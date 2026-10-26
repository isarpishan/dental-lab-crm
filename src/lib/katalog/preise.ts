import type { LieferOption, Zuschlag } from '@/db/schema';

/**
 * قیمت‌ها در فرم‌ها: ورودی با ویرگول اتریشی («120,50»)، ذخیره به یورو با دو رقم اعشار.
 * خالی یعنی «هنوز قیمتی نیست» (در فرم: «Preis auf Anfrage» / «Expresszuschlag nach Prüfung»).
 */
export const PREIS_EINHEITEN = ['Zahn', 'Glied', 'Kiefer', 'Fall'] as const satisfies readonly LieferOption['einheit'][];
/** واحدهای Expresszuschlag و Same-Day-Zuschlag. */
export const ZUSCHLAG_EINHEITEN = ['Auftrag', ...PREIS_EINHEITEN] as const satisfies readonly Zuschlag['einheit'][];

export type PreisLesen = { ok: true; wert: number | null } | { ok: false; fehler: string };

export function preisLesen(eingabe: string | null | undefined): PreisLesen {
  const t = (eingabe ?? '').trim().replace(/\s|€/g, '');
  if (!t) return { ok: true, wert: null };
  // هم «1.234,50» و هم «1234.50» پذیرفته می‌شوند. بدون ویرگول، نقطه فقط وقتی جداکنندهٔ هزارگان است که همیشه دقیقاً
  // سه رقم بعدش بیاید («3.000»، «1.250.000»؛ Spec فاز ۵): «12.50» همچنان ۱۲٫۵ است و چیزی که قبلاً درست بود عوض نمی‌شود.
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(normal)) return { ok: false, fehler: `»${eingabe}« ist kein gültiger Betrag (z. B. 120 oder 120,50).` };
  return { ok: true, wert: Number(normal) };
}

/** برای مقدار پیش‌فرض فیلد: 120 ← «120»، 120.5 ← «120,50». */
export function preisAnzeigen(wert: number | null | undefined): string {
  if (wert == null) return '';
  return Number.isInteger(wert) ? String(wert) : wert.toFixed(2).replace('.', ',');
}

const ganz = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const genau = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/** «€ 120» یا «€ 120,50». */
export function euroBetrag(wert: number): string {
  return Number.isInteger(wert) ? ganz.format(wert) : genau.format(wert);
}
