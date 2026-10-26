import type { StaffRolle } from '@/db/schema';
import { darf, type Aktion } from '@/lib/auth/roles';

/**
 * تب‌های «Einstellungen» (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶): این صفحه‌ها دیگر در منوی اصلی نیستند و زیر یک
 * «Einstellungen» با تب کنار هم‌اند. نشانی‌ها (`/preise`، `/touren`، …) و محتوای صفحه‌ها عوض نشده‌اند؛
 * هر کس فقط تب‌هایی را می‌بیند که نقشش اجازه می‌دهد.
 */
export const EINSTELLUNGEN_BEREICHE: readonly { href: string; label: string; recht: Aktion }[] = [
  { href: '/einstellungen', label: 'Aussteller & Rechnungen', recht: 'einstellungen.verwalten' },
  { href: '/einstellungen/ki', label: 'KI', recht: 'einstellungen.verwalten' },
  { href: '/einstellungen/handy-scanner', label: 'Handy-Scanner', recht: 'ausgaben.verwalten' },
  { href: '/einstellungen/steuer', label: 'Steuer', recht: 'ausgaben.verwalten' },
  { href: '/preise', label: 'Preise', recht: 'preise.bearbeiten' },
  { href: '/benutzer', label: 'Benutzer', recht: 'benutzer.verwalten' },
  { href: '/ordinationen', label: 'Ordinationen', recht: 'stammdaten.sehen' },
  { href: '/reklamationen', label: 'Reklamationen', recht: 'auftraege.sehen' },
  { href: '/touren', label: 'Touren', recht: 'touren.bearbeiten' },
];

export function einstellungenBereiche(rolle: StaffRolle) {
  return EINSTELLUNGEN_BEREICHE.filter((b) => darf(rolle, b.recht)).map(({ href, label }) => ({ href, label }));
}
