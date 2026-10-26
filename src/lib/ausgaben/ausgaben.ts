import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { belegEingang, expenses, fixkostenLaeufe } from '@/db/schema';
import { centLesen, centText } from '@/lib/abrechnung/geld';
import { dateinameBereinigen } from '@/lib/dateien/regeln';
import { AppError } from '@/lib/errors';
import { heuteIso, isoDatumText } from '@/lib/format';
import { kopfLesen, lesen, loeschen, speichern, ZuGross } from '@/lib/storage';
import { AUSGABE_KATEGORIEN, BELEG_MAX_BYTES, belegTypVon, istMwstSatz, lieferantNormal, mwstAusNetto, mwstPasst } from './text';

/**
 * «Ausgaben» (Einnahmen-Ausgaben-Rechnung، فقط Inhaber). هر Ausgabe از روی Rechnung فروشنده ثبت می‌شود؛
 * Beleg جدا و بعد از ذخیره از `api/ausgaben/[id]/beleg` می‌آید (عکس‌های موبایل بزرگ‌تر از سقف server action‌اند).
 * Beleg وقتی ثبت شد عوض نمی‌شود و Ausgabe فقط علامت «gelöscht» می‌خورد (trigger در migration 0025).
 */

const DATUM_FEHLER = 'Bitte ein gültiges Datum angeben.';
const datum = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, DATUM_FEHLER)
  .refine((v) => !Number.isNaN(Date.parse(v)) && v >= '2000-01-01', DATUM_FEHLER);

const betrag = (feld: string) =>
  z.string().transform((v, ctx) => {
    const r = centLesen(v);
    if (r.ok) return r.wert;
    ctx.addIssue({ code: 'custom', message: `${feld}: ${r.fehler}` });
    return z.NEVER;
  });

const formSchema = z.object({
  rechnungsdatum: datum,
  bezahltAm: z.union([z.literal(''), datum]),
  lieferant: z.string().trim().min(1, 'Bitte den Lieferanten angeben.').max(120, 'Der Lieferant ist zu lang.'),
  rechnungsnummer: z.string().trim().max(60, 'Die Rechnungsnummer ist zu lang.'),
  kategorie: z.enum(AUSGABE_KATEGORIEN, { message: 'Bitte eine Kategorie wählen.' }),
  beschreibung: z.string().trim().max(300, 'Die Beschreibung ist zu lang (höchstens 300 Zeichen).'),
  netto: betrag('Netto'),
  satz: z.enum(['20', '13', '10', '0', 'anders'], { message: 'Bitte den MwSt-Satz wählen.' }),
  mwst: betrag('MwSt'),
});

export type AusgabeEingabe = Omit<typeof expenses.$inferInsert, 'id' | 'erfasstVonLabel'>;

/** فرم ← مقدارهای ذخیره‌شدنی، با همهٔ بررسی‌ها (مبلغ‌ها، تاریخ‌ها، MwSt با نرخ). */
export function ausgabePruefen(roh: Record<string, string>, heute = heuteIso()) {
  const p = formSchema.safeParse(roh);
  if (!p.success) throw new AppError(p.error.issues[0]?.message ?? 'Bitte die Angaben prüfen.');
  const e = p.data;
  if (e.rechnungsdatum > heute) throw new AppError('Das Rechnungsdatum liegt in der Zukunft.');
  const bezahltAm = e.bezahltAm || e.rechnungsdatum;
  if (bezahltAm > heute) throw new AppError('»Bezahlt am« liegt in der Zukunft.');
  if (e.netto == null || e.netto <= 0) throw new AppError('Bitte den Nettobetrag angeben.');
  let mwstSatz: number | null = null;
  let mwstCent: number;
  if (e.satz === 'anders') {
    if (e.mwst == null) throw new AppError('Bitte den MwSt-Betrag angeben.');
    mwstCent = e.mwst;
  } else {
    const satz = Number(e.satz);
    if (!istMwstSatz(satz)) throw new AppError('Bitte den MwSt-Satz wählen.');
    mwstSatz = satz;
    mwstCent = e.mwst ?? mwstAusNetto(e.netto, satz);
    if (!mwstPasst(e.netto, mwstCent, satz))
      throw new AppError(`Die MwSt von ${centText(mwstCent)} passt nicht zu ${satz} % von ${centText(e.netto)}. Bei mehreren Sätzen »Anderer Betrag« wählen.`);
  }
  return {
    rechnungsdatum: e.rechnungsdatum,
    bezahltAm,
    lieferant: e.lieferant.replace(/\s+/g, ' '),
    rechnungsnummer: e.rechnungsnummer || null,
    kategorie: e.kategorie,
    beschreibung: e.beschreibung || null,
    nettoCent: e.netto,
    mwstSatz,
    mwstCent,
    bruttoCent: e.netto + mwstCent,
  };
}

