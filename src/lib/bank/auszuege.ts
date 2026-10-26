import 'server-only';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { bankAuszuege, bankUmsaetze, expenses, fixkostenLaeufe, fixkostenVorlagen, kiNutzung, privatBuchungen } from '@/db/schema';
import { kontoauszugLesen, umsaetzeEinordnen, type Einordnung } from '@/lib/ai-safe';
import { offeneRechnungen } from '@/lib/abrechnung/daten';
import { centEingabe } from '@/lib/abrechnung/geld';
import { zahlungErfassen, zahlungLoeschen } from '@/lib/abrechnung/zahlungen';
import { ausgabeAnlegen } from '@/lib/ausgaben/ausgaben';
import { ausBrutto, belegTypVon, type MwstSatz } from '@/lib/ausgaben/text';
import { dateinameBereinigen } from '@/lib/dateien/regeln';
import { AppError } from '@/lib/errors';
import { faelligkeitImMonat, vorlagePruefen, type Bereich } from '@/lib/fixkosten/plan';
import { RHYTHMUS_NAMEN } from '@/lib/fixkosten/text';
import { fixkostenNachziehen, offeneLaeufe } from '@/lib/fixkosten/vorlagen';
import { heuteIso, isoDatumText } from '@/lib/format';
import { kiLaden } from '@/lib/ki/einstellungen';
import type { KiModell } from '@/lib/ki/modelle';
import { passtZurArt, PRIVAT_KATEGORIE_NAMEN, type PrivatKategorie } from '@/lib/privat/text';
import { ganzLesen, kopfLesen, lesen, loeschen, speichern, ZuGross } from '@/lib/storage';
import { vorschlaegeBerechnen, type Kandidaten, type Vorschlag } from './abgleich';
import { auszugAuswerten, fingerabdruecke } from './auswerten';
import { istUmsatzliste, umsatzlisteLesen } from './csv';
import type { Zuordnung } from './text';

/**
 * «Bank» (Spec فاز ۵، قدم ۴؛ فقط Inhaber). Kontoauszug PDF ← Claude (`kontoauszugLesen`) ← کنترل کامل بودن
 * (`auswerten.ts`) ← ردیف‌ها، هر کدام یک بار. یا «Umsatzliste» CSV از eBanking (`csv.ts`): اعداد مستقیم از فایل،
 * Claude فقط ردیف‌های تازه را دسته‌بندی می‌کند (`umsaetzeEinordnen`)؛ Kontostand ندارد. پیشنهاد هر ردیف هر بار تازه حساب می‌شود (`abgleich.ts`)، چون
 * Rechnung، Ausgabe یا Privat-Buchung ممکن است بعداً اضافه شده باشد. هیچ‌چیز بدون تأیید Inhaber ثبت نمی‌شود.
 */

const AUSZUG_MAX_BYTES = 30 * 1024 * 1024;
type Akteur = { kind: 'staff'; id: string; label: string };

export async function auszugHochladen(d: { name: string | null; laenge: number | null; inhalt: ReadableStream<Uint8Array> | null }, label: string) {
  if (!d.inhalt) throw new AppError('Keine Datei empfangen.');
  if (d.laenge != null && d.laenge > AUSZUG_MAX_BYTES) throw new AppError('Der Kontoauszug ist zu groß (höchstens 30 MB).');
  let datei: Awaited<ReturnType<typeof speichern>>;
  try {
    datei = await speichern(d.inhalt, AUSZUG_MAX_BYTES);
  } catch (e) {
    if (e instanceof ZuGross) throw new AppError('Der Kontoauszug ist zu groß (höchstens 30 MB).');
    throw e;
  }
  const kopf = await kopfLesen(datei.key, 512);
  const istPdf = belegTypVon(kopf)?.typ === 'application/pdf';
  if (!istPdf && !istUmsatzliste(kopf)) {
    await loeschen(datei.key);
    throw new AppError('Bitte den Kontoauszug als PDF oder die Umsatzliste als CSV hochladen (im eBanking der BAWAG).');
  }
  const [schon] = await db().select({ nr: bankAuszuege.auszugNummer, datum: bankAuszuege.auszugDatum }).from(bankAuszuege).where(eq(bankAuszuege.dateiSha256, datei.sha256)).limit(1);
  if (schon) {
    await loeschen(datei.key);
    throw new AppError(`Dieser Kontoauszug ist schon hochgeladen${schon.nr ? ` (Nr. ${schon.nr} vom ${isoDatumText(schon.datum)})` : ''}.`);
  }
  const [a] = await db()
    .insert(bankAuszuege)
    .values({
      dateiKey: datei.key,
      dateiSha256: datei.sha256,
      dateiGroesse: datei.groesse,
      dateiName: dateinameBereinigen(d.name ?? '') || (istPdf ? 'Kontoauszug.pdf' : 'Umsatzliste.csv'),
      status: 'fehler',
      fehler: 'Noch nicht gelesen.',
      hochgeladenVonLabel: label,
    })
    .returning();
  return a;
}

