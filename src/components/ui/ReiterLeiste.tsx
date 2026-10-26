import Link from 'next/link';

export type Reiter = { key: string; href: string; aktiv: boolean; inhalt: React.ReactNode };

const QUADER = 'flex w-fit max-w-full flex-wrap gap-1 rounded-[12px] border border-panel-line bg-soft p-1.5';
const reiterKlasse = (aktiv: boolean, klein: boolean) =>
  `inline-flex items-center rounded-[8px] border transition-colors duration-[180ms] ${klein ? 'min-h-9 px-3 text-[13px]' : 'min-h-11 px-4 text-[15px]'} ${
    aktiv ? 'border-rose bg-white/[0.07] text-white' : 'border-transparent text-nav hover:bg-white/[0.04] hover:text-white'
  }`;

/**
 * تب‌های داخل یک صفحه در یک قاب، تا از بقیهٔ صفحه راحت جدا شوند (خواستهٔ کاربر، ۲۵ اکتبر ۲۰۲۶؛ قانون همهٔ
 * صفحه‌ها: بخش‌های زیر هم ← تب). قاب همان «جعبهٔ لازم» سایت است: حاشیهٔ `panel-line`، شعاع 12px، زمینهٔ
 * `soft`. تب باز زمینهٔ روشن‌تر و حاشیهٔ rose دارد، مثل دکمهٔ دوم سایت. بدون سایه و گرادیان.
 * `klein`: برای سوئیچ‌های کوچک کنار چیزهای دیگر (Monat/Woche، سال‌ها). `ohneNav`: وقتی داخل یک nav دیگر است.
 * تب‌های بخش‌ها («Einstellungen»، «Abrechnung») خطی می‌مانند (`BereichTabs`)، تا دو سطح قاطی نشوند.
 */
export function ReiterLeiste({ label, reiter, klein = false, ohneNav = false }: { label: string; reiter: Reiter[]; klein?: boolean; ohneNav?: boolean }) {
  const links = reiter.map((r) => (
    <Link key={r.key} href={r.href} scroll={false} aria-current={r.aktiv ? 'page' : undefined} className={reiterKlasse(r.aktiv, klein)}>
      {r.inhalt}
    </Link>
  ));
  return ohneNav ? (
    <span role="group" aria-label={label} className={`${QUADER} ${klein ? 'p-1' : ''}`}>
      {links}
    </span>
  ) : (
    <nav aria-label={label} className={`${QUADER} ${klein ? 'p-1' : ''}`}>
      {links}
    </nav>
  );
}

/** نام تب کنار یک عدد کم‌رنگ، مثل «Behandler (2)». */
export function MitAnzahl({ name, anzahl }: { name: string; anzahl?: number | null }) {
  return (
    <>
      {name}
      {anzahl ? <span className="ml-1.5 text-[13px] text-muted">({anzahl})</span> : null}
    </>
  );
}

/** محتوای تب باز: یک سطر توضیح کوتاه (جای `lead` در SectionRow) و خود محتوا. */
export function ReiterBereich({ titel, hinweis, children }: { titel: string; hinweis?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={titel} className="pt-8">
      {hinweis ? <p className="mb-8 max-w-[680px] text-[13px] text-muted">{hinweis}</p> : null}
      {children}
    </section>
  );
}

/** `?tab=` را می‌خواند؛ نامعتبر یا خالی ← تب اول. */
export function reiterWahl<T extends string>(wert: string | undefined, erlaubt: readonly T[]): T {
  return erlaubt.includes(wert as T) ? (wert as T) : erlaubt[0];
}
