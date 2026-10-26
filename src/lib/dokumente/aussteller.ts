import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { ausstellerAus, type Aussteller } from './aussteller-werte';

export { AUSSTELLER_STANDARD, type Aussteller } from './aussteller-werte';

/**
 * صادرکنندهٔ اسناد و فاکتورها (CLAUDE.md، قانون ۱): از تنظیم `aussteller` خوانده می‌شود (Inhaber در
 * «Einstellungen» عوضش می‌کند). از ۳ اکتبر ۲۰۲۶ Gewerbe «Digitale Zahntechnik» به نام Isar Pishan است؛
 * پس سازنده (Hersteller) روی Konformitätserklärung هم اوست. اسناد قبلی دست نمی‌خورند (غیرقابل‌تغییر).
 */
export async function ausstellerLaden(): Promise<Aussteller> {
  const [z1] = await db().select({ value: settings.value }).from(settings).where(eq(settings.key, 'aussteller')).limit(1);
  return ausstellerAus(z1?.value);
}
