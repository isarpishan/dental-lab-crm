import Link from 'next/link';

export type Kennzahl = {
  /** مقدار `?tab=`؛ بدون آن خانه فقط نمایش است */
  tab?: string;
  titel: string;
  wert: React.ReactNode;
  zusatz?: React.ReactNode;
};

/**
 * نوار عددهای اصلی بالای صفحه‌های «Abrechnung»، که هم‌زمان تب‌های صفحه است (`?tab=`، مثل تب‌های صفحهٔ
 * سفارش): همه‌چیز بدون اسکرول دیده می‌شود و با یک کلیک باز می‌شود. خانه‌ها با خط نازک جدا شده‌اند، نه
 * کارت؛ تب باز خط rose زیرش دارد. موبایل: دو ستون.
 */
export function KennzahlLeiste({ label, eintraege, aktiv }: { label: string; eintraege: Kennzahl[]; aktiv: string }) {
  // بدون هیچ تب (فقط عددها، مثل «Übersicht») ← section، نه nav
  const Huelle = eintraege.some((e) => e.tab) ? 'nav' : 'section';
  return (
    <Huelle aria-label={label} className={`grid grid-cols-2 gap-px border-y border-line bg-line ${eintraege.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}>
      {eintraege.map((e) => {
        const inhalt = (
          <>
            <span className={`block text-[13px] ${e.tab === aktiv ? 'text-white' : 'text-muted'}`}>{e.titel}</span>
            <span className="mt-3 block text-[clamp(22px,2.4vw,30px)] font-light leading-none">{e.wert}</span>
            {e.zusatz ? <span className="mt-2.5 block text-[13px] text-muted">{e.zusatz}</span> : null}
            {e.tab === aktiv ? <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-rose" /> : null}
          </>
        );
        // موبایل: خانهٔ آخرِ تنها (تعداد فرد) هر دو ستون را می‌گیرد
        const zelle = 'relative min-w-0 bg-black py-5 pl-4 pr-4 max-lg:odd:pl-0 max-lg:[&:last-child:nth-child(odd)]:col-span-2 lg:py-6 lg:first:pl-0';
        return e.tab ? (
          <Link
            key={e.titel}
            href={`?tab=${e.tab}`}
            scroll={false}
            aria-current={e.tab === aktiv ? 'page' : undefined}
            className={`${zelle} group transition-colors duration-[180ms] hover:text-white [&:hover>span:first-child]:text-white`}
          >
            {inhalt}
          </Link>
        ) : (
          <div key={e.titel} className={zelle}>
            {inhalt}
          </div>
        );
      })}
    </Huelle>
  );
}

/** سرستون‌های یک جدول ردیفی (فقط دسکتاپ؛ روی موبایل هر ردیف خودش برچسب دارد). `spalten`: همان grid ردیف‌ها. */
export function TabellenKopf({ spalten, namen }: { spalten: string; namen: (string | { text: string; rechts: true })[] }) {
  return (
    <div aria-hidden className={`hidden gap-x-6 border-b border-line pb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-muted lg:grid ${spalten}`}>
      {namen.map((n, i) =>
        typeof n === 'string' ? (
          <span key={i}>{n}</span>
        ) : (
          <span key={i} className="text-right">
            {n.text}
          </span>
        ),
      )}
    </div>
  );
}
