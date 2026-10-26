'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { dentists, PRAXIS_ROLLEN, practices, practiceUsers } from '@/db/schema';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { praxisTourSetzen } from '@/lib/touren/vorgang';
import { einladungErstellen, einladungsLink, EINLADUNG_STUNDEN } from '@/lib/auth/einladung';
import { mitBerechtigung } from '@/lib/auth/guard';
import { alleSitzungenBeenden, anfrageInfo } from '@/lib/auth/sessions';
import { ausFormular, einstellungenSpeichern } from '@/lib/benachrichtigungen/einstellungen';
import { emailEinreihen } from '@/lib/email';
import { portalEinladungMail } from '@/lib/email/vorlagen';
import { AppError } from '@/lib/errors';
import { kundennummer, naechsteNummer } from '@/lib/nummern';
import { abrufAnstossen, anfragenAbschliessen } from '@/lib/website/anfragen-daten';

/*
 * Stammdaten: Ordinationen، Behandler و Portal-Zugänge (Spec فاز ۱، بخش C).
 * الگوی ثابت هر action: نشست و نقش ← zod ← عملیات ← logAudit ← revalidate.
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Höchstens ${max} Zeichen.`)
    .transform((v) => v || null);

const ordinationSchema = z.object({
  name: z.string().trim().min(2, 'Bitte den Namen der Ordination eingeben.').max(160),
  street: text(160),
  zip: text(12),
  city: text(80),
  uidNumber: text(20).refine((v) => !v || /^ATU\d{8}$/.test(v.replace(/\s/g, '')) || !v.startsWith('ATU'), 'Die UID-Nummer hat die Form ATU12345678.'),
  phone: text(40),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || null)
    .refine((v) => !v || z.string().email().safeParse(v).success, 'Bitte eine gültige E-Mail-Adresse eingeben.'),
  billingEmail: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .transform((v) => v || null)
    .refine((v) => !v || z.string().email().safeParse(v).success, 'Bitte eine gültige E-Mail-Adresse für Rechnungen eingeben.'),
  billingMode: z.enum(['sammel', 'einzel']),
  defaultDeliveryKind: z.enum(['', 'design', 'fertigung']).transform((v) => v || null),
  tourId: z
    .string()
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || z.string().uuid().safeParse(v).success, 'Ungültige Tour.'),
  deliveryNotes: text(1000),
});

function pfadVon(id: string) {
  revalidatePath('/intern', 'layout');
  return `/ordinationen/${id}`;
}

export async function ordinationAnlegen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  let neueId = '';
  const ergebnis = await ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const r = ordinationSchema.safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: r.error.issues[0].message };
    const daten = { ...r.data, uidNumber: r.data.uidNumber?.replace(/\s/g, '') ?? null };

    const neu = await db().transaction(async (tx) => {
      const nr = kundennummer(await naechsteNummer(tx, 'kunde'));
      const [p] = await tx.insert(practices).values({ ...daten, customerNo: nr }).returning();
      return p;
    });
    if (neu.tourId) await praxisTourSetzen(neu.id, neu.tourId);
    await logAudit({ aktion: 'ordination_angelegt', akteur: akteurVon(ich), ziel: { typ: 'practice', id: neu.id }, details: { kundennummer: neu.customerNo, name: neu.name }, ip: (await anfrageInfo()).ip });
    neueId = neu.id;
    return null;
  });
  if (ergebnis?.fehler) return ergebnis;
  redirect(`${pfadVon(neueId)}?neu=1`);
}

export async function ordinationSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const r = ordinationSchema.extend({ id: z.string().uuid(), isActive: z.enum(['ja', 'nein']).transform((v) => v === 'ja') }).safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: r.error.issues[0].message };
    const { id, ...daten } = { ...r.data, uidNumber: r.data.uidNumber?.replace(/\s/g, '') ?? null };

    const [vorher] = await db().select().from(practices).where(eq(practices.id, id)).limit(1);
    if (!vorher) throw new AppError('Diese Ordination gibt es nicht mehr.');
    const diff = aenderungen(vorher, daten);
    if (!Object.keys(diff).length) return { erfolg: 'Keine Änderungen.' };

    await db().update(practices).set({ ...daten, updatedAt: new Date() }).where(eq(practices.id, id));
    // andere Tour: ans Ende ihrer Route
    if (diff.tourId) await praxisTourSetzen(id, daten.tourId ?? null);
    // غیرفعال شد: همهٔ کاربران پورتال این Ordination فوراً بیرون می‌افتند
    if (vorher.isActive && !daten.isActive) {
      const nutzer = await db().select({ id: practiceUsers.id }).from(practiceUsers).where(eq(practiceUsers.practiceId, id));
      for (const n of nutzer) await alleSitzungenBeenden('practice', n.id);
    }
    await logAudit({ aktion: 'ordination_geaendert', akteur: akteurVon(ich), ziel: { typ: 'practice', id }, details: diff, ip: (await anfrageInfo()).ip });
    pfadVon(id);
    return { erfolg: daten.isActive ? 'Gespeichert.' : 'Gespeichert. Die Ordination ist deaktiviert; ihre Portal-Zugänge wurden sofort abgemeldet.' };
  });
}

/* ── Behandler ─────────────────────────────────────────────── */

