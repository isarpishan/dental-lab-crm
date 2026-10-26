'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { orderPositions, RABATT_ARTEN, ZAHLUNGSARTEN } from '@/db/schema';
import { faelle } from '@/lib/abrechnung/daten';
import { ausstellen, gutschreiben } from '@/lib/abrechnung/rechnung';
import { centLesen, centText } from '@/lib/abrechnung/geld';
import { POSITION_EINHEITEN, rabattLesen, summe } from '@/lib/abrechnung/positionen';
import { mahnen, mahnungSenden } from '@/lib/abrechnung/mahnung';
import { MAHNSTUFE_NAMEN } from '@/lib/abrechnung/mahnwesen';
import { versenden } from '@/lib/abrechnung/versand';
import { zahlungErfassen as erfassen, zahlungLoeschen as loeschen } from '@/lib/abrechnung/zahlungen';
import { akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';

const zeile = z.object({
  bezeichnung: z.string().trim().min(1, 'Bitte jeder Position eine Bezeichnung geben.').max(300, 'Die Bezeichnung ist zu lang.'),
  menge: z.coerce.number({ error: 'Bitte eine Menge eingeben.' }).int('Die Menge ist eine ganze Zahl.').min(1, 'Die Menge ist mindestens 1.').max(9999),
  einheit: z.enum(POSITION_EINHEITEN),
  einzelpreis: z.string(),
  rabatt: z.string().max(20).default(''),
  rabattArt: z.enum(RABATT_ARTEN).default('prozent'),
});
const eingabe = z.object({ orderId: z.uuid(), zeilen: z.array(zeile).min(1, 'Mindestens eine Position.').max(40, 'Höchstens 40 Positionen.') });

function zeilenAus(form: FormData): unknown {
  try {
    return JSON.parse(String(form.get('zeilen') ?? '[]'));
  } catch {
    throw new AppError('Die Positionen konnten nicht gelesen werden. Bitte laden Sie die Seite neu.');
  }
}

async function fallZumBearbeiten(orderId: string) {
  const [fall] = await faelle({ orderIds: [orderId] });
  if (!fall) throw new AppError('Auftrag nicht gefunden.');
  if (fall.status === 'storniert') throw new AppError('Stornierte Aufträge werden nicht verrechnet.');
  if (fall.rechnung) throw new AppError(`Der Auftrag steht auf der Rechnung ${fall.rechnung.nummer}. Ändern geht nur über eine Gutschrift.`);
  return fall;
}

function aktualisieren(orderId: string) {
  revalidatePath(`/intern/auftraege/${orderId}`);
  revalidatePath('/intern/abrechnung', 'layout');
}

/**
 * پوزیشن‌های یک سفارش (Spec فاز ۲، قدم ۱): نقش ← zod ← جایگزینی همهٔ ردیف‌ها در یک تراکنش ←
 * logAudit با قبل و بعد ← revalidate. قیمت‌ها با ویرگول اتریشی وارد و به سنت ذخیره می‌شوند.
 */
export async function positionenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const d = eingabe.safeParse({ orderId: form.get('orderId'), zeilen: zeilenAus(form) });
    if (!d.success) throw new AppError(d.error.issues[0]?.message ?? 'Bitte prüfen Sie die Positionen.');
    const neu = d.data.zeilen.map((z, i) => {
      const preis = centLesen(z.einzelpreis);
      if (!preis.ok) throw new AppError(`Position ${i + 1}: ${preis.fehler}`);
      if (preis.wert == null) throw new AppError(`Position ${i + 1}: Bitte einen Einzelpreis eingeben.`);
      const rabatt = rabattLesen(z.rabatt, z.rabattArt, preis.wert * z.menge);
      if (!rabatt.ok) throw new AppError(`Position ${i + 1}: ${rabatt.fehler}`);
      return { bezeichnung: z.bezeichnung, menge: z.menge, einheit: z.einheit, einzelpreisCent: preis.wert, rabatt: rabatt.wert };
    });
    const fall = await fallZumBearbeiten(d.data.orderId);
    await db().transaction(async (tx) => {
      await tx.delete(orderPositions).where(eq(orderPositions.orderId, fall.orderId));
      await tx.insert(orderPositions).values(
        neu.map(({ rabatt, ...p }, i) => ({
          orderId: fall.orderId,
          position: i + 1,
          ...p,
          rabattArt: rabatt?.art ?? null,
          rabattWert: rabatt?.wert ?? null,
          createdById: s.user.id,
          createdByLabel: s.user.name,
        })),
      );
    });
    await logAudit({
      aktion: 'positionen_geaendert',
      akteur: akteurVon(s.user),
      ziel: { typ: 'auftrag', id: fall.orderId },
      details: { vorher: { positionen: fall.positionen, summeCent: fall.summe.cent }, nachher: { positionen: neu, summeCent: summe(neu).cent } },
      ip: (await anfrageInfo()).ip,
    });
    aktualisieren(fall.orderId);
    return { erfolg: 'Positionen gespeichert.' };
  });
}

