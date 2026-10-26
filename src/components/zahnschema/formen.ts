import { relativeBreite, zahntyp, type Zahntyp } from '@/lib/orders/fdi';

/**
 * شکل‌های کشیدهٔ خودمان. هیچ تصویری از سرویس دیگری کپی نشده است.
 * (Zahnleiste از ۲۶ اکتبر ۲۰۲۶ عکس دندان نشان می‌دهد؛ فقط پیچ Implantat از اینجاست.)
 */

/** پیچ Implantat به‌جای ریشه، در جعبهٔ ۱۰۰×۱۰۰ (تاج بالا، ریشه پایین). */
export const IMPLANTAT = {
  koerper: 'M38 52L62 52L59 92Q50 99 41 92Z',
  gewinde: [60, 67, 74, 81, 88].map((y) => {
    const halb = 12 - (y - 52) * 0.08;
    return `M${50 - halb} ${y}L${50 + halb} ${y + 3}`;
  }),
  abutment: 'M42 44L58 44L60 52L40 52Z',
};

/**
 * نمای از بالا (Kieferbogen): ابعاد دندان در راستای قوس (`breite`) و در
 * راستای بیرون-درون (`tiefe`)، نسبت به یک واحد.
 */
export function aufsicht(fdi: number): { breite: number; tiefe: number; typ: Zahntyp } {
  const typ = zahntyp(fdi);
  const breite = relativeBreite(fdi);
  const verhaeltnis: Record<Zahntyp, number> = { schneidezahn: 0.62, eckzahn: 1.0, praemolar: 1.12, molar: 0.96 };
  return { breite, tiefe: breite * verhaeltnis[typ], typ };
}
