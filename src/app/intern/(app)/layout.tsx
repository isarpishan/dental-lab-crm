import { and, eq } from 'drizzle-orm';
import { SiteHeader, type NavItem } from '@/components/ui/SiteHeader';
import { db } from '@/db/client';
import { tours } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf, ROLLEN_NAMEN } from '@/lib/auth/roles';
import { einstellungenBereiche } from '@/lib/einstellungen-bereiche';
import { offeneAnfragenZahl } from '@/lib/website/anfragen-daten';
import { abmelden } from './actions';

export default async function InternLayout({ children }: { children: React.ReactNode }) {
  const { user } = await mitarbeiterOderAnmelden();
  // »Meine Tour« für alle, die eine aktive Tour fahren (auch Inhaber oder Büro)
  const [fahrer] = darf(user.role, 'touren.sehen')
    ? await db().select({ id: tours.id }).from(tours).where(and(eq(tours.driverId, user.id), eq(tours.isActive, true))).limit(1)
    : [];
  const nav: NavItem[] = darf(user.role, 'auftraege.sehen') ? [{ href: '/', label: 'Übersicht' }] : [];
  if (darf(user.role, 'auftraege.sehen')) nav.push({ href: '/auftraege', label: 'Aufträge' }, { href: '/kalender', label: 'Kalender' });
  if (fahrer || (darf(user.role, 'touren.sehen') && !darf(user.role, 'touren.bearbeiten'))) nav.push({ href: '/meine-tour', label: 'Meine Tour' });
  if (darf(user.role, 'stammdaten.sehen') || darf(user.role, 'produktion.bearbeiten')) nav.push({ href: '/materialien', label: 'Materialien' });
  // neue Anfragen von der Website (»Praxisportal-Zugang«) für alle, die einladen dürfen
  const anfragen = darf(user.role, 'stammdaten.bearbeiten') ? await offeneAnfragenZahl() : 0;
  if (darf(user.role, 'abrechnung.sehen')) nav.push({ href: '/abrechnung', label: 'Abrechnung' });
  // »Privat« (Spec فاز ۵، قدم ۲): nur Inhaber
  if (darf(user.role, 'privat.verwalten')) nav.push({ href: '/privat', label: 'Privat' });
  // Preise, Benutzer, Ordinationen, Reklamationen und Touren sind Tabs unter »Einstellungen« (`(einstellungen)/layout.tsx`)
  const bereiche = einstellungenBereiche(user.role);
  if (bereiche[0]) nav.push({ href: bereiche[0].href, label: 'Einstellungen', hinweis: anfragen || undefined, bereich: bereiche.map((b) => b.href) });

  return (
    <>
      <SiteHeader
        nav={nav}
        rechts={
          <form action={abmelden} className="flex items-center gap-4 border-l border-line pl-6 text-[13px]">
            <span className="text-muted">
              {user.name} · {ROLLEN_NAMEN[user.role]}
            </span>
            <button type="submit" className="py-3 text-nav transition-colors duration-[180ms] hover:text-white">
              Abmelden
            </button>
          </form>
        }
      />
      <main id="inhalt" className="page pb-28">
        {children}
      </main>
    </>
  );
}
