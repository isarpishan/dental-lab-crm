'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Auswahl, Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';
import { PREIS_EINHEITEN } from '@/lib/katalog/preise';
import { behandlungNeu } from './actions';
import { BildFeld } from './BildWahl';

export type Vorlage = { key: string; name: string; fragen: string[]; dateien: string[]; einheit: string };

/**
 * «Neue Behandlung» زیر جدول قیمت‌ها (خواستهٔ کاربر، ۶ اکتبر ۲۰۲۶). فرم سفارش و مراحل تولید از یک
 * Behandlung موجود می‌آید؛ خلاصه‌اش زیر انتخاب دیده می‌شود تا Inhaber بداند Ordination چه می‌بیند.
 */
export function NeueBehandlung({ vorlagen }: { vorlagen: Vorlage[] }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(behandlungNeu, null, { zuruecksetzenBeiErfolg: true });
  const [bildBereit, setBildBereit] = useState(true);
  // nach »angelegt« alle Felder neu (auch Vorlage, Einheit und Bildvorschau)
  const [runde, setRunde] = useState(0);
  const [gesehen, setGesehen] = useState(zustand);
  if (zustand !== gesehen) {
    setGesehen(zustand);
    if (zustand?.erfolg) setRunde(runde + 1);
  }

  return (
    <form onSubmit={aktion} aria-label="Neue Behandlung" className="max-w-[860px] space-y-8">
      <Felder key={runde} vorlagen={vorlagen} onBildBereit={setBildBereit} />
      <div className="space-y-4">
        <p className="max-w-[620px] text-[13px] text-muted">
          Die neue Behandlung wird zuerst ausgeschaltet angelegt. Dann oben unter »Ausgeschaltet« Bearbeitungszeit und Preise eintragen, Häkchen setzen und
          speichern. Passende Materialien unter »Materialien« zuordnen.
        </p>
        <Button type="submit" variant="secondary" disabled={laeuft || !bildBereit}>
          {laeuft ? 'Wird angelegt …' : !bildBereit ? 'Bild wird vorbereitet …' : 'Behandlung anlegen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

function Felder({ vorlagen, onBildBereit }: { vorlagen: Vorlage[]; onBildBereit: (bereit: boolean) => void }) {
  const [vorlage, setVorlage] = useState('');
  const [einheit, setEinheit] = useState<string>('Fall');
  const gewaehlt = vorlagen.find((v) => v.key === vorlage);

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2">
        <Feld label="Name" name="name" required minLength={2} maxLength={60} placeholder="z. B. Kiefermodell" autoComplete="off" />
        <Auswahl
          label="Preis gilt pro"
          name="einheit"
          value={einheit}
          onChange={(e) => setEinheit(e.target.value)}
          optionen={PREIS_EINHEITEN.map((e) => ({ wert: e, label: e }))}
        />
      </div>

      <BildFeld onBereit={onBildBereit} />

      <div>
        <Auswahl
          label="Auftragsformular und Ablauf wie"
          name="vorlage"
          required
          value={vorlage}
          onChange={(e) => {
            setVorlage(e.target.value);
            const v = vorlagen.find((x) => x.key === e.target.value);
            if (v) setEinheit(v.einheit);
          }}
          optionen={[{ wert: '', label: 'Bitte wählen' }, ...vorlagen.map((v) => ({ wert: v.key, label: v.name }))]}
        />
        <div aria-live="polite" className="mt-3 text-[13px] leading-relaxed text-muted">
          {gewaehlt ? (
            <>
              <p>
                <span className="text-white">Fragen im Auftragsformular:</span> {gewaehlt.fragen.join(' · ')}
              </p>
              <p>
                <span className="text-white">Nötige Scans:</span> {gewaehlt.dateien.length ? gewaehlt.dateien.join(', ') : 'keine'}
              </p>
            </>
          ) : (
            <p>Fragen, nötige Scans und Produktionsschritte werden von der gewählten Behandlung übernommen.</p>
          )}
        </div>
      </div>

      <fieldset>
        <legend className="text-[15px]">Angeboten als</legend>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          <label className="flex min-h-11 items-center gap-2.5 text-[15px]">
            <input type="checkbox" name="lieferart" value="fertigung" defaultChecked className="size-4 accent-rose" />
            Fertige Arbeit
          </label>
          <label className="flex min-h-11 items-center gap-2.5 text-[15px]">
            <input type="checkbox" name="lieferart" value="design" defaultChecked className="size-4 accent-rose" />
            Nur Design
          </label>
        </div>
      </fieldset>
    </>
  );
}
