'use server';

import { bearbeiterIntern, type Bearbeiter } from '@/lib/auth/bearbeiter';
import { anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';
import { schrittErledigt, schrittSetzen, zustaendigSetzen } from '@/lib/produktion/vorgang';

/**
 * «Schritt erledigt»، «Schritt korrigieren» و «Zuständig» در صفحهٔ سفارش و صفحهٔ تبلت (QR): فقط نقش‌های با
 * `produktion.bearbeiten` (Inhaber، Techniker). صفحهٔ Kanban «Produktion» از ۲۶ اکتبر ۲۰۲۶ حذف شد (خواستهٔ کاربر).
 * الگو: نشست و نقش ← zod (در `lib/produktion/vorgang.ts`) ← عملیات ← audit. صفحه با `router.refresh` تازه می‌شود.
 */
async function mitProduktion<T extends object>(f: (b: Bearbeiter, ip: string | null) => Promise<T>): Promise<T | { fehler: string }> {
  const b = await bearbeiterIntern('produktion.bearbeiten');
  if (!b) return { fehler: 'Dafür fehlt Ihnen die Berechtigung.' };
  try {
    return await f(b, (await anfrageInfo()).ip);
  } catch (e) {
    if (e instanceof AppError) return { fehler: e.message };
    throw e;
  }
}

export async function verschieben(orderId: string, nach: string, von: string): Promise<{ fehler?: string }> {
  return mitProduktion(async (b, ip) => {
    await schrittSetzen(b, String(orderId), nach, von, ip);
    return {};
  });
}

export async function erledigt(orderId: string, daten: { schritt: string; geraet: string | null; chargen: string[]; mengen?: Record<string, number> }): Promise<{ fehler?: string; weiter?: string | null }> {
  return mitProduktion((b, ip) => schrittErledigt(b, String(orderId), daten, ip));
}

export async function zustaendig(orderId: string, userId: string): Promise<{ fehler?: string }> {
  return mitProduktion(async (b, ip) => {
    await zustaendigSetzen(b, String(orderId), userId, ip);
    return {};
  });
}
