'use client';

import { Button } from '@/components/ui/Button';
import { Auswahl, Feld, Textfeld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';
import { anfordern, zurueckziehen } from './actions';

export function AbholungFormular({
  vorschlag,
  min,
  max,
  auftraege,
  auftrag,
}: {
  vorschlag: string;
  min: string;
  max: string;
  auftraege: { id: string; label: string }[];
  auftrag: string;
}) {
  const [zustand, senden, laeuft] = useFormAktion<Ergebnis>(anfordern, null, { zuruecksetzenBeiErfolg: true });
  return (
    <form onSubmit={senden} aria-label="Abholung anfordern" className="max-w-[760px] space-y-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Feld label="Wunschtag" name="datum" type="date" required min={min} max={max} defaultValue={vorschlag} />
        <Auswahl
          label="Zu welchem Auftrag? (optional)"
          name="auftrag"
          defaultValue={auftrag}
          optionen={[{ wert: '', label: 'Kein bestimmter Auftrag' }, ...auftraege.map((a) => ({ wert: a.id, label: a.label }))]}
        />
      </div>
      <div>
        <Textfeld label="Was holen wir ab? (optional)" name="notiz" rows={3} maxLength={500} placeholder="z. B. Einprobe zurück, Abdruck OK" />
        <p className="mt-2 text-[13px] text-muted">Bitte keine Patientennamen: Die Notiz sieht auch unser Fahrer. Die Auftragsnummer genügt.</p>
      </div>
      <div className="space-y-4">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gesendet …' : 'Abholung anfordern'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function ZurueckziehenKnopf({ id }: { id: string }) {
  const [zustand, senden, laeuft] = useFormAktion<Ergebnis>(zurueckziehen, null);
  return (
    <form onSubmit={senden} className="inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={laeuft} className="border-b border-current text-[13px] text-muted hover:text-white disabled:opacity-50">
        Zurückziehen
      </button>
      {zustand?.fehler ? <span className="ml-3 text-[13px] text-rose-light">{zustand.fehler}</span> : null}
    </form>
  );
}
