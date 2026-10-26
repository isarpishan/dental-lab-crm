import { centText } from '@/lib/abrechnung/geld';
import type { Saldo, Zahlstand } from '@/lib/abrechnung/offen';
import { isoDatumText } from '@/lib/format';

/** وضعیت پرداخت یک Rechnung در یک سطر کوتاه؛ در CRM و پورتال یکی است. «überfällig» با rose. */
export function ZahlstandText({ stand, faelligAm, letzteZahlung, storniertMit }: { stand: Zahlstand; faelligAm: string | null; letzteZahlung: string | null; storniertMit?: string }) {
  switch (stand.status) {
    case 'storniert':
      return (
        <span className="text-muted">
          storniert{storniertMit ? ` mit ${storniertMit}` : ''}
          {stand.offenCent < 0 ? ` · Guthaben ${centText(-stand.offenCent)}` : ''}
        </span>
      );
    case 'offen':
      return stand.ueberfaellig ? <span className="text-rose">überfällig · fällig am {isoDatumText(faelligAm)}</span> : <span className="text-muted">offen · fällig am {isoDatumText(faelligAm)}</span>;
    case 'teilweise':
      return (
        <span className={stand.ueberfaellig ? 'text-rose' : 'text-muted'}>
          teilweise bezahlt · offen {centText(stand.offenCent)} · {stand.ueberfaellig ? 'überfällig' : `fällig am ${isoDatumText(faelligAm)}`}
        </span>
      );
    case 'bezahlt':
      return <span>bezahlt{letzteZahlung ? ` am ${isoDatumText(letzteZahlung)}` : ''}</span>;
    case 'ausgeglichen':
      return <span className="text-muted">ausgeglichen durch Gutschrift</span>;
    case 'guthaben':
      return <span>Guthaben {centText(-stand.offenCent)}</span>;
  }
}

/** جمع باز یک Ordination: «€ 1.234,50 offen · davon € 500,00 überfällig»، یا Guthaben، یا «Alles bezahlt.». `praxis`: متن پورتال. */
export function SaldoZeile({ saldo, praxis = false }: { saldo: Saldo; praxis?: boolean }) {
  if (saldo.offenCent === 0) return <p className="mb-10 text-[15px] font-light text-muted">Alles bezahlt. Nichts offen.</p>;
  return (
    <p className="mb-10 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[15px]">
      <span className="text-[32px] font-light">{centText(Math.abs(saldo.offenCent))}</span>
      <span className="text-muted">{saldo.offenCent > 0 ? `offen aus ${saldo.offeneRechnungen} ${saldo.offeneRechnungen === 1 ? 'Rechnung' : 'Rechnungen'}` : praxis ? 'Ihr Guthaben' : 'Guthaben der Ordination'}</span>
      {saldo.ueberfaelligCent > 0 ? <span className="text-rose">davon {centText(saldo.ueberfaelligCent)} überfällig</span> : null}
    </p>
  );
}
