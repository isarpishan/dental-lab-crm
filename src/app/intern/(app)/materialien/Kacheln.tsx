'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { Fenster } from '@/components/ui/Fenster';
import { isoDatumText } from '@/lib/format';
import type { ChargeZeile, MaterialZeile } from '@/lib/produktion/material';
import { einheitWort, flaschenStand, herstellerFarbe, LAGER_FARBE, lagerStand, MARKE, mengeText, verwendung, zahlMitBruch } from '@/lib/produktion/material-text';
import { BestandKnoepfe, ChargeFormular, ChargeKnopf, FuellungWahl, MaterialEinstellungen, MaterialKnopf, MaterialNeuFormular } from './Formulare';

/**
 * Kachelraster der Seite «Materialien» (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶). هر Material یک کاشی است با رنگ‌هایش (کدام
 * موجود، کدام نه) و Bestand؛ با کلیک یک پنجره باز می‌شود با همهٔ Chargeها، «Flasche leer»، «Bestand ändern»، فرم
 * «Neue Charge» و (Stammdaten) واحد و رنگ‌ها. بعد از ذخیره پنجره باز می‌ماند و کاشی پشتش همان لحظه به‌روز می‌شود.
 */

// خط راست و پایین هر کاشی داخل خودش (inset)، تا ردیف آخرِ ناقص خالی بماند و جعبهٔ خاکستری نسازد
const KACHEL =
  'group flex h-full w-full flex-col items-start p-4 text-left shadow-[inset_-1px_-1px_0_0_var(--color-line)] transition-colors duration-[180ms] hover:bg-soft sm:p-5';

