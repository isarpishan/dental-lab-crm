import { preisLesen } from '@/lib/katalog/preise';

/**
 * مبلغ‌های Abrechnung همیشه به سنت (عدد صحیح) حساب می‌شوند، تا جمع ردیف‌ها با گرد کردن اعشاری
 * خطا نسازد (Spec فاز ۲، تصمیم‌های قدم ۱). قیمت‌های Stammdaten به یورو هستند.
 */
export const centAusEuro = (euro: number) => Math.round(euro * 100);

const formatierer = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/** «€ 1.234,50» (همیشه با سنت، مثل روی فاکتور) */
export const centText = (cent: number) => formatierer.format(cent / 100);

/** مقدار پیش‌فرض فیلد: 8950 ← «89,50» */
export const centEingabe = (cent: number | null | undefined) => (cent == null ? '' : (cent / 100).toFixed(2).replace('.', ','));

export type CentLesen = { ok: true; wert: number | null } | { ok: false; fehler: string };

/** ورودی اتریشی («1.234,50»، «89,5»، «120») ← سنت؛ خالی ← null. */
export function centLesen(eingabe: string | null | undefined): CentLesen {
  const r = preisLesen(eingabe);
  return r.ok ? { ok: true, wert: r.wert == null ? null : centAusEuro(r.wert) } : r;
}

/** جمع چند سفارش: اگر هیچ‌کدام قیمت ندارند، «€ 0,00» گمراه‌کننده است ← null («Preise fehlen»). */
export const summeOderNull = (cent: number, ohnePreis: number, anzahl: number) => (cent === 0 && ohnePreis > 0 && ohnePreis === anzahl ? null : cent);