/** Claude liest; danach Kontrolle und Speichern der neuen Zeilen. Ohne Schlüssel oder bei Fehler bleibt der Auszug mit Hinweis. */
export async function auszugLesen(id: string) {
  const [a] = await db().select().from(bankAuszuege).where(eq(bankAuszuege.id, id)).limit(1);
  if (!a) throw new AppError('Diesen Kontoauszug gibt es nicht mehr.');
  if (a.status === 'gelesen') throw new AppError('Dieser Kontoauszug ist schon gelesen.');
  const ki = await kiLaden();
  const fehlerSetzen = async (fehler: string, modell?: string) => {
    await db().update(bankAuszuege).set({ status: 'fehler', fehler, kiModell: modell ?? null }).where(eq(bankAuszuege.id, id));
    return { ok: false as const, fehler };
  };
  if (!ki.schluessel) return fehlerSetzen('Kontoauszüge liest die KI: unter Einstellungen → KI den Schlüssel von Anthropic eintragen, dann »Erneut lesen«.');
  const datei = await ganzLesen(a.dateiKey);
  if (belegTypVon(datei.subarray(0, 16))?.typ !== 'application/pdf') return umsatzlisteSpeichern(id, datei, { schluessel: ki.schluessel, modell: ki.modell }, fehlerSetzen);
  const r = await kontoauszugLesen(datei, { schluessel: ki.schluessel, modell: ki.modell });
  if (r.eingabeTokens || r.ausgabeTokens)
    await db().insert(kiNutzung).values({ zweck: 'kontoauszug_lesen', modell: r.modell, eingabeTokens: r.eingabeTokens, ausgabeTokens: r.ausgabeTokens, erfolgreich: r.ok });
  if (!r.ok) return fehlerSetzen(r.fehler, r.modell);
  const w = auszugAuswerten(r.auszug);
  if (!w.ok) return fehlerSetzen(w.fehler, r.modell);

  return db().transaction(async (tx) => {
    const neu = w.umsaetze.length
      ? await tx
          .insert(bankUmsaetze)
          .values(
            w.umsaetze.map((u) => ({
              auszugId: id,
              fingerabdruck: u.fingerabdruck,
              buchungstag: u.buchungstag,
              valuta: u.valuta,
              betragCent: u.betragCent,
              gegenpartei: u.gegenpartei,
              iban: u.iban,
              text: u.text,
              referenz: u.referenz,
              rechnungsnummer: u.rechnungsnummer,
              bereich: u.bereich,
              kategorie: u.kategorie,
              privatKategorie: u.privatKategorie,
            })),
          )
          .onConflictDoNothing({ target: bankUmsaetze.fingerabdruck })
          .returning({ id: bankUmsaetze.id })
      : [];
    await tx
      .update(bankAuszuege)
      .set({
        status: 'gelesen',
        fehler: null,
        iban: w.iban,
        auszugNummer: w.auszugNummer,
        auszugDatum: w.auszugDatum,
        alterCent: w.alterCent,
        neuerCent: w.neuerCent,
        umsaetzeNeu: neu.length,
        umsaetzeSchonDa: w.umsaetze.length - neu.length,
        kiModell: r.modell,
      })
      .where(eq(bankAuszuege.id, id));
    return { ok: true as const, neu: neu.length, schonDa: w.umsaetze.length - neu.length, nummer: w.auszugNummer, datum: w.auszugDatum };
  });
}

/**
 * Umsatzliste (CSV): Zeilen direkt aus der Datei. Nur Zeilen, die noch nicht da sind (aus einem PDF oder einer
 * früheren Liste), gehen zum Einordnen an die KI. Auszugsdatum = letzter Buchungstag; ohne Kontostand.
 */
