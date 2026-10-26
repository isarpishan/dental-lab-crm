import { and, eq, sql } from 'drizzle-orm';
import type { db } from '@/db/client';
import { numberSequences } from '@/db/schema';

type Schreiber = Pick<ReturnType<typeof db>, 'insert'>;
type Leser = Pick<ReturnType<typeof db>, 'select'>;

/**
 * شمارهٔ پیوسته (CLAUDE.md، قانون ۶): یک ردیف برای هر scope و سال، با upsert که
 * ردیف را قفل می‌کند. پس دو درخواست هم‌زمان هرگز یک شماره نمی‌گیرند. هرگز `count(*)`.
 * داخل همان تراکنشی صدا زده می‌شود که شماره را ذخیره می‌کند.
 */
export async function naechsteNummer(tx: Schreiber, scope: string, jahr = 0): Promise<number> {
  const [r] = await tx
    .insert(numberSequences)
    .values({ scope, year: jahr, lastValue: 1 })
    .onConflictDoUpdate({ target: [numberSequences.scope, numberSequences.year], set: { lastValue: sql`${numberSequences.lastValue} + 1` } })
    .returning({ wert: numberSequences.lastValue });
  return r.wert;
}

/**
 * فقط برای پیش‌نمایش: شماره‌ای که سند بعدی احتمالاً می‌گیرد. چیزی مصرف یا قفل نمی‌کند؛ اگر هم‌زمان سند
 * دیگری صادر شود، شمارهٔ واقعی فرق می‌کند (روی پیش‌نمایش «voraussichtlich» نوشته می‌شود).
 */
export async function voraussichtlicheNummer(q: Leser, scope: string, jahr = 0): Promise<number> {
  const [r] = await q
    .select({ wert: numberSequences.lastValue })
    .from(numberSequences)
    .where(and(eq(numberSequences.scope, scope), eq(numberSequences.year, jahr)))
    .limit(1);
  return (r?.wert ?? 0) + 1;
}

/** «K-0001» (Spec فاز ۱، مدل داده). */
export const kundennummer = (n: number) => `K-${String(n).padStart(4, '0')}`;

/** «A-2026-0001»: سال به وقت وین، شمارنده برای هر سال جدا. */
export const auftragsnummer = (jahr: number, n: number) => `A-${jahr}-${String(n).padStart(4, '0')}`;

/**
 * «LS-2026-0001»، «KE-2026-0001»، «RK-2026-0001»، Rechnung «R-2026-0001»، Gutschrift «G-2026-0001»: سال به
 * وقت وین، شمارنده برای هر نوع و هر سال جدا.
 */
export const belegnummer = (kuerzel: 'LS' | 'KE' | 'RK' | 'R' | 'G', jahr: number, n: number) => `${kuerzel}-${jahr}-${String(n).padStart(4, '0')}`;
