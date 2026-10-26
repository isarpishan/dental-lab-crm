'use client';

import { Button } from '@/components/ui/Button';
import { Auswahl, Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';
import { EINHEIT_NAMEN, FUELLUNG_NAMEN, type Einheit } from '@/lib/produktion/material-text';
import { bestandAktualisieren, chargeErfassen, chargeUmschalten, fuellungAktualisieren, materialEinstellungen, materialNeu, materialUmschalten } from './actions';

const KLEIN = 'border-b border-current text-[13px] text-muted hover:text-white disabled:opacity-50';

/**
 * «Charge erfassen» im Fenster eines Materials: LOT-Nummer, Farbe (wenn das Material Farben hat), Anzahl, Eingang. Kein
 * Ablaufdatum mehr (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶)؛ ältere Chargen behalten ihres.
 */
export function ChargeFormular({ material, name, heute, einheit, farben }: { material: string; name: string; heute: string; einheit: Einheit; farben: string[] }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(chargeErfassen, null, { zuruecksetzenBeiErfolg: true });
  return (
    <form onSubmit={aktion} aria-label={`Charge erfassen: ${name}`} className="mt-4 grid gap-5 sm:grid-cols-3 sm:items-start">
      <input type="hidden" name="material" value={material} />
      <Feld label="LOT-Nummer" name="lot" required maxLength={40} autoComplete="off" hinweis="Steht auf dem Etikett nach »LOT«." />
      {farben.length ? (
        <Auswahl label="Farbe" name="farbe" required defaultValue="" optionen={[{ wert: '', label: 'Bitte wählen' }, ...farben.map((f) => ({ wert: f, label: f }))]} />
      ) : null}
      <Feld
        label={einheit === 'kapsel' ? 'Anzahl Kapseln' : 'Anzahl Flaschen'}
        name="menge"
        type="number"
        inputMode="numeric"
        min={1}
        max={9999}
        defaultValue={1}
        required
      />
      <Feld label="Eingang" name="eingang" type="date" defaultValue={heute} max={heute} />
      <div className="space-y-4 sm:col-span-3">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Charge speichern'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

/**
 * Bestand einer Charge: «Flasche leer» (−1, nur Flaschen) und «Bestand ändern» (gezählte Zahl eintragen, z. B. nach
 * dem Nachzählen der Kapseln). Bei 0 ist die Charge aufgebraucht.
 */
export function BestandKnoepfe({ id, lot, einheit, bestand }: { id: string; lot: string; einheit: Einheit; bestand: number | null }) {
  const [zEins, eins, laeuftEins] = useFormAktion<Ergebnis>(bestandAktualisieren, null);
  const [zSetzen, setzen, laeuftSetzen] = useFormAktion<Ergebnis>(bestandAktualisieren, null);
  const laeuft = laeuftEins || laeuftSetzen;
  return (
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
      {einheit === 'flasche' && bestand != null && bestand > 0 ? (
        <form onSubmit={eins} className="inline">
          <input type="hidden" name="charge" value={id} />
          <input type="hidden" name="art" value="eins" />
          <button type="submit" disabled={laeuft} aria-label={`Flasche leer: LOT ${lot}`} className={KLEIN}>
            Flasche leer
          </button>
        </form>
      ) : null}
      <details className="group/bestand">
        <summary className={`cursor-pointer list-none ${KLEIN}`}>Bestand ändern</summary>
        <form onSubmit={setzen} aria-label={`Bestand ändern: LOT ${lot}`} className="mt-2 flex items-center gap-3">
          <input type="hidden" name="charge" value={id} />
          <input type="hidden" name="art" value="setzen" />
          <label className="flex items-center gap-2 text-[13px] text-muted">
            {einheit === 'kapsel' ? 'Kapseln' : 'Flaschen'}
            <input
              type="number"
              name="bestand"
              inputMode="numeric"
              min={0}
              max={9999}
              required
              defaultValue={bestand ?? ''}
              className="w-20 rounded-[8px] border border-field-line bg-field px-3 py-1.5 text-[15px] text-white"
            />
          </label>
          <button type="submit" disabled={laeuft} className={KLEIN}>
            Speichern
          </button>
        </form>
      </details>
      {[zEins, zSetzen].map((z, i) =>
        z?.fehler ? (
          <span key={i} className="basis-full text-[13px] text-rose-light">
            {z.fehler}
          </span>
        ) : z?.erfolg ? (
          <span key={i} className="basis-full text-[13px] text-muted">
            {z.erfolg}
          </span>
        ) : null,
      )}
    </div>
  );
}

/**
 * Füllstand der offenen Flasche (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶): vier Knöpfe Voll, ¾, ½, ¼. Der gewählte ist hervorgehoben;
 * die Kachel und der Lagerbalken rechnen die angebrochene Flasche anteilig.
 */
export function FuellungWahl({ id, lot, fuellung }: { id: string; lot: string; fuellung: number | null }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(fuellungAktualisieren, null);
  const aktuell = fuellung ?? 4;
  return (
    <form onSubmit={aktion} aria-label={`Offene Flasche: LOT ${lot}`} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <input type="hidden" name="charge" value={id} />
      <span className="text-[13px] text-muted">Offene Flasche</span>
      <span className="inline-flex overflow-hidden rounded-[6px] border border-line">
        {[4, 3, 2, 1].map((v) => (
          <button
            key={v}
            type="submit"
            name="viertel"
            value={v}
            disabled={laeuft}
            aria-pressed={aktuell === v}
            aria-label={`Offene Flasche ${v === 4 ? 'voll' : FUELLUNG_NAMEN[v]}: LOT ${lot}`}
            className={`min-w-11 border-l border-line px-2.5 py-1.5 text-[13px] first:border-l-0 disabled:opacity-60 ${
              aktuell === v ? 'bg-white text-black' : 'text-muted hover:bg-soft hover:text-white'
            }`}
          >
            {FUELLUNG_NAMEN[v]}
          </button>
        ))}
      </span>
      {zustand?.fehler ? <span className="basis-full text-[13px] text-rose-light">{zustand.fehler}</span> : null}
    </form>
  );
}

/** «Aufgebraucht» / «Wieder verwenden» für eine Charge. */
export function ChargeKnopf({ id, lot, aufgebraucht }: { id: string; lot: string; aufgebraucht: boolean }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(chargeUmschalten, null);
  return (
    <form onSubmit={aktion} className="inline">
      <input type="hidden" name="charge" value={id} />
      <input type="hidden" name="aufgebraucht" value={aufgebraucht ? 'nein' : 'ja'} />
      <button type="submit" disabled={laeuft} aria-label={`${aufgebraucht ? 'Wieder verwenden' : 'Aufgebraucht'}: LOT ${lot}`} className={KLEIN}>
        {aufgebraucht ? 'Wieder verwenden' : 'Aufgebraucht'}
      </button>
      {zustand?.fehler ? <span className="ml-3 text-[13px] text-rose-light">{zustand.fehler}</span> : null}
    </form>
  );
}

/** Material ein- oder ausblenden (ausgeblendete erscheinen nicht beim 3D-Druck). */
export function MaterialKnopf({ schluessel, name, aktiv }: { schluessel: string; name: string; aktiv: boolean }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(materialUmschalten, null);
  return (
    <form onSubmit={aktion}>
      <input type="hidden" name="key" value={schluessel} />
      <input type="hidden" name="aktiv" value={aktiv ? 'nein' : 'ja'} />
      <button type="submit" disabled={laeuft} aria-label={`${aktiv ? 'Nicht mehr verwenden' : 'Wieder verwenden'}: ${name}`} className={KLEIN}>
        {aktiv ? 'Nicht mehr verwenden' : 'Wieder verwenden'}
      </button>
      {zustand?.fehler ? <span className="ml-3 text-[13px] text-rose-light">{zustand.fehler}</span> : null}
    </form>
  );
}

function EinheitWahl({ wert }: { wert?: Einheit }) {
  return (
    <fieldset>
      <legend className="text-[15px]">Gezählt in</legend>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
        {(['flasche', 'kapsel'] as const).map((e) => (
          <label key={e} className="flex items-center gap-2.5 text-[15px]">
            <input type="radio" name="einheit" value={e} defaultChecked={(wert ?? 'flasche') === e} className="size-4 accent-rose" />
            {EINHEIT_NAMEN[e]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Stammdaten eines Materials: Einheit und Farben (z. B. «A1, A2, A3»). */
export function MaterialEinstellungen({ schluessel, name, einheit, farben }: { schluessel: string; name: string; einheit: Einheit; farben: string[] }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(materialEinstellungen, null);
  return (
    <form onSubmit={aktion} aria-label={`Einstellungen: ${name}`} className="grid gap-5 sm:grid-cols-2 sm:items-start">
      <input type="hidden" name="key" value={schluessel} />
      <EinheitWahl wert={einheit} />
      <Feld label="Farben" name="farben" defaultValue={farben.join(', ')} placeholder="z. B. A1, A2, A3" maxLength={400} autoComplete="off" hinweis="Mit Komma getrennt. Leer: ohne Farben." />
      <div className="space-y-3 sm:col-span-2">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function MaterialNeuFormular({ behandlungen }: { behandlungen: { key: string; name: string }[] }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(materialNeu, null, { zuruecksetzenBeiErfolg: true });
  return (
    <form onSubmit={aktion} aria-label="Neues Material" className="max-w-[860px] space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Feld label="Hersteller" name="hersteller" required maxLength={60} placeholder="z. B. SprintRay" autoComplete="off" />
        <Feld label="Material" name="name" required maxLength={80} placeholder="z. B. Crown HT" autoComplete="off" />
        <EinheitWahl />
        <Feld label="Farben" name="farben" maxLength={400} placeholder="z. B. A1, A2, A3" autoComplete="off" hinweis="Mit Komma getrennt. Leer: ohne Farben." />
      </div>
      <fieldset>
        <legend className="text-[15px]">Für welche Behandlungen?</legend>
        <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-3">
          {behandlungen.map((b) => (
            <label key={b.key} className="flex items-center gap-2.5 text-[15px]">
              <input type="checkbox" name="fuer" value={b.key} className="size-4 accent-rose" />
              {b.name}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-4">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Material anlegen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}
