'use client';

import { useFormAktion } from '@/components/ui/useFormAktion';
import { Button } from '@/components/ui/Button';
import { Auswahl, Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import type { Ergebnis } from '@/lib/aktion';
import { aktivUmschalten, einladungErneut, mitarbeiterEinladen, rolleAendern } from './actions';

type Rolle = { wert: string; label: string };

export function EinladenFormular({ rollen }: { rollen: Rolle[] }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(mitarbeiterEinladen, null, { zuruecksetzenBeiErfolg: true });
  return (
    <form onSubmit={aktion} className="grid gap-6 md:grid-cols-[1fr_1fr_220px] md:items-end">
      <Feld label="Name" name="name" autoComplete="off" required />
      <Feld label="E-Mail-Adresse" name="email" type="email" autoComplete="off" required />
      <Auswahl label="Rolle" name="rolle" optionen={rollen} defaultValue="techniker" />
      <div className="space-y-5 md:col-span-3">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gesendet …' : 'Mitarbeiter einladen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function ZeilenAktionen({
  id,
  rolle,
  aktiv,
  eingerichtet,
  ichSelbst,
  rollen,
}: {
  id: string;
  rolle: string;
  aktiv: boolean;
  eingerichtet: boolean;
  ichSelbst: boolean;
  rollen: Rolle[];
}) {
  const [rz, rolleAktion] = useFormAktion<Ergebnis>(rolleAendern, null);
  const [az, aktivAktion, aktivLaeuft] = useFormAktion<Ergebnis>(aktivUmschalten, null);
  const [ez, erneutAktion, erneutLaeuft] = useFormAktion<Ergebnis>(einladungErneut, null);
  if (ichSelbst) return <span className="text-[13px] text-muted">Ihr Zugang</span>;
  const meldung = ez ?? az ?? rz;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <form onSubmit={rolleAktion}>
          <input type="hidden" name="id" value={id} />
          <label className="sr-only" htmlFor={`rolle-${id}`}>
            Rolle
          </label>
          <select
            id={`rolle-${id}`}
            name="rolle"
            defaultValue={rolle}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="rounded-[8px] border border-field-line bg-field px-3 py-2 text-[13px]"
          >
            {rollen.map((r) => (
              <option key={r.wert} value={r.wert}>
                {r.label}
              </option>
            ))}
          </select>
        </form>
        <form onSubmit={aktivAktion}>
          <input type="hidden" name="id" value={id} />
          <Button variant="text" type="submit" disabled={aktivLaeuft}>
            {aktiv ? 'Deaktivieren' : 'Aktivieren'}
          </Button>
        </form>
        <form
          onSubmit={(e) => {
            if (eingerichtet && !confirm('Zugang zurücksetzen? Passwort und Authenticator-App gelten danach nicht mehr.')) {
              e.preventDefault();
              return;
            }
            erneutAktion(e);
          }}
        >
          <input type="hidden" name="id" value={id} />
          <Button variant="text" type="submit" disabled={erneutLaeuft}>
            {eingerichtet ? 'Zugang zurücksetzen' : 'Einladung erneut senden'}
          </Button>
        </form>
      </div>
      <div aria-live="polite">{meldung ? <Rueckmeldung zustand={meldung} /> : null}</div>
    </div>
  );
}
