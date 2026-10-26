'use client';

import { farbName, VITA_3D_MASTER, VITA_CLASSICAL, type Zahnfarbe } from '@/lib/orders/assistent';
import { Optionen } from './Optionen';

const SYSTEME = [
  { wert: 'vita_classical', label: 'VITA classical' },
  { wert: 'vita_3d_master', label: 'VITA 3D-Master' },
  { wert: 'folgt', label: 'Farbe folgt' },
] as const;

/** ردیف‌ها: classical بر اساس حرف (A، B، C، D)، 3D-Master بر اساس روشنی (0 تا 5). */
function gruppiert(liste: string[]): string[][] {
  const gruppen = new Map<string, string[]>();
  for (const f of liste) gruppen.set(f[0], [...(gruppen.get(f[0]) ?? []), f]);
  return [...gruppen.values()];
}

/** قطعهٔ `zahnfarbe`: سیستم رنگ، رنگ، و «Individuelle Farbanpassung» (Spec، بخش D). */
export function ZahnfarbeWahl({
  wert,
  onChange,
  farbanpassung,
}: {
  wert: Zahnfarbe | undefined;
  onChange: (neu: Zahnfarbe) => void;
  farbanpassung: boolean;
}) {
  const system = wert?.system ?? 'vita_classical';
  const liste = system === 'vita_3d_master' ? VITA_3D_MASTER : VITA_CLASSICAL;

  return (
    <div className="space-y-8">
      <Optionen
        label="Farbsystem"
        optionen={SYSTEME}
        wert={system}
        onWahl={(s) => onChange({ ...wert, system: s as Zahnfarbe['system'], farbe: s === wert?.system ? wert.farbe : undefined })}
      />

      {system === 'folgt' ? (
        <p className="max-w-[560px] text-[15px] font-light text-muted">Die Farbe wird nachgereicht, zum Beispiel als Foto mit Farbmuster.</p>
      ) : (
        <div role="group" aria-label="Farbe" className="space-y-1.5">
          {gruppiert(liste).map((reihe) => (
            <div key={reihe[0]} className="flex flex-wrap gap-1.5">
              {reihe.map((f) => {
                const gewaehlt = wert?.farbe === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={gewaehlt}
                    onClick={() => onChange({ ...wert, system, farbe: f })}
                    className={`h-11 min-w-[60px] border px-2 text-[14px] transition-colors duration-[180ms] ${
                      gewaehlt ? 'border-rose bg-rose/15 text-white' : 'border-line text-nav hover:border-line-strong hover:text-white'
                    }`}
                  >
                    {farbName(f)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {farbanpassung ? (
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={Boolean(wert?.farbanpassung)}
            onChange={(e) => onChange({ ...wert, system, farbanpassung: e.target.checked })}
            className="size-5 accent-rose"
          />
          Individuelle Farbanpassung
        </label>
      ) : null}
    </div>
  );
}