const behandlerSchema = z.object({
  title: text(40),
  firstName: z.string().trim().min(1, 'Bitte den Vornamen eingeben.').max(80),
  lastName: z.string().trim().min(1, 'Bitte den Nachnamen eingeben.').max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v || null)
    .refine((v) => !v || z.string().email().safeParse(v).success, 'Bitte eine gültige E-Mail-Adresse eingeben.'),
});

export async function behandlerAnlegen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const r = behandlerSchema.extend({ practiceId: z.string().uuid() }).safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: r.error.issues[0].message };
    const [praxis] = await db().select({ id: practices.id }).from(practices).where(eq(practices.id, r.data.practiceId)).limit(1);
    if (!praxis) throw new AppError('Diese Ordination gibt es nicht mehr.');
    const [neu] = await db().insert(dentists).values(r.data).returning();
    await logAudit({ aktion: 'behandler_angelegt', akteur: akteurVon(ich), ziel: { typ: 'dentist', id: neu.id }, details: { ordination: praxis.id, name: `${neu.firstName} ${neu.lastName}` }, ip: (await anfrageInfo()).ip });
    pfadVon(praxis.id);
    return { erfolg: `${[neu.title, neu.firstName, neu.lastName].filter(Boolean).join(' ')} ist angelegt.` };
  });
}

export async function behandlerSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const r = behandlerSchema
      .extend({ id: z.string().uuid(), isActive: z.enum(['ja', 'nein']).transform((v) => v === 'ja') })
      .safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: r.error.issues[0].message };
    const { id, ...daten } = r.data;
    const [vorher] = await db().select().from(dentists).where(eq(dentists.id, id)).limit(1);
    if (!vorher) throw new AppError('Diesen Behandler gibt es nicht mehr.');
    const diff = aenderungen(vorher, daten);
    if (!Object.keys(diff).length) return { erfolg: 'Keine Änderungen.' };
    await db().update(dentists).set(daten).where(eq(dentists.id, id));
    await logAudit({ aktion: 'behandler_geaendert', akteur: akteurVon(ich), ziel: { typ: 'dentist', id }, details: diff, ip: (await anfrageInfo()).ip });
    pfadVon(vorher.practiceId);
    return { erfolg: 'Gespeichert.' };
  });
}

/* ── Portal-Zugänge ───────────────────────────────────────── */

async function portalEinladungSenden(nutzer: { id: string; name: string; email: string }, ordination: string) {
  const token = await einladungErstellen('practice', nutzer.id);
  const link = einladungsLink('practice', token);
  const mail = portalEinladungMail({ name: nutzer.name, ordination, link, gueltigStunden: EINLADUNG_STUNDEN });
  await emailEinreihen({ an: nutzer.email, betreff: mail.betreff, text: mail.text, html: mail.html });
  await db().update(practiceUsers).set({ invitedAt: new Date() }).where(eq(practiceUsers.id, nutzer.id));
  return link;
}

