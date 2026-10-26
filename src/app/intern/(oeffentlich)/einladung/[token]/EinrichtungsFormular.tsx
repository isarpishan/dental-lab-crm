'use client';

import { useFormAktion } from '@/components/ui/useFormAktion';
import { Button } from '@/components/ui/Button';
import { Feld, Meldung } from '@/components/ui/Formular';
import { MIN_LAENGE } from '@/lib/auth/passwords-regel';
import { zugangEinrichten, type FormZustand } from './actions';

export function EinrichtungsFormular({ token, email }: { token: string; email: string }) {
  const [zustand, aktion, laeuft] = useFormAktion<FormZustand>(zugangEinrichten, null);
  return (
    <form onSubmit={aktion} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      {/* برای مدیر رمز مرورگر: کدام حساب */}
      <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
      <Feld label="Neues Passwort" name="passwort" type="password" autoComplete="new-password" minLength={MIN_LAENGE} required hinweis={`Mindestens ${MIN_LAENGE} Zeichen.`} />
      <Feld label="Passwort wiederholen" name="passwort2" type="password" autoComplete="new-password" minLength={MIN_LAENGE} required />
      <Feld
        label="Code aus der App"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        className="max-w-[220px] text-[22px] tracking-[0.3em]"
        hinweis="Der 6-stellige Code, den die App nach dem Scannen anzeigt."
      />
      <div className="space-y-5 pt-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird eingerichtet …' : 'Zugang einrichten'}
        </Button>
        <div aria-live="polite">{zustand?.fehler ? <Meldung art="fehler">{zustand.fehler}</Meldung> : null}</div>
      </div>
    </form>
  );
}
