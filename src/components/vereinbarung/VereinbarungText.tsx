import type { VereinbarungInhalt } from '@/lib/vereinbarung/text';

/**
 * متن Vereinbarung برای پورتال و CRM، از همان ساختاری که ذخیره می‌شود. بندهایی که با «– » شروع
 * می‌شوند فهرست‌اند (ردیف‌های جداشده با خط، مثل سایت، نه نقطه‌های گرد).
 */
export function VereinbarungText({ inhalt }: { inhalt: VereinbarungInhalt }) {
  return (
    <article lang="de-AT" className="max-w-[760px]">
      <p className="eyebrow">
        Version {inhalt.version} · Stand {inhalt.stand}
      </p>
      <h2 className="mt-4 text-[clamp(24px,2.6vw,34px)] font-light leading-[1.1]">{inhalt.titel}</h2>
      {inhalt.abschnitte.map((a) => (
        <section key={a.titel} className="mt-10">
          <h3 className="text-[17px] font-medium">{a.titel}</h3>
          {a.absaetze.map((p) =>
            p.startsWith('– ') ? (
              <p key={p} className="mt-3 border-l border-line pl-4 text-[15px] font-light leading-relaxed text-paragraph">
                {p.slice(2)}
              </p>
            ) : (
              <p key={p} className="mt-3 text-[15px] font-light leading-relaxed text-paragraph">
                {p}
              </p>
            ),
          )}
        </section>
      ))}
    </article>
  );
}
