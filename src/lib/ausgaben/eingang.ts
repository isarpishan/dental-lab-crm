import 'server-only';
import { and, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { belegEingang, expenses, kiNutzung, privatBuchungen } from '@/db/schema';
import { belegLesen, type BelegVorschlag } from '@/lib/ai-safe';
import { dateinameBereinigen } from '@/lib/dateien/regeln';
import { AppError } from '@/lib/errors';
import { isoDatumText } from '@/lib/format';
import { kiLaden } from '@/lib/ki/einstellungen';
import { ganzLesen, kopfLesen, loeschen, speichern, ZuGross } from '@/lib/storage';
import { BELEG_MAX_BYTES, belegTypVon, lieferantNormal } from './text';

/**
 * «Zu prüfen» (Ausgaben قدم ۲): Beleg بالا می‌آید، همان لحظه Claude آن را می‌خواند (`lib/ai-safe.ts`) و پیشنهاد
 * در `beleg_eingang.vorschlag` می‌ماند. «Übernehmen» در `ausgaben.ts` (`ausgabeAnlegen` با `eingangId`) Beleg را به
 * Ausgabe منتقل می‌کند. یک فایل دو بار پذیرفته نمی‌شود (sha256، در Ausgaben، Privat و همین Eingang).
 * از ۲۵ اکتبر ۲۰۲۶ (Spec فاز ۵، قدم ۲) هر Beleg یک `bereich` دارد: «privat» اگر در «Privat» بالا آمد یا KI این را
 * پیشنهاد کرد؛ «Zu prüfen» هر Bereich فقط Belegهای خودش را نشان می‌دهد. Übernehmen برای Privat در `lib/privat/buchungen.ts`.
 */

export type EingangBereich = 'ddl' | 'privat';

export async function eingangHochladen(
  d: { name: string | null; laenge: number | null; inhalt: ReadableStream<Uint8Array> | null },
  akteur: { id: string; label: string },
  bereich: EingangBereich | null = null,
) {
  if (!d.inhalt) throw new AppError('Keine Datei empfangen.');
  if (d.laenge != null && d.laenge > BELEG_MAX_BYTES) throw new AppError('Der Beleg ist zu groß (höchstens 20 MB).');
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
  const [schon] = await db()
    .select({ lieferant: expenses.lieferant, rechnungsdatum: expenses.rechnungsdatum })
    .from(expenses)
    .where(and(eq(expenses.belegSha256, datei.sha256), isNull(expenses.geloeschtAm)))
    .limit(1);
  const [privat] = schon
    ? []
    : await db()
        .select({ haendler: privatBuchungen.haendler, datum: privatBuchungen.datum })
        .from(privatBuchungen)
        .where(and(eq(privatBuchungen.belegSha256, datei.sha256), isNull(privatBuchungen.geloeschtAm)))
        .limit(1);
  const [imEingang] = schon || privat ? [] : await db().select({ id: belegEingang.id }).from(belegEingang).where(eq(belegEingang.belegSha256, datei.sha256)).limit(1);
  if (schon || privat || imEingang) {
    await loeschen(datei.key);
    throw new AppError(
      schon
        ? `Dieser Beleg ist schon erfasst: ${schon.lieferant} vom ${isoDatumText(schon.rechnungsdatum)}.`
        : privat
          ? `Dieser Beleg ist schon unter »Privat« erfasst${privat.haendler ? `: ${privat.haendler}` : ''} vom ${isoDatumText(privat.datum)}.`
          : 'Dieser Beleg liegt schon unter »Zu prüfen«.',
    );
  }
  const [neu] = await db()
    .insert(belegEingang)
    .values({
      belegKey: datei.key,
      belegSha256: datei.sha256,
      belegGroesse: datei.groesse,
      belegTyp: typ.typ,
      belegName: dateinameBereinigen(d.name ?? '') || `Beleg.${typ.endung}`,
      hochgeladenVon: akteur.id,
      hochgeladenVonLabel: akteur.label,
      bereich,
    })
    .returning();
  return neu;
}

/** Claude liest den Beleg. Ohne Schlüssel oder bei einem Fehler bleibt er mit Hinweis im Eingang (von Hand eintragen). */
export async function eingangLesen(id: string) {
  const [e] = await db().select().from(belegEingang).where(eq(belegEingang.id, id)).limit(1);
  if (!e) throw new AppError('Dieser Beleg ist nicht mehr unter »Zu prüfen«.');
  const ki = await kiLaden();
  if (!ki.schluessel) {
    const fehler = 'Automatisches Lesen ist aus: unter Einstellungen → KI den Schlüssel von Anthropic eintragen. Bis dahin die Angaben von Hand eintragen.';
    await db().update(belegEingang).set({ status: 'fehler', fehler }).where(eq(belegEingang.id, id));
    return { status: 'fehler' as const, fehler, vorschlag: null };
  }
  const r = await belegLesen({ inhalt: await ganzLesen(e.belegKey), typ: e.belegTyp }, { schluessel: ki.schluessel, modell: ki.modell });
  if (r.eingabeTokens || r.ausgabeTokens) {
    await db().insert(kiNutzung).values({ zweck: 'beleg_lesen', modell: r.modell, eingabeTokens: r.eingabeTokens, ausgabeTokens: r.ausgabeTokens, erfolgreich: r.ok });
  }
  if (!r.ok) {
    await db().update(belegEingang).set({ status: 'fehler', fehler: r.fehler, kiModell: r.modell, gelesenAm: new Date() }).where(eq(belegEingang.id, id));
    return { status: 'fehler' as const, fehler: r.fehler, vorschlag: null };
  }
  const fehler = r.vorschlag.istRechnung ? null : 'Das sieht nicht nach einer Rechnung aus. Bitte prüfen oder verwerfen.';
  // Bereich: was beim Hochladen gewählt wurde, sonst der Vorschlag der KI
  const bereich = e.bereich ?? (r.vorschlag.bereich === 'privat' ? 'privat' : null);
  await db().update(belegEingang).set({ status: 'gelesen', vorschlag: r.vorschlag, fehler, kiModell: r.modell, gelesenAm: new Date(), bereich }).where(eq(belegEingang.id, id));
  return { status: 'gelesen' as const, fehler, vorschlag: r.vorschlag };
}

export async function eingangVerwerfen(id: string) {
  const [weg] = await db().delete(belegEingang).where(eq(belegEingang.id, id)).returning();
  if (!weg) throw new AppError('Dieser Beleg ist nicht mehr unter »Zu prüfen«.');
  await loeschen(weg.belegKey);
  return weg;
}

export async function eingangDatei(id: string) {
  const [e] = await db()
    .select({ key: belegEingang.belegKey, typ: belegEingang.belegTyp, name: belegEingang.belegName, groesse: belegEingang.belegGroesse })
    .from(belegEingang)
    .where(eq(belegEingang.id, id))
    .limit(1);
  return e ?? null;
}

export type EingangZeile = {
  id: string;
  name: string;
  typ: string;
  status: 'neu' | 'gelesen' | 'fehler';
  fehler: string | null;
  vorschlag: BelegVorschlag | null;
  /** dieselbe Rechnung (Lieferant und Nummer) ist schon eine Ausgabe */
  schonErfasst: string | null;
  hochgeladenAm: Date;
  /** für das Formular: nach »Erneut lesen« mit den neuen Werten neu aufbauen */
  gelesenAm: Date | null;
  bereich: EingangBereich;
};

/** «Zu prüfen» eines Bereichs (DDL = alles, was nicht »privat« ist). */
export async function eingangListe(bereich: EingangBereich = 'ddl'): Promise<EingangZeile[]> {
  const filter = bereich === 'privat' ? eq(belegEingang.bereich, 'privat') : or(isNull(belegEingang.bereich), ne(belegEingang.bereich, 'privat'));
  const [zeilen, erfasst] = await Promise.all([
    db().select().from(belegEingang).where(filter).orderBy(desc(belegEingang.hochgeladenAm)),
    db()
      .select({ lieferant: expenses.lieferant, nr: expenses.rechnungsnummer, datum: expenses.rechnungsdatum })
      .from(expenses)
      .where(and(isNull(expenses.geloeschtAm), sql`${expenses.rechnungsnummer} is not null`)),
  ]);
  return zeilen.map((e) => {
    const v = (e.vorschlag as BelegVorschlag | null) ?? null;
    const gleich =
      v?.lieferant && v.rechnungsnummer
        ? erfasst.find((x) => x.nr?.toLowerCase() === v.rechnungsnummer!.toLowerCase() && lieferantNormal(x.lieferant) === lieferantNormal(v.lieferant!))
        : undefined;
    return {
      id: e.id,
      name: e.belegName,
      typ: e.belegTyp,
      status: e.status,
      fehler: e.fehler,
      vorschlag: v,
      schonErfasst: gleich ? `${gleich.lieferant} vom ${isoDatumText(gleich.datum)}` : null,
      hochgeladenAm: e.hochgeladenAm,
      gelesenAm: e.gelesenAm,
      bereich: e.bereich === 'privat' ? 'privat' : 'ddl',
    };
  });
}

/** Verbrauch der KI je Monat (für «Einstellungen → KI»). */
export async function kiVerbrauch() {
  return db()
    .select({
      monat: sql<string>`to_char(${kiNutzung.am} at time zone 'Europe/Vienna', 'YYYY-MM')`,
      modell: kiNutzung.modell,
      anzahl: sql<number>`count(*)::int`,
      eingabe: sql<number>`sum(${kiNutzung.eingabeTokens})::int`,
      ausgabe: sql<number>`sum(${kiNutzung.ausgabeTokens})::int`,
    })
    .from(kiNutzung)
    .groupBy(sql`1`, kiNutzung.modell)
    .orderBy(sql`1 desc`);
}
