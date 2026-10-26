/**
 * Leistungsdatum هر سفارش (Spec فاز ۲، تصمیم‌های قدم ۱): Nur Design = روز Freigabe، Fertige Arbeit =
 * روز Übergabe (تاریخ Lieferschein؛ اگر نبود، روز «geliefert»). سفارش storniert یا هنوز تمام‌نشده
 * Leistungsdatum ندارد و فاکتور نمی‌شود.
 */
export type LeistungsDaten = {
  status: string;
  lieferart: 'design' | 'fertigung' | null;
  approvedAt: Date | null;
  /** اولین بار که سفارش «freigegeben» شد (برای Nur Design بدون Freigabe) */
  freigegebenAm: Date | null;
  lieferscheinAm: Date | null;
  deliveredAt: Date | null;
};

export function leistungsdatum(d: LeistungsDaten): Date | null {
  if (d.status === 'storniert' || d.status === 'entwurf') return null;
  if (d.lieferart === 'design') return d.approvedAt ?? d.freigegebenAm;
  if (d.lieferart === 'fertigung') return d.lieferscheinAm ?? d.deliveredAt;
  return null;
}

const ZONE = 'Europe/Vienna';
const monatF = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', timeZone: ZONE });
const monatNameF = new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric', timeZone: ZONE });

/** ماه Sammelrechnung به وقت وین: «2026-10» */
export const monatVon = (d: Date) => monatF.format(d).slice(0, 7);

/** «2026-10» ← «Oktober 2026» (اتریشی: «Jänner») */
export function monatName(monat: string): string {
  const [j, m] = monat.split('-').map(Number);
  return monatNameF.format(new Date(Date.UTC(j, m - 1, 15)));
}
