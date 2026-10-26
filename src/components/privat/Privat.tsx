'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { belegHochladen } from '@/components/finanzen/beleg-hochladen';
import { Button } from '@/components/ui/Button';
import { Fenster } from '@/components/ui/Fenster';
import { Auswahl, Feld, Textfeld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { privatEntfernen, privatSpeichern } from '@/app/intern/(app)/privat/actions';
import { centEingabe, centText } from '@/lib/abrechnung/geld';
import type { Ergebnis } from '@/lib/aktion';
import { BELEG_ANNEHMEN, monatTitel } from '@/lib/ausgaben/text';
import { isoDatumText } from '@/lib/format';
import type { PrivatZeile } from '@/lib/privat/buchungen';
import { kategorienFuer, PRIVAT_KATEGORIE_NAMEN, zaehltImErgebnis, type PrivatArt, type PrivatKategorie } from '@/lib/privat/text';

/**
 * «Privat» در مرورگر (Spec فاز ۵، قدم ۲): فرم (تازه، تغییر، و «Übernehmen» از «Zu prüfen») و فهرست ماه‌به‌ماه.
 * مثل «Ausgaben»، ولی ساده: یک مبلغ (بدون Netto و MwSt)، Ausgabe یا Einnahme، Beleg اختیاری.
 */

export type PrivatStart = {
  art?: PrivatArt;
  datum?: string;
  betragCent?: number;
  kategorie?: PrivatKategorie;
  haendler?: string;
  notiz?: string;
  /** Felder, die die KI nicht sicher gelesen hat (Namen wie bei den Ausgaben: brutto, rechnungsdatum, lieferant) */
  unsicher?: string[];
};

const UNSICHER = 'Unsicher gelesen. Bitte prüfen.';

/** «Ausgabe | Einnahme» als zwei Knöpfe (Radio), wie die Reiter. */
export function ArtWahl({ art, setArt }: { art: PrivatArt; setArt: (a: PrivatArt) => void }) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="mb-[9px] text-[15px]">Art</legend>
      <div className="flex w-fit gap-1 rounded-[12px] border border-panel-line bg-soft p-1">
        {(['ausgabe', 'einnahme'] as const).map((a) => (
          <label
            key={a}
            className={`inline-flex min-h-10 cursor-pointer items-center rounded-[8px] border px-4 text-[15px] transition-colors duration-[180ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-rose-light ${
              art === a ? 'border-rose bg-white/[0.07] text-white' : 'border-transparent text-nav hover:text-white'
            }`}
          >
            <input type="radio" name="art" value={a} checked={art === a} onChange={() => setArt(a)} className="sr-only" />
            {a === 'ausgabe' ? 'Ausgabe' : 'Einnahme'}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** `b`: Buchung ändern. `eingang`: Beleg aus »Zu prüfen« übernehmen (`start` = was die KI gelesen hat). Sonst neu. */
export function PrivatFormular({
  b,
  eingang,
  start,
  heute,
  onGespeichert,
}: {
  b?: PrivatZeile;
  eingang?: string;
  start?: PrivatStart;
  heute: string;
  onGespeichert?: () => void;
}) {
  const router = useRouter();
  const unsicher = new Set(start?.unsicher ?? []);
  const neuVonHand = !b && !eingang;
  const [art, setArt] = useState<PrivatArt>(b?.art ?? start?.art ?? 'ausgabe');
  const [zustand, setZustand] = useState<Ergebnis>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [schluessel, setSchluessel] = useState(0);
  const kategorie = b?.kategorie ?? start?.kategorie;

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const daten = new FormData(e.currentTarget);
    const datei = daten.get('beleg');
    daten.delete('beleg');
    setLaeuft('Wird gespeichert …');
    setZustand(null);
    try {
      const r = await privatSpeichern(null, daten);
      if (!r?.id) {
        setZustand(r);
        return;
      }
      let erfolg = r.erfolg ?? 'Gespeichert.';
      if (datei instanceof File && datei.size > 0) {
        setLaeuft('Beleg wird hochgeladen …');
        const fehler = await belegHochladen(`/api/privat/${r.id}/beleg`, datei);
        if (fehler) {
          setZustand({ fehler: `${erfolg} Aber: ${fehler} Sie können den Beleg in der Zeile nachreichen.` });
          router.refresh();
          if (neuVonHand) setSchluessel((k) => k + 1);
          return;
        }
        erfolg += ' Beleg gespeichert.';
      }
      setZustand({ erfolg });
      router.refresh();
      if (neuVonHand) {
        setSchluessel((k) => k + 1);
        setArt('ausgabe');
      }
      onGespeichert?.();
    } finally {
      setLaeuft(null);
    }
  }

  return (
    <form
      key={schluessel}
      onSubmit={absenden}
      aria-label={b ? 'Buchung ändern' : eingang ? 'Beleg übernehmen (Privat)' : 'Neue Buchung'}
      className="grid gap-5 sm:grid-cols-2 sm:items-start"
    >
      {b ? <input type="hidden" name="buchung" value={b.id} /> : null}
      {eingang ? <input type="hidden" name="eingang" value={eingang} /> : null}
      <ArtWahl art={art} setArt={setArt} />
      <Feld
        label="Datum"
        name="datum"
        type="date"
        required
        max={heute}
        defaultValue={b?.datum ?? start?.datum ?? (eingang ? '' : heute)}
        className={unsicher.has('rechnungsdatum') ? 'border-rose!' : ''}
        hinweis={unsicher.has('rechnungsdatum') ? UNSICHER : undefined}
      />
      <Feld
        label="Betrag (€)"
        name="betrag"
        inputMode="decimal"
        required
        autoComplete="off"
        defaultValue={centEingabe(b?.betragCent ?? start?.betragCent)}
        placeholder="z. B. 45,90"
        className={unsicher.has('brutto') ? 'border-rose!' : ''}
        hinweis={unsicher.has('brutto') ? UNSICHER : art === 'ausgabe' ? 'Gesamtbetrag, wie bezahlt.' : undefined}
      />
      <Auswahl
        // neue Art ← andere Kategorien: Feld neu aufbauen
        key={art}
        label="Kategorie"
        name="kategorie"
        required
        defaultValue={kategorie && kategorienFuer(art).includes(kategorie) ? kategorie : ''}
        optionen={[{ wert: '', label: 'Bitte wählen' }, ...kategorienFuer(art).map((k) => ({ wert: k, label: PRIVAT_KATEGORIE_NAMEN[k] }))]}
      />
      <Feld
        label={art === 'einnahme' ? 'Von' : 'Händler'}
        name="haendler"
        maxLength={120}
        autoComplete="off"
        defaultValue={b?.haendler ?? start?.haendler ?? ''}
        placeholder={art === 'einnahme' ? 'z. B. Arbeitgeber' : 'z. B. BILLA'}
        className={unsicher.has('lieferant') ? 'border-rose!' : ''}
        hinweis={unsicher.has('lieferant') ? UNSICHER : undefined}
      />
      <Textfeld label="Notiz" name="notiz" rows={2} maxLength={300} defaultValue={b?.notiz ?? start?.notiz ?? ''} placeholder="optional" />
      {b?.beleg || eingang ? null : (
        <label className="block text-[15px] sm:col-span-2">
          Beleg (optional, Foto oder PDF)
          <input
            type="file"
            name="beleg"
            accept={BELEG_ANNEHMEN}
            className="mt-[9px] block w-full text-[15px] text-muted file:mr-4 file:border file:border-rose file:bg-transparent file:px-3.5 file:py-[9px] file:text-[13px] file:text-white"
          />
        </label>
      )}
      <div className="space-y-4 sm:col-span-2">
        <Button type="submit" disabled={Boolean(laeuft)}>
          {laeuft ?? (b ? 'Änderungen speichern' : eingang ? 'Übernehmen' : 'Buchung speichern')}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function NeueBuchung({ heute }: { heute: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => fenster.current?.showModal()} aria-haspopup="dialog">
        + Neue Buchung
      </Button>
      <Fenster fenster={fenster} titel="Neue Buchung">
        <section aria-label="Neue Buchung">
          <h2 className="mb-8 pr-10 text-[30px] font-light leading-tight">Neue Buchung</h2>
          <PrivatFormular heute={heute} />
        </section>
      </Fenster>
    </>
  );
}

function Loeschen({ b, onGeloescht }: { b: PrivatZeile; onGeloescht: () => void }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await privatEntfernen(z, d);
    if (r?.erfolg) onGeloescht();
    return r;
  }, null);
  return (
    <details className="mt-10 border-t border-line pt-6">
      <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-white">Buchung löschen …</summary>
      <form onSubmit={aktion} className="mt-4 space-y-4">
        <input type="hidden" name="buchung" value={b.id} />
        <p className="text-[13px] text-muted">Die Buchung zählt dann nicht mehr.</p>
        <Button type="submit" variant="secondary" disabled={laeuft} aria-label={`Wirklich löschen: ${titelVon(b)}`}>
          Wirklich löschen
        </Button>
        <Rueckmeldung zustand={zustand} />
      </form>
    </details>
  );
}

const titelVon = (b: PrivatZeile) => b.haendler ?? PRIVAT_KATEGORIE_NAMEN[b.kategorie];
const betragZeichen = (b: PrivatZeile) => (b.art === 'einnahme' ? `+ ${centText(b.betragCent)}` : centText(b.betragCent));

function BelegAnsicht({ b }: { b: PrivatZeile }) {
  if (!b.beleg) return null;
  const url = `/api/privat/${b.id}/beleg`;
  return (
    <div className="mb-8">
      {/^image\/(jpeg|png|webp)$/.test(b.beleg.typ) ? (
        // eslint-disable-next-line @next/next/no-img-element -- Beleg aus der eigenen API, nicht optimierbar
        <img src={url} alt={`Beleg ${titelVon(b)}`} className="max-h-[320px] w-auto rounded-[8px] border border-line" />
      ) : null}
      <a href={url} target="_blank" rel="noopener" className="mt-3 inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
        Beleg öffnen ({b.beleg.name}) ↗
      </a>
    </div>
  );
}

const SPALTEN = 'lg:grid-cols-[84px_minmax(0,1.3fr)_minmax(0,1fr)_110px_40px]';

/** Buchungen nach Monat (neueste zuerst); ein Klick öffnet Formular und Beleg. `alle`: damit das Fenster nach dem Löschen offen bleibt. */
export function PrivatTabelle({ zeilen, alle, heute, leer }: { zeilen: PrivatZeile[]; alle: PrivatZeile[]; heute: string; leer: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  const [gewaehlt, setGewaehlt] = useState<PrivatZeile | null>(null);
  const b = gewaehlt ? (alle.find((z) => z.id === gewaehlt.id) ?? gewaehlt) : undefined;
  const monate = [...new Set(zeilen.map((z) => z.datum.slice(0, 7)))];

  return (
    <div className="max-w-[1040px]">
      {zeilen.length ? null : <p className="text-[15px] font-light text-muted">{leer}</p>}
      {zeilen.length ? (
        <div aria-hidden className={`hidden gap-x-6 border-b border-line pb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted lg:grid ${SPALTEN}`}>
          <span>Datum</span>
          <span>Händler / Von</span>
          <span>Kategorie</span>
          <span className="text-right">Betrag</span>
          <span className="text-right">Beleg</span>
        </div>
      ) : null}
      {monate.map((m) => {
        const imMonat = zeilen.filter((z) => z.datum.startsWith(m));
        // verliehenes Geld und Rückzahlungen stehen in der Liste, zählen aber nicht mit
        const aus = imMonat.filter((z) => z.art === 'ausgabe' && zaehltImErgebnis(z.kategorie)).reduce((s, z) => s + z.betragCent, 0);
        const ein = imMonat.filter((z) => z.art === 'einnahme' && zaehltImErgebnis(z.kategorie)).reduce((s, z) => s + z.betragCent, 0);
        return (
          <section key={m} aria-label={monatTitel(m)}>
            <h3 className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-line pb-2 pt-5 text-[13px] text-muted">
              <span className="text-[15px] text-white">{monatTitel(m)}</span>
              <span>
                {ein ? <span className="text-einnahme">+ {centText(ein)}</span> : null}
                {ein ? ' · ' : ''}
                {centText(aus)} ausgegeben
              </span>
            </h3>
            <ul aria-label={`Buchungen ${monatTitel(m)}`}>
              {imMonat.map((z) => (
                <li key={z.id} className="border-b border-line">
                  <button
                    type="button"
                    aria-haspopup="dialog"
                    onClick={() => {
                      setGewaehlt(z);
                      fenster.current?.showModal();
                    }}
                    className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 py-2.5 text-left ${SPALTEN}`}
                  >
                    <span className="hidden text-[13px] text-paragraph lg:block">{isoDatumText(z.datum)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] group-hover:text-rose">{titelVon(z)}</span>
                      <span className="block truncate text-[12px] text-muted">
                        <span className="lg:hidden">
                          {isoDatumText(z.datum)} · {PRIVAT_KATEGORIE_NAMEN[z.kategorie]}
                          {z.notiz || z.quelle === 'vorlage' ? ' · ' : ''}
                        </span>
                        {z.quelle === 'vorlage' ? <span className="text-paragraph">Fixkosten{z.notiz ? ' · ' : ''}</span> : null}
                        {z.notiz}
                      </span>
                    </span>
                    <span className="hidden truncate text-[13px] text-paragraph lg:block">{PRIVAT_KATEGORIE_NAMEN[z.kategorie]}</span>
                    <span className={`col-start-2 row-start-1 text-right text-[15px] tabular-nums lg:col-start-auto lg:row-start-auto ${z.art === 'einnahme' ? 'text-einnahme' : ''}`}>
                      {betragZeichen(z)}
                    </span>
                    <span className="hidden text-right text-[13px] text-muted lg:block">
                      {z.beleg ? (
                        <>
                          ✓<span className="sr-only"> Beleg vorhanden</span>
                        </>
                      ) : (
                        '–'
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Fenster fenster={fenster} titel={b ? `Buchung ${titelVon(b)}` : 'Buchung'}>
        {b ? (
          <section aria-label={`Buchung ${titelVon(b)}`} key={b.id}>
            <h2 className="pr-10 text-[30px] font-light leading-tight">{titelVon(b)}</h2>
            <p className="mb-6 mt-2 text-[13px] text-muted">
              <span className={b.art === 'einnahme' ? 'text-einnahme' : ''}>{betragZeichen(b)}</span> · {isoDatumText(b.datum)} · {PRIVAT_KATEGORIE_NAMEN[b.kategorie]}
            </p>
            <BelegAnsicht b={b} />
            <PrivatFormular b={b} heute={heute} />
            <Loeschen b={b} onGeloescht={() => setTimeout(() => fenster.current?.close(), 900)} />
          </section>
        ) : null}
      </Fenster>
    </div>
  );
}
