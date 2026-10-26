import { SeitenInfo } from "./SeitenInfo";

/**
 * سر هر صفحه: eyebrow کوچک و تیتر سبک بزرگ، مثل بخش‌های سایت.
 * - `info`: توضیح صفحه. دیگر زیر تیتر چاپ نمی‌شود؛ پشت علامت «i» کنار تیتر است (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶).
 * - `children`: فقط چیزهایی که باید همیشه دیده شوند: دکمه‌ها، لینک‌ها، عددها و پیام‌های وضعیت (مثل «Kein Zugriff»).
 * - `kompakt`: تیتر کوچک‌تر، برای صفحه‌های کاری که محتوا باید بدون اسکرول دیده شود (مثل «Abrechnung»).
 */
export function Seitenkopf({
  eyebrow,
  titel,
  info,
  kompakt = false,
  children,
}: {
  eyebrow: string;
  titel: string;
  info?: React.ReactNode;
  kompakt?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={
        kompakt
          ? "pb-10 pt-14 max-[640px]:pt-10"
          : "pb-14 pt-16 max-[640px]:pt-10"
      }
    >
      <p className="eyebrow">{eyebrow}</p>
      {/* اندازه و ارتفاع سطر روی قاب است: تیتر inline است تا «i» درست پشت آخرین کلمه بنشیند */}
      <div
        className={`relative mt-5 max-w-[980px] font-light ${kompakt ? "text-[clamp(36px,4.5vw,64px)] leading-[1]" : "text-[clamp(40px,5vw,72px)] leading-[0.98]"}`}
      >
        <h1 className="inline">{titel}</h1>
        {info ? <SeitenInfo>{info}</SeitenInfo> : null}
      </div>
      {children ? (
        <div
          className={
            kompakt
              ? "mt-5 max-w-[860px] text-[15px] font-light text-muted"
              : "mt-8 max-w-[680px] text-[18px] font-light leading-relaxed text-paragraph"
          }
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
