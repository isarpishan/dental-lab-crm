'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';
import { KI_MODELLE, type KiModell } from '@/lib/ki/modelle';

type Aktion = (z: Ergebnis, f: FormData) => Promise<Ergebnis>;

/**
 * Schlüssel und Modell für das Lesen der Belege. Der gespeicherte Schlüssel kommt nie zurück in den Browser; das Feld
 * bleibt leer, und leer gelassen heißt »unverändert«.
 */
export function KiFormular({
  stand,
  speichern,
  testen,
  entfernen,
}: {
  stand: { gesetzt: boolean; ende: string | null; modell: KiModell };
  speichern: Aktion;
  testen: () => Promise<Ergebnis>;
  entfernen: () => Promise<Ergebnis>;
}) {
  const [schluessel, setSchluessel] = useState('');
  // erst leeren, wenn gespeichert wurde (auch »Gespeichert, aber …«); bei einem Fehler bleibt die Eingabe stehen
  const [z, absenden, laeuft] = useFormAktion<Ergebnis>(async (alt, daten) => {
    const r = await speichern(alt, daten);
    if (r?.erfolg || r?.fehler?.startsWith('Gespeichert')) setSchluessel('');
    return r;
  }, null);
  const [extra, setExtra] = useState<Ergebnis>(null);
  const [arbeitet, starten] = useTransition();
  const zeige = extra ?? z;

  return (
    <form
      onSubmit={(e) => {
        setExtra(null);
        absenden(e);
      }}
      className="grid max-w-[760px] gap-8"
      aria-label="KI-Einstellungen"
    >
      <div>
        <p className="text-[15px]">
          {stand.gesetzt ? (
            <>
              Schlüssel eingetragen <span className="text-muted">(endet auf …{stand.ende})</span>
            </>
          ) : (
            <span className="text-rose">Noch kein Schlüssel eingetragen. Belege werden bis dahin nicht automatisch gelesen.</span>
          )}
        </p>
        <Feld
          label={stand.gesetzt ? 'Neuer API-Schlüssel' : 'API-Schlüssel von Anthropic'}
          name="schluessel"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={schluessel}
          onChange={(e) => setSchluessel(e.target.value)}
          placeholder="sk-ant-…"
          hinweis={
            stand.gesetzt
              ? 'Leer lassen, um den eingetragenen Schlüssel zu behalten.'
              : 'Wird verschlüsselt gespeichert und danach nie wieder angezeigt.'
          }
          className="font-mono text-[15px]"
        />
      </div>

      <fieldset>
        <legend className="text-[15px]">Modell</legend>
        <div className="mt-3 border-t border-line">
          {KI_MODELLE.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-baseline gap-4 border-b border-line py-4">
              <input type="radio" name="modell" value={m.id} defaultChecked={m.id === stand.modell} className="translate-y-[2px] accent-[#b1847a]" />
              <span className="min-w-0">
                <span className="block text-[17px] font-light">{m.name}</span>
                <span className="block text-[13px] text-muted">{m.text}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div aria-live="polite">
        <Rueckmeldung zustand={zeige} />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <Button type="submit" disabled={laeuft || arbeitet}>
          {laeuft ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
        {stand.gesetzt ? (
          <>
            <Button variant="secondary" disabled={laeuft || arbeitet} onClick={() => starten(async () => setExtra(await testen()))}>
              {arbeitet ? 'Bitte warten …' : 'Verbindung testen'}
            </Button>
            <Button
              variant="text"
              disabled={laeuft || arbeitet}
              className="text-muted hover:text-white"
              onClick={() => {
                if (confirm('Schlüssel wirklich löschen? Belege werden dann nicht mehr automatisch gelesen.')) starten(async () => setExtra(await entfernen()));
              }}
            >
              Schlüssel löschen
            </Button>
          </>
        ) : null}
      </div>
    </form>
  );
}
