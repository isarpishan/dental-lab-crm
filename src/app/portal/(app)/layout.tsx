import { SiteHeader } from '@/components/ui/SiteHeader';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { portalAbmelden } from './actions';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, praxis } = await praxisNutzerOderAnmelden();
  return (
    <>
      <SiteHeader
        nav={[
          { href: '/', label: 'Übersicht' },
          { href: '/auftraege/neu', label: 'Neuer Auftrag' },
          { href: '/abholung', label: 'Abholung' },
          // Rechnungen فقط برای Praxis-Admin (Spec فاز ۲، قدم ۳)
          ...(user.role === 'praxis_admin' ? [{ href: '/rechnungen', label: 'Rechnungen' }] : []),
          { href: '/einstellungen', label: 'Einstellungen' },
        ]}
        rechts={
          <form action={portalAbmelden} className="flex items-center gap-4 border-l border-line pl-6 text-[13px]">
            <span className="text-muted">
              {user.name} · {praxis.name}
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
