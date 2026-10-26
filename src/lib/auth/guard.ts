import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppError } from '@/lib/errors';
import { sichererPfad } from './pfad';
import { darf, type Aktion } from './roles';
import { aktuellerMitarbeiter, praxisSitzung, type PraxisSitzung, type StaffSitzung } from './sessions';

/** /anmelden، و اگر `proxy.ts` آدرس اصلی را داده، با «weiter» تا بعد از ورود همان صفحه باز شود. */
async function zurAnmeldung(): Promise<never> {
  const pfad = sichererPfad((await headers()).get('x-ddl-pfad'));
  redirect(pfad === '/' ? '/anmelden' : `/anmelden?weiter=${encodeURIComponent(pfad)}`);
}

/** صفحه‌های داخلی: بدون نشست ← /anmelden. */
export async function mitarbeiterOderAnmelden(): Promise<StaffSitzung> {
  const s = await aktuellerMitarbeiter();
  if (!s) return zurAnmeldung();
  return s;
}

/**
 * صفحه‌های پورتال: بدون نشست ← /anmelden (روی host پورتال). اگر Ordination نسخهٔ فعلی Vereinbarung
 * را نپذیرفته ← /vereinbarung؛ تا آن موقع هیچ صفحه‌ای از پورتال باز نمی‌شود.
 */
export async function praxisNutzerOderAnmelden(): Promise<PraxisSitzung> {
  const s = await praxisSitzung();
  if (!s) return zurAnmeldung();
  if (!s.vereinbarung) redirect('/vereinbarung');
  return s;
}

/** فقط صفحهٔ Vereinbarung: نشست لازم است، پذیرش نه. */
export async function praxisSitzungOderAnmelden(): Promise<PraxisSitzung> {
  const s = await praxisSitzung();
  if (!s) return zurAnmeldung();
  return s;
}

/** قدم اول هر server action: نشست + نقش. خطا آلمانی است و به کاربر نشان داده می‌شود. */
export async function mitBerechtigung(aktion: Aktion): Promise<StaffSitzung> {
  const s = await aktuellerMitarbeiter();
  if (!s) throw new AppError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  if (!darf(s.user.role, aktion)) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  return s;
}

export { sichererPfad };
