'use client';

export type Zeile = { wert: string; name: string; zusatz?: string };

/**
 * یک انتخاب از چند ردیف جداشده با خط، مثل فهرست خدمات سایت: نام، یک خط توضیح muted
 * و نقطهٔ انتخاب در راست. برای گزینه‌هایی که توضیح لازم دارند (مثلاً Standard / Express).
 */
export function ZeilenWahl({
  label,
  zeilen,
  wert,
  onWahl,
}: {
  label: string;
  zeilen: Zeile[];
  wert: string | null | undefined;
  onWahl: (wert: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="max-w-[640px] border-t border-line">
      {zeilen.map((z) => {
        const gewaehlt = z.wert === wert;
        return (
          <button
            key={z.wert}
            type="button"
            aria-pressed={gewaehlt}
            onClick={() => onWahl(z.wert)}
            className="group flex min-h-16 w-full items-center justify-between gap-4 border-b border-line py-3.5 text-left"
          >
            <span>
              <span className={`block text-[18px] font-light ${gewaehlt ? 'text-white' : 'text-nav group-hover:text-white'}`}>{z.name}</span>
              {z.zusatz ? <span className="mt-0.5 block text-[13px] text-muted">{z.zusatz}</span> : null}
            </span>
            <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border ${gewaehlt ? 'border-white' : 'border-muted/70'}`}>
              {gewaehlt ? <span className="size-[7px] rounded-full bg-white" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
