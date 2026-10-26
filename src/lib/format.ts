/** قالب تاریخ و مبلغ به شکل اتریشی (de-AT، به وقت وین). */
const ZONE = 'Europe/Vienna';

const datumF = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: ZONE });
const datumZeitF = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: ZONE });
const euroF = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' });

export const datum = (d: Date | null | undefined) => (d ? datumF.format(d) : '–');
export const datumZeit = (d: Date | null | undefined) => (d ? datumZeitF.format(d) : '–');
export const euro = (betrag: number) => euroF.format(betrag);

export function seitTagen(d: Date, jetzt = new Date()): string {
  const tage = Math.floor((jetzt.getTime() - d.getTime()) / 86_400_000);
  return tage <= 0 ? 'seit heute' : tage === 1 ? 'seit 1 Tag' : `seit ${tage} Tagen`;
}

const isoF = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONE });

/** امروز به وقت وین، «2026-10-01» (برای `<input type="date">` و مقایسهٔ تاریخ). */
export const heuteIso = (jetzt = new Date()) => isoF.format(jetzt);

/** «2026-10-08» ← «08.10.2026» */
export const isoDatumText = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('.') : '–');
