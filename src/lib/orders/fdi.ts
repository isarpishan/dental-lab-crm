/**
 * شماره‌گذاری FDI و ترتیب نمایش دندان‌ها.
 *
 * ترتیب نمایش همان دید دندانپزشک روبه‌روی بیمار است: سمت راست بیمار (کوادرانت
 * ۱ و ۴) در چپ صفحه. پس ردیف بالا 18…11 | 21…28 و ردیف پایین 48…41 | 31…38،
 * مثل همهٔ Zahnschemaهای رایج.
 */

export type Kiefer = 'OK' | 'UK';
export type Zahntyp = 'schneidezahn' | 'eckzahn' | 'praemolar' | 'molar';

export const OK_REIHE = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] as const;
export const UK_REIHE = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const;

export function istZahn(fdi: number): boolean {
  const quadrant = Math.floor(fdi / 10);
  const nummer = fdi % 10;
  return quadrant >= 1 && quadrant <= 4 && nummer >= 1 && nummer <= 8;
}

export function kieferVon(fdi: number): Kiefer {
  return fdi < 30 ? 'OK' : 'UK';
}

export function reiheVon(kiefer: Kiefer): readonly number[] {
  return kiefer === 'OK' ? OK_REIHE : UK_REIHE;
}

/** جای دندان در ردیف نمایش (۰ تا ۱۵). */
export function position(fdi: number): number {
  return reiheVon(kieferVon(fdi)).indexOf(fdi);
}

export function zahntyp(fdi: number): Zahntyp {
  const nummer = fdi % 10;
  if (nummer <= 2) return 'schneidezahn';
  if (nummer === 3) return 'eckzahn';
  if (nummer <= 5) return 'praemolar';
  return 'molar';
}

/**
 * پهنای نسبی دندان (molar بالا = ۱). فقط برای کشیدن است، نه اندازهٔ بالینی.
 * دندان‌های جلوی فک پایین باریک‌ترند.
 */
const BREITE_OK: Record<number, number> = { 1: 0.86, 2: 0.66, 3: 0.76, 4: 0.7, 5: 0.66, 6: 1, 7: 0.92, 8: 0.86 };
const BREITE_UK: Record<number, number> = { 1: 0.54, 2: 0.58, 3: 0.68, 4: 0.7, 5: 0.7, 6: 1.08, 7: 1.02, 8: 0.98 };

export function relativeBreite(fdi: number): number {
  return (kieferVon(fdi) === 'OK' ? BREITE_OK : BREITE_UK)[fdi % 10];
}

/** فهرست دندان‌ها به ترتیب نمایش، برای خلاصه‌ها: «16, 15, 14». */
export function sortiert(fdis: Iterable<number>): number[] {
  return [...fdis].sort((a, b) => {
    const ka = kieferVon(a);
    const kb = kieferVon(b);
    if (ka !== kb) return ka === 'OK' ? -1 : 1;
    return position(a) - position(b);
  });
}