async function umsatzlisteSpeichern(
  id: string,
  datei: Buffer,
  ki: { schluessel: string; modell: KiModell },
  fehlerSetzen: (fehler: string, modell?: string) => Promise<{ ok: false; fehler: string }>,
) {
  const g = umsatzlisteLesen(datei);
  if (!g.ok) return fehlerSetzen(g.fehler);
  const abdruecke = fingerabdruecke(g.iban, g.umsaetze);
  const schon = new Set(
    (await db().select({ f: bankUmsaetze.fingerabdruck }).from(bankUmsaetze).where(inArray(bankUmsaetze.fingerabdruck, abdruecke))).map((x) => x.f),
  );
  const neu = g.umsaetze.map((u, i) => ({ ...u, fingerabdruck: abdruecke[i] })).filter((u) => !schon.has(u.fingerabdruck));
  let modell: string | null = null;
  let einordnung = new Map<number, Einordnung>();
  if (neu.length) {
    const r = await umsaetzeEinordnen(neu, ki);
    if (r.eingabeTokens || r.ausgabeTokens)
      await db().insert(kiNutzung).values({ zweck: 'kontoauszug_lesen', modell: r.modell, eingabeTokens: r.eingabeTokens, ausgabeTokens: r.ausgabeTokens, erfolgreich: r.ok });
    if (!r.ok) return fehlerSetzen(r.fehler, r.modell);
    modell = r.modell;
    einordnung = r.zeilen;
  }
  const auszugDatum = g.umsaetze.reduce((m, u) => (u.buchungstag > m ? u.buchungstag : m), g.umsaetze[0].buchungstag);

  return db().transaction(async (tx) => {
    const eingefuegt = neu.length
      ? await tx
          .insert(bankUmsaetze)
          .values(
            neu.map((u, i) => {
              const e = einordnung.get(i);
              const bereich = e?.bereich ?? 'privat';
              return {
                auszugId: id,
                fingerabdruck: u.fingerabdruck,
                buchungstag: u.buchungstag,
                valuta: u.valuta,
                betragCent: u.betragCent,
                gegenpartei: e?.gegenpartei?.trim().slice(0, 120) || null,
                iban: u.iban,
                text: u.text,
                referenz: u.referenz,
                rechnungsnummer: e?.rechnungsnummer?.trim() || null,
                bereich,
                kategorie: bereich === 'ddl' && u.betragCent < 0 ? (e?.kategorie ?? null) : null,
                privatKategorie: bereich === 'privat' ? (e?.privatKategorie ?? null) : null,
              };
            }),
          )
          .onConflictDoNothing({ target: bankUmsaetze.fingerabdruck })
          .returning({ id: bankUmsaetze.id })
      : [];
    const schonDa = g.umsaetze.length - eingefuegt.length;
    await tx
      .update(bankAuszuege)
      .set({ status: 'gelesen', fehler: null, iban: g.iban, auszugNummer: null, auszugDatum, alterCent: null, neuerCent: null, umsaetzeNeu: eingefuegt.length, umsaetzeSchonDa: schonDa, kiModell: modell })
      .where(eq(bankAuszuege.id, id));
    return { ok: true as const, neu: eingefuegt.length, schonDa, nummer: null, datum: auszugDatum };
  });
}

/** Entfernen nur, solange noch keine Zeile zugeordnet ist (Zeilen, PDF und Eintrag verschwinden). */
export async function auszugEntfernen(id: string) {
  return db().transaction(async (tx) => {
    const [a] = await tx.select().from(bankAuszuege).where(eq(bankAuszuege.id, id)).for('update');
    if (!a) throw new AppError('Diesen Kontoauszug gibt es nicht mehr.');
    const [zugeordnet] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(bankUmsaetze)
      .where(and(eq(bankUmsaetze.auszugId, id), isNotNull(bankUmsaetze.zuordnung)));
    if (zugeordnet.n > 0) throw new AppError('Aus diesem Kontoauszug sind schon Zeilen zugeordnet. Erst diese zurücksetzen.');
    await tx.delete(bankUmsaetze).where(eq(bankUmsaetze.auszugId, id));
    await tx.delete(bankAuszuege).where(eq(bankAuszuege.id, id));
    await loeschen(a.dateiKey);
    return a;
  });
}

export async function auszugDatei(id: string) {
  const [a] = await db().select({ key: bankAuszuege.dateiKey, name: bankAuszuege.dateiName, groesse: bankAuszuege.dateiGroesse }).from(bankAuszuege).where(eq(bankAuszuege.id, id)).limit(1);
  return a ? { ...a, oeffnen: () => lesen(a.key) } : null;
}

// ════════════════ Liste und Vorschläge ════════════════

export type UmsatzZeile = {
  id: string;
  buchungstag: string;
  betragCent: number;
  gegenpartei: string | null;
  text: string;
  bereich: 'ddl' | 'privat' | 'ignorieren';
  kategorie: string | null;
  privatKategorie: string | null;
  zuordnung: Zuordnung | null;
  /** nur offene und »Beleg fehlt« */
  vorschlag: Vorschlag | null;
  /** Ziel einer Zuordnung, lesbar */
  ziel: string | null;
  erstelltHier: boolean;
};

export type AuszugZeile = {
  id: string;
  name: string;
  status: 'gelesen' | 'fehler';
  fehler: string | null;
  nummer: string | null;
  datum: string | null;
  iban: string | null;
  alterCent: number | null;
  neuerCent: number | null;
  neu: number;
  schonDa: number;
  zugeordnet: number;
  /** Kontostand passt nicht zum vorherigen Auszug: einer fehlt dazwischen */
  luecke: boolean;
  hochgeladenAm: Date;
};

export type OffeneRechnungKurz = { id: string; nummer: string; praxis: string; offenCent: number };
export type AusgabeKurz = { id: string; lieferant: string; bruttoCent: number; bezahltAm: string };

export type BankDaten = {
  auszuege: AuszugZeile[];
  klaeren: UmsatzZeile[];
  belegFehlt: UmsatzZeile[];
  erledigt: UmsatzZeile[];
  kontostand: { cent: number; datum: string } | null;
  /** für »Ändern …« */
  rechnungen: OffeneRechnungKurz[];
  ausgaben: AusgabeKurz[];
};

const MIN_TAG = (tage: string[]) => tage.reduce((m, t) => (t < m ? t : m), heuteIso());
const tageVor = (datum: string, n: number) => new Date(Date.parse(datum) - n * 86_400_000).toISOString().slice(0, 10);

