import { SiteHeader } from '@/components/ui/SiteHeader';
import { praxisSitzungOderAnmelden } from '@/lib/auth/guard';
import { portalAbmelden } from '../(app)/actions';

/** سربرگ ساده برای صفحهٔ Vereinbarung: بدون منو، چون تا پذیرش هیچ صفحهٔ دیگری باز نمی‌شود. */
export default async function VereinbarungLayout({ children }: { children: React.ReactNode }) {
  const { user, praxis } = await praxisSitzungOderAnmelden();
  return (
    <>
      <SiteHeader
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
