'use client';

export type Option = { wert: string; label: string };

/**
 * گزینه‌های متنی با یک انتخاب (قطعه‌های `auswahl`، `kiefer` و `schalter`)، به شکل
 * دکمه‌های حاشیه‌دار مثل تگ‌های «STL / OBJ / PLY» سایت. گزینهٔ انتخاب‌شده: حاشیهٔ rose
 * و نقطهٔ سفید. مثل `Kacheln`، دکمهٔ `aria-pressed` است.
 */
export function Optionen({
  label,
  optionen,
  wert,
  onWahl,
}: {
  label: string;
  optionen: readonly Option[];
  wert: string | null | undefined;
  onWahl: (wert: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex max-w-[760px] flex-wrap gap-2.5">
      {optionen.map((o) => {
        const gewaehlt = o.wert === wert;
        return (
          <button
            key={o.wert}
            type="button"
            aria-pressed={gewaehlt}
            onClick={() => onWahl(o.wert)}
            className={`inline-flex min-h-11 items-center gap-3 border px-4 py-2.5 text-[15px] transition-colors duration-[180ms] ${
              gewaehlt ? 'border-rose text-white' : 'border-line text-nav hover:border-line-strong hover:text-white'
            }`}
          >
            <span aria-hidden className={`grid size-4 place-items-center rounded-full border ${gewaehlt ? 'border-white' : 'border-muted/70'}`}>
              {gewaehlt ? <span className="size-[7px] rounded-full bg-white" /> : null}
            </span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** چند انتخابی (مثلاً نکته‌های Ästhetik): همان ظاهر، با علامت ✓ به‌جای نقطه. */
export function MehrfachOptionen({
  label,
  optionen,
  wert,
  onChange,
}: {
  label: string;
  optionen: readonly string[];
  wert: readonly string[];
  onChange: (neu: string[]) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex max-w-[760px] flex-wrap gap-2.5">
      {optionen.map((o) => {
        const an = wert.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={an}
            onClick={() => onChange(an ? wert.filter((w) => w !== o) : [...wert, o])}
            className={`inline-flex min-h-11 items-center gap-3 border px-4 py-2.5 text-[15px] transition-colors duration-[180ms] ${
              an ? 'border-rose text-white' : 'border-line text-nav hover:border-line-strong hover:text-white'
            }`}
          >
            <span aria-hidden className={`grid size-4 place-items-center border text-[11px] leading-none ${an ? 'border-white' : 'border-muted/70'}`}>
              {an ? '✓' : ''}
            </span>
            {o}
          </button>
        );
      })}
    </div>
  );
}
