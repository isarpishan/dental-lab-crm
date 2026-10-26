import Link from 'next/link';
import { Tag } from '@/components/ui/Tag';
import { datum, datumZeit, isoDatumText } from '@/lib/format';
import type { AuftragDetail } from '@/lib/orders/detail';
import type { ReklamationInfo } from '@/lib/reklamationen/liste';
import { ReklamationEntscheiden, ReklamationMelden, ReparaturErledigt, type EntscheidenAktion, type MeldenAktion } from './ReklamationBedienung';

/**
 * Reklamationen im Tab »Status« der Auftragsseite (Spec فاز ۱، بخش J): jede mit Grund, Gewährleistung
 * und Entscheidung; im Labor das Formular für die Entscheidung. Rose nur, wo jemand etwas tun muss.
 */
export type ReklamationsAktionen = {
  reklamation?: MeldenAktion;
  reklamationEntscheiden?: EntscheidenAktion;
  reparaturErledigt?: (id: string) => Promise<{ fehler?: string }>;
};

export function garantieText(r: Pick<ReklamationInfo, 'garantie'>): string {
  if (!r.garantie.bis) return 'Gewährleistung: ohne Lieferdatum, zugunsten der Ordination';
  return r.garantie.gueltig ? `Innerhalb der Gewährleistung (bis ${isoDatumText(r.garantie.bis)})` : `Gewährleistung abgelaufen am ${isoDatumText(r.garantie.bis)}`;
}

function Entscheidung({ r, seite, link }: { r: ReklamationInfo; seite: 'praxis' | 'labor'; link: (id: string) => string }) {
  if (r.entscheidung === 'offen') {
    return <p className="text-[15px] text-muted">{seite === 'praxis' ? 'Wir prüfen Ihre Reklamation und melden uns.' : 'Noch nicht entschieden.'}</p>;
  }
  return (
    <div className="space-y-1.5 text-[15px]">
      <p>
        {r.entscheidung === 'neuanfertigung' ? (
          <>
            Neuanfertigung{r.neuerAuftrag ? ' als ' : ''}
            {r.neuerAuftrag ? (
              <Link href={link(r.neuerAuftrag.id)} className="border-b border-current hover:text-white">
                Auftrag {r.neuerAuftrag.nr} ↗
              </Link>
            ) : null}
            {r.kostenlos ? <span className="text-muted"> · ohne Berechnung</span> : null}
          </>
        ) : r.entscheidung === 'reparatur' ? (
          r.repariertAm ? `Repariert am ${datum(r.repariertAm)}` : 'Reparatur im Labor'
        ) : (
          'Abgelehnt'
        )}
        {r.entschiedenAm ? <span className="text-[13px] text-muted"> · entschieden am {datum(r.entschiedenAm)}</span> : null}
      </p>
      {r.notiz ? <p className="whitespace-pre-line font-light text-paragraph">{r.entscheidung === 'abgelehnt' ? `Begründung: ${r.notiz}` : r.notiz}</p> : null}
    </div>
  );
}

export function ReklamationsBereich({
  d,
  seite,
  aktionen,
  maxBytes,
  dateiEntfernen,
}: {
  d: AuftragDetail;
  seite: 'praxis' | 'labor';
  aktionen: ReklamationsAktionen;
  maxBytes: number;
  dateiEntfernen: (id: string) => Promise<{ fehler?: string }>;
}) {
  // gleicher Pfad in Portal und Labor
  const link = (id: string) => `/auftraege/${id}`;
  return (
    <section aria-label="Reklamation" className="space-y-8 border-t border-line pt-10">
      <div>
        <p className="eyebrow">Reklamation</p>
        {!d.reklamationen.length && seite === 'praxis' ? (
          <p className="mt-3 max-w-[640px] text-[15px] font-light text-muted">Passt etwas nicht? Melden Sie es uns hier, mit Fotos. Wir prüfen auch die Gewährleistung.</p>
        ) : null}
      </div>
      {d.reklamationen.length ? (
        <ol className="border-t border-line">
          {d.reklamationen.map((r) => (
            <li key={r.id} className="space-y-4 border-b border-line py-6">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-[19px] font-light">{r.nr}</span>
                <Tag ton={seite === 'labor' && r.offen ? 'rose' : 'neutral'}>{r.entscheidungLabel}</Tag>
                <span className="text-[13px] text-muted">
                  {r.grund} · gemeldet am {datumZeit(r.am)}
                  {r.vonLabor ? ' · vom Labor erfasst' : ''}
                </span>
              </div>
              <p className="max-w-[760px] whitespace-pre-line break-words text-[16px] font-light leading-relaxed">{r.text}</p>
              <p className={`text-[13px] ${r.garantie.gueltig ? 'text-muted' : 'text-rose-light'}`}>{garantieText(r)}</p>
              <Entscheidung r={r} seite={seite} link={link} />
              {seite === 'labor' && r.entscheidung === 'offen' && d.kann.reklamationEntscheiden && aktionen.reklamationEntscheiden ? (
                <div className="border-t border-line pt-6">
                  <ReklamationEntscheiden id={r.id} garantie={r.garantie.gueltig} entscheiden={aktionen.reklamationEntscheiden} />
                </div>
              ) : null}
              {seite === 'labor' && r.entscheidung === 'reparatur' && !r.repariertAm && d.kann.reklamationEntscheiden && aktionen.reparaturErledigt ? (
                <ReparaturErledigt id={r.id} aktion={aktionen.reparaturErledigt} />
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {d.kann.reklamieren && aktionen.reklamation ? (
        <ReklamationMelden orderId={d.id} zaehne={d.zaehne} maxBytes={maxBytes} labor={seite === 'labor'} melden={aktionen.reklamation} dateiEntfernen={dateiEntfernen} />
      ) : null}
    </section>
  );
}
