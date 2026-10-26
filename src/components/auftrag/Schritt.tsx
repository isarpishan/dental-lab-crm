import { Button } from '@/components/ui/Button';

/**
 * دو حالت هر قدم در فرم «Neuer Auftrag»، با زبان ردیف‌های سایت (شمارهٔ کوچک rose،
 * عنوان سبک، خط نازک بالا):
 * - `SchrittOffen`: قدمی که الان جواب داده می‌شود. همیشه فقط یکی.
 * - `SchrittZu`: قدم جواب‌داده، جمع‌شده در یک خط، با «Ändern».
 */

export function SchrittOffen({
  id,
  nummer,
  frage,
  hinweis,
  children,
  fuss,
}: {
  id: string;
  nummer: number;
  frage: string;
  hinweis?: string;
  children: React.ReactNode;
  fuss?: React.ReactNode;
}) {
  return (
    <section id={`schritt-${id}`} aria-labelledby={`frage-${id}`} className="scroll-mt-[104px] border-t border-line pb-14 pt-9">
      <div className="grid grid-cols-1 gap-y-2 md:grid-cols-[56px_minmax(0,1fr)]">
        <span className="pt-1.5 text-[11px] text-rose">{String(nummer).padStart(2, '0')}</span>
        <div className="min-w-0">
          <h2 id={`frage-${id}`} tabIndex={-1} className="text-[clamp(26px,3vw,44px)] font-light leading-[1.05]">
            {frage}
          </h2>
          {hinweis ? <p className="mt-3 max-w-[620px] text-[15px] font-light leading-relaxed text-muted">{hinweis}</p> : null}
          <div className="mt-8">{children}</div>
          {fuss ? <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">{fuss}</div> : null}
        </div>
      </div>
    </section>
  );
}

export function SchrittZu({
  id,
  nummer,
  titel,
  wert,
  bild,
  onAendern,
}: {
  id: string;
  nummer: number;
  titel: string;
  wert: string;
  bild?: string | null;
  onAendern: () => void;
}) {
  const n = String(nummer).padStart(2, '0');
  return (
    <section id={`schritt-${id}`} className="scroll-mt-[104px] border-t border-line py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 md:grid-cols-[56px_170px_minmax(0,1fr)_auto]">
        <span aria-hidden className="hidden text-[11px] text-rose md:block">
          {n}
        </span>
        <h2 className="col-start-1 row-start-1 text-[13px] text-muted md:col-start-2">
          <span aria-hidden className="mr-3 text-[11px] text-rose md:hidden">
            {n}
          </span>
          {titel}
        </h2>
        <p className="col-start-1 row-start-2 flex min-w-0 items-center gap-3 text-[16px] font-light md:col-start-3 md:row-start-1">
          {bild ? (
            // eslint-disable-next-line @next/next/no-img-element -- عکس کوچک ثابت
            <img src={bild} alt="" width={48} height={36} className="h-9 w-12 shrink-0 bg-black object-contain" />
          ) : null}
          <span className="min-w-0 break-words">{wert}</span>
        </p>
        <Button
          variant="text"
          onClick={onAendern}
          aria-label={`${titel} ändern`}
          className="col-start-2 row-span-2 row-start-1 self-center md:col-start-4 md:row-span-1"
        >
          Ändern
        </Button>
      </div>
    </section>
  );
}
