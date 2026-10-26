'use client';

import { useState } from 'react';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { Button } from '@/components/ui/Button';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import type { Ergebnis } from '@/lib/aktion';
import { PREIS_EINHEITEN, preisAnzeigen, ZUSCHLAG_EINHEITEN } from '@/lib/katalog/preise';
import { TEMPO_NAMEN, ZUSCHLAG_NAMEN, type Eilig } from '@/lib/katalog/tempo';
import { katalogSpeichern } from './actions';
import { BildAendern } from './BildWahl';

type Stufe = { an: boolean; betrag: number | null; einheit: string };

export type PreisZeile = {
  key: string;
  name: string;
  bild: string | null;
  isActive: boolean;
  turnaroundLabel: string;
  design: { preisAb: number | null; einheit: string } | null;
  fertigung: { preisAb: number | null; einheit: string } | null;
  express: Stufe;
  sameDay: Stufe;
};

const FELD = 'w-full min-w-0 rounded-[8px] border border-field-line bg-field px-3 py-2.5 text-[15px] text-white placeholder:text-muted/60';
const EINHEIT = 'shrink-0 rounded-[8px] border border-field-line bg-field px-2 py-2.5 text-[13px] text-white';

/** فیلد مبلغ با واحد؛ نام فیلدها `${feld}_${schluessel}` و `${feld}_einheit_${schluessel}`. */
function BetragFeld({
  label,
  feld,
  schluessel,
  wert,
  einheit,
  einheiten,
  leer,
  ohneLabel = false,
}: {
  label: string;
  /** «design»، «fertigung»، «express» یا «sameday» */
  feld: string;
  schluessel: string;
  wert: number | null;
  einheit: string;
  einheiten: readonly string[];
  leer: string;
  /** وقتی بالای فیلد `<label>` نیست (Stufenfeld) */
  ohneLabel?: boolean;
}) {
  const name = `${feld}_${schluessel}`;
  return (
    <div className="mt-1.5 flex gap-1.5">
      <div className="relative min-w-0 flex-1">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">
          €
        </span>
        <input
          id={name}
          name={name}
          defaultValue={preisAnzeigen(wert)}
          inputMode="decimal"
          placeholder={leer}
          autoComplete="off"
          aria-label={ohneLabel ? label : undefined}
          className={`${FELD} pl-7`}
        />
      </div>
      <select name={`${feld}_einheit_${schluessel}`} defaultValue={einheit} aria-label={`${label}: Einheit`} className={EINHEIT}>
        {einheiten.map((e) => (
          <option key={e} value={e}>
            pro {e}
          </option>
        ))}
      </select>
    </div>
  );
}

function Betrag(p: { label: string; feld: string; schluessel: string; wert: number | null; einheit: string; einheiten: readonly string[]; leer: string }) {
  return (
    <div className="min-w-0">
      <label htmlFor={`${p.feld}_${p.schluessel}`} className="block text-[12px] text-muted">
        {p.label}
      </label>
      <BetragFeld {...p} />
    </div>
  );
}

/**
 * Express یا Same-Day: تیک «angeboten» و Zuschlag جدا. Zuschlag با تیک خاموش هم ذخیره می‌ماند،
 * فقط کم‌رنگ دیده می‌شود.
 */
function Stufenfeld({ stufe, schluessel, wert }: { stufe: Eilig; schluessel: string; wert: Stufe }) {
  const [an, setAn] = useState(wert.an);
  const feld = stufe === 'express' ? 'express' : 'sameday';
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            name={`${feld}_an_${schluessel}`}
            value="ja"
            checked={an}
            onChange={(e) => setAn(e.target.checked)}
            className="size-4 accent-rose"
          />
          <span className={an ? 'text-white' : ''}>{TEMPO_NAMEN[stufe]}</span>
        </label>
        <span aria-hidden>· Zuschlag</span>
      </div>
      <div className={an ? '' : 'opacity-45'}>
        <BetragFeld
          label={ZUSCHLAG_NAMEN[stufe]}
          feld={feld}
          schluessel={schluessel}
          wert={wert.betrag}
          einheit={wert.einheit}
          einheiten={ZUSCHLAG_EINHEITEN}
          leer="nach Prüfung"
          ohneLabel
        />
      </div>
    </div>
  );
}

