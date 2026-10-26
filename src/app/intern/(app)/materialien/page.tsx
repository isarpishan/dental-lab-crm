import type { Metadata } from 'next';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { heuteIso } from '@/lib/format';
import { materialListe, type MaterialZeile } from '@/lib/produktion/material';
import { herstellerFarbe, herstellerRang, MARKE } from '@/lib/produktion/material-text';
import { MaterialKachel, NeuesMaterial } from './Kacheln';

export const metadata: Metadata = { title: 'Materialien · Digital Dental Lab' };

// کاشی‌ها با خط نازک جدا می‌شوند، نه کارت. `-mr-px` و `overflow-hidden` بیرونی: خط راستِ ستون آخر بیرون می‌ماند
const RASTER = '-mr-px grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
const RAHMEN = 'overflow-hidden border-t border-line';

/** Gruppen nach Hersteller: SprintRay, Formlabs, dann die anderen (خواستهٔ کاربر: قاطی نباشند). */
function nachHersteller(ms: MaterialZeile[]) {
  const gruppen = new Map<string, MaterialZeile[]>();
  for (const m of ms) gruppen.set(m.hersteller, [...(gruppen.get(m.hersteller) ?? []), m]);
  return [...gruppen].sort(([a], [b]) => herstellerRang(a) - herstellerRang(b) || a.localeCompare(b));
}

/**
 * «Materialien und Chargen» (Spec فاز ۱، بخش C و H). کاشی‌ها گروه‌گروه به ترتیب سازنده (SprintRay، Formlabs، بقیه)
 * با علامت رنگی هر سازنده؛ هر کاشی رنگ‌ها و Bestand را نشان می‌دهد و با کلیک پنجرهٔ همان Material باز می‌شود
 * (`Kacheln.tsx`). Charge در «3D-Druck» به سفارش وصل می‌شود (ردیابی MDR) و Kapselها همان‌جا کم می‌شوند.
 * دیدن: Stammdaten یا Produktion. Charge و Bestand: Produktion یا Stammdaten. Material: Stammdaten.
 */
export default async function Materialien() {
  const { user } = await mitarbeiterOderAnmelden();
  const sehen = darf(user.role, 'stammdaten.sehen') || darf(user.role, 'produktion.bearbeiten');
  if (!sehen) return <Seitenkopf eyebrow="Materialien" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  const chargen = darf(user.role, 'produktion.bearbeiten') || darf(user.role, 'stammdaten.bearbeiten');
  const stamm = darf(user.role, 'stammdaten.bearbeiten');
  const { materialien, behandlungen } = await materialListe();
  const aktiv = materialien.filter((m) => m.aktiv);
  const aus = materialien.filter((m) => !m.aktiv);
  const heute = heuteIso();
  const mitCharge = aktiv.filter((m) => m.chargen.some((c) => !c.aufgebraucht)).length;
  const abgelaufen = aktiv.flatMap((m) => m.chargen).filter((c) => !c.aufgebraucht && c.abgelaufen).length;

  return (
    <>
      <Seitenkopf
        eyebrow="07 / Materialien"
        titel="Materialien und Chargen."
        kompakt
        info="Jede Flasche und jede Kapselpackung hat eine LOT-Nummer (auf dem Etikett). Beim 3D-Druck wird sie dem Auftrag zugeordnet (MDR). Ein Klick auf ein Material zeigt Farben, Bestand und alle Chargen."
      >
        <span className="flex flex-wrap gap-x-3 text-[13px]">
          <span>
            {aktiv.length} in Verwendung · {mitCharge} mit offener Charge
          </span>
          {abgelaufen ? <span className="text-rose-light">· {abgelaufen === 1 ? '1 Charge abgelaufen' : `${abgelaufen} Chargen abgelaufen`}</span> : null}
        </span>
      </Seitenkopf>

      {stamm ? (
        <div className="-mt-4 mb-8">
          <NeuesMaterial behandlungen={behandlungen} />
        </div>
      ) : null}

      <div className="space-y-12">
        {nachHersteller(aktiv).map(([hersteller, ms]) => (
          <section key={hersteller} aria-label={hersteller}>
            <h2 className="mb-4 flex items-center gap-3 text-[22px] font-light">
              <span aria-hidden className={`size-2.5 rounded-full ${MARKE[herstellerFarbe(hersteller)].punkt}`} />
              {hersteller}
              <span className="text-[13px] text-muted">{ms.length}</span>
            </h2>
            {/* Linie über der Gruppe in der Farbe des Herstellers, damit SprintRay und Formlabs sofort getrennt sind */}
            <div className={`overflow-hidden border-t-2 ${MARKE[herstellerFarbe(hersteller)].linie}`}>
              <ul aria-label={`Materialien von ${hersteller}`} className={RASTER}>
                {ms.map((m) => (
                  <MaterialKachel key={m.key} m={m} chargen={chargen} stamm={stamm} heute={heute} />
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>

      {aus.length ? (
        <details className="mt-12">
          <summary className="cursor-pointer text-[15px] text-muted hover:text-white">Nicht verwendete Materialien ({aus.length})</summary>
          <div className={`mt-5 ${RAHMEN}`}>
            <ul aria-label="Nicht verwendete Materialien" className={RASTER}>
              {aus.map((m) => (
                <MaterialKachel key={m.key} m={m} chargen={false} stamm={stamm} heute={heute} />
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </>
  );
}
