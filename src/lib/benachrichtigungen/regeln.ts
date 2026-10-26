import type { Benachrichtigung } from '@/db/schema';
import type { Seite, Status } from '@/lib/orders/status';

/**
 * قاعده‌های اعلان ایمیلی (Spec فاز ۱، بخش M). بدون دیتابیس، تا آزمون‌پذیر بماند.
 * ⚠️ هیچ ایمیلی نام بیمار، متن پیام یا متن آزاد ندارد؛ فقط شمارهٔ سفارش، کد بیمار و Behandlung.
 */

/** نام و توضیح هر رویداد برای صفحهٔ «Einstellungen» (پورتال) و صفحهٔ Ordination (داخلی). */
export const BENACHRICHTIGUNG_NAMEN: Record<Benachrichtigung, { titel: string; text: string }> = {
  auftrag_eingegangen: { titel: 'Auftrag eingegangen', text: 'Bestätigung, sobald ein Auftrag bei uns angekommen ist.' },
  rueckfrage: { titel: 'Rückfrage', text: 'Wenn uns für einen Auftrag noch Angaben oder Dateien fehlen.' },
  design_freigabe: { titel: 'Design zur Freigabe', text: 'Wenn ein Design oder eine neue Version zur Prüfung bereitliegt.' },
  einprobe: { titel: 'Bereit zur Einprobe', text: 'Wenn eine Arbeit für die Einprobe vorbereitet ist.' },
  versendet: { titel: 'Versendet', text: 'Wenn eine fertige Arbeit unser Labor verlassen hat.' },
  neue_nachricht: { titel: 'Neue Nachricht', text: 'Höchstens eine E-Mail pro Auftrag in 15 Minuten, und nur, solange die Nachricht ungelesen ist.' },
  reklamation_entschieden: { titel: 'Reklamation entschieden', text: 'Wenn wir über eine Reklamation entschieden haben.' },
};

/** حداقل فاصلهٔ دو ایمیل «Neue Nachricht» برای یک سفارش. */
export const NACHRICHT_PAUSE_MINUTEN = 15;

/**
 * کدام تغییر وضعیت برای Ordination ایمیل دارد. کاری که خود Ordination کرده (Freigabe،
 * Änderung، Storno، Daten nachreichen) ایمیل ندارد؛ او خودش می‌داند.
 */
export function ereignisFuerStatus(von: Status, nach: Status, wer: Seite): Benachrichtigung | null {
  if (von === 'entwurf') return nach === 'eingereicht' || nach === 'rueckfrage' ? 'auftrag_eingegangen' : null;
  if (wer !== 'labor') return null;
  switch (nach) {
    case 'rueckfrage':
      return 'rueckfrage';
    case 'design_freigabe':
      return 'design_freigabe';
    // Behandlung بدون Freigabe: طرح مستقیم آمادهٔ دانلود است
    case 'freigegeben':
      return 'design_freigabe';
    case 'einprobe':
      return 'einprobe';
    case 'versendet':
      return 'versendet';
    default:
      return null;
  }
}

/**
 * زمان ایمیل «Neue Nachricht» بعدی برای یک سفارش. `null` یعنی ایمیلی که هنوز منتظر است همین
 * پیام را هم پوشش می‌دهد. وگرنه: الان، یا ۱۵ دقیقه بعد از ایمیل قبلی.
 */
export function naechsteNachrichtMail(letzte: { runAfter: Date; status: string } | undefined, jetzt: Date): Date | null {
  if (!letzte) return jetzt;
  if (letzte.status === 'wartend') return null;
  const frei = new Date(letzte.runAfter.getTime() + NACHRICHT_PAUSE_MINUTEN * 60_000);
  return frei > jetzt ? frei : jetzt;
}

/** تنظیمات ذخیره‌شده ← همهٔ رویدادها؛ ردیف نبودن یعنی «روشن». */
export function mitStandard(zeilen: { eventKey: Benachrichtigung; emailEnabled: boolean }[], alle: readonly Benachrichtigung[]): Record<Benachrichtigung, boolean> {
  return Object.fromEntries(alle.map((k) => [k, zeilen.find((z) => z.eventKey === k)?.emailEnabled ?? true])) as Record<Benachrichtigung, boolean>;
}
