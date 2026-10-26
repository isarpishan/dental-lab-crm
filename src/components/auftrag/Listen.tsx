import Link from 'next/link';
import { Fortschrittsbalken } from '@/components/auftrag/Fortschrittsbalken';
import { Tag } from '@/components/ui/Tag';
import { datum, datumZeit } from '@/lib/format';
import { istEilig, TEMPO_KURZ } from '@/lib/katalog/tempo';
import type { AuftragsZeile, PatientenZeile } from '@/lib/orders/listen';

/**
 * ردیف‌های فهرست «Aufträge» و «Patienten» (Spec فاز ۱، بخش E)، با زبان ردیف‌های سایت: خط
 * نازک بین ردیف‌ها، بدون کارت. روی موبایل هر ردیف چندخطی می‌شود.
 */

export function AuftragsTabelle({ zeilen, seite, leer }: { zeilen: AuftragsZeile[]; seite: 'praxis' | 'labor'; leer: string }) {
  if (!zeilen.length) return <p className="border-t border-line pt-6 font-light text-muted">{leer}</p>;
  return (
    <ul className="border-t border-line">
      {zeilen.map((z) => {
        const entwurf = z.status === 'entwurf';
        return (
          <li key={z.id} className="border-b border-line">
            <Link
              href={entwurf ? `/auftraege/neu?entwurf=${z.id}` : `/auftraege/${z.id}`}
              className="group grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-4 md:grid-cols-[56px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_170px]"
            >
              <span className="row-span-3 block aspect-[4/3] w-12 self-start bg-black md:row-span-1 md:w-14 md:self-center">
                {z.behandlung?.bild ? (
                  // eslint-disable-next-line @next/next/no-img-element -- kleines festes Bild
                  <img src={z.behandlung.bild} alt="" width={56} height={42} className="h-full w-full object-contain" />
                ) : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[17px] font-light group-hover:text-white">
                  {z.patient ? (z.patient.name ?? z.patient.code) : 'Kein Patient'}
                  {z.patient?.name ? <span className="text-[13px] text-muted"> · {z.patient.code}</span> : null}
                </span>
                <span className="block truncate text-[13px] text-muted">
                  {entwurf ? 'Entwurf' : z.orderNo} · {z.behandlung?.name ?? 'Behandlung offen'}
                  {seite === 'labor' ? ` · ${z.praxis.name}` : ''}
                </span>
              </span>
              <span className="col-start-2 flex min-w-0 items-center gap-3 md:col-start-auto">
                {entwurf ? (
                  <span className="text-[13px] text-muted">geändert {datumZeit(z.geaendert)}</span>
                ) : (
                  <>
                    <Fortschrittsbalken f={z.fortschritt} klein />
                    {/* auf dem Handy statt des Status-Tags */}
                    <span aria-hidden className="truncate text-[13px] text-paragraph sm:hidden">
                      {z.statusLabel}
                    </span>
                  </>
                )}
              </span>
              <span className="col-start-2 text-[13px] text-muted md:col-start-auto">
                {istEilig(z.tempo) ? <span className="mr-2 text-white">{TEMPO_KURZ[z.tempo]}</span> : null}
                {z.termin ?? (z.eingereicht ? `Eingang ${datum(z.eingereicht)}` : '')}
              </span>
              <span className="col-start-3 row-span-3 row-start-1 flex items-center justify-end gap-3 self-center md:col-start-auto md:row-span-1">
                {z.ungelesen ? (
                  <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-rose px-1.5 text-[11px] text-black" title="Neue Nachricht">
                    {z.ungelesen}
                    <span className="sr-only"> neue Nachricht{z.ungelesen > 1 ? 'en' : ''}</span>
                  </span>
                ) : null}
                {!entwurf ? (
                  <span className="hidden sm:block">
                    <Tag ton={z.statusAktion ? 'rose' : 'neutral'}>{z.statusLabel}</Tag>
                  </span>
                ) : null}
                <span aria-hidden className="text-rose transition-transform duration-[180ms] group-hover:translate-x-1">
                  ↗
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function PatientenTabelle({ zeilen, leer }: { zeilen: PatientenZeile[]; leer: string }) {
  if (!zeilen.length) return <p className="border-t border-line pt-6 font-light text-muted">{leer}</p>;
  return (
    <ul className="border-t border-line">
      {zeilen.map((p) => (
        <li key={p.id} className="border-b border-line">
          <Link
            href={`/patienten/${p.id}`}
            className="group grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-4 md:grid-cols-[44px_minmax(0,1.2fr)_minmax(0,1fr)_150px_150px_auto]"
          >
            <span aria-hidden className="row-span-2 grid size-11 place-items-center rounded-full border border-line-strong text-[13px] text-paragraph md:row-span-1">
              {p.kuerzel}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[17px] font-light group-hover:text-white">{p.name}</span>
              <span className="block text-[13px] text-muted">
                {p.code}
                {p.geburtsdatum ? ` · geb. ${p.geburtsdatum}` : ''}
              </span>
            </span>
            <span className="col-start-2 min-w-0 text-[14px] md:col-start-auto">
              {p.status ? (
                <>
                  <span className="text-paragraph">{p.behandlung}</span>
                  {p.weitere ? <span className="ml-2 border border-line px-1.5 text-[11px] text-muted">+{p.weitere}</span> : null}
                  <span className="block text-[13px] text-muted">{p.status}</span>
                </>
              ) : (
                <span className="text-muted">Keine aktiven Aufträge</span>
              )}
            </span>
            <span className="hidden text-[13px] text-muted md:block">
              Geändert
              <span className="block text-paragraph">{datum(p.geaendert)}</span>
            </span>
            <span className="hidden text-[13px] text-muted md:block">
              Angelegt
              <span className="block text-paragraph">{datum(p.angelegt)}</span>
            </span>
            <span aria-hidden className="col-start-3 row-span-2 row-start-1 text-rose transition-transform duration-[180ms] group-hover:translate-x-1 md:col-start-auto md:row-span-1">
              ↗
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
