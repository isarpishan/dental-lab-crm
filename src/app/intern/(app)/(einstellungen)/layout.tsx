import { BereichTabs } from '@/components/ui/BereichTabs';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { einstellungenBereiche } from '@/lib/einstellungen-bereiche';
import { offeneAnfragenZahl } from '@/lib/website/anfragen-daten';

/**
 * گروه «Einstellungen» (فقط گروه مسیر؛ نشانی‌ها عوض نمی‌شوند): بالای همهٔ این صفحه‌ها تب‌های بخش.
 * هر صفحه خودش نقش را چک می‌کند، مثل قبل؛ این‌جا فقط تب‌های مجاز نشان داده می‌شوند.
 */
export default async function EinstellungenLayout({ children }: { children: React.ReactNode }) {
  const { user } = await mitarbeiterOderAnmelden();
  const anfragen = darf(user.role, 'stammdaten.bearbeiten') ? await offeneAnfragenZahl() : 0;
  const tabs = einstellungenBereiche(user.role).map((t) => (t.href === '/ordinationen' && anfragen ? { ...t, hinweis: anfragen } : t));
  return (
    <>
      {tabs.length > 1 ? (
        <div className="pt-10 max-[640px]:pt-6">
          <BereichTabs label="Einstellungen" tabs={tabs} />
        </div>
      ) : null}
      {children}
    </>
  );
}
