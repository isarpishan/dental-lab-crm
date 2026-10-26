import { BereichTabs } from '@/components/ui/BereichTabs';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';

/**
 * «Abrechnung» در دو بخش (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶): «Einnahmen» (همهٔ صفحه‌های قبلی Abrechnung، با Konto
 * هر Ordination) و «Ausgaben» (`ausgaben/`). تب‌ها فقط برای Inhaber؛ Büro فقط Einnahmen را می‌بیند، مثل قبل.
 * از ۲۵ اکتبر ۲۰۲۶ «Übersicht» (`uebersicht/`، Spec فاز ۵) اولِ تب‌هاست؛ صفحهٔ پیش‌فرض همان Einnahmen می‌ماند.
 */
export default async function AbrechnungLayout({ children }: { children: React.ReactNode }) {
  const { user } = await mitarbeiterOderAnmelden();
  return (
    <>
      {darf(user.role, 'ausgaben.verwalten') ? (
        <div className="pt-10 max-[640px]:pt-6">
          <BereichTabs
            label="Einnahmen und Ausgaben"
            tabs={[
              { href: '/abrechnung/uebersicht', label: 'Übersicht' },
              { href: '/abrechnung', label: 'Einnahmen' },
              { href: '/abrechnung/ausgaben', label: 'Ausgaben' },
              { href: '/abrechnung/fixkosten', label: 'Fixkosten' },
              { href: '/abrechnung/bank', label: 'Bank' },
              { href: '/abrechnung/steuer', label: 'Steuer' },
              { href: '/abrechnung/fragen', label: 'Fragen' },
            ]}
          />
        </div>
      ) : null}
      {children}
    </>
  );
}