/** پوزیشن‌های دستی پاک می‌شوند و دوباره پیشنهاد خودکار معتبر است. */
export async function vorschlagWiederherstellen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const d = z.object({ orderId: z.uuid() }).safeParse({ orderId: form.get('orderId') });
    if (!d.success) throw new AppError('Auftrag nicht gefunden.');
    const fall = await fallZumBearbeiten(d.data.orderId);
    if (!fall.gespeichert) return { erfolg: 'Es gilt bereits der Vorschlag.' };
    await db().delete(orderPositions).where(eq(orderPositions.orderId, fall.orderId));
    await logAudit({
      aktion: 'positionen_zurueckgesetzt',
      akteur: akteurVon(s.user),
      ziel: { typ: 'auftrag', id: fall.orderId },
      details: { vorher: { positionen: fall.gespeichert, summeCent: fall.summe.cent }, nachher: { positionen: fall.vorschlag, summeCent: summe(fall.vorschlag).cent } },
      ip: (await anfrageInfo()).ip,
    });
    aktualisieren(fall.orderId);
    return { erfolg: 'Vorschlag wiederhergestellt.' };
  });
}

const auswahlSchema = z.union([
  z.object({ practiceId: z.uuid(), monat: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  z.object({ practiceId: z.uuid(), orderId: z.uuid() }),
]);

/**
 * «Rechnung ausstellen» (Spec فاز ۲، قدم ۲): نقش ← zod ← تأیید صریح ← `ausstellen` (قفل، شماره،
 * PDF، logAudit) ← revalidate ← برگشت به Konto. فاکتور صادرشده دیگر تغییر نمی‌کند.
 */
export async function rechnungAusstellen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  const r = await ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const roh = { practiceId: form.get('practiceId'), ...(form.get('monat') ? { monat: form.get('monat') } : { orderId: form.get('orderId') }) };
    const d = auswahlSchema.safeParse(roh);
    if (!d.success) throw new AppError('Ungültige Auswahl. Bitte laden Sie die Seite neu.');
    if (form.get('geprueft') !== 'ja') throw new AppError('Bitte bestätigen Sie, dass Sie die Rechnung geprüft haben.');
    const ip = (await anfrageInfo()).ip;
    const neu = await ausstellen(d.data.practiceId, 'monat' in d.data ? { monat: d.data.monat } : { orderId: d.data.orderId }, akteurVon(s.user), ip);
    // فاکتور در هر حال صادر شده است؛ اگر ایمیل آماده نشد، Konto آن را می‌گوید
    let versand = '';
    if (form.get('senden') === 'ja') versand = await versenden(neu.id, akteurVon(s.user), ip).then(() => '', () => '&versand=fehler');
    revalidatePath('/intern/abrechnung', 'layout');
    revalidatePath('/intern/auftraege', 'layout');
    return { erfolg: neu.nummer, link: `/abrechnung/${d.data.practiceId}?ausgestellt=${encodeURIComponent(neu.nummer)}${versand}` };
  });
  if (r?.link) redirect(r.link);
  return r;
}

const gutschriftZeile = z.object({ bezeichnung: z.string().trim().min(1, 'Bitte eine Bezeichnung eingeben.').max(300), betrag: z.string() });

