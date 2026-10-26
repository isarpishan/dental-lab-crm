'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';

type ZugangErgebnis = (Ergebnis & { schluessel?: string }) | null;

export type ZugangZeile = { id: string; name: string; von: string; angelegt: string; zuletzt: string | null; gesperrt: string | null };

function Kopieren({ wert, label }: { wert: string; label: string }) {
  const [kopiert, setKopiert] = useState(false);
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(wert);
        setKopiert(true);
        setTimeout(() => setKopiert(false), 2500);
      }}
    >
      {kopiert ? 'Kopiert ✓' : label}
    </Button>
  );
}

/** Ein Wert zum Abschreiben oder Kopieren (Adresse, Schlüssel), in Schreibmaschinenschrift und umbrechend. */
export function Wert({ wert, label }: { wert: string; label: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
      <code className="min-w-0 break-all border-b border-line pb-1 font-mono text-[14px] text-white">{wert}</code>
      <Kopieren wert={wert} label={label} />
    </div>
  );
}

/**
 * «Neuer Zugang»: Name eingeben, anlegen; der Schlüssel erscheint genau einmal (als fertiger Header-Wert
 * `Bearer …`, so wie er im Kurzbefehl eingetragen wird). Darunter die Liste mit »Sperren«.
 */
export function HandyScannerZugaenge({
  zugaenge,
  anlegen,
  sperren,
  entfernen,
}: {
  zugaenge: ZugangZeile[];
  anlegen: (z: ZugangErgebnis, f: FormData) => Promise<ZugangErgebnis>;
  sperren: (id: string) => Promise<Ergebnis>;
  entfernen: (id: string) => Promise<Ergebnis>;
}) {
  const [z, absenden, laeuft] = useFormAktion<ZugangErgebnis>(anlegen, null, { zuruecksetzenBeiErfolg: true });
  const [extra, setExtra] = useState<Ergebnis>(null);
  const [arbeitet, starten] = useTransition();

  return (
    <div className="grid max-w-[760px] gap-10">
      <form
        onSubmit={(e) => {
          setExtra(null);
          absenden(e);
        }}
        aria-label="Neuer Zugang"
        className="grid gap-6"
      >
        <Feld label="Name des Geräts" name="name" required maxLength={60} autoComplete="off" placeholder="z. B. iPhone Isar" />
        <div>
          <Button type="submit" disabled={laeuft}>
            {laeuft ? 'Wird angelegt …' : 'Zugang anlegen'}
          </Button>
        </div>
      </form>

      {z?.schluessel ? (
        <div role="status" className="rounded-[12px] border border-success-line p-5 text-[15px]">
          <p>{z.erfolg} Jetzt »Schlüssel kopieren« und den Kurzbefehl laden (Schritt 2 unten); beim Hinzufügen fragt das iPhone nach diesem Schlüssel.</p>
          <p className="mt-2 text-[13px] text-rose">Er wird nur dieses eine Mal angezeigt. Wer ihn hat, kann Belege hochladen, aber nichts sehen.</p>
          <Wert wert={`Bearer ${z.schluessel}`} label="Schlüssel kopieren" />
        </div>
      ) : (
        <div aria-live="polite">
          <Rueckmeldung zustand={z} />
        </div>
      )}

      <div aria-live="polite">
        <Rueckmeldung zustand={extra} />
      </div>

      {zugaenge.length ? (
        <ul aria-label="Zugänge" className="border-t border-line">
          {zugaenge.map((g) => (
            <li key={g.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 border-b border-line py-4">
              <span className="min-w-0">
                <span className={`block text-[17px] font-light ${g.gesperrt ? 'text-muted line-through' : ''}`}>{g.name}</span>
                <span className="block text-[13px] text-muted">
                  angelegt {g.angelegt} von {g.von} · {g.gesperrt ? `gesperrt ${g.gesperrt}` : g.zuletzt ? `zuletzt benutzt ${g.zuletzt}` : 'noch nicht benutzt'}
                </span>
              </span>
              {g.gesperrt ? (
                <Button
                  variant="text"
                  disabled={arbeitet}
                  className="text-muted hover:text-white"
                  onClick={() => {
                    if (confirm(`Gesperrten Zugang »${g.name}« aus der Liste entfernen?`)) starten(async () => setExtra(await entfernen(g.id)));
                  }}
                >
                  Entfernen
                </Button>
              ) : (
                <Button
                  variant="text"
                  disabled={arbeitet}
                  className="text-muted hover:text-white"
                  onClick={() => {
                    if (confirm(`Zugang »${g.name}« sperren? Der Kurzbefehl auf diesem Gerät kann dann nichts mehr hochladen.`))
                      starten(async () => setExtra(await sperren(g.id)));
                  }}
                >
                  Sperren
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[15px] font-light text-muted">Noch kein Zugang angelegt.</p>
      )}
    </div>
  );
}
