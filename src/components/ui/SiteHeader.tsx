import Link from 'next/link';
import { NavLinks, type NavItem } from './NavLinks';

export type { NavItem };

/**
 * سربرگ مثل سایت: لوگو و «DIGITAL DENTAL LAB» در چپ، منوی 13px در راست،
 * زمینهٔ سیاه نیمه‌شفاف با خط نازک زیر. `rechts` برای نام کاربر و «Abmelden».
 */
export function SiteHeader({ nav = [], rechts }: { nav?: NavItem[]; rechts?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-black/92 backdrop-blur-[18px]">
      <a href="#inhalt" className="skip-link">
        Zum Inhalt springen
      </a>
      <div className="page flex min-h-[88px] flex-wrap items-center justify-between gap-x-8 gap-y-2 py-3 max-[980px]:min-h-[76px]">
        <Link href="/" className="inline-flex min-w-0 items-center gap-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- لوگوی ثابت، همان فایل سایت */}
          <img src="/ddl-mark.png" alt="" width={62} height={52} className="h-[52px] w-[62px] object-contain" />
          <span className="whitespace-nowrap text-xs font-medium leading-none">DIGITAL DENTAL LAB</span>
        </Link>
        <div className="flex flex-wrap items-center gap-x-8">
          {nav.length ? <NavLinks nav={nav} /> : null}
          {rechts}
        </div>
      </div>
    </header>
  );
}