/** «Stornieren» (Gutschrift برای کل مبلغ) یا Gutschrift با یک ردیف آزاد، مثلاً Kulanz. */
export async function gutschriftAusstellen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const id = z.uuid().safeParse(form.get('rechnungId'));
    if (!id.success) throw new AppError('Rechnung nicht gefunden.');
    const grund = String(form.get('grund') ?? '').trim();
    if (!grund) throw new AppError('Bitte einen Grund angeben.');
    if (grund.length > 300) throw new AppError('Der Grund ist zu lang.');
    const ip = (await anfrageInfo()).ip;
    let neu;
    if (form.get('storno') === 'ja') {
      neu = await gutschreiben(id.data, { storno: true, grund }, akteurVon(s.user), ip);
    } else {
      const z1 = gutschriftZeile.safeParse({ bezeichnung: form.get('bezeichnung'), betrag: form.get('betrag') });
      if (!z1.success) throw new AppError(z1.error.issues[0]?.message ?? 'Bitte prüfen Sie die Eingabe.');
      const betrag = centLesen(z1.data.betrag);
      if (!betrag.ok) throw new AppError(betrag.fehler);
      if (!betrag.wert) throw new AppError('Bitte einen Betrag eingeben.');
      neu = await gutschreiben(id.data, { storno: false, grund, zeilen: [{ bezeichnung: z1.data.bezeichnung, betragCent: betrag.wert }] }, akteurVon(s.user), ip);
    }
    let hinweis = '';
    if (form.get('senden') === 'ja') {
      hinweis = await versenden(neu.id, akteurVon(s.user), ip).then(
        (v) => ` Die E-Mail an ${v.an} wird gesendet.`,
        (e) => ` Nicht per E-Mail gesendet: ${e instanceof AppError ? e.message : 'unerwarteter Fehler.'}`,
      );
    }
    revalidatePath('/intern/abrechnung', 'layout');
    revalidatePath('/intern/auftraege', 'layout');
    return { erfolg: `${neu.nummer} ausgestellt.${hinweis}` };
  });
}

/** Rechnung یا Gutschrift صادرشده را (دوباره) با ایمیل می‌فرستد، با PDF پیوست (Spec فاز ۲، قدم ۳). */
export async function rechnungSenden(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const id = z.uuid().safeParse(form.get('rechnungId'));
    if (!id.success) throw new AppError('Rechnung nicht gefunden.');
    const v = await versenden(id.data, akteurVon(s.user), (await anfrageInfo()).ip);
    revalidatePath('/intern/abrechnung', 'layout');
    return { erfolg: `${v.nummer} wird an ${v.an} gesendet.` };
  });
}

const zahlungSchema = z.object({
  rechnungId: z.uuid(),
  betrag: z.string(),
  am: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte das Datum der Zahlung wählen.')
    .refine((v) => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v), 'Bitte ein gültiges Datum wählen.'),
  art: z.enum(ZAHLUNGSARTEN, { error: 'Bitte die Zahlungsart wählen.' }),
  notiz: z
    .string()
    .trim()
    .max(300, 'Die Notiz ist zu lang.')
    .transform((v) => v || null),
});

/** «Zahlung buchen» (Spec فاز ۲، قدم ۳): پرداخت از روی صورت‌حساب بانک، حداکثر تا مبلغ باز. در Konto و در تب «Offen». */
export async function zahlungErfassen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const d = zahlungSchema.safeParse({ rechnungId: form.get('rechnungId'), betrag: form.get('betrag') ?? '', am: form.get('am') ?? '', art: form.get('art'), notiz: form.get('notiz') ?? '' });
    if (!d.success) throw new AppError(d.error.issues[0]?.message ?? 'Bitte prüfen Sie die Eingabe.');
    const betrag = centLesen(d.data.betrag);
    if (!betrag.ok) throw new AppError(betrag.fehler);
    if (!betrag.wert) throw new AppError('Bitte einen Betrag eingeben.');
    const neu = await erfassen(d.data.rechnungId, { betragCent: betrag.wert, am: d.data.am, art: d.data.art, notiz: d.data.notiz }, akteurVon(s.user), (await anfrageInfo()).ip);
    revalidatePath('/intern/abrechnung', 'layout');
    return { erfolg: neu.restCent > 0 ? `Zahlung zu ${neu.nummer} gebucht. Noch offen: ${centText(neu.restCent)}.` : `Zahlung zu ${neu.nummer} gebucht. ${neu.nummer} ist bezahlt.` };
  });
}

