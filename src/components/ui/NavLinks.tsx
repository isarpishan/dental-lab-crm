'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * `hinweis`: Zahl, die Aufmerksamkeit braucht (z. B. neue Anfragen von der Website).
 * `bereich`: weitere Pfade, auf denen der Eintrag aktiv ist (»Einstellungen« mit seinen Tabs).
 */
export type NavItem = { href: string; label: string; hinweis?: number; bereich?: string[] };

const unter = (pfad: string, href: string) => pfad === href || pfad.startsWith(`${href}/`);

/** منوی سربرگ. آیتم فعال خط زیر rose دارد، مثل «E-Mail» در سایت. */
export function NavLinks({ nav }: { nav: NavItem[] }) {
  const pfad = usePathname();
  return (
    <nav aria-label="Hauptnavigation" className="flex flex-wrap items-center gap-x-6 text-[13px] min-[1600px]:gap-x-8">
      {nav.map((item) => {
        const aktiv = item.href === '/' ? pfad === '/' : [item.href, ...(item.bereich ?? [])].some((h) => unter(pfad, h));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={aktiv ? 'page' : undefined}
            className={aktiv ? 'border-b border-rose py-3 text-white' : 'py-3 text-nav transition-colors duration-[180ms] hover:text-white'}
          >
            {item.label}
            {item.hinweis ? (
              <span className="ml-1.5 border border-rose px-1.5 text-[11px] text-rose" aria-label={`, ${item.hinweis} neu`}>
                {item.hinweis}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