const zugangSchema = z.object({
  practiceId: z.string().uuid({ message: 'Bitte eine Ordination wählen.' }),
  name: z.string().trim().min(2, 'Bitte den Namen eingeben.').max(120),
  email: z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse eingeben.'),
  rolle: z.enum(PRAXIS_ROLLEN, { message: 'Bitte eine Rolle wählen.' }),
});

/**
 * Portal-Zugang anlegen und Einladung senden; gemeinsam für die Ordinationsseite und Anfragen von der Website.
 * درخواست‌های باز سایت با همین ایمیل خودکار «eingeladen» می‌شوند (و سایت «contacted»).
 */
async function zugangEinladen(ich: Parameters<typeof akteurVon>[0], form: FormData): Promise<Ergebnis & { practiceId?: string }> {
  const r = zugangSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { fehler: r.error.issues[0].message };
  const [praxis] = await db().select().from(practices).where(eq(practices.id, r.data.practiceId)).limit(1);
  if (!praxis) throw new AppError('Diese Ordination gibt es nicht mehr.');
  if (!praxis.isActive) return { fehler: 'Die Ordination ist deaktiviert. Bitte zuerst aktivieren.' };

  const [neu] = await db()
    .insert(practiceUsers)
    .values({ practiceId: praxis.id, name: r.data.name, email: r.data.email, role: r.data.rolle })
    .onConflictDoNothing({ target: practiceUsers.email })
    .returning();
  if (!neu) return { fehler: 'Für diese E-Mail-Adresse gibt es bereits einen Portal-Zugang.' };

  const link = await portalEinladungSenden(neu, praxis.name);
  const akteur = akteurVon(ich);
  const ip = (await anfrageInfo()).ip;
  await logAudit({ aktion: 'praxiszugang_eingeladen', akteur, ziel: { typ: 'practice_user', id: neu.id }, details: { ordination: praxis.id, email: neu.email, rolle: neu.role }, ip });
  const anfragen = await anfragenAbschliessen({ email: neu.email }, 'eingeladen', akteur, neu.id);
  for (const a of anfragen) await logAudit({ aktion: 'portal_anfrage_eingeladen', akteur, ziel: { typ: 'portal_anfrage', id: a.id }, details: { email: a.email, ordination: praxis.id }, ip });
  return { erfolg: `Einladung an ${neu.email} wurde verschickt.`, link, practiceId: praxis.id };
}

export async function praxisZugangEinladen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const { practiceId, ...ergebnis } = await zugangEinladen(ich, form);
    if (practiceId) pfadVon(practiceId);
    return ergebnis;
  });
}

/* ── Anfragen von der Website (Praxisportal-Zugang) ───────── */

/** «Einladen» direkt bei der Anfrage: Ordination wählen, Name und E-Mail aus dem Formular der Website. */
export async function anfrageEinladen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const { practiceId, ...ergebnis } = await zugangEinladen(ich, form);
    if (practiceId) {
      revalidatePath('/intern', 'layout');
      // die Anfrage selbst schließen, auch wenn die Einladung an eine andere Adresse ging (z. B. korrigiert)
      const id = z.string().uuid().safeParse(form.get('anfrageId'));
      if (id.success) {
        const akteur = akteurVon(ich);
        const [a] = await anfragenAbschliessen({ id: id.data }, 'eingeladen', akteur);
        if (a) await logAudit({ aktion: 'portal_anfrage_eingeladen', akteur, ziel: { typ: 'portal_anfrage', id: a.id }, details: { email: a.email, ordination: practiceId }, ip: (await anfrageInfo()).ip });
      }
    }
    return ergebnis;
  });
}

