/**
 * «Übersicht» (Spec فاز ۵، قدم ۱): جمع‌های ماهانهٔ پول، بدون دیتابیس تا با آزمون واحد سنجیده شود.
 * همهٔ مبلغ‌ها به سنت. ماه‌ها رشتهٔ «2026-10» و تاریخ‌ها «2026-10-08» به وقت وین هستند (از `heuteIso`).
 * - Einnahmen: پرداخت‌های دریافتی (Zuflussprinzip، مثل Einnahmen-Ausgaben-Rechnung).
 * - fakturiert: Rechnungها منهای Gutschriftها (`summe_cent` در Gutschrift منفی است).
 * - Ausgaben: Brutto بر اساس «Bezahlt am».
 */

export type Buchung = { datum: string; cent: number };
export type AusgabeBuchung = Buchung & { kategorie: string };

export type Monatszahlen = {
  monat: string;
  einnahmenCent: number;
  fakturiertCent: number;
  ausgabenCent: number;
  ueberschussCent: number;
  /** Überschuss ÷ Einnahmen، بین ۰ و ۱ (یا منفی)؛ بدون Einnahmen ← null */
  quote: number | null;
};

export type Kategorieanteil = { kategorie: string | null; cent: number; anteil: number };

/** «2026-10» + n ماه (n منفی هم) */
export function monatVerschieben(monat: string, n: number): string {
  const [j, m] = monat.split('-').map(Number);
  const index = j * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** ماه معتبر از نشانی، نه بعد از ماه جاری؛ وگرنه ماه جاری */
export function monatWahl(wert: string | undefined, aktuell: string): string {
  if (!wert || !/^\d{4}-(0[1-9]|1[0-2])$/.test(wert) || wert < '2000-01') return aktuell;
  return wert > aktuell ? aktuell : wert;
}

const summe = (xs: Buchung[], passt: (datum: string) => boolean) => xs.reduce((s, x) => (passt(x.datum) ? s + x.cent : s), 0);

function zahlen(monat: string, passt: (datum: string) => boolean, d: { einnahmen: Buchung[]; fakturiert: Buchung[]; ausgaben: Buchung[] }): Monatszahlen {
  const einnahmenCent = summe(d.einnahmen, passt);
  const ausgabenCent = summe(d.ausgaben, passt);
  const ueberschussCent = einnahmenCent - ausgabenCent;
  return {
    monat,
    einnahmenCent,
    fakturiertCent: summe(d.fakturiert, passt),
    ausgabenCent,
    ueberschussCent,
    quote: einnahmenCent > 0 ? ueberschussCent / einnahmenCent : null,
  };
}

/** تغییر نسبت به ماه قبل (۰٫۱ = ۱۰ ٪)؛ ماه قبل ۰ ← null */
export function veraenderung(jetzt: number, vorher: number): number | null {
  if (vorher === 0) return null;
  return (jetzt - vorher) / Math.abs(vorher);
}

/**
 * Ausgaben بر اساس Kategorie، بزرگ‌ترین اول. پیش‌فرض: همه (خواستهٔ کاربر، ۲۶ اکتبر ۲۰۲۶: «Abos» و «Gesundheit» را هم
 * ببیند). با `max`: فقط `max` تای بزرگ‌تر و بقیه با هم «Weitere» (فقط اگر بیش از یکی بمانند).
 */
export function nachKategorie(ausgaben: AusgabeBuchung[], passt: (datum: string) => boolean, max = Infinity): Kategorieanteil[] {
  const je = new Map<string, number>();
  for (const a of ausgaben) if (passt(a.datum)) je.set(a.kategorie, (je.get(a.kategorie) ?? 0) + a.cent);
  const gesamt = [...je.values()].reduce((s, c) => s + c, 0);
  if (gesamt <= 0) return [];
  const sortiert = [...je.entries()].filter(([, c]) => c > 0).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  const oben: [string | null, number][] = sortiert.length > max + 1 ? sortiert.slice(0, max) : sortiert;
  if (sortiert.length > max + 1) oben.push([null, sortiert.slice(max).reduce((s, [, c]) => s + c, 0)]);
  return oben.map(([kategorie, cent]) => ({ kategorie, cent, anteil: cent / gesamt }));
}

export type Uebersicht = {
  monat: Monatszahlen;
  vormonat: Monatszahlen;
  /** از اول Jänner تا پایان ماه انتخاب‌شده */
  jahr: Monatszahlen;
  /** شش ماه، قدیمی‌ترین اول، ماه انتخاب‌شده آخر */
  verlauf: Monatszahlen[];
  kategorienMonat: Kategorieanteil[];
  kategorienJahr: Kategorieanteil[];
  /** تا پایان ماه انتخاب‌شده هیچ ردیفی نیست */
  leer: boolean;
};

export function uebersichtBerechnen(monat: string, d: { einnahmen: Buchung[]; fakturiert: Buchung[]; ausgaben: AusgabeBuchung[] }): Uebersicht {
  const imMonat = (m: string) => (datum: string) => datum.startsWith(m);
  const jahrVon = `${monat.slice(0, 4)}-01`;
  const imJahr = (datum: string) => datum.slice(0, 7) >= jahrVon && datum.slice(0, 7) <= monat;
  const verlauf = Array.from({ length: 6 }, (_, i) => monatVerschieben(monat, i - 5)).map((m) => zahlen(m, imMonat(m), d));
  const bisEnde = (datum: string) => datum.slice(0, 7) <= monat;
  return {
    monat: verlauf[5],
    vormonat: verlauf[4],
    jahr: zahlen(monat.slice(0, 4), imJahr, d),
    verlauf,
    kategorienMonat: nachKategorie(d.ausgaben, imMonat(monat)),
    kategorienJahr: nachKategorie(d.ausgaben, imJahr),
    leer: ![...d.einnahmen, ...d.fakturiert, ...d.ausgaben].some((x) => bisEnde(x.datum)),
  };
}

/** اولین روزی که داده‌اش لازم است: اول سال یا پنج ماه قبل، هر کدام زودتر */
export function datenAb(monat: string): string {
  const fuenfZurueck = monatVerschieben(monat, -5);
  const jahrVon = `${monat.slice(0, 4)}-01`;
  return `${fuenfZurueck < jahrVon ? fuenfZurueck : jahrVon}-01`;
}

/** اولین روز ماه بعد: سقف بازه، خودش بیرون (`< …`)؛ «2026-09-31» در Postgres تاریخ نامعتبر است */
export const datenVor = (monat: string) => `${monatVerschieben(monat, 1)}-01`;
