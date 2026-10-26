import type { Zahlungsart } from '@/db/schema';

/**
 * وضعیت پرداخت هر Rechnung و Saldo هر Ordination (Spec فاز ۲، قدم ۳). همه به سنت. Gutschriftها منفی
 * ذخیره شده‌اند و از مبلغ همان Rechnung کم می‌شوند؛ پرداخت‌ها مثبت‌اند:
 *   offen = Rechnungsbetrag + Gutschriften − Zahlungen
 * منفی یعنی Guthaben (بیشتر از مبلغ پرداخت شده، مثلاً Gutschrift بعد از پرداخت).
 */
export const ZAHLUNGSART_NAMEN: Record<Zahlungsart, string> = { ueberweisung: 'Überweisung', bar: 'Bar', karte: 'Karte', sonstige: 'Sonstige' };

export type Zahlstatus = 'offen' | 'teilweise' | 'bezahlt' | 'ausgeglichen' | 'guthaben' | 'storniert';

export type Zahlstand = {
  status: Zahlstatus;
  offenCent: number;
  gezahltCent: number;
  /** هنوز مبلغی باز است و تاریخ سررسید گذشته */
  ueberfaellig: boolean;
};

export function zahlstand(
  r: { summeCent: number; gutschriftenCent: number; gezahltCent: number; storniert: boolean; faelligAm: string | null },
  heute: string,
): Zahlstand {
  const offenCent = r.summeCent + r.gutschriftenCent - r.gezahltCent;
  let status: Zahlstatus;
  if (r.storniert) status = 'storniert';
  else if (offenCent < 0) status = 'guthaben';
  else if (offenCent === 0) status = r.gezahltCent > 0 ? 'bezahlt' : 'ausgeglichen';
  else status = r.gezahltCent > 0 ? 'teilweise' : 'offen';
  const ueberfaellig = !r.storniert && offenCent > 0 && r.faelligAm != null && heute > r.faelligAm;
  return { status, offenCent, gezahltCent: r.gezahltCent, ueberfaellig };
}

export type Saldo = {
  /** مثبت: Ordination بدهکار است؛ منفی: Guthaben */
  offenCent: number;
  ueberfaelligCent: number;
  offeneRechnungen: number;
  /** قدیمی‌ترین سررسیدِ Rechnungهای هنوز باز */
  aeltesteFaelligkeit: string | null;
};

export function saldoAus(rechnungen: { stand: Zahlstand; faelligAm: string | null }[]): Saldo {
  const offen = rechnungen.filter((r) => r.stand.offenCent > 0);
  const faelligkeiten = offen.map((r) => r.faelligAm).filter((f): f is string => f != null).sort();
  const offenCent = rechnungen.reduce((s, r) => s + r.stand.offenCent, 0);
  // یک Guthaben روی Rechnung دیگر، بدهی سررسیده را کم می‌کند؛ «überfällig» هرگز بیشتر از کل مانده نیست
  const ueberfaellig = offen.filter((r) => r.stand.ueberfaellig).reduce((s, r) => s + r.stand.offenCent, 0);
  return {
    offenCent,
    ueberfaelligCent: Math.min(ueberfaellig, Math.max(offenCent, 0)),
    offeneRechnungen: offen.length,
    aeltesteFaelligkeit: faelligkeiten[0] ?? null,
  };
}
