/**
 * کمک‌های مشترک «Ausgaben» برای سرور و مرورگر (بدون `server-only`): نام Kategorieها، نرخ‌های MwSt و حساب
 * Netto/MwSt/Brutto. همهٔ مبلغ‌ها به سنت. `schema.ts` فهرست Kategorieها را از همین‌جا می‌گیرد (مثل `TEMPI`)،
 * تا مرورگر کد دیتابیس را بار نکند.
 */
export const AUSGABE_KATEGORIEN = ['material', 'geraete', 'software', 'versand', 'buero', 'sonstiges'] as const;
export type AusgabeKategorie = (typeof AUSGABE_KATEGORIEN)[number];

export const KATEGORIE_NAMEN: Record<AusgabeKategorie, string> = {
  material: 'Material & Resin',
  geraete: 'Geräte & Werkzeug',
  software: 'Software & Lizenzen',
  versand: 'Versand & Fahrten',
  buero: 'Büro & Telefon',
  sonstiges: 'Sonstiges',
};

/** نرخ‌های اتریش؛ «anders» = مبلغ MwSt مستقیم (چند نرخ روی یک Rechnung، یا Rechnung خارجی) */
export const MWST_SAETZE = [20, 13, 10, 0] as const;
export type MwstSatz = (typeof MWST_SAETZE)[number];

export const istMwstSatz = (n: number): n is MwstSatz => (MWST_SAETZE as readonly number[]).includes(n);

/** MwSt از Netto: گرد به نزدیک‌ترین سنت */
export const mwstAusNetto = (nettoCent: number, satz: MwstSatz) => Math.round((nettoCent * satz) / 100);

/** Netto از Brutto (وقتی روی رسید فقط Brutto چاپ شده است) */
export function ausBrutto(bruttoCent: number, satz: MwstSatz): { nettoCent: number; mwstCent: number } {
  const nettoCent = Math.round((bruttoCent * 100) / (100 + satz));
  return { nettoCent, mwstCent: bruttoCent - nettoCent };
}

/**
 * MwSt با نرخ داده‌شده می‌خواند؟ یک سنت فرق مجاز است، چون Rechnungها گاهی هر ردیف را جدا گرد می‌کنند یا
 * Netto را از Brutto حساب می‌کنند.
 */
export const mwstPasst = (nettoCent: number, mwstCent: number, satz: MwstSatz) =>
  Math.abs(mwstAusNetto(nettoCent, satz) - mwstCent) <= 1 || Math.abs(ausBrutto(nettoCent + mwstCent, satz).mwstCent - mwstCent) <= 1;

/**
 * بالای € 1.000 (Geringwertige Wirtschaftsgüter، § 13 EStG) یک دستگاه یا نرم‌افزار معمولاً چندساله نوشته
 * می‌شود (AfA). چون Vorsteuer پس گرفته نمی‌شود، Brutto ملاک است. برنامه فقط علامت می‌زند؛ تصمیم با Steuerberatung.
 */
export const AFA_GRENZE_CENT = 100_000;
export const afaPruefen = (a: { kategorie: AusgabeKategorie; bruttoCent: number }) => (a.kategorie === 'geraete' || a.kategorie === 'software') && a.bruttoCent > AFA_GRENZE_CENT;

/** نام فروشنده برای مقایسهٔ تکراری‌ها: «Formlabs GmbH» = «formlabs gmbh » */
export const lieferantNormal = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** «2026-10» ← «Oktober 2026» */
export const monatTitel = (jahrMonat: string) => `${MONATE[Number(jahrMonat.slice(5, 7)) - 1]} ${jahrMonat.slice(0, 4)}`;

/** Beleg: Foto vom Handy, Scan oder PDF. Höchstens 20 MB (Fotos werden im Browser vorher verkleinert). */
export const BELEG_MAX_BYTES = 20 * 1024 * 1024;
export const BELEG_ANNEHMEN = 'image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf,.heic,.pdf';

/** نوع Beleg فقط از بایت‌های اول فایل، نه از نام یا Content-Type مرورگر (فایل در مرورگر باز می‌شود). */
export function belegTypVon(kopf: Uint8Array): { typ: string; endung: string } | null {
  const text = (von: number, bis: number) => String.fromCharCode(...kopf.subarray(von, bis));
  if (text(0, 5) === '%PDF-') return { typ: 'application/pdf', endung: 'pdf' };
  if (kopf[0] === 0xff && kopf[1] === 0xd8 && kopf[2] === 0xff) return { typ: 'image/jpeg', endung: 'jpg' };
  if (text(0, 8) === '\x89PNG\r\n\x1a\n') return { typ: 'image/png', endung: 'png' };
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return { typ: 'image/webp', endung: 'webp' };
  if (text(4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'msf1', 'hevc', 'heim', 'heis'].includes(text(8, 12))) return { typ: 'image/heic', endung: 'heic' };
  return null;
}
