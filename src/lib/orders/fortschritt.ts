import type { Status } from './status';

/**
 * نوار پیشرفت هر سفارش (Spec فاز ۱، بخش E و F): فقط مراحل مربوط به همین سفارش.
 * - «Nur Design»: Eingereicht ← In Planung ← Freigabe ← Freigegeben
 * - «Fertige Arbeit»: Eingereicht ← In Planung ← Freigabe ← In Produktion ← (Einprobe) ← Fertig ← Versendet
 * «Freigabe» فقط اگر Behandlung آن را دارد؛ «Einprobe» فقط اگر در فرم خواسته شده است.
 * Rückfrage و Überarbeitung مرحلهٔ تازه نیستند؛ سفارش در همان مرحلهٔ قبلی می‌ماند.
 */

export type Etappe = { key: Status; label: string };

export type Fortschritt = {
  etappen: Etappe[];
  /** مرحلهٔ فعلی (۰ = اولی)؛ ‎-1 یعنی Entwurf. */
  aktuell: number;
  /** همه تمام شده (Geliefert، Abgeschlossen، یا Freigegeben برای «Nur Design»). */
  fertig: boolean;
  storniert: boolean;
};

export function etappenVon(e: { lieferart: 'design' | 'fertigung' | null; freigabeNoetig: boolean; einprobe: boolean }): Etappe[] {
  const liste: Etappe[] = [
    { key: 'eingereicht', label: 'Eingereicht' },
    { key: 'in_planung', label: 'In Planung' },
  ];
  if (e.freigabeNoetig) liste.push({ key: 'design_freigabe', label: 'Freigabe' });
  if (e.lieferart === 'design') {
    liste.push({ key: 'freigegeben', label: 'Freigegeben' });
    return liste;
  }
  liste.push({ key: 'in_produktion', label: 'In Produktion' });
  if (e.einprobe) liste.push({ key: 'einprobe', label: 'Einprobe' });
  liste.push({ key: 'fertig', label: 'Fertig' }, { key: 'versendet', label: 'Versendet' });
  return liste;
}

/** کدام مرحله برای این وضعیت روشن است. `vorher`: آخرین وضعیت پیش از Rückfrage (از Statusverlauf). */
export function fortschritt(
  status: Status,
  e: { lieferart: 'design' | 'fertigung' | null; freigabeNoetig: boolean; einprobe: boolean; vorher?: Status | null },
): Fortschritt {
  const etappen = etappenVon(e);
  const index = (k: Status) => etappen.findIndex((x) => x.key === k);
  const letzte = etappen.length - 1;
  const ergebnis = (aktuell: number, fertig = false, storniert = false) => ({ etappen, aktuell, fertig, storniert });

  switch (status) {
    case 'entwurf':
      return ergebnis(-1);
    case 'rueckfrage':
      return ergebnis(Math.max(0, e.vorher && e.vorher !== 'rueckfrage' ? fortschritt(e.vorher, e).aktuell : 0));
    case 'in_ueberarbeitung':
      return ergebnis(Math.max(index('design_freigabe'), index('in_planung')));
    case 'geliefert':
    case 'abgeschlossen':
      return ergebnis(letzte, true);
    case 'storniert':
      return ergebnis(Math.max(0, e.vorher ? fortschritt(e.vorher, e).aktuell : 0), false, true);
    case 'freigegeben':
      return e.lieferart === 'design' ? ergebnis(letzte, true) : ergebnis(Math.max(0, index('in_produktion')));
    case 'einprobe':
      return ergebnis(index('einprobe') >= 0 ? index('einprobe') : index('in_produktion'));
    default: {
      const i = index(status);
      return ergebnis(i >= 0 ? i : 0);
    }
  }
}

/** وضعیت‌هایی که کار سفارش دیگر باز نیست. */
export const ABGESCHLOSSEN: readonly Status[] = ['geliefert', 'abgeschlossen', 'storniert'];
/** وضعیت‌هایی که از Ordination کاری می‌خواهند (Spec E: «Ihre Aktion erforderlich»). */
export const AKTION_NOETIG: readonly Status[] = ['rueckfrage', 'design_freigabe', 'einprobe'];
