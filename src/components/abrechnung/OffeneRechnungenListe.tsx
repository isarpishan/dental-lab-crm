'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { TabellenKopf } from './Kennzahlen';
import type { OffeneRechnung } from '@/lib/abrechnung/daten';
import { centEingabe, centText } from '@/lib/abrechnung/geld';
import type { Ergebnis } from '@/lib/aktion';
import { isoDatumText } from '@/lib/format';

type Aktion = (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
const SPALTEN = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_180px_130px_150px]';
const FELD = 'mt-1.5 w-full border border-line bg-transparent px-3 py-2.5 text-[15px] text-white outline-none transition-colors focus:border-rose';

/** «R-2026-0012»، «r 2026 0012» و «R20260012» یکی‌اند. */
const nurZeichen = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

function passt(r: OffeneRechnung, suche: string) {
  const roh = suche.trim().toLowerCase();
  if (!roh) return true;
  const q = nurZeichen(roh);
  return (q !== '' && (nurZeichen(r.nummer).includes(q) || nurZeichen(r.customerNo).includes(q))) || r.praxis.toLowerCase().includes(roh);
}

/**
 * تب «Offen» در «Abrechnung»: هر Rechnung باز یک ردیف. پول که در بانک آمد، شمارهٔ Verwendungszweck را در
 * جست‌وجو می‌نویسید و کنار همان ردیف «Zahlung buchen» را می‌زنید: تاریخ (امروز) و مبلغ (کل مبلغ باز) از
 * پیش پرند. Enter در جست‌وجو وقتی فقط یک ردیف مانده، همان را باز می‌کند. پیام موفقیت بالای فهرست است، چون
 * Rechnung پرداخت‌شده بعد از تازه شدن صفحه از فهرست بیرون می‌رود.
 */
