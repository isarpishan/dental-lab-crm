import { BereichTabs } from '@/components/ui/BereichTabs';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { eingangListe } from '@/lib/ausgaben/eingang';

/**
 * «Privat» (Spec فاز ۵، قدم ۲؛ فقط Inhaber): دو تب «Übersicht» و «Buchungen»، مثل «Abrechnung». عدد کنار
 * «Buchungen» = Belegهای Privat زیر «Zu prüfen». هر صفحه دسترسی را خودش هم می‌سنجد.
 */
export default async function PrivatLayout({ children }: { children: React.ReactNode }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'privat.verwalten')) return children;
  const zuPruefen = (await eingangListe('privat')).length;
  return (
    <>
      <div className="pt-10 max-[640px]:pt-6">
        <BereichTabs
          label="Bereiche von Privat"
          tabs={[
            { href: '/privat', label: 'Übersicht' },
            { href: '/privat/buchungen', label: 'Buchungen', hinweis: zuPruefen || undefined },
            { href: '/privat/fixkosten', label: 'Fixkosten' },
          ]}
        />
      </div>
      {children}
    </>
  );
}