/** Ausgaben und Privat-Buchungen, die noch mit keiner Bankzeile verbunden sind (Zeitraum um die offenen Zeilen). */
async function kandidaten(ab: string): Promise<{ k: Kandidaten; rechnungen: OffeneRechnungKurz[]; ausgaben: AusgabeKurz[] }> {
  const [rechnungen, ausgaben, privat, laeufe] = await Promise.all([
    offeneRechnungen(),
    db()
      .select({ id: expenses.id, bruttoCent: expenses.bruttoCent, bezahltAm: expenses.bezahltAm, lieferant: expenses.lieferant })
      .from(expenses)
      .leftJoin(bankUmsaetze, eq(bankUmsaetze.expenseId, expenses.id))
      .where(and(isNull(expenses.geloeschtAm), isNull(bankUmsaetze.id), gte(expenses.bezahltAm, ab)))
      .orderBy(desc(expenses.bezahltAm)),
    db()
      .select({ id: privatBuchungen.id, art: privatBuchungen.art, betragCent: privatBuchungen.betragCent, datum: privatBuchungen.datum, haendler: privatBuchungen.haendler, kategorie: privatBuchungen.kategorie })
      .from(privatBuchungen)
      .leftJoin(bankUmsaetze, eq(bankUmsaetze.privatBuchungId, privatBuchungen.id))
      .where(and(isNull(privatBuchungen.geloeschtAm), isNull(bankUmsaetze.id), gte(privatBuchungen.datum, ab))),
    offeneLaeufe(),
  ]);
  const r = rechnungen.map((x) => ({ id: x.id, nummer: x.nummer, offenCent: x.offenCent, praxis: x.praxis }));
  return {
    k: {
      rechnungen: r,
      ausgaben,
      privat: privat.map((p) => ({ id: p.id, art: p.art, betragCent: p.betragCent, datum: p.datum, titel: p.haendler ?? PRIVAT_KATEGORIE_NAMEN[p.kategorie] })),
      fixkosten: laeufe.map((l) => ({ id: l.id, betragCent: l.betragCent, faelligAm: l.faelligAm, titel: l.titel })),
    },
    rechnungen: r,
    ausgaben,
  };
}

