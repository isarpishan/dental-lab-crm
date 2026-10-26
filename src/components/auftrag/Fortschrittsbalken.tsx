import type { Fortschritt } from '@/lib/orders/fortschritt';

const tagMonat = new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Vienna' });

/**
 * نوار پیشرفت سفارش (Spec فاز ۱، بخش E و F): فقط مراحل همین سفارش. مرحلهٔ فعلی با rose،
 * مراحل گذشته پر، بعدی‌ها خالی. وضعیت با متن هم گفته می‌شود، نه فقط با رنگ.
 * - `klein`: در ردیف فهرست، فقط نقطه‌ها و نام مرحلهٔ فعلی
 * - بزرگ: در تب «Status»، با نام و تاریخ هر مرحله (روی موبایل عمودی)
 */
export function Fortschrittsbalken({ f, daten, klein = false }: { f: Fortschritt; daten?: (Date | null)[]; klein?: boolean }) {
  const aktuell = f.etappen[f.aktuell];
  const text = f.storniert ? 'Storniert' : f.fertig ? `${f.etappen.at(-1)?.label} – abgeschlossen` : aktuell ? `Schritt ${f.aktuell + 1} von ${f.etappen.length}: ${aktuell.label}` : 'Entwurf';

  if (klein) {
    return (
      <span className="flex items-center gap-2" title={text}>
        <span className="sr-only">{text}</span>
        <span aria-hidden className="flex items-center">
          {f.etappen.map((e, i) => (
            <span key={e.key} className="flex items-center">
              {i > 0 ? <span className={`h-px w-2.5 ${i <= f.aktuell ? 'bg-white/70' : 'bg-line'}`} /> : null}
              <span
                className={`size-[7px] rounded-full border ${
                  f.storniert ? 'border-muted/60' : i < f.aktuell || f.fertig ? 'border-white bg-white' : i === f.aktuell ? 'border-rose bg-rose' : 'border-muted/60'
                }`}
              />
            </span>
          ))}
        </span>
      </span>
    );
  }

  return (
    <div>
      {f.storniert ? <p className="sr-only">{text}</p> : null}
      <ol aria-label="Fortschritt" className="grid grid-cols-1 gap-y-0 md:grid-flow-col md:auto-cols-fr">
        {f.etappen.map((e, i) => {
          const erledigt = !f.storniert && (i < f.aktuell || f.fertig);
          const jetzt = !f.storniert && !f.fertig && i === f.aktuell;
          return (
            <li key={e.key} aria-current={jetzt ? 'step' : undefined} className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 pb-5 md:block md:pb-0 md:pr-3">
              {/* Linie zur nächsten Etappe */}
              {i < f.etappen.length - 1 ? (
                <span
                  aria-hidden
                  className={`absolute left-[10px] top-[16px] h-[calc(100%-10px)] w-px md:left-[16px] md:top-[10px] md:h-px md:w-[calc(100%-12px)] ${erledigt ? 'bg-white/70' : 'bg-line'}`}
                />
              ) : null}
              <span
                aria-hidden
                className={`relative z-[1] mt-[3px] grid size-[21px] place-items-center rounded-full border md:mt-0 ${
                  jetzt ? 'border-rose bg-black' : erledigt ? 'border-white bg-white' : 'border-line-strong bg-black'
                }`}
              >
                {jetzt ? <span className="size-[9px] rounded-full bg-rose" /> : null}
              </span>
              <span className="md:mt-3 md:block">
                <span className={`block text-[14px] ${jetzt ? 'text-white' : erledigt ? 'text-paragraph' : 'text-muted'}`}>
                  {e.label}
                  <span className="sr-only">{jetzt ? ' (aktuell)' : erledigt ? ' (erledigt)' : ''}</span>
                </span>
                <span className="block text-[12px] text-muted">{daten?.[i] ? tagMonat.format(daten[i]!) : jetzt ? 'jetzt' : ''}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
