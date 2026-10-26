import { db } from '@/db/client';
import { jobs } from '@/db/schema';

/**
 * ایمیل‌ها مستقیم فرستاده نمی‌شوند؛ در صف jobs می‌روند و worker آن‌ها را
 * می‌فرستد. این‌طوری خطای SMTP صفحه را نمی‌شکند و خودکار دوباره امتحان می‌شود.
 * ⚠️ هیچ نام بیماری در ایمیل نمی‌آید (Spec فاز ۱، بخش M).
 */
export type Email = { an: string; betreff: string; text: string; html: string };

export async function emailEinreihen(email: Email) {
  await db().insert(jobs).values({ type: 'email_senden', payload: email });
}