export async function bankDaten(): Promise<BankDaten> {
  const [auszuege, umsaetze, zaehler] = await Promise.all([
    db().select().from(bankAuszuege).orderBy(desc(bankAuszuege.auszugDatum), desc(bankAuszuege.hochgeladenAm)),
    db()
      .select({
        u: bankUmsaetze,
        ausgabe: expenses.lieferant,
        privatHaendler: privatBuchungen.haendler,
        privatKategorie: privatBuchungen.kategorie,
        zahlungNummer: sql<string | null>`(select i.nummer from ddl.payments p join ddl.invoices i on i.id = p.invoice_id where p.id = ${bankUmsaetze.paymentId})`,
      })
      .from(bankUmsaetze)
      .leftJoin(expenses, eq(expenses.id, bankUmsaetze.expenseId))
      .leftJoin(privatBuchungen, eq(privatBuchungen.id, bankUmsaetze.privatBuchungId))
      .orderBy(desc(bankUmsaetze.buchungstag), desc(bankUmsaetze.referenz)),
    db()
      .select({ id: bankUmsaetze.auszugId, n: sql<number>`count(*) filter (where ${bankUmsaetze.zuordnung} is not null)::int` })
      .from(bankUmsaetze)
      .groupBy(bankUmsaetze.auszugId),
  ]);

  const offen = umsaetze.filter((x) => x.u.zuordnung == null || x.u.zuordnung === 'ddl_offen');
  const kand = await kandidaten(tageVor(MIN_TAG(offen.map((x) => x.u.buchungstag)), 15));
  // älteste zuerst vergeben (wie auf dem Kontoauszug), »Beleg fehlt« nur gegen Ausgaben des Labors
  const reihenfolge = [...offen].sort((a, b) => a.u.buchungstag.localeCompare(b.u.buchungstag));
  const vorschlaege = vorschlaegeBerechnen(
    reihenfolge.map((x) => ({
      id: x.u.id,
      buchungstag: x.u.buchungstag,
      betragCent: x.u.betragCent,
      text: x.u.text,
      gegenpartei: x.u.gegenpartei,
      bereich: x.u.zuordnung === 'ddl_offen' ? 'ddl' : x.u.bereich,
      kategorie: x.u.kategorie,
      privatKategorie: x.u.privatKategorie,
      rechnungsnummer: x.u.rechnungsnummer,
    })),
    kand.k,
  );

  const zeile = (x: (typeof umsaetze)[number]): UmsatzZeile => {
    const u = x.u;
    let vorschlag = u.zuordnung == null || u.zuordnung === 'ddl_offen' ? (vorschlaege.get(u.id) ?? null) : null;
    // »Beleg fehlt«: nur ein gefundenes Gegenstück ist ein neuer Vorschlag
    if (u.zuordnung === 'ddl_offen' && vorschlag && vorschlag.aktion !== 'ausgabe' && vorschlag.aktion !== 'fixkosten') vorschlag = null;
    const ziel =
      u.zuordnung === 'rechnung'
        ? (x.zahlungNummer ? `Zahlung zu ${x.zahlungNummer}` : 'Zahlung (gelöscht)')
        : u.zuordnung === 'ausgabe'
          ? `Ausgabe: ${x.ausgabe ?? '(gelöscht)'}`
          : u.zuordnung === 'privat'
            ? `Privat: ${x.privatHaendler ?? (x.privatKategorie ? PRIVAT_KATEGORIE_NAMEN[x.privatKategorie] : '(gelöscht)')}${x.privatKategorie ? ` · ${PRIVAT_KATEGORIE_NAMEN[x.privatKategorie]}` : ''}`
            : u.zuordnung === 'ignoriert'
              ? 'Ignoriert'
              : u.zuordnung === 'ddl_offen'
                ? 'Labor, Beleg fehlt'
                : null;
    return {
      id: u.id,
      buchungstag: u.buchungstag,
      betragCent: u.betragCent,
      gegenpartei: u.gegenpartei,
      text: u.text,
      bereich: u.bereich,
      kategorie: u.kategorie,
      privatKategorie: u.privatKategorie,
      zuordnung: u.zuordnung,
      vorschlag,
      ziel,
      erstelltHier: u.erstelltHier,
    };
  };

  const zugeordnet = new Map(zaehler.map((z) => [z.id, z.n]));
  // Lücken: pro IBAN nach Datum; der alte Kontostand muss der neue des vorigen Auszugs sein
  const gelesen = auszuege
    .filter((a) => a.status === 'gelesen' && a.alterCent != null && a.neuerCent != null)
    .sort((a, b) => (a.auszugDatum ?? '').localeCompare(b.auszugDatum ?? '') || a.hochgeladenAm.getTime() - b.hochgeladenAm.getTime());
  const luecken = new Set<string>();
  for (let i = 1; i < gelesen.length; i++) {
    const vorher = gelesen.slice(0, i).reverse().find((x) => x.iban === gelesen[i].iban);
    if (vorher && vorher.neuerCent !== gelesen[i].alterCent) luecken.add(gelesen[i].id);
  }
  const letzter = gelesen.at(-1);

  return {
    auszuege: auszuege.map((a) => ({
      id: a.id,
      name: a.dateiName,
      status: a.status,
      fehler: a.fehler,
      nummer: a.auszugNummer,
      datum: a.auszugDatum,
      iban: a.iban,
      alterCent: a.alterCent,
      neuerCent: a.neuerCent,
      neu: a.umsaetzeNeu,
      schonDa: a.umsaetzeSchonDa,
      zugeordnet: zugeordnet.get(a.id) ?? 0,
      luecke: luecken.has(a.id),
      hochgeladenAm: a.hochgeladenAm,
    })),
    klaeren: umsaetze.filter((x) => x.u.zuordnung == null).map(zeile),
    belegFehlt: umsaetze.filter((x) => x.u.zuordnung === 'ddl_offen').map(zeile),
    erledigt: umsaetze.filter((x) => x.u.zuordnung != null && x.u.zuordnung !== 'ddl_offen').map(zeile),
    kontostand: letzter?.neuerCent != null && letzter.auszugDatum ? { cent: letzter.neuerCent, datum: letzter.auszugDatum } : null,
    rechnungen: kand.rechnungen,
    ausgaben: kand.ausgaben,
  };
}

// ════════════════ Zuordnen ════════════════

export type Wahl =
  | { aktion: 'rechnung'; rechnungId: string; betragCent: number }
  | { aktion: 'ausgabe'; expenseId: string; erstelltHier?: boolean }
  | { aktion: 'privat_verbinden'; privatId: string }
  | { aktion: 'privat_neu'; kategorie: string }
  /** mit einer fälligen Fixkosten des Labors: daraus die Ausgabe */
  | { aktion: 'fixkosten'; laufId: string }
  /** neue Fixkosten (Abo, Miete …) ab dieser Zeile; künftige Monate werden vorgeschlagen */
  | { aktion: 'fixkosten_neu'; bereich: Bereich; roh: Record<string, string> }
  | { aktion: 'ddl_offen' }
  | { aktion: 'ignorieren' };

/** Zeile laden, die noch zugeordnet werden darf (offen; »Beleg fehlt« nur noch zu Ausgabe, Privat oder Ignorieren). */
export async function umsatzOffen(id: string, wahl?: Wahl['aktion']) {
  const [u] = await db().select().from(bankUmsaetze).where(eq(bankUmsaetze.id, id)).limit(1);
  if (!u) throw new AppError('Diese Bankzeile gibt es nicht mehr.');
  const darf = u.zuordnung == null || (u.zuordnung === 'ddl_offen' && wahl !== 'ddl_offen' && wahl !== 'rechnung');
  if (!darf) throw new AppError('Diese Bankzeile ist schon zugeordnet.');
  return u;
}

