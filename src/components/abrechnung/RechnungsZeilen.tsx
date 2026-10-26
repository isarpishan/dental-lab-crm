import { centText } from '@/lib/abrechnung/geld';
import { rabattAnzeige } from '@/lib/abrechnung/positionen';
import type { Zeile } from '@/lib/abrechnung/rechnung';
import { isoDatumText } from '@/lib/format';

/**
 * ردیف‌های فاکتور در پیش‌نمایش، مثل PDF: ردیف‌های جداشده با خط، فقط شمارهٔ سفارش و Patienten-ID. چیدمان به
 * پهنای جای خودش بسته است (`@container`)، نه پهنای صفحه، چون کنار Vorschau ستون باریک‌تر است.
 */
export function RechnungsZeilen({ zeilen, summeCent, hinweis, titel = 'Rechnungsbetrag' }: { zeilen: Zeile[]; summeCent: number; hinweis: string; titel?: string }) {
  // ستون Rabatt فقط وقتی یک ردیف Rabatt دارد (مثل PDF)
  const mitRabatt = zeilen.some((z) => rabattAnzeige(z));
  const spalten = mitRabatt ? '@2xl:grid-cols-[32px_minmax(0,1fr)_90px_110px_100px_110px]' : '@2xl:grid-cols-[32px_minmax(0,1fr)_100px_120px_120px]';
  return (
    <div className="@container">
      <div role="table" aria-label="Rechnungspositionen" className="border-t border-line">
        <div role="row" className={`hidden gap-4 border-b border-line py-3 text-[11px] uppercase tracking-[0.06em] text-muted @2xl:grid ${spalten}`}>
          <span role="columnheader">Pos</span>
          <span role="columnheader">Leistung</span>
          <span role="columnheader" className="text-right">Menge</span>
          <span role="columnheader" className="text-right">Einzelpreis</span>
          {mitRabatt ? (
            <span role="columnheader" className="text-right">
              Rabatt
            </span>
          ) : null}
          <span role="columnheader" className="text-right">Betrag</span>
        </div>
        {zeilen.map((z, i) => {
          const rabatt = rabattAnzeige(z);
          return (
            <div key={i} role="row" className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-line py-4 ${spalten}`}>
              <span role="cell" className="hidden text-[13px] text-muted @2xl:block">
                {i + 1}
              </span>
              <span role="cell" className="min-w-0 @max-2xl:col-start-1 @max-2xl:row-start-1">
                <span className="block text-[15px] font-light">{z.bezeichnung}</span>
                {z.auftragsnummer ? (
                  <span className="block text-[13px] text-muted">
                    {[`Auftrag ${z.auftragsnummer}`, z.patientencode ? `Patienten-ID ${z.patientencode}` : null, z.leistungsdatum ? `Leistung ${isoDatumText(z.leistungsdatum)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </span>
              <span role="cell" className="text-[13px] text-muted @max-2xl:col-start-1 @max-2xl:row-start-2 @2xl:text-right @2xl:text-[15px] @2xl:font-light @2xl:text-white">
                {z.menge} {z.einheit}
                <span className="@2xl:hidden">
                  {' '}
                  × {centText(z.einzelpreisCent)}
                  {rabatt ? ` · Rabatt ${rabatt.prozent ? `${rabatt.prozent} (${rabatt.betrag})` : rabatt.betrag}` : ''}
                </span>
              </span>
              <span role="cell" className="hidden text-right text-[15px] font-light @2xl:block">
                {centText(z.einzelpreisCent)}
              </span>
              {mitRabatt ? (
                <span role="cell" className="hidden text-right text-[15px] font-light @2xl:block">
                  {rabatt ? (rabatt.prozent ?? rabatt.betrag) : '–'}
                  {rabatt?.prozent ? <span className="block text-[13px] text-muted">{rabatt.betrag}</span> : null}
                </span>
              ) : null}
              <span role="cell" className="text-right text-[15px] font-light @max-2xl:col-start-2 @max-2xl:row-start-1">
                {centText(z.betragCent)}
              </span>
            </div>
          );
        })}
        <div role="row" className="flex items-baseline justify-between gap-4 pt-4">
          <span role="cell" className="text-[15px]">
            {titel}
          </span>
          <span role="cell" className="text-[24px] font-light">
            {centText(summeCent)}
          </span>
        </div>
        <p className="mt-1 text-right text-[13px] text-muted">{hinweis}</p>
      </div>
    </div>
  );
}
