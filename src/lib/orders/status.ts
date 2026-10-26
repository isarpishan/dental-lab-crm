import { and, eq } from 'drizzle-orm';
import type { db } from '@/db/client';
import { orderMessages, orders, orderStatusHistory } from '@/db/schema';
import { benachrichtigen } from '@/lib/benachrichtigungen/einreihen';
import { ereignisFuerStatus } from '@/lib/benachrichtigungen/regeln';
import { AppError } from '@/lib/errors';

/**
 * ماشین وضعیت سفارش (CLAUDE.md، قانون ۵؛ Spec فاز ۱، بخش G). وضعیت سفارش فقط از
 * همین فایل عوض می‌شود: جدول انتقال‌های مجاز، این‌که چه کسی اجازهٔ هر انتقال را دارد،
 * و این‌که هر انتقال یک ردیف در `order_status_history` و یک پیام «ereignis» می‌سازد، و اگر لازم
 * باشد ایمیل اعلان به Ordination را در صف می‌گذارد (`lib/benachrichtigungen/`).
 */

export const STATUS = [
  'entwurf',
  'eingereicht',
  'rueckfrage',
  'in_planung',
  'design_freigabe',
  'in_ueberarbeitung',
  'freigegeben',
  'in_produktion',
  'einprobe',
  'fertig',
  'versendet',
  'geliefert',
  'abgeschlossen',
  'storniert',
] as const;
export type Status = (typeof STATUS)[number];

/** طرفی که وضعیت را عوض می‌کند. کارهای خودکار سیستم مثل لابراتوار حساب می‌شوند. */
export type Seite = 'praxis' | 'labor';

/** شرط‌هایی که به خود سفارش بستگی دارند. */
export type Umstaende = { lieferart: 'design' | 'fertigung' | null; freigabeNoetig: boolean };

type Regel = { nach: Status; wer: readonly Seite[]; nurWenn?: (u: Umstaende) => boolean };

const BEIDE = ['praxis', 'labor'] as const;
const LABOR = ['labor'] as const;
const PRAXIS = ['praxis'] as const;

const nurDesign = (u: Umstaende) => u.lieferart === 'design';
const nurFertigung = (u: Umstaende) => u.lieferart !== 'design';

const UEBERGAENGE: Record<Status, readonly Regel[]> = {
  // ارسال: با همهٔ فایل‌ها ← eingereicht؛ با «Daten werden nachgereicht» ← rueckfrage
  entwurf: [
    { nach: 'eingereicht', wer: BEIDE },
    { nach: 'rueckfrage', wer: BEIDE },
  ],
  eingereicht: [
    { nach: 'in_planung', wer: LABOR },
    { nach: 'rueckfrage', wer: LABOR },
    { nach: 'storniert', wer: BEIDE },
  ],
  // «Daten nachreichen» به مرحلهٔ قبل از Rückfrage برمی‌گرداند
  rueckfrage: [
    { nach: 'eingereicht', wer: BEIDE },
    { nach: 'in_planung', wer: BEIDE },
    { nach: 'in_ueberarbeitung', wer: BEIDE },
    { nach: 'storniert', wer: BEIDE },
  ],
  in_planung: [
    { nach: 'design_freigabe', wer: LABOR, nurWenn: (u) => u.freigabeNoetig },
    { nach: 'freigegeben', wer: LABOR, nurWenn: (u) => !u.freigabeNoetig && nurDesign(u) },
    { nach: 'in_produktion', wer: LABOR, nurWenn: (u) => !u.freigabeNoetig && nurFertigung(u) },
    { nach: 'rueckfrage', wer: LABOR },
    { nach: 'storniert', wer: BEIDE },
  ],
  design_freigabe: [
    { nach: 'freigegeben', wer: PRAXIS, nurWenn: nurDesign },
    { nach: 'in_produktion', wer: PRAXIS, nurWenn: nurFertigung },
    { nach: 'in_ueberarbeitung', wer: PRAXIS },
    { nach: 'rueckfrage', wer: LABOR },
    { nach: 'storniert', wer: LABOR },
  ],
  in_ueberarbeitung: [
    { nach: 'design_freigabe', wer: LABOR, nurWenn: (u) => u.freigabeNoetig },
    // Behandlung ohne Freigabe: das überarbeitete Design gilt direkt
    { nach: 'freigegeben', wer: LABOR, nurWenn: (u) => !u.freigabeNoetig && nurDesign(u) },
    { nach: 'in_produktion', wer: LABOR, nurWenn: (u) => !u.freigabeNoetig && nurFertigung(u) },
    { nach: 'rueckfrage', wer: LABOR },
    { nach: 'storniert', wer: LABOR },
  ],
  // «Nur Design»: بعد از Freigabe هم «Überarbeitung anfordern» باز است
  freigegeben: [
    { nach: 'in_ueberarbeitung', wer: PRAXIS, nurWenn: nurDesign },
    { nach: 'abgeschlossen', wer: LABOR },
  ],
  in_produktion: [
    { nach: 'einprobe', wer: LABOR },
    { nach: 'fertig', wer: LABOR },
    { nach: 'storniert', wer: LABOR },
  ],
  einprobe: [
    { nach: 'in_produktion', wer: LABOR },
    { nach: 'fertig', wer: LABOR },
    { nach: 'storniert', wer: LABOR },
  ],
  // Qualitätskontrolle nicht bestanden: zurück in die Produktion (Nacharbeit)
  fertig: [
    { nach: 'versendet', wer: LABOR },
    { nach: 'in_produktion', wer: LABOR },
    { nach: 'storniert', wer: LABOR },
  ],
  versendet: [{ nach: 'geliefert', wer: LABOR }],
  geliefert: [{ nach: 'abgeschlossen', wer: LABOR }],
  abgeschlossen: [],
  storniert: [],
};

