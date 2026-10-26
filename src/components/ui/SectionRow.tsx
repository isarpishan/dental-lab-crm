/**
 * بخش ویراستاری مثل `section-heading` و `service-row` سایت: ستون کوچک برای
 * شمارهٔ rose و عنوان، ستون بزرگ برای محتوا، و خط نازک بالای هر بخش.
 */
export function SectionRow({
  index,
  title,
  lead,
  children,
}: {
  index: string;
  title: string;
  lead?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`abschnitt-${index}`} className="scroll-mt-[100px] grid grid-cols-1 gap-x-16 gap-y-8 border-t border-line py-14 lg:grid-cols-[minmax(160px,0.32fr)_1fr]">
      <div>
        <span className="text-[11px] text-rose">{index}</span>
        <h2 className="mt-3 text-[clamp(23px,2.6vw,38px)] font-light leading-[1.05]">{title}</h2>
        {lead ? <p className="mt-4 max-w-[340px] text-[15px] font-light text-muted">{lead}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
