'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react';
import { TabellenKopf } from '@/components/abrechnung/Kennzahlen';
import { Button } from '@/components/ui/Button';
import { Fenster } from '@/components/ui/Fenster';
import { Auswahl, Feld, Textfeld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { centEingabe, centLesen, centText } from '@/lib/abrechnung/geld';
import type { Ergebnis } from '@/lib/aktion';
import type { AusgabeZeile } from '@/lib/ausgaben/ausgaben';
import type { EingangBereich, EingangZeile } from '@/lib/ausgaben/eingang';
import type { OffenerLauf } from '@/lib/fixkosten/vorlagen';
import { entwurfAus, type Entwurf } from '@/lib/ausgaben/entwurf';
import { afaPruefen, AUSGABE_KATEGORIEN, ausBrutto, BELEG_ANNEHMEN, istMwstSatz, KATEGORIE_NAMEN, monatTitel, mwstAusNetto } from '@/lib/ausgaben/text';
import { datum, isoDatumText } from '@/lib/format';
import { belegHochladen, senden, vorbereiten } from '@/components/finanzen/beleg-hochladen';
import { PrivatFormular } from '@/components/privat/Privat';
import { fixkostenUeberspringen } from '@/app/intern/(app)/fixkosten/actions';
import { ausgabeEntfernen, ausgabeSpeichern, eingangEntfernen, eingangNeuLesen } from './actions';

/**
 * «Ausgaben» im Browser: Formular (neu und ändern) mit Netto, MwSt-Satz und Brutto, die sich gegenseitig ausrechnen
 * (auf Kassabons steht oft nur der Bruttobetrag), und die Tabelle nach Monaten. Der Beleg geht nach dem Speichern
 * direkt an `api/ausgaben/[id]/beleg`; Fotos vom Handy werden vorher verkleinert (lange Seite 2400 px), damit sie
 * schnell hochgehen und trotzdem gut lesbar bleiben.
 */

const SPALTEN = 'lg:grid-cols-[84px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_96px_84px_104px_44px]';

type Satz = '20' | '13' | '10' | '0' | 'anders';
const SAETZE: { wert: Satz; label: string }[] = [
  { wert: '20', label: '20 %' },
  { wert: '13', label: '13 %' },
  { wert: '10', label: '10 %' },
  { wert: '0', label: '0 % (ohne MwSt)' },
  { wert: 'anders', label: 'Anderer Betrag (mehrere Sätze, Ausland)' },
];

const cent = (s: string) => {
  const r = centLesen(s);
  return r.ok ? r.wert : null;
};

/** Felder, die die KI nicht sicher gelesen hat: rot umrandet, mit Hinweis. */
const UNSICHER = 'Unsicher gelesen. Bitte prüfen.';
const markiert = (unsicher: Set<string> | undefined, feld: string) => (unsicher?.has(feld) ? 'border-rose!' : '');
const unsicherHinweis = (unsicher: Set<string> | undefined, feld: string, sonst?: string) => (unsicher?.has(feld) ? UNSICHER : sonst);

type Start = { nettoCent?: number; mwstCent?: number; bruttoCent?: number; mwstSatz?: number | null };

/** Netto, Satz, MwSt und Brutto: was zuletzt getippt wurde, bestimmt die anderen. */
function Betraege({ start, unsicher }: { start?: Start; unsicher?: Set<string> }) {
  const [netto, setNetto] = useState(centEingabe(start?.nettoCent));
  const [satz, setSatz] = useState<Satz>(start?.mwstSatz === undefined ? '20' : start.mwstSatz === null ? 'anders' : (String(start.mwstSatz) as Satz));
  const [mwst, setMwst] = useState(centEingabe(start?.mwstCent));
  const [brutto, setBrutto] = useState(centEingabe(start?.bruttoCent));

  const ausNetto = (n: string, s: Satz, m: string) => {
    const nc = cent(n);
    if (nc == null) return;
    const satzZahl = Number(s);
    const mc = s !== 'anders' && istMwstSatz(satzZahl) ? mwstAusNetto(nc, satzZahl) : (cent(m) ?? 0);
    if (s !== 'anders') setMwst(centEingabe(mc));
    setBrutto(centEingabe(nc + mc));
  };
  const ausBruttoFeld = (b: string, s: Satz, m: string) => {
    const bc = cent(b);
    if (bc == null) return;
    const satzZahl = Number(s);
    if (s !== 'anders' && istMwstSatz(satzZahl)) {
      const r = ausBrutto(bc, satzZahl);
      setNetto(centEingabe(r.nettoCent));
      setMwst(centEingabe(r.mwstCent));
    } else setNetto(centEingabe(bc - (cent(m) ?? 0)));
  };

  return (
    <div className="grid gap-5 sm:col-span-2 sm:grid-cols-2">
      <Feld
        label="Netto (€)"
        name="netto"
        inputMode="decimal"
        required
        autoComplete="off"
        value={netto}
        onChange={(e) => {
          setNetto(e.target.value);
          ausNetto(e.target.value, satz, mwst);
        }}
        placeholder="z. B. 120,50"
        className={markiert(unsicher, 'netto')}
        hinweis={unsicherHinweis(unsicher, 'netto')}
      />
      <Auswahl
        label="MwSt-Satz"
        name="satz"
        value={satz}
        onChange={(e) => {
          const s = e.target.value as Satz;
          setSatz(s);
          if (cent(netto) != null) ausNetto(netto, s, mwst);
          else ausBruttoFeld(brutto, s, mwst);
        }}
        optionen={SAETZE}
        className={markiert(unsicher, 'mwstSatz')}
      />
      <Feld
        label="MwSt (€)"
        name="mwst"
        inputMode="decimal"
        autoComplete="off"
        readOnly={satz !== 'anders'}
        required={satz === 'anders'}
        value={mwst}
        onChange={(e) => {
          setMwst(e.target.value);
          const nc = cent(netto);
          const mc = cent(e.target.value);
          if (nc != null && mc != null) setBrutto(centEingabe(nc + mc));
        }}
        hinweis={unsicherHinweis(unsicher, 'mwst', satz === 'anders' ? 'Gesamte MwSt laut Rechnung.' : 'Wird aus dem Satz berechnet.')}
        className={`${satz === 'anders' ? '' : 'text-muted'} ${markiert(unsicher, 'mwst')}`}
      />
      <Feld
        label="Brutto (€)"
        name="brutto"
        inputMode="decimal"
        autoComplete="off"
        value={brutto}
        onChange={(e) => {
          setBrutto(e.target.value);
          ausBruttoFeld(e.target.value, satz, mwst);
        }}
        hinweis={unsicherHinweis(unsicher, 'brutto', 'Steht nur der Gesamtbetrag auf dem Beleg, hier eintragen; Netto und MwSt rechnen sich aus.')}
        className={markiert(unsicher, 'brutto')}
      />
    </div>
  );
}

/**
 * `a`: Ausgabe ändern. `eingang` + `entwurf`: Beleg aus »Zu prüfen« übernehmen (vorbefüllt mit dem, was die KI gelesen
 * hat; der Beleg ist schon da). Sonst: neue Ausgabe von Hand.
 */
function AusgabeFormular({
  a,
  eingang,
  lauf,
  umsatz,
  entwurf,
  heute,
  onGespeichert,
}: {
  a?: AusgabeZeile;
  eingang?: string;
  /** aus »Fixkosten« (Spec فاز ۵، قدم ۳): vorbefüllt, der Beleg kann gleich mit */
  lauf?: string;
  /** aus »Bank« (Spec فاز ۵، قدم ۴): Bankzeile, die danach mit der neuen Ausgabe verbunden wird */
  umsatz?: string;
  entwurf?: Entwurf;
  heute: string;
  onGespeichert?: () => void;
}) {
  const unsicher = entwurf ? new Set(entwurf.unsicher) : undefined;
  const neuVonHand = !a && !eingang && !lauf && !umsatz;
  const router = useRouter();
  const [zustand, setZustand] = useState<Ergebnis>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [schluessel, setSchluessel] = useState(0);

  async function absenden(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const daten = new FormData(form);
    const datei = daten.get('beleg');
    daten.delete('beleg');
    setLaeuft('Wird gespeichert …');
    setZustand(null);
    try {
      const r = await ausgabeSpeichern(null, daten);
      if (!r?.id) {
        setZustand(r);
        return;
      }
      let erfolg = r.erfolg ?? 'Gespeichert.';
      if (datei instanceof File && datei.size > 0) {
        setLaeuft('Beleg wird hochgeladen …');
        const fehler = await belegHochladen(`/api/ausgaben/${r.id}/beleg`, datei);
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
      if (neuVonHand) setSchluessel((k) => k + 1);
      onGespeichert?.();
    } finally {
      setLaeuft(null);
    }
  }

  return (
    <form
      key={schluessel}
      onSubmit={absenden}
      aria-label={a ? `Ausgabe ändern: ${a.lieferant}` : eingang ? 'Beleg übernehmen' : lauf ? 'Fixkosten übernehmen' : umsatz ? 'Ausgabe aus Bankzeile' : 'Neue Ausgabe'}
      className="grid gap-5 sm:grid-cols-2 sm:items-start"
    >
      {a ? <input type="hidden" name="ausgabe" value={a.id} /> : null}
      {eingang ? <input type="hidden" name="eingang" value={eingang} /> : null}
      {lauf ? <input type="hidden" name="lauf" value={lauf} /> : null}
      {umsatz ? <input type="hidden" name="umsatz" value={umsatz} /> : null}
      <Feld
        label="Rechnungsdatum"
        name="rechnungsdatum"
        type="date"
        required
        max={heute}
        defaultValue={a?.rechnungsdatum ?? (entwurf ? (entwurf.rechnungsdatum ?? '') : heute)}
        className={markiert(unsicher, 'rechnungsdatum')}
        hinweis={unsicherHinweis(unsicher, 'rechnungsdatum')}
      />
      <Feld
        label="Bezahlt am"
        name="bezahltAm"
        type="date"
        max={heute}
        defaultValue={a && a.bezahltAm !== a.rechnungsdatum ? a.bezahltAm : ''}
        hinweis="Leer lassen, wenn am Rechnungsdatum bezahlt. Zählt für Monat und Jahr."
      />
      <Feld
        label="Lieferant"
        name="lieferant"
        required
        maxLength={120}
        autoComplete="off"
        defaultValue={a?.lieferant ?? entwurf?.lieferant}
        placeholder="z. B. SprintRay Europe GmbH"
        className={markiert(unsicher, 'lieferant')}
        hinweis={unsicherHinweis(unsicher, 'lieferant')}
      />
      <Feld
        label="Rechnungsnummer"
        name="rechnungsnummer"
        maxLength={60}
        autoComplete="off"
        defaultValue={a?.rechnungsnummer ?? entwurf?.rechnungsnummer ?? ''}
        hinweis={unsicherHinweis(unsicher, 'rechnungsnummer', 'Auf Kassabons bis € 400 fehlt sie oft; dann leer lassen.')}
        className={markiert(unsicher, 'rechnungsnummer')}
      />
      <Auswahl
        label="Kategorie"
        name="kategorie"
        required
        defaultValue={a?.kategorie ?? entwurf?.kategorie ?? ''}
        className={markiert(unsicher, 'kategorie')}
        optionen={[{ wert: '', label: 'Bitte wählen' }, ...AUSGABE_KATEGORIEN.map((k) => ({ wert: k, label: KATEGORIE_NAMEN[k] }))]}
      />
      <Textfeld label="Wofür?" name="beschreibung" rows={2} maxLength={300} defaultValue={a?.beschreibung ?? entwurf?.beschreibung ?? ''} placeholder="z. B. 2 Flaschen Crown HT A2" />
      <Betraege start={a ?? entwurf} unsicher={unsicher} />
      {a?.beleg || eingang ? null : (
        <label className="block text-[15px] sm:col-span-2">
          Beleg (Foto oder PDF)
          <input
            type="file"
            name="beleg"
            accept={BELEG_ANNEHMEN}
            className="mt-[9px] block w-full text-[15px] text-muted file:mr-4 file:border file:border-rose file:bg-transparent file:px-3.5 file:py-[9px] file:text-[13px] file:text-white"
          />
          <span className="mt-2 block text-[13px] text-muted">
            Am Handy öffnet sich die Kamera oder die Fotos. Wird 7 Jahre aufbewahrt und kann danach nicht mehr ersetzt werden.
          </span>
        </label>
      )}
      <div className="space-y-4 sm:col-span-2">
        <Button type="submit" disabled={Boolean(laeuft)}>
          {laeuft ?? (a ? 'Änderungen speichern' : eingang || lauf ? 'Übernehmen' : umsatz ? 'Ausgabe erfassen und verbinden' : 'Ausgabe speichern')}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function NeueAusgabe({ heute }: { heute: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => fenster.current?.showModal()} aria-haspopup="dialog">
        + Neue Ausgabe
      </Button>
      <Fenster fenster={fenster} titel="Neue Ausgabe">
        <section aria-label="Neue Ausgabe">
          <h2 className="mb-8 pr-10 text-[30px] font-light leading-tight">Neue Ausgabe</h2>
          <AusgabeFormular heute={heute} />
        </section>
      </Fenster>
    </>
  );
}

function Loeschen({ a, onGeloescht }: { a: AusgabeZeile; onGeloescht: () => void }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await ausgabeEntfernen(z, d);
    if (r?.erfolg) onGeloescht();
    return r;
  }, null);
  return (
    <details className="mt-10 border-t border-line pt-6">
      <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-white">Ausgabe löschen …</summary>
      <form onSubmit={aktion} className="mt-4 space-y-4">
        <input type="hidden" name="ausgabe" value={a.id} />
        <p className="text-[13px] text-muted">Die Ausgabe zählt dann nicht mehr. {a.beleg ? 'Der Beleg bleibt aufbewahrt.' : ''}</p>
        <Button type="submit" variant="secondary" disabled={laeuft} aria-label={`Wirklich löschen: ${a.lieferant}`}>
          Wirklich löschen
        </Button>
        <Rueckmeldung zustand={zustand} />
      </form>
    </details>
  );
}

function BelegAnsicht({ a }: { a: AusgabeZeile }) {
  if (!a.beleg) return <p className="mb-6 text-[13px] text-rose">Beleg fehlt. Unten ein Foto oder PDF wählen.</p>;
  const url = `/api/ausgaben/${a.id}/beleg`;
  return (
    <div className="mb-8">
      {/^image\/(jpeg|png|webp)$/.test(a.beleg.typ) ? (
        // eslint-disable-next-line @next/next/no-img-element -- Beleg aus der eigenen API, nicht optimierbar
        <img src={url} alt={`Beleg ${a.lieferant}`} className="max-h-[320px] w-auto rounded-[8px] border border-line" />
      ) : null}
      <a href={url} target="_blank" rel="noopener" className="mt-3 inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
        Beleg öffnen ({a.beleg.name}) ↗
      </a>
    </div>
  );
}

/**
 * `alle`: alle Ausgaben, damit das Fenster offen bleibt, auch wenn die Zeile nach dem Speichern aus der Liste fällt
 * (»Ohne Beleg« nach dem Nachreichen, oder nach dem Löschen: dann bleibt der letzte Stand sichtbar, bis es schließt).
 */
export function AusgabenTabelle({ zeilen, alle, heute, leer }: { zeilen: AusgabeZeile[]; alle: AusgabeZeile[]; heute: string; leer: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  const [gewaehlt, setGewaehlt] = useState<AusgabeZeile | null>(null);
  const a = gewaehlt ? (alle.find((z) => z.id === gewaehlt.id) ?? gewaehlt) : undefined;
  const monate = [...new Set(zeilen.map((z) => z.bezahltAm.slice(0, 7)))];

  return (
    <div className="max-w-[1200px]">
      {zeilen.length ? null : <p className="text-[15px] font-light text-muted">{leer}</p>}
      {zeilen.length ? (
        <TabellenKopf
          spalten={SPALTEN}
          namen={[
            'Bezahlt',
            'Lieferant',
            'Kategorie',
            'Rechnungs-Nr.',
            { text: 'Netto', rechts: true },
            { text: 'MwSt', rechts: true },
            { text: 'Brutto', rechts: true },
            { text: 'Beleg', rechts: true },
          ]}
        />
      ) : null}
      {monate.map((m) => {
        const imMonat = zeilen.filter((z) => z.bezahltAm.startsWith(m));
        return (
          <section key={m} aria-label={monatTitel(m)}>
            <h3 className="flex items-baseline justify-between border-b border-line pb-2 pt-5 text-[13px] text-muted">
              <span className="text-[15px] text-white">{monatTitel(m)}</span>
              <span>{centText(imMonat.reduce((s, z) => s + z.bruttoCent, 0))}</span>
            </h3>
            <ul aria-label={`Ausgaben ${monatTitel(m)}`}>
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
                    <span className="hidden text-[13px] text-paragraph lg:block">{isoDatumText(z.bezahltAm)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] group-hover:text-rose">{z.lieferant}</span>
                      <span className="block truncate text-[13px] text-muted">
                        <span className="lg:hidden">
                          {isoDatumText(z.bezahltAm)}
                          {z.beleg ? null : <span className="text-rose"> · Beleg fehlt</span>} · {KATEGORIE_NAMEN[z.kategorie]}
                          {z.rechnungsnummer ? ` · Nr. ${z.rechnungsnummer}` : ''}
                          {z.beschreibung ? ' · ' : ''}
                        </span>
                        {z.beschreibung}
                      </span>
                    </span>
                    <span className="hidden truncate text-[13px] text-paragraph lg:block">{KATEGORIE_NAMEN[z.kategorie]}</span>
                    <span className="hidden truncate text-[13px] text-paragraph lg:block">{z.rechnungsnummer ?? <span className="text-muted">–</span>}</span>
                    <span className="hidden text-right text-[14px] font-light tabular-nums lg:block">{centText(z.nettoCent)}</span>
                    <span className="hidden text-right text-[13px] text-muted lg:block">
                      {centText(z.mwstCent)}
                      <span className="block text-[11px]">{z.mwstSatz == null ? 'gemischt' : `${z.mwstSatz} %`}</span>
                    </span>
                    <span className="col-start-2 row-start-1 text-right text-[15px] tabular-nums lg:col-start-auto lg:row-start-auto">
                      {centText(z.bruttoCent)}
                      {afaPruefen(z) ? <span className="block text-[11px] text-rose">AfA prüfen</span> : null}
                    </span>
                    <span className="hidden text-right text-[13px] lg:block">
                      {z.beleg ? (
                        <span className="text-muted">
                          ✓<span className="sr-only"> Beleg vorhanden</span>
                        </span>
                      ) : (
                        <span className="text-rose">fehlt</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <Fenster fenster={fenster} titel={a ? `Ausgabe ${a.lieferant}` : 'Ausgabe'}>
        {a ? (
          <section aria-label={`Ausgabe ${a.lieferant}`} key={a.id}>
            <h2 className="pr-10 text-[30px] font-light leading-tight">{a.lieferant}</h2>
            <p className="mb-6 mt-2 text-[13px] text-muted">
              {centText(a.bruttoCent)} brutto · bezahlt am {isoDatumText(a.bezahltAm)} · erfasst von {a.erfasstVonLabel}
            </p>
            <BelegAnsicht a={a} />
            <AusgabeFormular a={a} heute={heute} />
            <Loeschen a={a} onGeloescht={() => setTimeout(() => fenster.current?.close(), 900)} />
          </section>
        ) : null}
      </Fenster>
    </div>
  );
}

// ════════════════ «Zu prüfen»: Belege hochladen, von der KI lesen lassen, prüfen und übernehmen ════════════════

type Hochgeladen = { name: string; stand: 'wartet' | 'laeuft' | 'gelesen' | 'fehler'; text?: string };

const betragText = (betrag: number | null | undefined, waehrung: string | null | undefined) => {
  if (betrag == null) return null;
  const w = (waehrung ?? 'EUR').toUpperCase();
  return w === 'EUR' ? centText(Math.round(betrag * 100)) : `${betrag.toLocaleString('de-AT', { minimumFractionDigits: 2 })} ${w}`;
};

/**
 * «Beleg hochladen»: ein oder mehrere Fotos oder PDFs (am Handy Kamera oder Fotos, am Computer auch per Ziehen auf
 * die Seite). Jeder Beleg geht einzeln an `api/ausgaben/eingang`, wo Claude ihn gleich liest; danach steht er unter
 * »Zu prüfen«. Noch keine Ausgabe: gespeichert wird erst mit »Übernehmen«.
 */
export function BelegeHochladen({ kiAktiv, bereich = 'ddl' }: { kiAktiv: boolean; bereich?: EingangBereich }) {
  const router = useRouter();
  const eingabe = useRef<HTMLInputElement>(null);
  const [liste, setListe] = useState<Hochgeladen[]>([]);
  const [ziehen, setZiehen] = useState(false);
  const laeuft = liste.some((x) => x.stand === 'wartet' || x.stand === 'laeuft');

  async function hochladen(dateien: File[]) {
    if (!dateien.length || laeuft) return;
    const stand: Hochgeladen[] = dateien.map((d) => ({ name: d.name, stand: 'wartet' }));
    const setze = (i: number, x: Partial<Hochgeladen>) => {
      stand[i] = { ...stand[i], ...x };
      setListe([...stand]);
    };
    setListe([...stand]);
    for (const [i, datei] of dateien.entries()) {
      setze(i, { stand: 'laeuft', text: kiAktiv ? 'wird hochgeladen und gelesen …' : 'wird hochgeladen …' });
      const d = await vorbereiten(datei);
      if ('fehler' in d) {
        setze(i, { stand: 'fehler', text: d.fehler });
        continue;
      }
      try {
        const r = await senden(bereich === 'privat' ? '/api/ausgaben/eingang?bereich=privat' : '/api/ausgaben/eingang', d);
        const j = (await r.json().catch(() => null)) as { fehler?: string | null; status?: string; lieferant?: string | null; brutto?: number | null; waehrung?: string | null } | null;
        if (!r.ok) setze(i, { stand: 'fehler', text: j?.fehler ?? 'Der Beleg konnte nicht hochgeladen werden.' });
        else if (j?.status === 'gelesen') {
          const was = [j.lieferant, betragText(j.brutto, j.waehrung)].filter(Boolean).join(', ');
          setze(i, { stand: 'gelesen', text: j.fehler ?? (was ? `gelesen: ${was}` : 'gelesen') });
        }
        else setze(i, { stand: 'gelesen', text: kiAktiv ? 'hochgeladen, nicht gelesen. Bitte von Hand eintragen.' : 'hochgeladen. Bitte die Angaben von Hand eintragen.' });
      } catch {
        setze(i, { stand: 'fehler', text: 'Keine Verbindung. Nicht hochgeladen.' });
      }
      router.refresh();
    }
    router.push('?tab=pruefen', { scroll: false });
  }

  // Dateien auf die Seite ziehen (Computer): nicht in einem offenen Fenster, dort gilt das jeweilige Dateifeld
  const ablegen = useEffectEvent((dateien: File[]) => void hochladen(dateien));
  useEffect(() => {
    let tiefe = 0;
    const mitDateien = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files')) && !(e.target instanceof Element && e.target.closest('dialog'));
    const rein = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      e.preventDefault();
      tiefe++;
      setZiehen(true);
    };
    const raus = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      tiefe = Math.max(0, tiefe - 1);
      if (!tiefe) setZiehen(false);
    };
    const ueber = (e: DragEvent) => {
      if (mitDateien(e)) e.preventDefault();
    };
    const ab = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      e.preventDefault();
      tiefe = 0;
      setZiehen(false);
      ablegen([...(e.dataTransfer?.files ?? [])]);
    };
    document.addEventListener('dragenter', rein);
    document.addEventListener('dragleave', raus);
    document.addEventListener('dragover', ueber);
    document.addEventListener('drop', ab);
    return () => {
      document.removeEventListener('dragenter', rein);
      document.removeEventListener('dragleave', raus);
      document.removeEventListener('dragover', ueber);
      document.removeEventListener('drop', ab);
    };
  }, []);

  return (
    <>
      <Button onClick={() => eingabe.current?.click()} disabled={laeuft}>
        {laeuft ? 'Belege werden gelesen …' : 'Beleg hochladen'}
      </Button>
      <input
        ref={eingabe}
        type="file"
        multiple
        accept={BELEG_ANNEHMEN}
        aria-label="Belege wählen (Foto oder PDF)"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const dateien = [...(e.target.files ?? [])];
          e.target.value = '';
          void hochladen(dateien);
        }}
      />
      {liste.length ? (
        <ul aria-label="Hochgeladene Belege" aria-live="polite" className="order-last max-w-[680px] basis-full space-y-1 text-[13px]">
          {liste.map((x, i) => (
            <li key={i} className={x.stand === 'fehler' ? 'text-rose' : 'text-muted'}>
              <span className={x.stand === 'fehler' ? '' : 'text-white'}>{x.name}</span> · {x.stand === 'wartet' ? 'wartet …' : x.text}
            </li>
          ))}
        </ul>
      ) : null}
      {ziehen ? (
        <div aria-hidden className="pointer-events-none fixed inset-4 z-50 grid place-items-center rounded-[12px] border border-rose bg-black/85">
          <span className="text-[clamp(22px,2.4vw,30px)] font-light">Belege hier ablegen</span>
        </div>
      ) : null}
    </>
  );
}

function EingangBeleg({ e }: { e: EingangZeile }) {
  const url = `/api/ausgaben/eingang/${e.id}`;
  const bild = /^image\/(jpeg|png|webp|gif)$/.test(e.typ);
  return (
    <div>
      {bild ? (
        // eslint-disable-next-line @next/next/no-img-element -- Beleg aus der eigenen API, nicht optimierbar
        <img src={url} alt={`Beleg ${e.name}`} className="max-h-[260px] w-auto rounded-[8px] border border-line lg:max-h-[68vh]" />
      ) : e.typ === 'application/pdf' ? (
        <iframe src={url} title={`Beleg ${e.name}`} className="hidden h-[68vh] w-full rounded-[8px] border border-line bg-white lg:block" />
      ) : null}
      <a href={url} target="_blank" rel="noopener" className="mt-3 inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
        Beleg öffnen ({e.name}) ↗
      </a>
    </div>
  );
}

function NeuLesen({ e }: { e: EingangZeile }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(eingangNeuLesen, null);
  return (
    <form onSubmit={aktion} className="space-y-3">
      <input type="hidden" name="eingang" value={e.id} />
      <Button type="submit" variant="secondary" disabled={laeuft}>
        {laeuft ? 'Wird gelesen …' : 'Erneut lesen lassen'}
      </Button>
      <Rueckmeldung zustand={zustand} />
    </form>
  );
}

function Verwerfen({ e, onVerworfen }: { e: EingangZeile; onVerworfen: () => void }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await eingangEntfernen(z, d);
    if (r?.erfolg) onVerworfen();
    return r;
  }, null);
  return (
    <details className="border-t border-line pt-6">
      <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-white">Beleg verwerfen …</summary>
      <form onSubmit={aktion} className="mt-4 space-y-4">
        <input type="hidden" name="eingang" value={e.id} />
        <p className="text-[13px] text-muted">Zum Beispiel, wenn es keine Rechnung ist oder sie doppelt hochgeladen wurde. Datei und Eintrag werden gelöscht.</p>
        <Button type="submit" variant="secondary" disabled={laeuft} aria-label={`Wirklich verwerfen: ${e.name}`}>
          Wirklich verwerfen
        </Button>
        <Rueckmeldung zustand={zustand} />
      </form>
    </details>
  );
}

const SPALTEN_EINGANG = 'lg:grid-cols-[92px_minmax(0,1.7fr)_minmax(0,1fr)_112px]';

/**
 * Formular im Fenster »Zu prüfen«: oben »DDL-Labor | Privat« (Spec فاز ۵، قدم ۲). Vorgewählt ist der Bereich des Belegs
 * (beim Hochladen gewählt oder von der KI vorgeschlagen); je nach Wahl wird er eine Ausgabe des Labors oder eine
 * Privat-Buchung. Der Zustand gehört zum Beleg (Schlüssel im Fenster), also neu für jeden Beleg.
 */
function PruefFormular({ e, entwurf, heute, onGespeichert }: { e: EingangZeile; entwurf?: Entwurf; heute: string; onGespeichert: () => void }) {
  const [bereich, setBereich] = useState<EingangBereich>(e.bereich);
  const knopf = (b: EingangBereich, text: string) => (
    <button
      type="button"
      aria-pressed={bereich === b}
      onClick={() => setBereich(b)}
      className={`inline-flex min-h-10 items-center rounded-[8px] border px-4 text-[15px] transition-colors duration-[180ms] ${
        bereich === b ? 'border-rose bg-white/[0.07] text-white' : 'border-transparent text-nav hover:text-white'
      }`}
    >
      {text}
    </button>
  );
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-[9px] text-[15px]" id={`bereich-${e.id}`}>
          Gehört zu
        </p>
        <div role="group" aria-labelledby={`bereich-${e.id}`} className="flex w-fit gap-1 rounded-[12px] border border-panel-line bg-soft p-1">
          {knopf('ddl', 'DDL-Labor')}
          {knopf('privat', 'Privat')}
        </div>
        {entwurf?.bereich && entwurf.bereich !== bereich ? (
          <p className="mt-2 text-[13px] text-muted">Die KI hätte {entwurf.bereich === 'privat' ? '»Privat«' : '»DDL-Labor«'} gewählt.</p>
        ) : null}
      </div>
      {bereich === 'privat' ? (
        <PrivatFormular
          eingang={e.id}
          heute={heute}
          onGespeichert={onGespeichert}
          start={{
            art: 'ausgabe',
            datum: entwurf?.rechnungsdatum,
            betragCent: entwurf?.bruttoCent,
            kategorie: entwurf?.privatKategorie,
            haendler: entwurf?.lieferant,
            notiz: entwurf?.beschreibung,
            unsicher: entwurf?.unsicher,
          }}
        />
      ) : (
        <AusgabeFormular eingang={e.id} entwurf={entwurf ?? { unsicher: [], hinweise: [] }} heute={heute} onGespeichert={onGespeichert} />
      )}
    </div>
  );
}

