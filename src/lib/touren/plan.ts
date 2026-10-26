/**
 * منطق خالص تاریخ برای تقویم و تورها (Spec فاز ۱، بخش I)، بدون دیتابیس و قابل‌تست.
 * تاریخ‌ها همیشه رشتهٔ «YYYY-MM-DD» به وقت وین‌اند (از `heuteIso`)؛ حساب روزها با UTC انجام می‌شود
 * تا تغییر ساعت تابستانی یک روز را جابه‌جا نکند. روزهای هفته ISO: ۱ = Montag … ۷ = Sonntag.
 */

export const WOCHENTAGE = [
  { nr: 1, kurz: 'Mo', lang: 'Montag' },
  { nr: 2, kurz: 'Di', lang: 'Dienstag' },
  { nr: 3, kurz: 'Mi', lang: 'Mittwoch' },
  { nr: 4, kurz: 'Do', lang: 'Donnerstag' },
  { nr: 5, kurz: 'Fr', lang: 'Freitag' },
  { nr: 6, kurz: 'Sa', lang: 'Samstag' },
  { nr: 7, kurz: 'So', lang: 'Sonntag' },
] as const;

const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export function istIsoDatum(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const alsDatum = (iso: string) => new Date(`${iso}T00:00:00Z`);
const alsIso = (d: Date) => d.toISOString().slice(0, 10);

export function plusTage(iso: string, tage: number): string {
  const d = alsDatum(iso);
  d.setUTCDate(d.getUTCDate() + tage);
  return alsIso(d);
}

/** ۱ = Montag … ۷ = Sonntag */
export function wochentag(iso: string): number {
  return ((alsDatum(iso).getUTCDay() + 6) % 7) + 1;
}

/** «Do, 08.10.» */
export function tagKurz(iso: string): string {
  const [, m, t] = iso.split('-');
  return `${WOCHENTAGE[wochentag(iso) - 1].kurz}, ${t}.${m}.`;
}

/** «Donnerstag, 8. Oktober 2026» */
export function tagLang(iso: string): string {
  const [j, m, t] = iso.split('-').map(Number);
  return `${WOCHENTAGE[wochentag(iso) - 1].lang}, ${t}. ${MONATE[m - 1]} ${j}`;
}

export function monatTitel(iso: string): string {
  const [j, m] = iso.split('-').map(Number);
  return `${MONATE[m - 1]} ${j}`;
}

/** «Mo–Fr», «Mo, Mi, Fr», «–» */
export function tageText(tage: readonly number[]): string {
  const t = [...new Set(tage)].filter((x) => x >= 1 && x <= 7).sort((a, b) => a - b);
  if (!t.length) return '–';
  const laeufe: number[][] = [];
  for (const x of t) {
    const l = laeufe[laeufe.length - 1];
    if (l && x === l[l.length - 1] + 1) l.push(x);
    else laeufe.push([x]);
  }
  const k = (n: number) => WOCHENTAGE[n - 1].kurz;
  return laeufe.map((l) => (l.length >= 3 ? `${k(l[0])}–${k(l[l.length - 1])}` : l.map(k).join(', '))).join(', ');
}

/** اولین روزِ تور از `ab` به بعد (خود `ab` هم حساب است)؛ بدون روز: null. */
export function naechsterTourTag(tage: readonly number[], ab: string): string | null {
  if (!tage.length) return null;
  for (let i = 0; i < 7; i++) {
    const d = plusTage(ab, i);
    if (tage.includes(wochentag(d))) return d;
  }
  return null;
}

/** دوشنبهٔ همان هفته */
export function wochenBeginn(iso: string): string {
  return plusTage(iso, 1 - wochentag(iso));
}

export function wocheVon(iso: string): string[] {
  const start = wochenBeginn(iso);
  return Array.from({ length: 7 }, (_, i) => plusTage(start, i));
}

/** هفته‌های کامل (دوشنبه تا یکشنبه) که ماهِ `iso` را می‌پوشانند. */
export function monatsRaster(iso: string): string[][] {
  const erster = `${iso.slice(0, 7)}-01`;
  const naechster = plusTage(erster, 32).slice(0, 7);
  const letzter = plusTage(`${naechster}-01`, -1);
  const wochen: string[][] = [];
  for (let start = wochenBeginn(erster); start <= letzter; start = plusTage(start, 7)) wochen.push(wocheVon(start));
  return wochen;
}

/** یک ماه جلو یا عقب، روز ۱ */
export function monatVerschieben(iso: string, monate: number): string {
  const [j, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1 + monate, 1));
  return alsIso(d);
}