/** Ausgabe des Labors aus Fixkosten: Betrag von der Bank (brutto), MwSt-Satz und Kategorie aus der Vorlage. */
function ausgabeAusFixkosten(
  u: typeof bankUmsaetze.$inferSelect,
  laufId: string,
  v: { titel: string; gegenpartei: string | null; kategorie: string; mwstSatz: number | null; notiz: string | null },
  akteur: Akteur,
) {
  const satz = (v.mwstSatz ?? 20) as MwstSatz;
  const { nettoCent, mwstCent } = ausBrutto(Math.abs(u.betragCent), satz);
  const tag = u.buchungstag <= heuteIso() ? u.buchungstag : heuteIso();
  return ausgabeAnlegen(
    {
      rechnungsdatum: tag,
      bezahltAm: tag,
      lieferant: (v.gegenpartei ?? v.titel).slice(0, 120),
      rechnungsnummer: '',
      kategorie: v.kategorie,
      beschreibung: v.gegenpartei ? v.titel : (v.notiz ?? ''),
      netto: centEingabe(nettoCent),
      satz: String(satz),
      mwst: centEingabe(mwstCent),
    },
    akteur,
    undefined,
    laufId,
  );
}

/** Zeile atomar beanspruchen: nur eine von zwei gleichzeitigen Zuordnungen gewinnt. */
async function beanspruchen(tx: Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0], id: string, zuordnung: Zuordnung, extra: Partial<typeof bankUmsaetze.$inferInsert> = {}) {
  const [u] = await tx
    .update(bankUmsaetze)
    .set({ zuordnung, zugeordnetAm: new Date(), ...extra })
    .where(and(eq(bankUmsaetze.id, id), zuordnung === 'ddl_offen' ? isNull(bankUmsaetze.zuordnung) : or(isNull(bankUmsaetze.zuordnung), eq(bankUmsaetze.zuordnung, 'ddl_offen'))))
    .returning();
  if (!u) throw new AppError('Diese Bankzeile ist schon zugeordnet.');
  return u;
}

export async function umsatzZuordnen(id: string, wahl: Wahl, akteur: Akteur, ip: string | null): Promise<string> {
  const u = await umsatzOffen(id, wahl.aktion);
  const betrag = Math.abs(u.betragCent);

  if (wahl.aktion === 'fixkosten') {
    if (u.betragCent >= 0) throw new AppError('Nur Abgänge gehören zu Fixkosten des Labors.');
    const [l] = await db()
      .select({ lauf: fixkostenLaeufe, v: fixkostenVorlagen })
      .from(fixkostenLaeufe)
      .innerJoin(fixkostenVorlagen, eq(fixkostenVorlagen.id, fixkostenLaeufe.vorlageId))
      .where(and(eq(fixkostenLaeufe.id, wahl.laufId), eq(fixkostenLaeufe.status, 'offen'), eq(fixkostenVorlagen.bereich, 'ddl')))
      .limit(1);
    if (!l) throw new AppError('Diese Fixkosten sind schon erledigt (übernommen oder übersprungen).');
    await db().transaction((tx) => beanspruchen(tx, id, 'ausgabe'));
    try {
      const a = await ausgabeAusFixkosten(u, l.lauf.id, l.v, akteur);
      await db().update(bankUmsaetze).set({ expenseId: a.id, erstelltHier: true }).where(eq(bankUmsaetze.id, id));
      return `Ausgabe aus den Fixkosten »${l.v.titel}« erfasst und verbunden.`;
    } catch (e) {
      await db().update(bankUmsaetze).set({ zuordnung: u.zuordnung, zugeordnetAm: null }).where(eq(bankUmsaetze.id, id));
      throw e;
    }
  }

  if (wahl.aktion === 'fixkosten_neu') return fixkostenAusZeile(u, wahl.bereich, wahl.roh, akteur);

  if (wahl.aktion === 'rechnung') {
    if (u.betragCent <= 0) throw new AppError('Nur Eingänge können eine Rechnung bezahlen.');
    if (!Number.isInteger(wahl.betragCent) || wahl.betragCent <= 0 || wahl.betragCent > betrag) throw new AppError('Der Betrag passt nicht zu dieser Bankzeile.');
    // erst beanspruchen, dann buchen; geht die Zahlung schief, wird die Zeile wieder frei
    await db().transaction((tx) => beanspruchen(tx, id, 'rechnung'));
    try {
      const z = await zahlungErfassen(wahl.rechnungId, { betragCent: wahl.betragCent, am: u.buchungstag, art: 'ueberweisung', notiz: `Bank: ${u.gegenpartei ?? u.text.slice(0, 60)}` }, akteur, ip);
      await db().update(bankUmsaetze).set({ paymentId: z.id, erstelltHier: true }).where(eq(bankUmsaetze.id, id));
      return `Zahlung zu ${z.nummer} gebucht.`;
    } catch (e) {
      await db().update(bankUmsaetze).set({ zuordnung: u.zuordnung, zugeordnetAm: null }).where(eq(bankUmsaetze.id, id));
      throw e;
    }
  }

  return db().transaction(async (tx) => {
    if (wahl.aktion === 'ausgabe') {
      const [a] = await tx.select().from(expenses).where(and(eq(expenses.id, wahl.expenseId), isNull(expenses.geloeschtAm))).limit(1);
      if (!a) throw new AppError('Diese Ausgabe gibt es nicht mehr.');
      if (u.betragCent >= 0) throw new AppError('Nur Abgänge gehören zu einer Ausgabe.');
      const [schon] = await tx.select({ id: bankUmsaetze.id }).from(bankUmsaetze).where(eq(bankUmsaetze.expenseId, a.id)).limit(1);
      if (schon) throw new AppError(`${a.lieferant} ist schon mit einer anderen Bankzeile verbunden.`);
      await beanspruchen(tx, id, 'ausgabe', { expenseId: a.id, erstelltHier: Boolean(wahl.erstelltHier) });
      return `Mit der Ausgabe ${a.lieferant} verbunden.`;
    }
    if (wahl.aktion === 'privat_verbinden') {
      const [p] = await tx.select().from(privatBuchungen).where(and(eq(privatBuchungen.id, wahl.privatId), isNull(privatBuchungen.geloeschtAm))).limit(1);
      if (!p) throw new AppError('Diese Privat-Buchung gibt es nicht mehr.');
      const [schon] = await tx.select({ id: bankUmsaetze.id }).from(bankUmsaetze).where(eq(bankUmsaetze.privatBuchungId, p.id)).limit(1);
      if (schon) throw new AppError('Diese Privat-Buchung ist schon mit einer anderen Bankzeile verbunden.');
      await beanspruchen(tx, id, 'privat', { privatBuchungId: p.id });
      return `Mit der Privat-Buchung ${p.haendler ?? PRIVAT_KATEGORIE_NAMEN[p.kategorie]} verbunden.`;
    }
    if (wahl.aktion === 'privat_neu') {
      const art = u.betragCent > 0 ? 'einnahme' : 'ausgabe';
      if (!passtZurArt(art, wahl.kategorie)) throw new AppError('Bitte eine passende Kategorie wählen.');
      const [p] = await tx
        .insert(privatBuchungen)
        .values({
          art,
          datum: u.buchungstag,
          betragCent: betrag,
          kategorie: wahl.kategorie as PrivatKategorie,
          haendler: u.gegenpartei,
          notiz: u.text.slice(0, 300),
          quelle: 'bank',
          erfasstVon: akteur.id,
          erfasstVonLabel: akteur.label,
        })
        .returning({ id: privatBuchungen.id });
      await beanspruchen(tx, id, 'privat', { privatBuchungId: p.id, erstelltHier: true });
      return `Privat gebucht: ${PRIVAT_KATEGORIE_NAMEN[wahl.kategorie as PrivatKategorie]}.`;
    }
    if (wahl.aktion === 'ddl_offen') {
      if (u.betragCent >= 0) throw new AppError('»Beleg fehlt« gilt nur für Abgänge.');
      await beanspruchen(tx, id, 'ddl_offen');
      return 'Als Ausgabe des Labors vorgemerkt; der Beleg fehlt noch.';
    }
    await beanspruchen(tx, id, 'ignoriert');
    return 'Ignoriert.';
  });
}

