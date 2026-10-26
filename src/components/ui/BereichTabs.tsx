'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type BereichTab = { href: string; label: string; hinweis?: number };

/**
 * تب‌های یک بخش که هر کدام صفحهٔ خودش است (مثل «Einstellungen»)، با همان ظاهر تب‌های صفحهٔ سفارش:
 * خط نازک زیر، تب باز با خط rose. تب باز از نشانی صفحه خوانده می‌شود، پس صفحه‌های زیرین (مثل یک
 * Ordination) هم تب خودشان را روشن نگه می‌دارند. اگر چند تب بخورند، بلندترین نشانی برنده است
 * (`/abrechnung/ausgaben` ← «Ausgaben»، نه «Einnahmen»).
 */
export function BereichTabs({ label, tabs }: { label: string; tabs: BereichTab[] }) {
  const pfad = usePathname();
  const aktiv = tabs.filter((t) => pfad === t.href || pfad.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={label} className="flex flex-wrap gap-x-7 gap-y-1 border-b border-line">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === aktiv ? 'page' : undefined}
          className={`-mb-px border-b py-3.5 text-[15px] transition-colors duration-[180ms] ${t.href === aktiv ? 'border-rose text-white' : 'border-transparent text-nav hover:text-white'}`}
        >
          {t.label}
          {t.hinweis ? (
            <span className="ml-1.5 border border-rose px-1.5 text-[11px] text-rose" aria-label={`, ${t.hinweis} neu`}>
              {t.hinweis}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