type Werte = ReturnType<typeof ausgabePruefen>;
type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

/** همان Rechnung یک فروشنده دو بار ثبت نشود (همان شماره، بدون فرق بزرگی و کوچکی حروف). */
async function doppeltPruefen(tx: Tx, w: Werte, ausser: string | null) {
  if (!w.rechnungsnummer) return;
  const gleiche = await tx
    .select({ id: expenses.id, lieferant: expenses.lieferant, rechnungsdatum: expenses.rechnungsdatum })
    .from(expenses)
    .where(and(isNull(expenses.geloeschtAm), sql`lower(${expenses.rechnungsnummer}) = lower(${w.rechnungsnummer})`));
  const d = gleiche.find((g) => g.id !== ausser && lieferantNormal(g.lieferant) === lieferantNormal(w.lieferant));
  if (d) throw new AppError(`Diese Rechnung ist schon erfasst: ${d.lieferant}, Nr. ${w.rechnungsnummer} vom ${isoDatumText(d.rechnungsdatum)}.`);
}

/**
 * `eingangId`: aus «Zu prüfen» übernehmen. Der Beleg wandert in derselben Transaktion vom Eingang zur Ausgabe (die
 * Datei bleibt, wo sie ist), der Eingang verschwindet.
 */
export async function ausgabeAnlegen(roh: Record<string, string>, akteur: { id: string; label: string }, eingangId?: string, laufId?: string) {
  const w = ausgabePruefen(roh);
  return db().transaction(async (tx) => {
    // gleichzeitiges Doppelklicken: eine Sperre für alle Ausgaben (selten und kurz)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ausgaben'))`);
    await doppeltPruefen(tx, w, null);
    let beleg = {};
    if (eingangId) {
      const [e] = await tx.delete(belegEingang).where(eq(belegEingang.id, eingangId)).returning();
      if (!e) throw new AppError('Dieser Beleg ist nicht mehr unter »Zu prüfen« (schon übernommen oder verworfen).');
      beleg = { belegKey: e.belegKey, belegSha256: e.belegSha256, belegGroesse: e.belegGroesse, belegTyp: e.belegTyp, belegName: e.belegName, belegAm: e.hochgeladenAm };
    }
    const [neu] = await tx
      .insert(expenses)
      .values({ ...w, ...beleg, erfasstVon: akteur.id, erfasstVonLabel: akteur.label })
      .returning();
    // aus «Fixkosten» (Spec فاز ۵، قدم ۳): derselbe Lauf wird nur einmal übernommen
    if (laufId) {
      const [lauf] = await tx
        .update(fixkostenLaeufe)
        .set({ status: 'gebucht', expenseId: neu.id, erledigtAm: new Date() })
        .where(and(eq(fixkostenLaeufe.id, laufId), eq(fixkostenLaeufe.status, 'offen')))
        .returning({ id: fixkostenLaeufe.id });
      if (!lauf) throw new AppError('Diese Fixkosten sind schon erledigt (übernommen oder übersprungen).');
    }
    return neu;
  });
}