function Zeile({ z }: { z: PreisZeile }) {
  return (
    // xl: دو خط (بالا Standard: زمان و قیمت‌ها؛ پایین Express و Same-Day)، از 2xl یک خط
    <li className="grid grid-cols-1 gap-x-4 gap-y-4 border-b border-line py-5 sm:grid-cols-2 xl:grid-cols-[200px_repeat(3,minmax(0,1fr))] xl:items-end 2xl:grid-cols-[200px_minmax(0,0.7fr)_repeat(2,minmax(0,1.2fr))_repeat(2,minmax(0,1.3fr))]">
      <div className="sm:col-span-2 xl:col-span-1 xl:row-span-2 xl:self-center 2xl:row-span-1">
        <BildAendern schluessel={z.key} name={z.name} bild={z.bild}>
          <label className="flex min-h-9 cursor-pointer items-center gap-3">
            <input type="checkbox" name={`aktiv_${z.key}`} value="ja" defaultChecked={z.isActive} className="size-5 shrink-0 accent-rose" />
            <span className="min-w-0 hyphens-auto text-[17px] font-light leading-tight">{z.name}</span>
          </label>
        </BildAendern>
      </div>
      <div className="min-w-0">
        <label htmlFor={`zeit_${z.key}`} className="block text-[12px] text-muted">
          Bearbeitungszeit
        </label>
        <input id={`zeit_${z.key}`} name={`zeit_${z.key}`} defaultValue={z.turnaroundLabel} required className={`${FELD} mt-1.5`} />
      </div>
      {z.design ? (
        <Betrag label="Nur Design ab" feld="design" schluessel={z.key} wert={z.design.preisAb} einheit={z.design.einheit} einheiten={PREIS_EINHEITEN} leer="auf Anfrage" />
      ) : (
        <p className="text-[13px] text-muted xl:pb-3">Nur Design: nicht angeboten</p>
      )}
      {z.fertigung ? (
        <Betrag label="Fertige Arbeit ab" feld="fertigung" schluessel={z.key} wert={z.fertigung.preisAb} einheit={z.fertigung.einheit} einheiten={PREIS_EINHEITEN} leer="auf Anfrage" />
      ) : (
        <p className="text-[13px] text-muted xl:pb-3">Fertige Arbeit: nicht angeboten</p>
      )}
      <Stufenfeld stufe="express" schluessel={z.key} wert={z.express} />
      <Stufenfeld stufe="same_day" schluessel={z.key} wert={z.sameDay} />
    </li>
  );
}

/** همهٔ Behandlungها در یک فرم؛ یک دکمهٔ «Speichern» پایین صفحه که همیشه در دید است. */
export function PreisFormular({ aktiv, aus }: { aktiv: PreisZeile[]; aus: PreisZeile[] }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(katalogSpeichern, null);
  return (
    <form onSubmit={aktion}>
      <ul className="border-t border-line" aria-label="Behandlungen im Auftragsformular">
        {aktiv.map((z) => (
          <Zeile key={z.key} z={z} />
        ))}
      </ul>
      {aus.length ? (
        <>
          <h2 className="mt-16 text-[clamp(23px,2.6vw,32px)] font-light">Ausgeschaltet</h2>
          <p className="mb-6 mt-2 max-w-[620px] text-[15px] font-light text-muted">
            Erscheinen nicht im Auftragsformular. Häkchen setzen und speichern, um eine Behandlung anzubieten.
          </p>
          <ul className="border-t border-line" aria-label="Ausgeschaltete Behandlungen">
            {aus.map((z) => (
              <Zeile key={z.key} z={z} />
            ))}
          </ul>
        </>
      ) : null}
      <div className="sticky bottom-0 z-10 -mx-4 mt-10 border-t border-line bg-black/92 px-4 py-4 backdrop-blur-[18px]">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Button type="submit" disabled={laeuft}>
            {laeuft ? 'Wird gespeichert …' : 'Speichern'}
          </Button>
          <div aria-live="polite" className="min-w-0 flex-1">
            <Rueckmeldung zustand={zustand} />
          </div>
        </div>
      </div>
    </form>
  );
}