/** Anfrage ohne Einladung schließen (z. B. doppelt, kein Dentallabor-Kunde) */
export async function anfrageErledigt(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const id = z.string().uuid().safeParse(form.get('anfrageId'));
    if (!id.success) throw new AppError('Anfrage nicht gefunden.');
    const akteur = akteurVon(ich);
    const [a] = await anfragenAbschliessen({ id: id.data }, 'erledigt', akteur);
    if (!a) return { fehler: 'Diese Anfrage ist schon erledigt.' };
    await logAudit({ aktion: 'portal_anfrage_erledigt', akteur, ziel: { typ: 'portal_anfrage', id: a.id }, details: { email: a.email }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Anfrage von ${a.email} als erledigt markiert.` };
  });
}

/** «Jetzt abrufen»: der Worker holt die Anfragen sofort, nicht erst in bis zu 5 Minuten */
export async function anfragenJetztAbrufen(_: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await mitBerechtigung('stammdaten.bearbeiten');
    await abrufAnstossen();
    return { erfolg: 'Wird abgerufen … Die Seite in einigen Sekunden neu laden.' };
  });
}

async function praxisNutzer(id: string) {
  const [z] = await db()
    .select({ nutzer: practiceUsers, ordination: practices.name })
    .from(practiceUsers)
    .innerJoin(practices, eq(practices.id, practiceUsers.practiceId))
    .where(eq(practiceUsers.id, id))
    .limit(1);
  if (!z) throw new AppError('Diesen Zugang gibt es nicht mehr.');
  return z;
}

export async function praxisZugangAktivUmschalten(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const r = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: 'Ungültige Angabe.' };
    const { nutzer } = await praxisNutzer(r.data.id);
    await db().update(practiceUsers).set({ isActive: !nutzer.isActive }).where(eq(practiceUsers.id, nutzer.id));
    if (nutzer.isActive) await alleSitzungenBeenden('practice', nutzer.id);
    await logAudit({
      aktion: nutzer.isActive ? 'praxiszugang_deaktiviert' : 'praxiszugang_aktiviert',
      akteur: akteurVon(ich),
      ziel: { typ: 'practice_user', id: nutzer.id },
      ip: (await anfrageInfo()).ip,
    });
    pfadVon(nutzer.practiceId);
    return { erfolg: nutzer.isActive ? `${nutzer.name} ist deaktiviert und wurde sofort abgemeldet.` : `${nutzer.name} ist wieder aktiv.` };
  });
}

export async function praxisZugangErneut(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const r = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: 'Ungültige Angabe.' };
    const { nutzer, ordination } = await praxisNutzer(r.data.id);
    // بازنشانی: رمز و اپ قبلی دیگر کار نمی‌کنند
    await db().update(practiceUsers).set({ passwordHash: null, totpEnabled: false, totpSecretEnc: null }).where(eq(practiceUsers.id, nutzer.id));
    await alleSitzungenBeenden('practice', nutzer.id);
    const link = await portalEinladungSenden(nutzer, ordination);
    await logAudit({ aktion: 'praxiszugang_erneuert', akteur: akteurVon(ich), ziel: { typ: 'practice_user', id: nutzer.id }, ip: (await anfrageInfo()).ip });
    pfadVon(nutzer.practiceId);
    return { erfolg: `Neue Einladung an ${nutzer.email} verschickt. Der alte Zugang gilt nicht mehr.`, link };
  });
}

/* ── E-Mail-Benachrichtigungen (Spec فاز ۱، بخش M) ───────────── */

/** مثلاً وقتی Ordination زنگ می‌زند. همان تنظیمی که Praxis-Admin در پورتال می‌بیند. */
export async function benachrichtigungenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('stammdaten.bearbeiten');
    const id = z.string().uuid().safeParse(form.get('practiceId'));
    if (!id.success) throw new AppError('Ordination nicht gefunden.');
    const [p] = await db().select({ id: practices.id }).from(practices).where(eq(practices.id, id.data)).limit(1);
    if (!p) throw new AppError('Ordination nicht gefunden.');
    const n = await einstellungenSpeichern(p.id, ausFormular(form), akteurVon(ich), (await anfrageInfo()).ip);
    pfadVon(p.id);
    return { erfolg: n ? 'Gespeichert.' : 'Keine Änderungen.' };
  });
}
