'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { centEingabe } from '@/lib/abrechnung/geld';
import type { Ergebnis } from '@/lib/aktion';
import type { SteuerEingaben } from '@/lib/steuer/rechnen';

/** Formular «Einstellungen → Steuer» (Spec فاز ۵، قدم ۵): Zahlen vom Lohnzettel und vom SVS-Brief, je Jahr. */
export function SteuerFormular({
  jahr,
  eingaben,
  ausVorjahr,
  speichern,
}: {
  jahr: number;
  eingaben: SteuerEingaben | null;
  ausVorjahr: boolean;
  speichern: (z: Ergebnis, d: FormData) => Promise<Ergebnis>;
}) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(speichern, null);
  const e = eingaben;
  const schaetzung = e?.gewinnSchaetzungCent;
  return (
    <form onSubmit={aktion} aria-label="Steuer-Angaben" className="grid max-w-[760px] gap-5 sm:grid-cols-2 sm:items-start">
      <input type="hidden" name="jahr" value={jahr} />
      {ausVorjahr ? <p className="text-[13px] text-rose sm:col-span-2">Vorbefüllt mit den Angaben aus {jahr - 1}. Bitte prüfen und speichern.</p> : null}
      <h3 className="text-[15px] sm:col-span-2">Gehalt (Anstellung)</h3>
      <Feld
        label="Gehalt je Monat, steuerpflichtig (€)"
        name="gehalt"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={centEingabe(e?.gehaltMonatCent)}
        placeholder="z. B. 2.150,00"
        hinweis="Auf dem Lohnzettel rechts in der Spalte »BMG LSt« (Brutto minus Sozialversicherung). Ohne Anstellung leer lassen."
      />
      <Feld
        label="Monate mit Gehalt in diesem Jahr"
        name="monate"
        inputMode="numeric"
        autoComplete="off"
        defaultValue={String(e?.gehaltMonate ?? 12)}
        hinweis="Ohne Urlaubs- und Weihnachtsgeld; die werden getrennt (mit 6 %) besteuert."
      />
      <h3 className="pt-4 text-[15px] sm:col-span-2">Selbständigkeit (Labor)</h3>
      <Feld label="Beginn der Selbständigkeit" name="beginn" type="date" required defaultValue={e?.beginn ?? ''} hinweis="Datum der Gewerbeberechtigung. Ab da sind Sie bei der SVS versichert." />
      <Feld
        label="SVS-Vorschreibung je Quartal (€)"
        name="svs"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={centEingabe(e?.svsQuartalCent)}
        placeholder="laut SVS-Brief"
        hinweis="Leer lassen, solange kein Brief da ist: dann wird mit den Mindestbeiträgen für Neugründer gerechnet. SVS-Zahlungen nicht als Ausgabe buchen; sie werden hier eingerechnet."
      />
      <Feld
        label="ESt-Vorauszahlungen in diesem Jahr (€)"
        name="vorauszahlungen"
        inputMode="decimal"
        autoComplete="off"
        defaultValue={centEingabe(e?.vorauszahlungenCent || null)}
        placeholder="0"
        hinweis="Nur wenn das Finanzamt Vorauszahlungen vorgeschrieben hat (meist erst nach dem ersten Steuerbescheid)."
      />
      <Feld
        label="Erwarteter Gewinn im Jahr (€, optional)"
        name="schaetzung"
        autoComplete="off"
        defaultValue={schaetzung == null ? '' : `${schaetzung < 0 ? '-' : ''}${centEingabe(Math.abs(schaetzung))}`}
        placeholder="leer = aus den Zahlen hochrechnen"
        hinweis="Nur wenn Sie es besser wissen als die Hochrechnung (z. B. kurz nach dem Start). Verlust mit »-«."
      />
      <div className="space-y-4 sm:col-span-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
        <Link href="/abrechnung/steuer" className="inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
          Zur Vorschau ↗
        </Link>
      </div>
    </form>
  );
}