/** Zahlung اشتباه ثبت‌شده؛ داده‌هایش در audit می‌ماند. */
export async function zahlungLoeschen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const id = z.uuid().safeParse(form.get('zahlungId'));
    if (!id.success) throw new AppError('Diese Zahlung gibt es nicht mehr.');
    const z1 = await loeschen(id.data, akteurVon(s.user), (await anfrageInfo()).ip);
    revalidatePath('/intern/abrechnung', 'layout');
    return { erfolg: `Zahlung zu ${z1.nummer} gelöscht.` };
  });
}

const mahnText = (m: { stufe: 1 | 2 | 3; nummer: string; an: string | null }) =>
  m.an
    ? `${MAHNSTUFE_NAMEN[m.stufe]} zu ${m.nummer} wird an ${m.an} gesendet.`
    : `${MAHNSTUFE_NAMEN[m.stufe]} zu ${m.nummer} erstellt. Ohne E-Mail-Adresse: bitte das PDF ausdrucken und schicken.`;

/** Zahlungserinnerung یا Mahnung رسیده برای یک Rechnung (Spec فاز ۲، قدم ۴): ساختن PDF و، اگر آدرس هست، ارسال. */
export async function mahnungErstellen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const id = z.uuid().safeParse(form.get('rechnungId'));
    if (!id.success) throw new AppError('Rechnung nicht gefunden.');
    const m = await mahnen(id.data, akteurVon(s.user), (await anfrageInfo()).ip);
    revalidatePath('/intern/abrechnung', 'layout');
    return { erfolg: mahnText(m) };
  });
}

/** «Alle senden»: همهٔ نامه‌های رسیدهٔ فهرست، یکی‌یکی؛ اگر یکی نشد، بقیه می‌روند. */
export async function mahnungenErstellen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const ids = z.array(z.uuid()).min(1, 'Keine Mahnung ausgewählt.').max(300).safeParse(form.getAll('rechnungId'));
    if (!ids.success) throw new AppError(ids.error.issues[0]?.message ?? 'Keine Mahnung ausgewählt.');
    const ip = (await anfrageInfo()).ip;
    let gesendet = 0;
    let ohneAdresse = 0;
    const fehler: string[] = [];
    for (const id of ids.data) {
      try {
        const m = await mahnen(id, akteurVon(s.user), ip);
        if (m.an) gesendet++;
        else ohneAdresse++;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        fehler.push(e.message);
      }
    }
    revalidatePath('/intern/abrechnung', 'layout');
    const teile = [
      gesendet ? `${gesendet} per E-Mail gesendet` : null,
      ohneAdresse ? `${ohneAdresse} ohne E-Mail-Adresse erstellt (bitte ausdrucken)` : null,
      fehler.length ? `nicht erstellt: ${fehler.join(' ')}` : null,
    ].filter(Boolean);
    if (!gesendet && !ohneAdresse) return { fehler: teile.join('. ') || 'Nichts erstellt.' };
    return { erfolg: `${teile.join('. ')}.` };
  });
}

/** نامه‌ای که نرفته (بی‌آدرس یا خطای ارسال)، دوباره با ایمیل. */
export async function mahnungNochmalSenden(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await mitBerechtigung('abrechnung.bearbeiten');
    const id = z.uuid().safeParse(form.get('mahnungId'));
    if (!id.success) throw new AppError('Dieses Schreiben gibt es nicht.');
    const v = await mahnungSenden(id.data, akteurVon(s.user), (await anfrageInfo()).ip);
    revalidatePath('/intern/abrechnung', 'layout');
    return { erfolg: mahnText(v) };
  });
}
