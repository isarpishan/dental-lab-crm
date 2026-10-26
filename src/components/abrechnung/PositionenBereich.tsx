'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { centEingabe, centLesen, centText } from '@/lib/abrechnung/geld';
import { POSITION_EINHEITEN, positionBetrag, rabattCent, rabattEingabe, rabattLesen, rabattText, type Position, type PositionEinheit } from '@/lib/abrechnung/positionen';
import type { Ergebnis } from '@/lib/aktion';
import type { RabattArt } from '@/db/schema';

type Aktion = (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
type Zeile = { bezeichnung: string; menge: string; einheit: PositionEinheit; einzelpreis: string; rabatt: string; rabattArt: RabattArt };

const FELD = 'w-full border border-line bg-transparent px-3 py-2.5 text-[15px] text-white outline-none transition-colors focus:border-rose';
// Tailwind فقط نام‌های کامل کلاس را می‌شناسد، پس هر دو چیدمان کامل نوشته شده‌اند
const SPALTEN = 'md:grid-cols-[minmax(0,1fr)_110px_120px_120px]';
const SPALTEN_RABATT = 'md:grid-cols-[minmax(0,1fr)_100px_110px_100px_110px]';
const zeileAus = (p: Position): Zeile => ({
  bezeichnung: p.bezeichnung,
  menge: String(p.menge),
  einheit: p.einheit,
  einzelpreis: centEingabe(p.einzelpreisCent),
  rabatt: rabattEingabe(p.rabatt),
  rabattArt: p.rabatt?.art ?? 'prozent',
});

/** مبلغ یک ردیف پس از Rabatt در حالت ویرایش، یا null اگر هنوز قابل حساب نیست. Rabatt نادرست تا ذخیره نادیده می‌ماند. */
function betrag(z: Zeile): number | null {
  const preis = centLesen(z.einzelpreis);
  const menge = Number(z.menge);
  if (!preis.ok || preis.wert == null || !Number.isInteger(menge) || menge <= 0) return null;
  const grund = preis.wert * menge;
  const r = rabattLesen(z.rabatt, z.rabattArt, grund);
  return grund - (r.ok ? rabattCent(grund, r.wert) : 0);
}

/** خانهٔ Rabatt: «10 %» با مبلغ کسرشده زیرش، یا «− € 10,00». */
function RabattZelle({ p }: { p: Position }) {
  if (!p.rabatt || p.einzelpreisCent == null) return <>–</>;
  const minus = `− ${centText(rabattCent(p.einzelpreisCent * p.menge, p.rabatt))}`;
  return p.rabatt.art === 'prozent' ? (
    <>
      {rabattText(p.rabatt)}
      <span className="block text-[13px] text-muted">{minus}</span>
    </>
  ) : (
    <>{minus}</>
  );
}

/**
 * تب «Abrechnung» هر سفارش در CRM (Spec فاز ۲، قدم ۱): پوزیشن‌ها با جمع netto. پیشنهاد خودکار از
 * قیمت‌های لحظهٔ سفارش است؛ Büro می‌تواند ردیف‌ها را عوض کند یا به پیشنهاد برگردد.
 */
export function PositionenBereich({
  orderId,
  positionen,
  gespeichert,
  leistung,
  bearbeitbar,
  speichern,
  zuruecksetzen,
  einzelrechnung,
}: {
  orderId: string;
  positionen: Position[];
  gespeichert: boolean;
  /** «Leistungsdatum 05.10.2026 · Sammelrechnung Oktober 2026» oder warum noch nicht verrechenbar */
  leistung: string;
  bearbeitbar: boolean;
  speichern: Aktion;
  zuruecksetzen: Aktion;
  /** لینک پیش‌نمایش Einzelrechnung (اگر سفارش آمادهٔ فاکتور است و نقش اجازه دارد) */
  einzelrechnung?: string;
}) {
  const [bearbeiten, setBearbeiten] = useState(false);
  const [zeilen, setZeilen] = useState<Zeile[]>(() => positionen.map(zeileAus));
  // بعد از ذخیره، برگشت به نما (داخل خود action، نه در effect)
  const [zustand, absenden, laeuft] = useFormAktion(async (z: Ergebnis, f: FormData) => {
    const r = await speichern(z, f);
    if (r?.erfolg) setBearbeiten(false);
    return r;
  }, null);
  const [zurueck, zuruecksenden, laeuftZurueck] = useFormAktion(zuruecksetzen, null);
  const gesamt = positionen.reduce((s, p) => s + (positionBetrag(p) ?? 0), 0);
  const mitRabatt = positionen.some((p) => p.rabatt);
  const preisFehlt = positionen.some((p) => p.einzelpreisCent == null);
  const neuGesamt = zeilen.reduce((s, z) => s + (betrag(z) ?? 0), 0);

  const aendern = (i: number, teil: Partial<Zeile>) => setZeilen((alt) => alt.map((z, j) => (j === i ? { ...z, ...teil } : z)));
  const meldung = zustand?.fehler ?? zurueck?.fehler;
  const erfolg = !bearbeiten ? (zustand?.erfolg ?? zurueck?.erfolg) : undefined;

  if (bearbeiten) {
    return (
      <form onSubmit={absenden} className="grid gap-6" aria-label="Positionen bearbeiten">
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="zeilen" value={JSON.stringify(zeilen)} />
        <ol className="border-t border-line">
          {zeilen.map((z, i) => (
            <li key={i} className="grid gap-3 border-b border-line py-5 md:grid-cols-[80px_110px_120px_150px_auto] md:items-end xl:grid-cols-[minmax(0,1fr)_80px_110px_120px_150px_auto]">
              <label className="block text-[13px] text-muted md:col-span-full xl:col-span-1">
                Bezeichnung
                <input className={`${FELD} mt-1.5`} value={z.bezeichnung} onChange={(e) => aendern(i, { bezeichnung: e.target.value })} required maxLength={300} />
              </label>
              <label className="block text-[13px] text-muted">
                Menge
                <input className={`${FELD} mt-1.5`} value={z.menge} onChange={(e) => aendern(i, { menge: e.target.value })} inputMode="numeric" required />
              </label>
              <label className="block text-[13px] text-muted">
                Einheit
                <select className={`${FELD} mt-1.5 appearance-auto`} value={z.einheit} onChange={(e) => aendern(i, { einheit: e.target.value as PositionEinheit })}>
                  {POSITION_EINHEITEN.map((e) => (
                    <option key={e} value={e} className="bg-black">
                      {e}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[13px] text-muted">
                Einzelpreis (€)
                <input className={`${FELD} mt-1.5`} value={z.einzelpreis} onChange={(e) => aendern(i, { einzelpreis: e.target.value })} inputMode="decimal" placeholder="0,00" required />
              </label>
              <div className="text-[13px] text-muted">
                <label htmlFor={`${orderId}-rabatt-${i}`}>Rabatt</label>
                <div className="mt-1.5 flex">
                  <input
                    id={`${orderId}-rabatt-${i}`}
                    className={`${FELD} min-w-0 flex-1`}
                    value={z.rabatt}
                    onChange={(e) => aendern(i, { rabatt: e.target.value })}
                    inputMode="decimal"
                    placeholder="–"
                  />
                  <select
                    aria-label="Rabatt in Prozent oder Euro"
                    className="w-[64px] shrink-0 appearance-auto border border-l-0 border-line bg-transparent px-2 py-2.5 text-[15px] text-white outline-none transition-colors focus:border-rose"
                    value={z.rabattArt}
                    onChange={(e) => aendern(i, { rabattArt: e.target.value as RabattArt })}
                  >
                    <option value="prozent" className="bg-black">
                      %
                    </option>
                    <option value="betrag" className="bg-black">
                      €
                    </option>
                  </select>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setZeilen((alt) => alt.filter((_, j) => j !== i))}
                disabled={zeilen.length === 1}
                className="justify-self-start py-2.5 text-[13px] text-muted hover:text-white disabled:opacity-40"
              >
                Entfernen
              </button>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <Button variant="text" onClick={() => setZeilen((alt) => [...alt, { bezeichnung: '', menge: '1', einheit: 'Stück', einzelpreis: '', rabatt: '', rabattArt: 'prozent' }])}>
            Position hinzufügen +
          </Button>
          <p className="text-[15px]">
            Summe netto <span className="ml-3 text-[18px] font-light">{centText(neuGesamt)}</span>
          </p>
        </div>
        {zustand?.fehler ? <Meldung art="fehler">{zustand.fehler}</Meldung> : null}
        <div className="flex flex-wrap items-center gap-6">
          <Button type="submit" disabled={laeuft}>
            {laeuft ? 'Wird gespeichert …' : 'Speichern'}
          </Button>
          <button
            type="button"
            onClick={() => {
              setZeilen(positionen.map(zeileAus));
              setBearbeiten(false);
            }}
            className="text-[13px] text-muted hover:text-white"
          >
            Abbrechen
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="grid gap-6">
      <p className="text-[15px] font-light text-paragraph">{leistung}</p>
      <div role="table" aria-label="Positionen" className="border-t border-line">
        <div role="row" className={`hidden gap-4 border-b border-line py-3 text-[11px] uppercase tracking-[0.06em] text-muted md:grid ${mitRabatt ? SPALTEN_RABATT : SPALTEN}`}>
          <span role="columnheader">Bezeichnung</span>
          <span role="columnheader" className="text-right">Menge</span>
          <span role="columnheader" className="text-right">Einzelpreis</span>
          {mitRabatt ? (
            <span role="columnheader" className="text-right">
              Rabatt
            </span>
          ) : null}
          <span role="columnheader" className="text-right">Betrag</span>
        </div>
        {positionen.map((p, i) => (
          <div key={i} role="row" className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b border-line py-4 ${mitRabatt ? SPALTEN_RABATT : SPALTEN}`}>
            <span role="cell" className="text-[15px] font-light max-md:col-start-1 max-md:row-start-1">
              {p.bezeichnung}
            </span>
            <span role="cell" className="text-[13px] text-muted max-md:col-start-1 max-md:row-start-2 md:text-right md:text-[15px] md:font-light md:text-white">
              {p.menge} {p.einheit}
              <span className="md:hidden">
                {' '}
                × {p.einzelpreisCent == null ? '–' : centText(p.einzelpreisCent)}
                {p.rabatt && p.einzelpreisCent != null
                  ? ` · Rabatt ${p.rabatt.art === 'prozent' ? `${rabattText(p.rabatt)} (− ${centText(rabattCent(p.einzelpreisCent * p.menge, p.rabatt))})` : `− ${centText(p.rabatt.wert)}`}`
                  : ''}
              </span>
            </span>
            <span role="cell" className="hidden text-right text-[15px] font-light md:block">
              {p.einzelpreisCent == null ? '–' : centText(p.einzelpreisCent)}
            </span>
            {mitRabatt ? (
              <span role="cell" className="hidden text-right text-[15px] font-light md:block">
                <RabattZelle p={p} />
              </span>
            ) : null}
            <span role="cell" className="text-right text-[15px] font-light max-md:col-start-2 max-md:row-start-1">
              {p.einzelpreisCent == null ? <span className="text-rose">Preis fehlt</span> : centText(positionBetrag(p)!)}
            </span>
          </div>
        ))}
        <div role="row" className="flex items-baseline justify-between gap-4 py-4">
          <span role="cell" className="text-[15px]">
            Summe netto
          </span>
          <span role="cell" className="text-[22px] font-light">
            {centText(gesamt)}
            {preisFehlt ? <span className="ml-3 text-[13px] text-rose">ohne fehlende Preise</span> : null}
          </span>
        </div>
      </div>
      <p className="max-w-[680px] text-[13px] text-muted">
        {gespeichert
          ? 'Von Hand angepasst.'
          : 'Vorschlag aus den Preisen bei Auftragseingang (»ab«-Preise aus den Stammdaten). Bitte vor der Rechnung prüfen.'}
      </p>
      {meldung ? <Meldung art="fehler">{meldung}</Meldung> : null}
      {erfolg ? <Meldung art="erfolg">{erfolg}</Meldung> : null}
      {bearbeitbar ? (
        <div className="flex flex-wrap items-center gap-6">
          <Button
            variant="secondary"
            onClick={() => {
              setZeilen(positionen.map(zeileAus));
              setBearbeiten(true);
            }}
          >
            Positionen bearbeiten
          </Button>
          {einzelrechnung ? (
            <Link href={einzelrechnung} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
              Einzelrechnung erstellen ↗
            </Link>
          ) : null}
          {gespeichert ? (
            <form onSubmit={zuruecksenden}>
              <input type="hidden" name="orderId" value={orderId} />
              <button type="submit" disabled={laeuftZurueck} className="text-[13px] text-muted hover:text-white disabled:opacity-50">
                Vorschlag wiederherstellen
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
