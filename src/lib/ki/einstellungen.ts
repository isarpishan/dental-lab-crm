import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { entschluesseln, verschluesseln } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { istKiModell, KI_STANDARD, type KiModell } from './modelle';

/**
 * KI-Einstellungen (Spec فاز ۴، بند ۱، کوچک‌شده برای خواندن Beleg): کلید Anthropic فقط رمزگذاری‌شده در
 * `settings.value_enc` و هرگز به مرورگر نمی‌رود (فقط چهار نویسهٔ آخر). مدل در `settings.value`.
 */
const KEY = 'ki';

export async function kiLaden(): Promise<{ schluessel: string | null; modell: KiModell }> {
  const [z] = await db().select().from(settings).where(eq(settings.key, KEY)).limit(1);
  const modell = (z?.value as { modell?: unknown } | null)?.modell;
  return { schluessel: z?.valueEnc ? entschluesseln(z.valueEnc) : null, modell: istKiModell(modell) ? modell : KI_STANDARD };
}

/** Für die Seite: ob ein Schlüssel da ist und seine letzten vier Zeichen. */
export async function kiStand() {
  const { schluessel, modell } = await kiLaden();
  return { gesetzt: Boolean(schluessel), ende: schluessel ? schluessel.slice(-4) : null, modell };
}

export function schluesselPruefen(s: string): string {
  const t = s.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(t)) throw new AppError('Das sieht nicht nach einem API-Schlüssel von Anthropic aus (beginnt mit »sk-ant-«).');
  return t;
}

/** `schluessel`: neuer Schlüssel; `undefined` = unverändert; `null` = löschen. */
export async function kiSpeichern(e: { schluessel?: string | null; modell: KiModell }) {
  const [alt] = await db().select().from(settings).where(eq(settings.key, KEY)).limit(1);
  const valueEnc = e.schluessel === undefined ? (alt?.valueEnc ?? null) : e.schluessel === null ? null : verschluesseln(schluesselPruefen(e.schluessel));
  await db()
    .insert(settings)
    .values({ key: KEY, value: { modell: e.modell }, valueEnc })
    .onConflictDoUpdate({ target: settings.key, set: { value: { modell: e.modell }, valueEnc, updatedAt: new Date() } });
}
