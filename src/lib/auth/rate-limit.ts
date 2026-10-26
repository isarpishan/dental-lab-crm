import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { rateLimits } from '@/db/schema';

/**
 * شمارندهٔ تلاش در دیتابیس (نه در حافظه)، تا با ری‌استارت یا چند پروسه از
 * بین نرود. `true` یعنی هنوز مجاز است.
 */
export async function versuchErlaubt(schluessel: string, max: number, fensterSekunden: number): Promise<boolean> {
  const fenster = sql`now() - make_interval(secs => ${fensterSekunden})`;
  const [zeile] = await db()
    .insert(rateLimits)
    .values({ key: schluessel, windowStart: sql`now()`, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < ${fenster} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} < ${fenster} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  return zeile.count <= max;
}

export async function versucheZuruecksetzen(schluessel: string) {
  await db().delete(rateLimits).where(eq(rateLimits.key, schluessel));
}