export function istStatus(wert: string): wert is Status {
  return (STATUS as readonly string[]).includes(wert);
}

export function uebergangErlaubt(von: Status, nach: Status, wer: Seite, u: Umstaende): boolean {
  return UEBERGAENGE[von].some((r) => r.nach === nach && r.wer.includes(wer) && (!r.nurWenn || r.nurWenn(u)));
}

/** وضعیت‌هایی که این طرف از اینجا می‌تواند برود (برای دکمه‌ها). */
export function moeglicheUebergaenge(von: Status, wer: Seite, u: Umstaende): Status[] {
  return UEBERGAENGE[von].filter((r) => r.wer.includes(wer) && (!r.nurWenn || r.nurWenn(u))).map((r) => r.nach);
}

/** متن پیام «ereignis» در Kommunikation برای هر وضعیت تازه. */
export const EREIGNIS_TEXT: Record<Status, string> = {
  entwurf: 'Entwurf angelegt',
  eingereicht: 'Auftrag eingereicht',
  rueckfrage: 'Rückfrage: Es fehlen noch Angaben oder Dateien',
  in_planung: 'Design in Planung',
  design_freigabe: 'Design zur Freigabe bereit',
  in_ueberarbeitung: 'Design wird überarbeitet',
  freigegeben: 'Design freigegeben',
  in_produktion: 'In Produktion',
  einprobe: 'Bereit zur Einprobe',
  fertig: 'Fertiggestellt',
  versendet: 'Versendet',
  geliefert: 'Geliefert',
  abgeschlossen: 'Abgeschlossen',
  storniert: 'Auftrag storniert',
};

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

/**
 * تنها راه عوض کردن وضعیت. داخل تراکنش صدا زده می‌شود. اگر وضعیت در این فاصله عوض
 * شده باشد (مثلاً کلیک دوم)، هیچ ردیفی عوض نمی‌شود و خطای آلمانی برمی‌گردد.
 */
export async function statusWechseln(
  tx: Tx,
  e: {
    orderId: string;
    von: Status;
    nach: Status;
    wer: Seite;
    akteur: { kind: 'staff' | 'practice' | 'system'; id: string | null };
    umstaende: Umstaende;
    /** فیلدهای دیگری که در همان update عوض می‌شوند (مثلاً `submittedAt`). */
    felder?: Partial<typeof orders.$inferInsert>;
    /** متن پیام به‌جای متن پیش‌فرض. */
    ereignis?: string;
    /** `false`: ایمیل دیگری همین را می‌گوید (مثلاً Neuanfertigung در ایمیل «Reklamation entschieden»). */
    benachrichtigen?: boolean;
  },
) {
  if (!uebergangErlaubt(e.von, e.nach, e.wer, e.umstaende)) {
    throw new AppError('Dieser Schritt ist für diesen Auftrag gerade nicht möglich.');
  }
  const jetzt = new Date();
  const geaendert = await tx
    .update(orders)
    .set({ ...e.felder, status: e.nach, updatedAt: jetzt })
    .where(and(eq(orders.id, e.orderId), eq(orders.status, e.von)))
    .returning({ id: orders.id });
  if (!geaendert.length) throw new AppError('Der Auftrag wurde inzwischen geändert. Bitte laden Sie die Seite neu.');
  await tx.insert(orderStatusHistory).values({ orderId: e.orderId, status: e.nach, at: jetzt, byKind: e.akteur.kind, byId: e.akteur.id });
  await tx.insert(orderMessages).values({
    orderId: e.orderId,
    authorKind: 'system',
    kind: 'ereignis',
    body: e.ereignis ?? EREIGNIS_TEXT[e.nach],
    createdAt: jetzt,
  });
  // ایمیل به Ordination (Spec فاز ۱، بخش M) در همین تراکنش در صف می‌رود
  const ereignis = e.benachrichtigen === false ? null : ereignisFuerStatus(e.von, e.nach, e.wer);
  if (ereignis) await benachrichtigen(tx, { ereignis, orderId: e.orderId, nach: e.nach });
}
