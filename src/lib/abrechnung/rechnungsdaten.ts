import { z } from 'zod';
import type { Aussteller } from '@/lib/dokumente/aussteller-werte';

/**
 * داده‌های فاکتور که در «Einstellungen» (فقط Inhaber) تنظیم می‌شوند: IBAN، مهلت پرداخت، UID (اگر هست)
 * و متن معافیت مالیاتی (Spec فاز ۲، قدم ۲). بدون دیتابیس، تا آزمون‌پذیر باشد.
 */
export type Rechnungsdaten = {
  iban: string;
  bic: string;
  uid: string;
  zahlungszielTage: number;
  /** روی هر فاکتور زیر جمع (تأیید Steuerberater، ۳ اکتبر ۲۰۲۶: بدون MwSt) */
  hinweis: string;
  /** متن اختیاری پایین فاکتور، مثلاً «Vielen Dank für die Zusammenarbeit.» */
  fusstext: string;
};

export const RECHNUNGSDATEN_STANDARD: Rechnungsdaten = {
  iban: '',
  bic: '',
  uid: '',
  zahlungszielTage: 14,
  hinweis: 'Steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.',
  fusstext: '',
};

const gespeichert = z
  .object({ iban: z.string(), bic: z.string(), uid: z.string(), zahlungszielTage: z.number().int().min(0).max(120), hinweis: z.string(), fusstext: z.string() })
  .partial();

export function rechnungsdatenAus(wert: unknown): Rechnungsdaten {
  const r = gespeichert.safeParse(wert ?? {});
  return { ...RECHNUNGSDATEN_STANDARD, ...(r.success ? Object.fromEntries(Object.entries(r.data).filter(([, v]) => v !== undefined)) : {}) };
}

const ohneLeer = (iban: string) => iban.replace(/\s/g, '').toUpperCase();

/** «AT611904300234573201» ← «AT61 1904 3002 3457 3201» */
export const ibanFormat = (iban: string) => ohneLeer(iban).replace(/(.{4})(?=.)/g, '$1 ');

/** طول و رقم کنترل (mod 97، ISO 13616)؛ خطای تایپی معمولاً همین‌جا پیدا می‌شود. */
export function ibanGueltig(iban: string): boolean {
  const i = ohneLeer(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i)) return false;
  if (i.startsWith('AT') && i.length !== 20) return false;
  const zahl = (i.slice(4) + i.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ziffer of zahl) rest = (rest * 10 + Number(ziffer)) % 97;
  return rest === 1;
}

/** تا این‌ها پر نباشد، فاکتوری صادر نمی‌شود (§ 11 UStG: نام و نشانی صادرکننده؛ برای پرداخت: IBAN). */
export function fehlendeAngaben(a: Aussteller, r: Rechnungsdaten): string[] {
  const fehlt: string[] = [];
  if (!a.name.trim()) fehlt.push('Name des Ausstellers');
  if (!a.strasse.trim() || !a.ort.trim()) fehlt.push('Anschrift des Ausstellers');
  if (!ibanGueltig(r.iban)) fehlt.push('IBAN');
  if (!r.hinweis.trim()) fehlt.push('Hinweis zur Umsatzsteuer');
  return fehlt;
}

/** «2026-10-03» + ۱۴ روز ← «2026-10-17» (تاریخ تقویمی، بدون ساعت) */
export function faelligAm(heuteIso: string, tage: number): string {
  const [j, m, t] = heuteIso.split('-').map(Number);
  return new Date(Date.UTC(j, m - 1, t + tage)).toISOString().slice(0, 10);
}

/** اول و آخر یک ماه: «2026-09» ← ['2026-09-01', '2026-09-30'] */
export function monatsgrenzen(monat: string): [string, string] {
  const [j, m] = monat.split('-').map(Number);
  return [`${monat}-01`, new Date(Date.UTC(j, m, 0)).toISOString().slice(0, 10)];
}