/** Zeile unter der LOT-Nummer; ein Ablaufdatum nur bei älteren Chargen, die noch eines haben */
function chargeDetails(c: ChargeZeile) {
  return [
    c.ablauf ? `${c.abgelaufen ? 'abgelaufen am' : 'bis'} ${isoDatumText(c.ablauf)}` : null,
    c.eingang ? `Eingang ${isoDatumText(c.eingang)}` : null,
    c.auftraege ? `${c.auftraege} ${c.auftraege === 1 ? 'Auftrag' : 'Aufträge'}` : null,
    c.bestand == null ? 'Bestand nicht erfasst' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Bestand je Farbe aus den offenen Chargen: Zahl, oder null wenn eine offene Charge nicht gezählt wird. */
function farbBestand(m: MaterialZeile, offen: ChargeZeile[]) {
  return m.farben.map((f) => {
    const cs = offen.filter((c) => c.farbe === f);
    const gezaehlt = cs.every((c) => c.bestand != null);
    return { farbe: f, da: cs.some((c) => c.bestand == null || c.bestand > 0), n: gezaehlt ? cs.reduce((s, c) => s + (c.bestand ?? 0), 0) : null };
  });
}

function FarbChips({ m, offen, gross = false }: { m: MaterialZeile; offen: ChargeZeile[]; gross?: boolean }) {
  if (!m.farben.length) return null;
  return (
    <span className={`flex flex-wrap gap-1.5 ${gross ? 'text-[13px]' : 'text-[12px]'}`}>
      {farbBestand(m, offen).map((f) => (
        <span
          key={f.farbe}
          title={f.da ? (f.n != null ? `${f.farbe}: ${mengeText(f.n, m.einheit)}` : `${f.farbe}: vorhanden`) : `${f.farbe}: nicht vorhanden`}
          className={`rounded-[4px] border px-1.5 py-px ${f.da ? 'border-line-strong text-white' : 'border-line text-muted line-through decoration-rose'}`}
        >
          {f.farbe}
          {f.da && f.n != null ? <span className="ml-1 text-muted">{` ${f.n}`}</span> : null}
          <span className="sr-only">{f.da ? ' vorhanden' : ' nicht vorhanden'}</span>
        </span>
      ))}
    </span>
  );
}


export function MaterialKachel({ m, chargen, stamm, heute }: { m: MaterialZeile; chargen: boolean; stamm: boolean; heute: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  const titel = `${m.hersteller} ${m.name}`;
  const offen = m.chargen.filter((c) => !c.aufgebraucht);
  const verbraucht = m.chargen.filter((c) => c.aufgebraucht);
  const gezaehlt = offen.filter((c) => c.bestand != null);
  // Flaschen: die offene Flasche zählt anteilig (Voll, ¾, ½, ¼); Kapseln ganz
  const vorrat = (c: ChargeZeile) => (m.einheit === 'flasche' ? flaschenStand(c.bestand ?? 0, c.fuellung) : (c.bestand ?? 0));
  const summe = gezaehlt.reduce((s, c) => s + vorrat(c), 0);
  const gekauft = gezaehlt.reduce((s, c) => s + Math.max(c.menge ?? 0, c.bestand ?? 0), 0);
  const abgelaufen = offen.filter((c) => c.abgelaufen).length;
  const marke = MARKE[herstellerFarbe(m.hersteller)].punkt;
  const chargenText = `${offen.length} ${offen.length === 1 ? 'Charge' : 'Chargen'}`;
  // ohne offene Charge ist das Lager leer; offene Chargen ohne Zählung (vor dem 24. Oktober 2026) zeigen keinen Balken
  const lager = gezaehlt.length || !offen.length ? lagerStand(summe, gekauft) : null;
  const farbe = lager ? LAGER_FARBE[lager.stufe] : null;
  return (
    <li aria-label={titel} className="min-w-0">
      <button type="button" onClick={() => fenster.current?.showModal()} className={KACHEL} aria-haspopup="dialog">
        <span className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          <span aria-hidden className={`size-2 rounded-full ${marke}`} />
          {m.hersteller}
        </span>
        <span className={`mt-1.5 text-[19px] font-light leading-tight group-hover:text-rose ${m.aktiv ? '' : 'text-muted'}`}>{m.name}</span>
        {m.fuerKeys.length ? <span className="mt-1 line-clamp-1 text-[13px] text-muted">{verwendung(m.fuerKeys, Object.fromEntries(m.fuerKeys.map((k, i) => [k, m.fuer[i]])))}</span> : null}
        <span className="mt-auto block w-full pt-5">
          {m.farben.length ? (
            <span className="mb-3 block">
              <FarbChips m={m} offen={offen} />
            </span>
          ) : null}
          {lager && farbe ? (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <span className={`whitespace-nowrap text-[30px] leading-none ${farbe.text}`}>
                  {zahlMitBruch(summe)}
                  <span className="text-[15px]">{` ${einheitWort(summe, m.einheit)}`}</span>
                </span>
                <span className="text-[12px] text-muted max-sm:hidden">{offen.length ? chargenText : 'Keine Charge'}</span>
              </span>
              {/* Lagerbalken: kürzer und röter, je näher am Ende (Anteil vom Gekauften) */}
              <span
                role="meter"
                aria-label="Lagerstand"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={lager.prozent}
                aria-valuetext={`${zahlMitBruch(summe)} ${einheitWort(summe, m.einheit)}, ${lager.prozent} Prozent`}
                className="mt-2.5 block h-1.5 w-full overflow-hidden rounded-full bg-line"
              >
                <span className={`block h-full rounded-full ${farbe.balken}`} style={{ width: `${lager.prozent}%` }} />
              </span>
            </>
          ) : (
            <span className="block text-[13px] text-muted">
              {chargenText} · Bestand nicht erfasst
            </span>
          )}
          {abgelaufen ? <span className="mt-2 block text-[12px] text-rose-light">{abgelaufen} abgelaufen</span> : null}
        </span>
      </button>

      <Fenster fenster={fenster} titel={titel}>
        <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          <span aria-hidden className={`size-2 rounded-full ${marke}`} />
          {m.hersteller}
        </p>
        <h2 className={`mt-1.5 pr-10 text-[30px] font-light leading-tight ${m.aktiv ? '' : 'text-muted'}`}>{m.name}</h2>
        <p className="mt-2 text-[13px] text-muted">
          {m.fuer.length ? `Für: ${m.fuer.join(', ')} · ` : ''}gezählt in {m.einheit === 'kapsel' ? 'Kapseln' : 'Flaschen'}
        </p>
        {m.farben.length ? (
          <div className="mt-4">
            <FarbChips m={m} offen={offen} gross />
          </div>
        ) : null}

        <section aria-label="Offene Chargen" className="mt-8">
          <h3 className="eyebrow">Offene Chargen</h3>
          {offen.length ? (
            <ul className="mt-3 border-t border-line">
              {offen.map((c) => (
                <li key={c.id} className="grid gap-x-6 gap-y-2 border-b border-line py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline">
                  <div className="min-w-0">
                    <p className="text-[16px]">
                      LOT {c.lotNo}
                      {c.farbe ? (
                        <>
                          {' '}
                          <span className="ml-1 rounded-[4px] border border-line-strong px-1.5 text-[13px]">{c.farbe}</span>
                        </>
                      ) : null}
                      {c.bestand != null ? (
                        <>
                          {' '}
                          <span className={`ml-2 text-[15px] ${c.bestand === 0 ? 'text-rose-light' : ''}`}>
                            {m.einheit === 'flasche' && c.fuellung ? `${zahlMitBruch(vorrat(c))} ${einheitWort(vorrat(c), 'flasche')}` : mengeText(c.bestand, m.einheit)}
                            {c.menge ? <span className="text-muted"> von {c.menge}</span> : null}
                          </span>
                        </>
                      ) : null}
                    </p>
                    <p className={`text-[13px] ${c.abgelaufen ? 'text-rose-light' : 'text-muted'}`}>{chargeDetails(c)}</p>
                  </div>
                  {chargen ? (
                    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 sm:justify-end">
                      <BestandKnoepfe id={c.id} lot={c.lotNo} einheit={m.einheit} bestand={c.bestand} />
                      <ChargeKnopf id={c.id} lot={c.lotNo} aufgebraucht={false} />
                    </div>
                  ) : null}
                  {chargen && m.einheit === 'flasche' && c.bestand ? (
                    <div className="sm:col-span-2">
                      <FuellungWahl id={c.id} lot={c.lotNo} fuellung={c.fuellung} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[15px] text-muted">Keine offene Charge.</p>
          )}
          <p className="mt-3 text-[13px] text-muted">
            {m.einheit === 'kapsel'
              ? 'Kapseln werden beim 3D-Druck eines Auftrags automatisch abgezogen.'
              : 'Bei der offenen Flasche wählen Sie, wie viel noch drin ist (Voll, ¾, ½, ¼). Ist sie leer: »Flasche leer«.'}
          </p>
        </section>

        {chargen && m.aktiv ? (
          <section aria-label="Neue Charge" className="mt-8">
            <h3 className="eyebrow">Neue Charge</h3>
            <ChargeFormular material={m.key} name={titel} heute={heute} einheit={m.einheit} farben={m.farben} />
          </section>
        ) : null}

        {verbraucht.length ? (
          <details className="mt-8">
            <summary className="cursor-pointer text-[13px] text-muted hover:text-white">Aufgebraucht ({verbraucht.length})</summary>
            <ul className="mt-2">
              {verbraucht.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-[13px] text-muted">
                  <span>
                    LOT {c.lotNo}
                    {c.farbe ? ` · ${c.farbe}` : ''}
                  </span>
                  <span>{c.auftraege ? `${c.auftraege} ${c.auftraege === 1 ? 'Auftrag' : 'Aufträge'}` : 'nicht verwendet'}</span>
                  {chargen ? <ChargeKnopf id={c.id} lot={c.lotNo} aufgebraucht /> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {stamm ? (
          <section aria-label="Einstellungen des Materials" className="mt-8 border-t border-line pt-6">
            <h3 className="eyebrow mb-4">Einstellungen</h3>
            <MaterialEinstellungen schluessel={m.key} name={titel} einheit={m.einheit} farben={m.farben} />
            <div className="mt-6">
              <MaterialKnopf schluessel={m.key} name={titel} aktiv={m.aktiv} />
            </div>
          </section>
        ) : null}
      </Fenster>
    </li>
  );
}

/** «+ Neues Material» (nur Stammdaten): Knopf oben auf der Seite, Formular im Fenster. */
export function NeuesMaterial({ behandlungen }: { behandlungen: { key: string; name: string }[] }) {
  const fenster = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => fenster.current?.showModal()} aria-haspopup="dialog">
        + Neues Material
      </Button>
      <Fenster fenster={fenster} titel="Neues Material">
        <section aria-label="Neues Material">
          <h2 className="mb-8 pr-10 text-[30px] font-light leading-tight">Neues Material</h2>
          <MaterialNeuFormular behandlungen={behandlungen} />
        </section>
      </Fenster>
    </>
  );
}