export async function ausgabeAendern(id: string, roh: Record<string, string>) {
  const w = ausgabePruefen(roh);
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('ausgaben'))`);
    const [vorher] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update');
    if (!vorher || vorher.geloeschtAm) throw new AppError('Diese Ausgabe gibt es nicht mehr.');
    await doppeltPruefen(tx, w, id);
    const [nachher] = await tx
      .update(expenses)
      .set({ ...w, geaendertAm: new Date() })
      .where(eq(expenses.id, id))
      .returning();
    return { vorher, nachher };
  });
}

/** Nur als gelöscht markieren; Zeile und Beleg bleiben (Aufbewahrungspflicht). */
export async function ausgabeLoeschen(id: string, label: string) {
  const [a] = await db()
    .update(expenses)
    .set({ geloeschtAm: new Date(), geloeschtVonLabel: label })
    .where(and(eq(expenses.id, id), isNull(expenses.geloeschtAm)))
    .returning();
  if (!a) throw new AppError('Diese Ausgabe gibt es nicht mehr.');
  return a;
}

/**
 * Beleg einer Ausgabe speichern (Body = Datei). Typ nur aus den ersten Bytes (PDF, JPEG, PNG, WebP, HEIC). Ein
 * vorhandener Beleg wird nie ersetzt.
 */
export async function belegSpeichern(id: string, d: { name: string | null; laenge: number | null; inhalt: ReadableStream<Uint8Array> | null }) {
  if (!d.inhalt) throw new AppError('Keine Datei empfangen.');
  if (d.laenge != null && d.laenge > BELEG_MAX_BYTES) throw new AppError('Der Beleg ist zu groß (höchstens 20 MB).');
  const [a] = await db().select({ geloeschtAm: expenses.geloeschtAm, belegKey: expenses.belegKey }).from(expenses).where(eq(expenses.id, id)).limit(1);
  if (!a || a.geloeschtAm) throw new AppError('Diese Ausgabe gibt es nicht mehr.');
  if (a.belegKey) throw new AppError('Diese Ausgabe hat schon einen Beleg.');

  let datei: Awaited<ReturnType<typeof speichern>>;
  try {
    datei = await speichern(d.inhalt, BELEG_MAX_BYTES);
  } catch (e) {
    if (e instanceof ZuGross) throw new AppError('Der Beleg ist zu groß (höchstens 20 MB).');
    throw e;
  }
  const typ = belegTypVon(await kopfLesen(datei.key));
  if (!typ || datei.groesse === 0) {
    await loeschen(datei.key);
    throw new AppError('Bitte ein Foto (JPG, PNG, HEIC) oder ein PDF wählen.');
  }
  const name = dateinameBereinigen(d.name ?? '') || `Beleg.${typ.endung}`;
  const [gesetzt] = await db()
    .update(expenses)
    .set({ belegKey: datei.key, belegSha256: datei.sha256, belegGroesse: datei.groesse, belegTyp: typ.typ, belegName: name, belegAm: new Date() })
    .where(and(eq(expenses.id, id), isNull(expenses.belegKey), isNull(expenses.geloeschtAm)))
    .returning({ id: expenses.id, lieferant: expenses.lieferant, rechnungsnummer: expenses.rechnungsnummer });
  if (!gesetzt) {
    await loeschen(datei.key);
    throw new AppError('Diese Ausgabe hat schon einen Beleg.');
  }
  return { ...gesetzt, name, typ: typ.typ, groesse: datei.groesse };
}

export async function belegLaden(id: string) {
  const [a] = await db()
    .select({ key: expenses.belegKey, typ: expenses.belegTyp, name: expenses.belegName, groesse: expenses.belegGroesse })
    .from(expenses)
    .where(eq(expenses.id, id))
    .limit(1);
  if (!a?.key || !a.typ || a.groesse == null) return null;
  return { typ: a.typ, name: a.name ?? 'Beleg', groesse: a.groesse, oeffnen: () => lesen(a.key!) };
}

export type AusgabeZeile = {
  id: string;
  rechnungsdatum: string;
  bezahltAm: string;
  lieferant: string;
  rechnungsnummer: string | null;
  kategorie: (typeof AUSGABE_KATEGORIEN)[number];
  beschreibung: string | null;
  nettoCent: number;
  mwstSatz: number | null;
  mwstCent: number;
  bruttoCent: number;
  beleg: { typ: string; name: string; groesse: number } | null;
  erfasstVonLabel: string;
};

/** Alle nicht gelöschten Ausgaben, neueste Zahlung zuerst (wenige hundert im Jahr). */
export async function alleAusgaben(): Promise<AusgabeZeile[]> {
  const zeilen = await db().select().from(expenses).where(isNull(expenses.geloeschtAm));
  return zeilen
    .map((a) => ({
      id: a.id,
      rechnungsdatum: a.rechnungsdatum,
      bezahltAm: a.bezahltAm,
      lieferant: a.lieferant,
      rechnungsnummer: a.rechnungsnummer,
      kategorie: a.kategorie,
      beschreibung: a.beschreibung,
      nettoCent: a.nettoCent,
      mwstSatz: a.mwstSatz,
      mwstCent: a.mwstCent,
      bruttoCent: a.bruttoCent,
      beleg: a.belegKey && a.belegTyp && a.belegGroesse != null ? { typ: a.belegTyp, name: a.belegName ?? 'Beleg', groesse: a.belegGroesse } : null,
      erfasstVonLabel: a.erfasstVonLabel,
    }))
    .sort((x, y) => y.bezahltAm.localeCompare(x.bezahltAm) || y.rechnungsdatum.localeCompare(x.rechnungsdatum) || x.lieferant.localeCompare(y.lieferant, 'de-AT'));
}
