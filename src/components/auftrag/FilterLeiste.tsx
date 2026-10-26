'use client';

import Form from 'next/form';
import { useRef } from 'react';

type Option = { wert: string; label: string };
const FELD = 'block w-full rounded-[8px] border border-field-line bg-field px-3.5 py-3 text-[15px] text-white';

/**
 * ابزار بالای فهرست (Spec فاز ۱، بخش E): Suche، فیلترها و Sortierung. یک فرم GET است
 * (`next/form`): نشانی صفحه همان فیلترها را دارد و بدون JavaScript هم کار می‌کند؛ با
 * JavaScript هر انتخاب فوراً اعمال می‌شود و جست‌وجو بعد از مکث کوتاه.
 */
export function FilterLeiste({
  ziel,
  werte,
  suchePlatzhalter,
  auswahl,
  versteckt = {},
}: {
  ziel: string;
  werte: Record<string, string>;
  /** ohne: keine Suche (z. B. Kalender) */
  suchePlatzhalter?: string;
  auswahl: { name: string; label: string; optionen: Option[] }[];
  versteckt?: Record<string, string>;
}) {
  const formular = useRef<HTMLFormElement>(null);
  const warten = useRef<ReturnType<typeof setTimeout> | null>(null);
  const senden = () => formular.current?.requestSubmit();

  return (
    <Form ref={formular} action={ziel} replace scroll={false} role="search" aria-label="Filter" className="flex flex-wrap gap-3">
      {Object.entries(versteckt).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {suchePlatzhalter ? (
        <label className="block min-w-[220px] flex-[1.6_1_260px] text-[13px] text-muted">
          Suche
          <input
            type="search"
            name="suche"
            defaultValue={werte.suche ?? ''}
            placeholder={suchePlatzhalter}
            autoComplete="off"
            className={`mt-1.5 ${FELD}`}
            onChange={() => {
              if (warten.current) clearTimeout(warten.current);
              warten.current = setTimeout(senden, 400);
            }}
          />
        </label>
      ) : null}
      {auswahl.map((a) => (
        <label key={a.name} className="block min-w-[150px] flex-[1_1_160px] text-[13px] text-muted">
          {a.label}
          <select name={a.name} defaultValue={werte[a.name] ?? ''} onChange={senden} className={`mt-1.5 appearance-auto ${FELD}`}>
            {a.optionen.map((o) => (
              <option key={o.wert} value={o.wert}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <noscript>
        <button type="submit" className="border border-rose px-3.5 py-[9px] text-[13px]">
          Anwenden
        </button>
      </noscript>
    </Form>
  );
}
