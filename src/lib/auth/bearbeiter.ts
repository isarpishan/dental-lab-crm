import 'server-only';
import { headers } from 'next/headers';
import type { PraxisRolle, StaffRolle } from '@/db/schema';
import { darf, type Aktion } from './roles';
import { aktuellerMitarbeiter, aktuellerPraxisNutzer } from './sessions';

/**
 * «چه کسی روی سفارش کار می‌کند»: کاربر پورتال (همیشه با Ordination خودش) یا
 * کارکنان DDL (برای هر Ordination، با نقش مجاز). فرم «Neuer Auftrag» در هر دو
 * طرف همین است؛ فقط این‌جا فرق می‌کند (Spec فاز ۱، بخش D).
 *
 * در پورتال `practiceId` همیشه از نشست می‌آید، هرگز از ورودی (CLAUDE.md، قانون ۳).
 */
export type Bearbeiter =
  | { seite: 'praxis'; kind: 'practice'; id: string; label: string; practiceId: string; praxisRolle: PraxisRolle }
  | { seite: 'labor'; kind: 'staff'; id: string; label: string; rolle: StaffRolle };

export async function bearbeiterPortal(): Promise<Bearbeiter | null> {
  const s = await aktuellerPraxisNutzer();
  return s ? { seite: 'praxis', kind: 'practice', id: s.user.id, label: s.user.name, practiceId: s.praxis.id, praxisRolle: s.user.role } : null;
}

export async function bearbeiterIntern(aktion: Aktion): Promise<Bearbeiter | null> {
  const s = await aktuellerMitarbeiter();
  if (!s || !darf(s.user.role, aktion)) return null;
  return { seite: 'labor', kind: 'staff', id: s.user.id, label: s.user.name, rolle: s.user.role };
}

/**
 * برای route handlerها که از `proxy.ts` نمی‌گذرند: بخش از روی host. کوکی‌ها به host
 * بسته‌اند، پس روی host پورتال فقط نشست پورتال وجود دارد و برعکس.
 */
export async function bearbeiterFuerHost(aktionIntern: Aktion): Promise<Bearbeiter | null> {
  const host = (await headers()).get('host');
  return host === process.env.PORTAL_HOST ? bearbeiterPortal() : bearbeiterIntern(aktionIntern);
}