/** `zeilen`: alles unter »Zu prüfen« dieses Bereichs, neueste zuerst. Ein Klick öffnet Beleg und vorbefülltes Formular nebeneinander. */
export function ZuPruefen({ zeilen, heute, kiAktiv }: { zeilen: EingangZeile[]; heute: string; kiAktiv: boolean }) {
  const fenster = useRef<HTMLDialogElement>(null);
  const [gewaehlt, setGewaehlt] = useState<EingangZeile | null>(null);
  // immer den neuesten Stand merken (z. B. nach »Erneut lesen«): nach »Übernehmen« oder »Verwerfen« ist die Zeile weg,
  // und das Fenster zeigt bis zum Schließen diesen letzten Stand, ohne das Formular neu aufzubauen
  const aktuell = gewaehlt ? zeilen.find((z) => z.id === gewaehlt.id) : undefined;
  if (aktuell && aktuell !== gewaehlt) setGewaehlt(aktuell);
  const e = aktuell ?? gewaehlt ?? undefined;
  const entwurf = e?.vorschlag ? entwurfAus(e.vorschlag, heute) : undefined;
  const schliessen = () => setTimeout(() => fenster.current?.close(), 900);

  return (
    <>
      {kiAktiv ? null : (
        <p className="mb-6 max-w-[680px] text-[13px] text-rose">
          Automatisches Lesen ist aus. Unter{' '}
          <Link href="/einstellungen/ki" className="border-b border-current">
            Einstellungen → KI
          </Link>{' '}
          den Schlüssel von Anthropic eintragen; bis dahin die Angaben hier von Hand eintragen.
        </p>
      )}
      {zeilen.length ? (
        <TabellenKopf spalten={SPALTEN_EINGANG} namen={['Hochgeladen', 'Lieferant', 'Stand', { text: 'Brutto', rechts: true }]} />
      ) : (
        <p className="text-[15px] font-light text-muted">Nichts zu prüfen. Neue Belege mit »Beleg hochladen« oder einfach auf die Seite ziehen.</p>
      )}
      <ul aria-label="Belege zu prüfen">
        {zeilen.map((z) => {
          const stand =
            z.status !== 'gelesen' ? (
              <span className="text-rose">nicht gelesen</span>
            ) : z.schonErfasst ? (
              <span className="text-rose">schon erfasst?</span>
            ) : z.fehler ? (
              <span className="text-rose">bitte prüfen</span>
            ) : (
              <span>gelesen, bitte bestätigen</span>
            );
          return (
            <li key={z.id} className="border-b border-line">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setGewaehlt(z);
                  fenster.current?.showModal();
                }}
                className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 py-2.5 text-left ${SPALTEN_EINGANG}`}
              >
                <span className="hidden text-[13px] text-paragraph lg:block">{datum(z.hochgeladenAm)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] group-hover:text-rose">{z.vorschlag?.lieferant ?? z.name}</span>
                  <span className="block truncate text-[13px] text-muted">
                    <span className="lg:hidden">
                      {stand} · {datum(z.hochgeladenAm)} ·{' '}
                    </span>
                    {z.vorschlag?.lieferant ? z.name : z.typ === 'application/pdf' ? 'PDF' : 'Foto'}
                    {z.vorschlag?.rechnungsnummer ? ` · Nr. ${z.vorschlag.rechnungsnummer}` : ''}
                  </span>
                </span>
                <span className="hidden truncate text-[13px] text-paragraph lg:block">{stand}</span>
                <span className="col-start-2 row-start-1 text-right text-[15px] tabular-nums lg:col-start-auto lg:row-start-auto">
                  {betragText(z.vorschlag?.brutto, z.vorschlag?.waehrung) ?? <span className="text-muted">–</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Fenster fenster={fenster} titel={e ? `Beleg prüfen: ${e.name}` : 'Beleg prüfen'} breit>
        {e ? (
          <section aria-label={`Beleg prüfen: ${e.name}`} key={`${e.id}-${e.gelesenAm ? new Date(e.gelesenAm).getTime() : 0}`}>
            <h2 className="pr-10 text-[30px] font-light leading-tight">{e.vorschlag?.lieferant ?? 'Beleg prüfen'}</h2>
            <p className="mb-6 mt-2 text-[13px] text-muted">
              {e.name} · hochgeladen am {datum(e.hochgeladenAm)}
            </p>
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <div className="self-start lg:sticky lg:top-0">
                <EingangBeleg e={e} />
              </div>
              <div className="min-w-0 space-y-8">
                {e.fehler || e.schonErfasst || entwurf?.hinweise.length || entwurf?.unsicher.length ? (
                  <ul className="space-y-2 text-[13px]">
                    {e.fehler ? <li className="text-rose">{e.fehler}</li> : null}
                    {e.schonErfasst ? <li className="text-rose">Diese Rechnung scheint schon erfasst: {e.schonErfasst}. Dann bitte verwerfen.</li> : null}
                    {entwurf?.hinweise.map((h) => (
                      <li key={h} className="text-rose">
                        {h}
                      </li>
                    ))}
                    {entwurf?.unsicher.length ? <li className="text-muted">Rot umrandete Felder hat die KI nicht sicher gelesen.</li> : null}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">Von der KI gelesen. Bitte mit dem Beleg vergleichen und übernehmen.</p>
                )}
                <PruefFormular e={e} entwurf={entwurf} heute={heute} onGespeichert={schliessen} />
                {kiAktiv ? <NeuLesen e={e} /> : null}
                <Verwerfen e={e} onVerworfen={schliessen} />
              </div>
            </div>
          </section>
        ) : null}
      </Fenster>
    </>
  );
}

// ════════════════ «Fällige Fixkosten» (Spec فاز ۵، قدم ۳): Vorschläge aus den Fixkosten des Labors ════════════════

function laufEntwurf(l: OffenerLauf, heute: string): Entwurf {
  const satz = l.mwstSatz != null && istMwstSatz(l.mwstSatz) ? l.mwstSatz : 20;
  const { nettoCent, mwstCent } = ausBrutto(l.betragCent, satz as 20 | 13 | 10 | 0);
  return {
    rechnungsdatum: l.faelligAm <= heute ? l.faelligAm : heute,
    lieferant: l.gegenpartei ?? l.titel,
    kategorie: AUSGABE_KATEGORIEN.includes(l.kategorie as AusgabeZeile['kategorie']) ? (l.kategorie as AusgabeZeile['kategorie']) : undefined,
    beschreibung: [l.titel, monatTitel(l.periode), l.notiz].filter(Boolean).join(' · ').slice(0, 300),
    nettoCent,
    mwstCent,
    bruttoCent: l.betragCent,
    mwstSatz: satz,
    unsicher: [],
    hinweise: [],
  };
}

function Ueberspringen({ l, onFertig }: { l: OffenerLauf; onFertig: () => void }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await fixkostenUeberspringen(z, d);
    if (r?.erfolg) onFertig();
    return r;
  }, null);
  return (
    <form onSubmit={aktion} className="space-y-3 border-t border-line pt-6">
      <input type="hidden" name="lauf" value={l.id} />
      <p className="text-[13px] text-muted">Kam diesmal keine Rechnung (z. B. gekündigt oder schon anders erfasst)? Dann überspringen; es wird nichts gebucht.</p>
      <Button type="submit" variant="secondary" disabled={laeuft}>
        Diesen Monat überspringen
      </Button>
      <Rueckmeldung zustand={zustand} />
    </form>
  );
}

/** Über den Belegen unter »Zu prüfen«: jede fällige Fixkosten-Zahlung des Labors, älteste zuerst. */
export function FixkostenFaellig({ laeufe, heute }: { laeufe: OffenerLauf[]; heute: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  const [gewaehlt, setGewaehlt] = useState<OffenerLauf | null>(null);
  const schliessen = () => setTimeout(() => fenster.current?.close(), 900);
  if (!laeufe.length) return null;
  return (
    <section aria-label="Fällige Fixkosten" className="mb-10 max-w-[1040px]">
      <h3 className="border-b border-line pb-3 text-[15px]">
        Fällige Fixkosten <span className="text-[13px] text-muted">({laeufe.length})</span>
      </h3>
      <ul aria-label="Fällige Fixkosten">
        {laeufe.map((l) => (
          <li key={l.id} className="border-b border-line">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                setGewaehlt(l);
                fenster.current?.showModal();
              }}
              className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 py-2.5 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] group-hover:text-rose">{l.titel}</span>
                <span className="block truncate text-[13px] text-muted">
                  fällig am {isoDatumText(l.faelligAm)} · {monatTitel(l.periode)}
                  {l.gegenpartei ? ` · ${l.gegenpartei}` : ''}
                </span>
              </span>
              <span className="text-right text-[15px] tabular-nums">{centText(l.betragCent)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Fenster fenster={fenster} titel={gewaehlt ? `Fixkosten ${gewaehlt.titel}` : 'Fixkosten'}>
        {gewaehlt ? (
          <section aria-label={`Fixkosten ${gewaehlt.titel}`} key={gewaehlt.id} className="space-y-8">
            <div>
              <h2 className="pr-10 text-[30px] font-light leading-tight">{gewaehlt.titel}</h2>
              <p className="mt-2 text-[13px] text-muted">
                Fixkosten für {monatTitel(gewaehlt.periode)}, fällig am {isoDatumText(gewaehlt.faelligAm)}. Bitte mit der Rechnung vergleichen; den Beleg können Sie gleich mitgeben.
              </p>
            </div>
            <AusgabeFormular lauf={gewaehlt.id} entwurf={laufEntwurf(gewaehlt, heute)} heute={heute} onGespeichert={schliessen} />
            <Ueberspringen l={gewaehlt} onFertig={schliessen} />
          </section>
        ) : null}
      </Fenster>
    </section>
  );
}

/**
 * »Als Ausgabe erfassen« aus einer Bankzeile (Spec فاز ۵، قدم ۴): Lieferant, Datum und Brutto (der Euro-Betrag der
 * Bank, auch bei Rechnungen in Dollar) sind vorbefüllt; MwSt-Satz und Beleg von der Rechnung ergänzen.
 */
export function AusgabeAusBank({
  umsatz,
  lieferant,
  datum,
  bruttoCent,
  kategorie,
  heute,
  onGespeichert,
}: {
  umsatz: string;
  lieferant: string;
  datum: string;
  bruttoCent: number;
  kategorie: string | null;
  heute: string;
  onGespeichert?: () => void;
}) {
  const { nettoCent, mwstCent } = ausBrutto(bruttoCent, 20);
  const entwurf: Entwurf = {
    rechnungsdatum: datum <= heute ? datum : heute,
    lieferant: lieferant.slice(0, 120),
    kategorie: AUSGABE_KATEGORIEN.includes(kategorie as AusgabeZeile['kategorie']) ? (kategorie as AusgabeZeile['kategorie']) : undefined,
    nettoCent,
    mwstCent,
    bruttoCent,
    mwstSatz: 20,
    unsicher: ['mwstSatz', 'rechnungsdatum'],
    hinweise: [],
  };
  return <AusgabeFormular umsatz={umsatz} entwurf={entwurf} heute={heute} onGespeichert={onGespeichert} />;
}
