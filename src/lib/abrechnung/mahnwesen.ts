import { z } from 'zod';
import type { Zahlstand } from './offen';

/**
 * Mahnwesen (Spec فاز ۲، قدم ۴؛ پیش‌فرض‌ها را کاربر ۴ اکتبر ۲۰۲۶ پذیرفت): سه مرحله پس از سررسید —
 * «Zahlungserinnerung» دوستانه، «1. Mahnung»، «2. Mahnung» (آخرین) — هر کدام با مهلت تازه، بدون
 * هزینه. هیچ‌چیز خودکار فرستاده نمی‌شود؛ این‌جا فقط حساب می‌شود کدام مرحله برای کدام Rechnung رسیده است.
 */
export const MAHNSTUFEN = [1, 2, 3] as const;
export type Mahnstufe = (typeof MAHNSTUFEN)[number];
export const MAHNSTUFE_NAMEN: Record<Mahnstufe, string> = { 1: 'Zahlungserinnerung', 2: '1. Mahnung', 3: '2. Mahnung' };

export type Mahnwesen = { erinnerungTage: number; mahnung1Tage: number; mahnung2Tage: number; fristTage: number };
export const MAHNWESEN_STANDARD: Mahnwesen = { erinnerungTage: 7, mahnung1Tage: 21, mahnung2Tage: 35, fristTage: 7 };

const tage = z.number().int().min(1).max(365);
const gespeichert = z.object({ erinnerungTage: tage, mahnung1Tage: tage, mahnung2Tage: tage, fristTage: z.number().int().min(1).max(60) }).partial();

/** تنظیم ذخیره‌شده با پیش‌فرض‌ها؛ مقدار نادرست یعنی پیش‌فرض */
export function mahnwesenAus(v: unknown): Mahnwesen {
  const r = gespeichert.safeParse(v ?? {});
  return { ...MAHNWESEN_STANDARD, ...(r.success ? Object.fromEntries(Object.entries(r.data).filter(([, x]) => x !== undefined)) : {}) };
}

/** null یعنی درست؛ وگرنه پیام آلمانی */
export function mahnwesenFehler(m: Mahnwesen): string | null {
  const ganz = (x: number, min: number, max: number) => Number.isInteger(x) && x >= min && x <= max;
  if (![m.erinnerungTage, m.mahnung1Tage, m.mahnung2Tage].every((x) => ganz(x, 1, 365))) return 'Die Tage nach der Fälligkeit liegen zwischen 1 und 365.';
  if (!ganz(m.fristTage, 1, 60)) return 'Die neue Frist liegt zwischen 1 und 60 Tagen.';
  if (!(m.erinnerungTage < m.mahnung1Tage && m.mahnung1Tage < m.mahnung2Tage)) return 'Die Stufen müssen aufeinander folgen: Erinnerung vor der 1. Mahnung, diese vor der 2. Mahnung.';
  return null;
}

export const tageZwischen = (von: string, bis: string) => Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);

/**
 * مرحلهٔ بعدی که برای یک Rechnung رسیده، یا null. شرط‌ها: هنوز مبلغی باز است (نه storniert)، از سررسید
 * به‌اندازهٔ همان مرحله گذشته، و مهلت نامهٔ قبلی هم تمام شده. بعد از «2. Mahnung» دیگر چیزی نیست.
 */
export function faelligeStufe(
  r: { faelligAm: string | null; stand: Zahlstand | null; letzte: { stufe: number; frist: string } | null },
  heute: string,
  m: Mahnwesen,
): Mahnstufe | null {
  if (!r.faelligAm || !r.stand || r.stand.status === 'storniert' || r.stand.offenCent <= 0) return null;
  const naechste = (r.letzte?.stufe ?? 0) + 1;
  if (naechste > 3) return null;
  const schwelle = [m.erinnerungTage, m.mahnung1Tage, m.mahnung2Tage][naechste - 1];
  if (tageZwischen(r.faelligAm, heute) < schwelle) return null;
  if (r.letzte && heute <= r.letzte.frist) return null;
  return naechste as Mahnstufe;
}
