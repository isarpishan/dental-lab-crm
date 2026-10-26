'use client';

import { useFormAktion } from '@/components/ui/useFormAktion';
import { Button } from '@/components/ui/Button';
import { Feld, Meldung } from '@/components/ui/Formular';
import { anmelden, codePruefen, type FormZustand } from './actions';

export function AnmeldeFormular({ weiter }: { weiter?: string }) {
  const [zustand, aktion, laeuft] = useFormAktion<FormZustand>(anmelden, null);
  return (
    <form onSubmit={aktion} className="space-y-6">
      <input type="hidden" name="weiter" value={weiter ?? ''} />
      <Feld label="E-Mail-Adresse" name="email" type="email" autoComplete="username" required autoFocus />
      <Feld label="Passwort" name="passwort" type="password" autoComplete="current-password" required />
      <div className="space-y-5 pt-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird geprüft …' : 'Anmelden'}
        </Button>
        <div aria-live="polite">{zustand?.fehler ? <Meldung art="fehler">{zustand.fehler}</Meldung> : null}</div>
      </div>
    </form>
  );
}

export function CodeFormular() {
  const [zustand, aktion, laeuft] = useFormAktion<FormZustand>(codePruefen, null);
  return (
    <form onSubmit={aktion} className="space-y-6">
      <Feld
        label="Code aus der Authenticator-App"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        className="max-w-[220px] text-[22px] tracking-[0.3em]"
      />
      <div className="space-y-5 pt-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird geprüft …' : 'Bestätigen'}
        </Button>
        <div aria-live="polite">{zustand?.fehler ? <Meldung art="fehler">{zustand.fehler}</Meldung> : null}</div>
      </div>
    </form>
  );
}
