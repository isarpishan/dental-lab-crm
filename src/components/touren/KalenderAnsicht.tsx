import Link from 'next/link';
import { istEilig, TEMPO_KURZ } from '@/lib/katalog/tempo';
import type { KalenderTag, Termin } from '@/lib/touren/kalender';
import { tagKurz, WOCHENTAGE } from '@/lib/touren/plan';

/**
 * تقویم (Spec فاز ۱، بخش I): ماه یا هفته روی صفحهٔ بزرگ، و روی گوشی فهرست روزها. ردیف‌ها با خط نازک،
 * بدون کارت. rose فقط برای «überfällig»؛ کار تمام‌شده کم‌رنگ و خط‌خورده.
 */

const MAX_IM_MONAT = 4;

function TerminZeile({ t, ausfuehrlich }: { t: Termin; ausfuehrlich: boolean }) {
  const farbe = t.erledigt ? 'text-muted line-through decoration-line-strong' : t.ueberfaellig ? 'text-rose-light' : 'text-white';
  return (
    <Link href={`/auftraege/${t.orderId}`} className={`group block min-w-0 py-1 text-[12px] leading-snug ${farbe}`} title={`${t.orderNo} · ${t.behandlung} · ${t.praxis}`}>
      <span className="block truncate group-hover:underline">
        {istEilig(t.tempo) ? <span className="mr-1 text-[10px] uppercase tracking-[0.06em]">{TEMPO_KURZ[t.tempo]}</span> : null}
        {t.orderNo}
      </span>
      <span className="block truncate text-muted">
        {t.behandlung}
        {t.art === 'wunschtermin' ? ' · Wunsch' : ''}
        {ausfuehrlich ? ` · ${t.patientCode ?? '–'} · ${t.praxis}` : ''}
      </span>
    </Link>
  );
}

function TagInhalt({ tag, ausfuehrlich, mehrLink }: { tag: KalenderTag | undefined; ausfuehrlich: boolean; mehrLink?: string }) {
  if (!tag) return null;
  const termine = ausfuehrlich ? tag.termine : tag.termine.slice(0, MAX_IM_MONAT);
  const rest = tag.termine.length - termine.length;
  return (
    <div className="space-y-0.5">
      {tag.touren.length ? <p className="truncate pb-1 text-[11px] text-muted">{tag.touren.join(', ')}</p> : null}
      {termine.map((t) => (
        <TerminZeile key={t.orderId} t={t} ausfuehrlich={ausfuehrlich} />
      ))}
      {rest > 0 && mehrLink ? (
        <Link href={mehrLink} className="block py-1 text-[12px] text-muted underline-offset-4 hover:underline">
          + {rest} weitere
        </Link>
      ) : null}
      {tag.abholungen.map((a) => (
        <p key={a.id} className={`truncate py-1 text-[12px] ${a.status === 'erledigt' ? 'text-muted line-through decoration-line-strong' : a.status === 'offen' ? 'text-rose-light' : 'text-paragraph'}`}>
          Abholung · {a.praxis}
          {a.status === 'offen' ? ' (nicht eingeplant)' : ''}
        </p>
      ))}
    </div>
  );
}

export function KalenderRaster({
  wochen,
  tage,
  heute,
  monat,
  ausfuehrlich,
  wocheLink,
}: {
  wochen: string[][];
  tage: Map<string, KalenderTag>;
  heute: string;
  /** «2026-10»: Tage anderer Monate blasser; null in der Wochenansicht */
  monat: string | null;
  ausfuehrlich: boolean;
  wocheLink: (datum: string) => string;
}) {
  const alle = wochen.flat();
  const mitInhalt = alle.filter((d) => {
    const t = tage.get(d);
    return d === heute || (t && (t.termine.length || t.abholungen.length)) || (!monat && t);
  });
  return (
    <>
      {/* Bildschirm: Raster */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-line">
          {WOCHENTAGE.map((w) => (
            <p key={w.nr} className="pb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              {w.kurz}
            </p>
          ))}
        </div>
        {wochen.map((w) => (
          <div key={w[0]} className="grid grid-cols-7 border-b border-line">
            {w.map((d, i) => {
              const fremd = monat !== null && !d.startsWith(monat);
              return (
                <div
                  key={d}
                  data-tag={d}
                  className={`min-w-0 px-2.5 pb-3 pt-2.5 ${i ? 'border-l border-line' : ''} ${monat ? 'min-h-[132px]' : 'min-h-[320px]'} ${fremd ? 'opacity-45' : ''} ${i >= 5 ? 'bg-soft' : ''}`}
                >
                  <p className={`mb-1.5 inline-block text-[13px] ${d === heute ? 'border-b border-rose text-white' : 'text-muted'}`}>
                    {Number(d.slice(8))}
                    {d === heute ? <span className="sr-only"> (heute)</span> : null}
                  </p>
                  <TagInhalt tag={tage.get(d)} ausfuehrlich={ausfuehrlich} mehrLink={wocheLink(d)} />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Handy: nur Tage mit Einträgen, als Liste */}
      <ol className="border-t border-line md:hidden">
        {mitInhalt.map((d) => (
          <li key={d} className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-4 border-b border-line py-4">
            <p className={`text-[14px] ${d === heute ? 'text-white' : 'text-muted'}`}>
              {tagKurz(d)}
              {d === heute ? <span className="mt-1 block text-[11px] text-rose">heute</span> : null}
            </p>
            <div className="min-w-0">{tage.get(d) ? <TagInhalt tag={tage.get(d)} ausfuehrlich /> : <p className="py-1 text-[13px] text-muted">–</p>}</div>
          </li>
        ))}
        {!mitInhalt.length ? <li className="py-6 text-[15px] text-muted">Keine Termine in diesem Zeitraum.</li> : null}
      </ol>
    </>
  );
}
