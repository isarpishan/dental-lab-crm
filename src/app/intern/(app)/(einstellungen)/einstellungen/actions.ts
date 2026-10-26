'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { mahnwesenFehler } from '@/lib/abrechnung/mahnwesen';
import { ibanGueltig, rechnungsdatenAus } from '@/lib/abrechnung/rechnungsdaten';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';

const text = (max: number) => z.string().trim().max(max, 'Eine Angabe ist zu lang.');
const pflicht = (max: number, meldung: string) => z.string().trim().min(1, meldung).max(max, 'Eine Angabe ist zu lang.');

const ausstellerSchema = z.object({
  name: pflicht(150, 'Bitte den Namen angeben.'),
  zusatz: text(200),
  strasse: pflicht(150, 'Bitte Straße und Hausnummer angeben.'),
  plz: text(10),
  ort: pflicht(100, 'Bitte den Ort angeben.'),
  land: text(60),
  telefon: text(40),
  email: text(120),
  web: text(120),
});

const rechnungSchema = z.object({
  iban: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, '').toUpperCase())
    .refine(ibanGueltig, 'Die IBAN ist nicht gültig (Prüfziffer). Bitte noch einmal prüfen.'),
  bic: text(11).transform((v) => v.replace(/\s/g, '').toUpperCase()),
  uid: text(20).transform((v) => v.replace(/\s/g, '').toUpperCase()),
  zahlungszielTage: z.coerce.number({ error: 'Bitte das Zahlungsziel in Tagen angeben.' }).int().min(0, 'Mindestens 0 Tage.').max(120, 'Höchstens 120 Tage.'),
  hinweis: pflicht(300, 'Bitte den Hinweis zur Umsatzsteuer angeben.'),
  fusstext: text(500),
});

async function speichern(key: 'aussteller' | 'rechnung' | 'mahnwesen', neu: Record<string, unknown>, akteur: { kind: 'staff'; id: string; label: string }) {
  const [alt] = await db().select({ value: settings.value }).from(settings).where(eq(settings.key, key)).limit(1);
  const diff = aenderungen((alt?.value ?? {}) as Record<string, unknown>, neu);
  if (!Object.keys(diff).length) return false;
  await db()
    .insert(settings)
    .values({ key, value: neu })
    .onConflictDoUpdate({ target: settings.key, set: { value: neu, updatedAt: new Date() } });
  await logAudit({ aktion: 'einstellungen_geaendert', akteur, ziel: { typ: 'einstellung', id: key }, details: diff, ip: (await anfrageInfo()).ip });
  return true;
}

/** «Aussteller» (فقط Inhaber): روی اسناد و فاکتورهای بعدی؛ اسناد صادرشده دست نمی‌خورند. */
export async function ausstellerSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('einstellungen.verwalten');
    const d = ausstellerSchema.safeParse(Object.fromEntries(form));
    if (!d.success) throw new AppError(d.error.issues[0]?.message ?? 'Bitte prüfen Sie die Angaben.');
    const geaendert = await speichern('aussteller', d.data, akteurVon(s.user));
    revalidatePath('/intern/einstellungen');
    return { erfolg: geaendert ? 'Gespeichert. Gilt für alle neuen Dokumente und Rechnungen.' : 'Keine Änderungen.' };
  });
}

/** «Rechnungen» (فقط Inhaber): IBAN، BIC، UID، مهلت پرداخت، متن معافیت مالیاتی، متن پایانی. */
export async function rechnungsdatenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('einstellungen.verwalten');
    const d = rechnungSchema.safeParse(Object.fromEntries(form));
    if (!d.success) throw new AppError(d.error.issues[0]?.message ?? 'Bitte prüfen Sie die Angaben.');
    const geaendert = await speichern('rechnung', rechnungsdatenAus(d.data), akteurVon(s.user));
    revalidatePath('/intern/einstellungen');
    return { erfolg: geaendert ? 'Gespeichert. Gilt für alle neuen Rechnungen.' : 'Keine Änderungen.' };
  });
}

const tageFeld = (name: string) => z.coerce.number({ error: `Bitte ${name} in Tagen angeben.` }).int(`${name}: bitte ganze Tage.`);
const mahnSchema = z.object({
  erinnerungTage: tageFeld('die Zahlungserinnerung'),
  mahnung1Tage: tageFeld('die 1. Mahnung'),
  mahnung2Tage: tageFeld('die 2. Mahnung'),
  fristTage: tageFeld('die neue Frist'),
});

/** «Mahnwesen» (فقط Inhaber؛ Spec فاز ۲، قدم ۴): چند روز بعد از سررسید هر مرحله، و مهلت تازه. */
export async function mahnwesenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('einstellungen.verwalten');
    const d = mahnSchema.safeParse(Object.fromEntries(form));
    if (!d.success) throw new AppError(d.error.issues[0]?.message ?? 'Bitte prüfen Sie die Angaben.');
    const fehler = mahnwesenFehler(d.data);
    if (fehler) throw new AppError(fehler);
    const geaendert = await speichern('mahnwesen', d.data, akteurVon(s.user));
    revalidatePath('/intern/einstellungen');
    revalidatePath('/intern/abrechnung', 'layout');
    return { erfolg: geaendert ? 'Gespeichert. Gilt ab sofort für die Liste der fälligen Mahnungen.' : 'Keine Änderungen.' };
  });
}
