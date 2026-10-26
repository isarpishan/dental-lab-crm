import { SchrittErledigen, SchrittKorrigieren, ZustaendigWahl, type ErledigtAktion } from '@/components/produktion/SchrittErledigen';
import { datumZeit, isoDatumText, seitTagen } from '@/lib/format';
import { mengeText } from '@/lib/produktion/material-text';
import type { ProduktionsStand } from '@/lib/produktion/stand';

/**
 * بخش «Produktion» در تب Status صفحهٔ سفارش (فقط لابراتوار) و در صفحهٔ تبلت: مرحلهٔ فعلی با
 * «Erledigt»، «Zuständig»، فهرست مراحل همین سفارش با تاریخ و نام، Chargeها و Laufzettel.
 */
export function ProduktionsBereich({
  stand,
  erledigt,
  zustaendig,
  verschieben,
  auftragsLink,
  laufzettel = true,
}: {
  stand: ProduktionsStand;
  erledigt?: ErledigtAktion;
  zustaendig?: (orderId: string, userId: string) => Promise<{ fehler?: string }>;
  /** nur auf der Auftragsseite: Schritt von Hand setzen (vor oder zurück) */
  verschieben?: (orderId: string, nach: string, von: string) => Promise<{ fehler?: string }>;
  auftragsLink?: string;
  laufzettel?: boolean;
}) {
  return (
    <section aria-label="Produktion" className="space-y-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3">
        <div>
          <p className="eyebrow">Produktion</p>
          <h3 className="mt-3 text-[clamp(26px,3vw,40px)] font-light leading-[1.05]">{stand.aktuell ? stand.aktuell.label : 'Kein offener Schritt'}</h3>
          {stand.aktuell?.seit ? <p className="mt-2 text-[15px] text-muted">{seitTagen(stand.aktuell.seit)}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {/* nach der Qualitätskontrolle: Lieferschein für die Box, Konformitätserklärung als Beilage */}
          {stand.dokumente.map((d) => (
            <a key={d.id} href={`/api/dokumente/${d.id}`} target="_blank" rel="noopener" className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
              {d.name} {d.nr} ↗
            </a>
          ))}
          {laufzettel ? (
            <a href={`/api/auftraege/${stand.orderId}/laufzettel`} target="_blank" rel="noopener" className="border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10">
              Laufzettel (PDF)
            </a>
          ) : null}
        </div>
      </div>

      {erledigt ? <SchrittErledigen stand={stand} erledigt={erledigt} auftragsLink={auftragsLink} /> : null}

      {verschieben && stand.aktuell && stand.ziele.length ? <SchrittKorrigieren stand={stand} verschieben={verschieben} /> : null}

      {zustaendig && stand.aktuell ? (
        <ZustaendigWahl orderId={stand.orderId} wert={stand.zustaendig?.id ?? null} personen={stand.personen} setzen={zustaendig} />
      ) : stand.zustaendig ? (
        <p className="text-[15px]">
          <span className="text-muted">Zuständig:</span> {stand.zustaendig.name}
        </p>
      ) : null}

      <div>
        <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Schritte dieses Auftrags</h4>
        <ol className="mt-3">
          {stand.zeilen.map((z, i) => (
            <li key={z.key} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 border-t border-line py-3.5 sm:grid-cols-[32px_minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <span className={`text-[11px] ${z.zustand === 'aktuell' ? 'text-rose' : 'text-muted'}`}>{String(i + 1).padStart(2, '0')}</span>
              <span className={`text-[16px] ${z.zustand === 'offen' ? 'text-muted' : z.zustand === 'aktuell' ? 'text-white' : 'font-light'}`}>
                {z.label}
                {z.zustand === 'aktuell' ? <span className="sr-only"> (aktuell)</span> : null}
              </span>
              <span className="col-start-2 text-[13px] text-muted sm:col-start-auto">
                {z.zustand === 'erledigt'
                  ? ['erledigt', z.am ? datumZeit(z.am) : null, z.von, z.geraet].filter(Boolean).join(' · ')
                  : z.zustand === 'aktuell'
                    ? 'aktuell'
                    : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {stand.verwendet.length ? (
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Material und Chargen</h4>
          <ul className="mt-3">
            {stand.verwendet.map((v) => (
              <li key={`${v.material}-${v.lotNo}`} className="border-t border-line py-3 text-[15px]">
                {v.material}
                {v.farbe ? ` ${v.farbe}` : ''} · LOT {v.lotNo}
                {v.menge ? <span className="text-muted"> · {mengeText(v.menge, v.einheit)}</span> : null}
                {v.ablauf ? <span className="text-muted"> · verwendbar bis {isoDatumText(v.ablauf)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
