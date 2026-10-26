import { monatName } from './leistung';
import { monatsgrenzen } from './rechnungsdaten';

/**
 * دوره‌های آماده برای خروجی Excel (Spec فاز ۲، قدم ۵): ماه قبل، فصل قبل، امسال تا امروز، سال قبل. همه
 * تاریخ‌ها «YYYY-MM-DD» به وقت وین.
 */
export type Zeitraum = { name: string; von: string; bis: string };

const iso = (j: number, m: number, t: number) => new Date(Date.UTC(j, m - 1, t)).toISOString().slice(0, 10);

export function zeitraumVorlagen(heute: string): Zeitraum[] {
  const [j, m] = heute.split('-').map(Number);
  const vm = m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, '0')}`;
  const [vmVon, vmBis] = monatsgrenzen(vm);
  // فصل جاری ۱ تا ۴؛ فصل قبل، شاید در سال قبل
  const q = Math.ceil(m / 3);
  const [qj, vq] = q === 1 ? [j - 1, 4] : [j, q - 1];
  return [
    { name: monatName(vm), von: vmVon, bis: vmBis },
    { name: `${vq}. Quartal ${qj}`, von: iso(qj, vq * 3 - 2, 1), bis: iso(qj, vq * 3 + 1, 0) },
    { name: `${j} bis heute`, von: `${j}-01-01`, bis: heute },
    { name: String(j - 1), von: `${j - 1}-01-01`, bis: `${j - 1}-12-31` },
  ];
}

const GUELTIG = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v);

/** null یعنی درست؛ وگرنه پیام آلمانی برای کاربر */
export function zeitraumFehler(von: string, bis: string): string | null {
  if (!GUELTIG(von) || !GUELTIG(bis)) return 'Bitte ein gültiges Von- und Bis-Datum wählen.';
  if (von > bis) return 'Das Von-Datum liegt nach dem Bis-Datum.';
  const tage = (Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000;
  if (tage > 731) return 'Höchstens zwei Jahre auf einmal.';
  return null;
}
