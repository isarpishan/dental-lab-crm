import { desc, eq, sql } from 'drizzle-orm';
import type { db } from '@/db/client';
import { jobs, type Benachrichtigung } from '@/db/schema';
import { naechsteNachrichtMail } from './regeln';

/**
 * اعلان‌ها داخل همان تراکنشی در صف می‌روند که اتفاق را ثبت می‌کند. اگر کار برگردد (مثلاً
 * PDF ساخته نشود)، ایمیلی هم نمی‌رود. worker بعداً گیرنده‌ها و تنظیمات Ordination را
 * می‌خواند و برای هر گیرنده یک `email_senden` می‌سازد (`src/worker/handlers/benachrichtigung.ts`).
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export const BENACHRICHTIGUNG_JOB = 'benachrichtigung';

export type BenachrichtigungJob = {
  ereignis: Benachrichtigung;
  orderId: string;
  /** وضعیت تازهٔ سفارش در لحظهٔ اتفاق (مثلاً `rueckfrage` برای «Daten werden nachgereicht») */
  nach?: string;
  complaintId?: string;
};

export async function benachrichtigen(tx: Tx, job: BenachrichtigungJob) {
  await tx.insert(jobs).values({ type: BENACHRICHTIGUNG_JOB, payload: job });
}

/**
 * پیام تازهٔ لابراتوار به Ordination: حداکثر یک ایمیل در ۱۵ دقیقه برای هر سفارش. قفل
 * تراکنشی جلوی دو ایمیل هم‌زمان را می‌گیرد؛ ایمیلی که هنوز منتظر است پیام‌های بعدی را هم می‌شمارد.
 */
export async function nachrichtGemeldet(tx: Tx, orderId: string) {
  const schluessel = `neue_nachricht:${orderId}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${schluessel}))`);
  const [letzte] = await tx
    .select({ runAfter: jobs.runAfter, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.dedupeKey, schluessel))
    .orderBy(desc(jobs.runAfter))
    .limit(1);
  const wann = naechsteNachrichtMail(letzte, new Date());
  if (!wann) return;
  const job: BenachrichtigungJob = { ereignis: 'neue_nachricht', orderId };
  await tx.insert(jobs).values({ type: BENACHRICHTIGUNG_JOB, payload: job, dedupeKey: schluessel, runAfter: wann });
}