export function OffeneRechnungenListe({ rechnungen, heute, buchen, darfBuchen }: { rechnungen: OffeneRechnung[]; heute: string; buchen: Aktion; darfBuchen: boolean }) {
  const [z, senden, laeuft] = useFormAktion(buchen, null);
  const [suche, setSuche] = useState('');
  const [offen, setOffen] = useState<string | null>(null);
  const [zuletzt, setZuletzt] = useState<string | null>(null);
  const suchfeld = useRef<HTMLInputElement>(null);
  const treffer = useMemo(() => rechnungen.filter((r) => passt(r, suche)), [rechnungen, suche]);

  // بعد از هر Buchung موفق: فرم بسته، جست‌وجو خالی، مکان‌نما در جست‌وجو برای Rechnung بعدی
  const [gesehen, setGesehen] = useState(z);
  if (z !== gesehen) {
    setGesehen(z);
    if (z?.erfolg) {
      setOffen(null);
      setSuche('');
    }
  }
  useEffect(() => {
    if (z?.erfolg) suchfeld.current?.focus();
  }, [z]);

  function oeffnen(id: string) {
    setOffen((jetzt) => (jetzt === id ? null : id));
  }

  function abschicken(id: string) {
    return (e: FormEvent<HTMLFormElement>) => {
      setZuletzt(id);
      senden(e);
    };
  }

  if (!rechnungen.length) return <p className="text-[15px] font-light text-muted">Keine offenen Rechnungen.</p>;

  return (
    <div>
      <div className="mb-6 grid max-w-[680px] gap-3 empty:hidden" aria-live="polite">
        {z?.erfolg ? <Meldung art="erfolg">{z.erfolg}</Meldung> : null}
      </div>

      <div className="mb-8 flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="block w-full max-w-[420px] text-[13px] text-muted">
          Rechnung suchen
          <input
            ref={suchfeld}
            type="search"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (darfBuchen && treffer.length === 1) setOffen(treffer[0].id);
              }
            }}
            placeholder="Rechnungsnummer oder Ordination"
            autoComplete="off"
            className={FELD}
          />
        </label>
        <p className="pb-3 text-[13px] text-muted">
          {suche.trim() ? `${treffer.length} von ${rechnungen.length}` : rechnungen.length} {rechnungen.length === 1 ? 'Rechnung' : 'Rechnungen'}
        </p>
      </div>

      {treffer.length ? (
        <>
          <TabellenKopf spalten={SPALTEN} namen={['Rechnung', 'Ordination', 'Fälligkeit', { text: 'Offen', rechts: true }, '']} />
          <ul aria-label="Offene Rechnungen" className="border-t border-line lg:border-t-0">
            {treffer.map((r) => {
              const istOffen = offen === r.id;
              const fehler = zuletzt === r.id && z?.fehler ? z.fehler : null;
              return (
                <li key={r.id} className="border-b border-line">
                  <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 py-4 ${SPALTEN}`}>
                    <div className="min-w-0">
                      <a href={`/api/rechnungen/${r.id}`} target="_blank" rel="noopener" className="text-[17px] font-light hover:text-rose">
                        {r.nummer}
                      </a>
                      <p className="text-[13px] text-muted">vom {isoDatumText(r.ausgestelltAm)}</p>
                    </div>
                    <div className="col-span-2 row-start-2 min-w-0 lg:col-span-1 lg:row-start-auto">
                      <Link href={`/abrechnung/${r.practiceId}`} className="block truncate text-[15px] font-light text-paragraph hover:text-rose">
                        {r.praxis}
                      </Link>
                      <p className="text-[13px] text-muted">
                        {r.customerNo}
                        <span className="lg:hidden">
                          {r.faelligAm ? ' · ' : ''}
                          {r.faelligAm ? <span className={r.ueberfaellig ? 'text-rose' : ''}>{r.ueberfaellig ? 'fällig seit' : 'fällig am'} {isoDatumText(r.faelligAm)}</span> : null}
                        </span>
                      </p>
                    </div>
                    <p className="hidden text-[13px] lg:block">
                      {r.faelligAm ? <span className={r.ueberfaellig ? 'text-rose' : 'text-paragraph'}>{r.ueberfaellig ? 'fällig seit' : 'fällig am'} {isoDatumText(r.faelligAm)}</span> : <span className="text-muted">–</span>}
                    </p>
                    <p className="col-start-2 row-start-1 text-right lg:col-start-auto lg:row-start-auto">
                      <span className="block text-[17px] font-light">{centText(r.offenCent)}</span>
                      {r.gezahltCent > 0 ? <span className="block text-[13px] text-muted">von {centText(r.summeCent)}</span> : null}
                    </p>
                    {darfBuchen ? (
                      <div className="col-span-2 row-start-3 pt-2 lg:col-span-1 lg:row-start-auto lg:pt-0 lg:text-right">
                        <Button variant="secondary" aria-expanded={istOffen} aria-controls={`buchen-${r.id}`} onClick={() => oeffnen(r.id)}>
                          {istOffen ? 'Schließen' : 'Zahlung buchen'}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  {darfBuchen && istOffen ? (
                    <form id={`buchen-${r.id}`} onSubmit={abschicken(r.id)} className="grid gap-4 pb-6 sm:grid-cols-[180px_160px_180px_auto] sm:items-end" aria-label={`Zahlung zu ${r.nummer} buchen`}>
                      <input type="hidden" name="rechnungId" value={r.id} />
                      <label className="block text-[13px] text-muted">
                        Eingegangen am
                        <input name="am" type="date" className={FELD} required defaultValue={heute} max={heute} autoFocus />
                      </label>
                      <label className="block text-[13px] text-muted">
                        Betrag (€)
                        <input name="betrag" className={FELD} required inputMode="decimal" defaultValue={centEingabe(r.offenCent)} />
                      </label>
                      <label className="block text-[13px] text-muted">
                        Zahlungsart
                        <select name="art" className={`${FELD} appearance-auto`} defaultValue="ueberweisung">
                          <option value="ueberweisung">Überweisung</option>
                          <option value="bar">Bar</option>
                          <option value="karte">Karte</option>
                          <option value="sonstige">Sonstige</option>
                        </select>
                      </label>
                      <div className="pb-0.5">
                        <Button type="submit" variant="secondary" disabled={laeuft}>
                          {laeuft ? 'Wird gebucht …' : 'Buchen'}
                        </Button>
                      </div>
                      {fehler ? (
                        <div className="sm:col-span-4">
                          <Meldung art="fehler">{fehler}</Meldung>
                        </div>
                      ) : null}
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="text-[15px] font-light text-muted">Keine offene Rechnung passt zu „{suche.trim()}“.</p>
      )}
    </div>
  );
}
