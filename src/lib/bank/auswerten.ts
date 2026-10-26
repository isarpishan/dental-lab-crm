/**
 * Kontoauszug خوانده‌شده ← ردیف‌های قابل ذخیره (Spec فاز ۵، قدم ۴). بدون دیتابیس، با آزمون واحد.
 * مهم‌ترین کار: **کامل بودن**. جمع همهٔ ردیف‌ها باید دقیقاً «neuer − alter Kontostand» باشد (و اگر چاپ شده، با
 * «Summe Ein» و «Summe Aus» هم بخواند)؛ وگرنه KI ردیفی را جا انداخته یا اشتباه خوانده و کل Auszug رد می‌شود.
 */

export type GelesenerUmsatz = {
  buchungstag: string;
  valuta: string | null;
  betrag: number;
  gegenpartei: string | null;
  iban: string | null;
  text: string;
  referenz: string | null;
  bereich: 'ddl' | 'privat' | 'ignorieren';
  kategorie: string | null;
  privatKategorie: string | null;
  rechnungsnummer: string | null;
};

export type GelesenerAuszug = {
  istKontoauszug: boolean;
  iban: string | null;
  auszugNummer: string | null;
  auszugDatum: string | null;
  alterKontostand: number | null;
  neuerKontostand: number | null;
  summeEin: number | null;
  summeAus: number | null;
  umsaetze: GelesenerUmsatz[];
};

export type Umsatz = Omit<GelesenerUmsatz, 'betrag' | 'buchungstag' | 'iban'> & {
  buchungstag: string;
  betragCent: number;
  iban: string | null;
  fingerabdruck: string;
};

export type Ausgewertet =
  | {
      ok: true;
      iban: string;
      auszugNummer: string | null;
      auszugDatum: string;
      alterCent: number;
      neuerCent: number;
      umsaetze: Umsatz[];
    }
  | { ok: false; fehler: string };

const cent = (n: number) => Math.round(n * 100);
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const gueltig = (d: string | null | undefined): d is string => Boolean(d && DATUM.test(d) && !Number.isNaN(Date.parse(d)));
export const ibanNormal = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();
const textNormal = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const euro = (c: number) => (c / 100).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * سال تاریخ‌ها: روی Auszug فقط «01.09» چاپ است. تاریخی که بیش از ۳۱ روز بعد از تاریخ Auszug بیفتد مال سال قبل است
 * (Auszug ژانویه با ردیف‌های دسامبر).
 */
export function jahrKorrigieren(datum: string, auszugDatum: string): string {
  const d = Date.parse(datum);
  const a = Date.parse(auszugDatum);
  if (d - a > 31 * 86_400_000) return `${Number(datum.slice(0, 4)) - 1}${datum.slice(4)}`;
  return datum;
}

/**
 * اثر انگشت یکتای هر ردیف (همان ردیف در دو Auszug هم‌پوشان یکی است): با شمارهٔ مرجع بانک (`MC/000001716`)،
 * وگرنه تاریخ، مبلغ، متن و شمارهٔ تکرار همان ردیف در همین Auszug.
 */
export function fingerabdruecke(iban: string, umsaetze: { buchungstag: string; betragCent: number; text: string; referenz: string | null }[]): string[] {
  const gesehen = new Map<string, number>();
  return umsaetze.map((u) => {
    if (u.referenz?.trim()) return `${iban}|ref|${u.referenz.trim().toUpperCase()}`;
    const basis = `${iban}|${u.buchungstag}|${u.betragCent}|${textNormal(u.text)}`;
    const n = (gesehen.get(basis) ?? 0) + 1;
    gesehen.set(basis, n);
    return `${basis}|${n}`;
  });
}

export function auszugAuswerten(g: GelesenerAuszug): Ausgewertet {
  if (!g.istKontoauszug) return { ok: false, fehler: 'Das sieht nicht nach einem Kontoauszug aus.' };
  const iban = ibanNormal(g.iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { ok: false, fehler: 'Die IBAN des Kontos ist nicht lesbar.' };
  if (!gueltig(g.auszugDatum)) return { ok: false, fehler: 'Das Datum des Kontoauszugs ist nicht lesbar.' };
  if (g.alterKontostand == null || g.neuerKontostand == null) return { ok: false, fehler: 'Alter oder neuer Kontostand ist nicht lesbar.' };
  const auszugDatum = g.auszugDatum;

  const umsaetze: Omit<Umsatz, 'fingerabdruck'>[] = [];
  for (const [i, u] of g.umsaetze.entries()) {
    if (!gueltig(u.buchungstag)) return { ok: false, fehler: `Zeile ${i + 1}: Buchungsdatum nicht lesbar.` };
    const betragCent = cent(u.betrag);
    if (!Number.isFinite(betragCent) || betragCent === 0) return { ok: false, fehler: `Zeile ${i + 1}: Betrag nicht lesbar.` };
    umsaetze.push({
      buchungstag: jahrKorrigieren(u.buchungstag, auszugDatum),
      valuta: gueltig(u.valuta) ? jahrKorrigieren(u.valuta, auszugDatum) : null,
      betragCent,
      gegenpartei: u.gegenpartei?.trim().slice(0, 120) || null,
      iban: ibanNormal(u.iban) || null,
      text: u.text.replace(/\s+/g, ' ').trim().slice(0, 600),
      referenz: u.referenz?.trim() || null,
      bereich: u.bereich,
      kategorie: u.kategorie,
      privatKategorie: u.privatKategorie,
      rechnungsnummer: u.rechnungsnummer?.trim() || null,
    });
  }

  const alterCent = cent(g.alterKontostand);
  const neuerCent = cent(g.neuerKontostand);
  const summe = umsaetze.reduce((s, u) => s + u.betragCent, 0);
  if (summe !== neuerCent - alterCent) {
    return {
      ok: false,
      fehler: `Nicht vollständig gelesen: Die Umsätze ergeben € ${euro(summe)}, laut Kontostand müssten es € ${euro(neuerCent - alterCent)} sein. Bitte erneut lesen lassen.`,
    };
  }
  const ein = umsaetze.filter((u) => u.betragCent > 0).reduce((s, u) => s + u.betragCent, 0);
  const aus = -umsaetze.filter((u) => u.betragCent < 0).reduce((s, u) => s + u.betragCent, 0);
  if ((g.summeEin != null && cent(g.summeEin) !== ein) || (g.summeAus != null && cent(Math.abs(g.summeAus)) !== aus)) {
    return { ok: false, fehler: 'Nicht vollständig gelesen: »Summe Ein« oder »Summe Aus« passt nicht zu den Umsätzen. Bitte erneut lesen lassen.' };
  }

  const abdruecke = fingerabdruecke(iban, umsaetze);
  return {
    ok: true,
    iban,
    auszugNummer: g.auszugNummer?.trim() || null,
    auszugDatum,
    alterCent,
    neuerCent,
    umsaetze: umsaetze.map((u, i) => ({ ...u, fingerabdruck: abdruecke[i] })),
  };
}
