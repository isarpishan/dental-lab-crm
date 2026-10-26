import { centText } from '@/lib/abrechnung/geld';
import { preisGross, type PreisUebersicht } from '@/lib/orders/preis';

// Kein »voraussichtlich« (Wunsch 25.10.2026): die Preise stehen in »Preise« fest, das Wort würde verunsichern
const TITEL = 'Preis';

function hinweis(p: PreisUebersicht): string {
  switch (p.art) {
    case 'schaetzung':
      return p.offen.length ? 'Was noch ohne Betrag ist, nennen wir nach Prüfung.' : '';
    case 'festgelegt':
      return 'Vom Labor geprüft. So steht der Auftrag auf der Rechnung.';
    case 'verrechnet':
      return p.rechnung ? `Verrechnet mit Rechnung ${p.rechnung}.` : 'Verrechnet.';
    case 'storniert':
      return 'Der Auftrag ist storniert und wird nicht verrechnet.';
  }
}

/**
 * قیمت یک سفارش، درشت و با جمع (خواستهٔ کاربر، ۲۵ اکتبر ۲۰۲۶). در قدم آخر «Neuer Auftrag» و در صفحهٔ هر
 * سفارش. یک «جعبهٔ لازم» سایت (حاشیهٔ `panel-line`، شعاع 12px): جمع بزرگ، زیرش هر ردیف با تعداد و مبلغ،
 * و یک سطر توضیح. بدون hook، پس هم در فرم (client) و هم در صفحهٔ سرور کار می‌کند.
 */
export function PreisKasten({ preis, className = '' }: { preis: PreisUebersicht; className?: string }) {
  const storniert = preis.art === 'storniert';
  return (
    <section aria-label={TITEL} className={`max-w-[680px] rounded-[12px] border border-panel-line px-5 py-5 sm:px-6 ${className}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{TITEL}</p>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-[clamp(34px,3.8vw,48px)] font-medium leading-none ${storniert ? 'text-muted line-through' : ''}`}>{preisGross(preis)}</span>
        {!storniert && preis.zeilen.some((z) => z.betragCent != null) ? <span className="text-[15px] text-muted">netto</span> : null}
      </p>
      {!storniert && preis.offen.length && preis.zeilen.some((z) => z.betragCent != null) ? (
        <p className="mt-2 text-[15px] text-rose-light">zzgl. {preis.offen.join(' und ')} nach Prüfung</p>
      ) : null}
      <ul aria-label="Zusammensetzung" className="mt-5 border-t border-line text-[14px]">
        {preis.zeilen.map((z, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 border-b border-line py-2.5">
            <span className="min-w-0">
              <span className="block break-words">{z.text}</span>
              <span className="block text-[13px] text-muted">{z.menge}</span>
            </span>
            <span className={`text-right tabular-nums ${z.betragCent == null ? 'text-[13px] text-muted' : ''}`}>{z.betragCent == null ? 'nach Prüfung' : centText(z.betragCent)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-muted">
        {[hinweis(preis), 'Alle Preise netto, steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.'].filter(Boolean).join(' ')}
      </p>
    </section>
  );
}