/**
 * Neue Fixkosten aus einer Bankzeile (z. B. ein Abo): die Vorlage, die Fälligkeit im Monat dieser Zeile mit der Zeile
 * verbunden, und alles bis heute nachgetragen. Privat: die Fälligkeit ist eine Privat-Buchung; Labor: eine Ausgabe.
 * Spätere Abbuchungen mit demselben Betrag schlägt »Zu klären« dann selbst vor.
 */
async function fixkostenAusZeile(u: typeof bankUmsaetze.$inferSelect, bereich: Bereich, roh: Record<string, string>, akteur: Akteur): Promise<string> {
  const art = u.betragCent > 0 ? 'einnahme' : 'ausgabe';
  if (bereich === 'ddl' && art === 'einnahme') throw new AppError('Fixkosten des Labors sind nur Abgänge. Für einen Eingang »Privat« wählen.');
  const r = vorlagePruefen({ ...roh, art }, bereich);
  if (!r.ok) throw new AppError(r.fehler);
  const w = r.werte;
  const f = faelligkeitImMonat({ ab: w.ab, tag: w.tag, rhythmus: w.rhythmus, bis: w.bis }, u.buchungstag);
  if (!f) throw new AppError('Im Monat dieser Buchung ist nach »Erste Fälligkeit« und »Wie oft?« nichts fällig. Bitte die erste Fälligkeit anpassen.');
  const betrag = Math.abs(u.betragCent);
  const fertig = `Als Fixkosten angelegt: ${w.titel} (${RHYTHMUS_NAMEN[w.rhythmus]}). Die nächsten Abbuchungen werden unter »Zu klären« vorgeschlagen.`;

  if (bereich === 'privat') {
    await db().transaction(async (tx) => {
      const [v] = await tx.insert(fixkostenVorlagen).values({ ...w, erstelltVonLabel: akteur.label }).returning({ id: fixkostenVorlagen.id });
      const [b] = await tx
        .insert(privatBuchungen)
        .values({
          art,
          datum: u.buchungstag,
          betragCent: betrag,
          kategorie: w.kategorie as PrivatKategorie,
          haendler: w.gegenpartei ?? w.titel,
          notiz: w.notiz ?? (w.gegenpartei ? w.titel : null),
          quelle: 'vorlage',
          erfasstVon: akteur.id,
          erfasstVonLabel: akteur.label,
        })
        .returning({ id: privatBuchungen.id });
      await tx.insert(fixkostenLaeufe).values({ vorlageId: v.id, periode: f.periode, faelligAm: f.faelligAm, status: 'gebucht', privatBuchungId: b.id, erledigtAm: new Date() });
      await beanspruchen(tx, u.id, 'privat', { privatBuchungId: b.id, erstelltHier: true });
    });
    await fixkostenNachziehen();
    return fertig;
  }

  // Labor: erst Vorlage, Fälligkeit und Zeile, dann die Ausgabe; geht die schief, wird alles zurückgenommen
  const { vorlageId, laufId } = await db().transaction(async (tx) => {
    const [v] = await tx.insert(fixkostenVorlagen).values({ ...w, erstelltVonLabel: akteur.label }).returning({ id: fixkostenVorlagen.id });
    const [l] = await tx.insert(fixkostenLaeufe).values({ vorlageId: v.id, periode: f.periode, faelligAm: f.faelligAm, status: 'offen' }).returning({ id: fixkostenLaeufe.id });
    await beanspruchen(tx, u.id, 'ausgabe');
    return { vorlageId: v.id, laufId: l.id };
  });
  try {
    const a = await ausgabeAusFixkosten(u, laufId, w, akteur);
    await db().update(bankUmsaetze).set({ expenseId: a.id, erstelltHier: true }).where(eq(bankUmsaetze.id, u.id));
  } catch (e) {
    await db().transaction(async (tx) => {
      await tx.update(bankUmsaetze).set({ zuordnung: u.zuordnung, zugeordnetAm: null }).where(eq(bankUmsaetze.id, u.id));
      await tx.delete(fixkostenLaeufe).where(eq(fixkostenLaeufe.id, laufId));
      await tx.delete(fixkostenVorlagen).where(eq(fixkostenVorlagen.id, vorlageId));
    });
    throw e;
  }
  await fixkostenNachziehen();
  return fertig;
}

