'use client';

import { ILLUSTRATIONEN } from '@/components/auftrag/bloecke/illustrationen';

export type Kachel = {
  wert: string;
  name: string;
  zeilen?: string[];
  /** قیمت هر Lieferart (`preisZeilen`)، اولی روشن‌تر. */
  preise?: string[];
  tags?: string[];
  /** عکس از `public/bilder/auswahl/` یا کلید یکی از طرح‌های خودمان. */
  bild: { foto: string } | { illustration: string } | null;
};

/**
 * کاشی‌های تصویری کوچک برای یک انتخاب: Behandlung، نوع Prothese، Lieferart و
 * Bildauswahl. ظاهر مثل تصویر «Arbeiten» سایت: عکس کار روی سیاه و نام زیرش.
 * عمداً کوچک: حداکثر ۴ در هر ردیف، هر کاشی حدود 181px (کاربر کارت‌های بزرگ را گیج‌کننده دید).
 * فاصلهٔ بین کاشی‌ها باز است تا نام و قیمت هر کاشی جدا خوانده شود (خواستهٔ کاربر، ۶ اکتبر ۲۰۲۶)؛
 * max-w همراه فاصله بزرگ شد تا اندازهٔ خود کاشی‌ها عوض نشود: ۴ × 181 + ۳ × 40.
 *
 * هر کاشی دکمهٔ `aria-pressed` است، نه radio: انتخاب، قدم بعدی را فوراً باز
 * می‌کند، پس کلیدهای جهت نباید ناخواسته انتخاب را عوض کنند.
 */
export function Kacheln({
  label,
  kacheln,
  wert,
  onWahl,
}: {
  label: string;
  kacheln: Kachel[];
  wert: string | null | undefined;
  onWahl: (wert: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid max-w-[844px] grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:gap-x-10 lg:gap-y-10">
      {kacheln.map((k) => {
        const gewaehlt = k.wert === wert;
        const Illustration = k.bild && 'illustration' in k.bild ? ILLUSTRATIONEN[k.bild.illustration as keyof typeof ILLUSTRATIONEN] : null;
        return (
          <button key={k.wert} type="button" aria-pressed={gewaehlt} onClick={() => onWahl(k.wert)} className="group min-w-0 self-start text-left">
            <span
              className={`relative block aspect-[4/3] overflow-hidden border transition-colors duration-[180ms] ${
                k.bild && 'foto' in k.bild ? 'bg-black' : 'bg-soft'
              } ${gewaehlt ? 'border-rose' : 'border-transparent group-hover:border-line'}`}
            >
              {k.bild && 'foto' in k.bild ? (
                // eslint-disable-next-line @next/next/no-img-element -- عکس‌های کوچک ثابت، نسبت اصلی حفظ می‌شود
                <img
                  src={k.bild.foto}
                  alt=""
                  width={480}
                  height={360}
                  className="h-full w-full object-contain transition-transform duration-[220ms] group-hover:scale-[1.025]"
                />
              ) : Illustration ? (
                <span className="absolute inset-[6%]">
                  <Illustration />
                </span>
              ) : null}
              <span
                aria-hidden
                className={`absolute left-2 top-2 grid size-4 place-items-center rounded-full border ${gewaehlt ? 'border-white' : 'border-muted/70'}`}
              >
                {gewaehlt ? <span className="size-[7px] rounded-full bg-white" /> : null}
              </span>
              {k.tags?.length ? (
                <span aria-hidden className="absolute right-2 top-2 flex gap-1">
                  {k.tags.map((t) => (
                    <span key={t} className="border border-rose bg-black/70 px-1.5 py-0.5 text-[10px] leading-none text-rose">
                      {t}
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
            <span className={`mt-2.5 block text-[16px] font-light leading-snug ${gewaehlt ? 'text-white' : 'text-nav group-hover:text-white'}`}>
              {k.name}
              {/* برچسب‌ها روی عکس فقط دیدنی‌اند؛ صفحه‌خوان آن‌ها را بعد از نام می‌خواند */}
              {k.tags?.length ? <span className="sr-only">, {k.tags.join(', ')}</span> : null}
            </span>
            {k.zeilen?.map((z) => (
              <span key={z} className="mt-0.5 block text-[13px] leading-snug text-muted">
                {z}
              </span>
            ))}
            {k.preise?.map((z, i) => (
              <span key={z} className={`mt-0.5 block text-[13px] leading-snug [overflow-wrap:anywhere] ${i === 0 ? 'text-nav' : 'text-muted'}`}>
                {z}
              </span>
            ))}
          </button>
        );
      })}
    </div>
  );
}