/** Zuordnung aufheben. Was hier entstanden ist (Zahlung, Privat-Buchung), wird zurückgenommen; eine hier erfasste Ausgabe bleibt. */
export async function umsatzZuruecksetzen(id: string, akteur: Akteur, ip: string | null) {
  const [u] = await db().select().from(bankUmsaetze).where(eq(bankUmsaetze.id, id)).limit(1);
  if (!u || u.zuordnung == null) throw new AppError('Diese Bankzeile ist nicht zugeordnet.');
  if (u.zuordnung === 'rechnung' && u.erstelltHier && u.paymentId) await zahlungLoeschen(u.paymentId, akteur, ip);
  await db().transaction(async (tx) => {
    if (u.zuordnung === 'privat' && u.erstelltHier && u.privatBuchungId)
      await tx.update(privatBuchungen).set({ geloeschtAm: new Date() }).where(eq(privatBuchungen.id, u.privatBuchungId));
    await tx
      .update(bankUmsaetze)
      .set({ zuordnung: null, zugeordnetAm: null, paymentId: null, expenseId: null, privatBuchungId: null, erstelltHier: false })
      .where(eq(bankUmsaetze.id, id));
  });
  return u;
}

/** alle »sicheren« Vorschläge der offenen Zeilen übernehmen (Rechnungsnummer, gleicher Betrag nah, Privat mit Kategorie) */
export async function sichereUebernehmen(akteur: Akteur, ip: string | null) {
  const d = await bankDaten();
  let n = 0;
  const fehler: string[] = [];
  for (const z of [...d.klaeren].sort((a, b) => a.buchungstag.localeCompare(b.buchungstag))) {
    const v = z.vorschlag;
    if (!v?.sicher) continue;
    try {
      await umsatzZuordnen(z.id, wahlAus(v), akteur, ip);
      n++;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      fehler.push(`${isoDatumText(z.buchungstag)} ${z.gegenpartei ?? ''}: ${e.message}`);
    }
  }
  return { n, fehler };
}

export function wahlAus(v: Vorschlag): Wahl {
  switch (v.aktion) {
    case 'rechnung':
      return { aktion: 'rechnung', rechnungId: v.id, betragCent: v.betragCent };
    case 'ausgabe':
      return { aktion: 'ausgabe', expenseId: v.id };
    case 'privat_verbinden':
      return { aktion: 'privat_verbinden', privatId: v.id };
    case 'privat_neu':
      return { aktion: 'privat_neu', kategorie: v.kategorie };
    case 'fixkosten':
      return { aktion: 'fixkosten', laufId: v.id };
    case 'ddl_offen':
      return { aktion: 'ddl_offen' };
    default:
      return { aktion: 'ignorieren' };
  }
}

/** Vorschlag einer Zeile frisch berechnen (für »Übernehmen« einer einzelnen Zeile). */
export async function vorschlagFuer(id: string): Promise<Vorschlag | null> {
  const d = await bankDaten();
  return [...d.klaeren, ...d.belegFehlt].find((z) => z.id === id)?.vorschlag ?? null;
}
