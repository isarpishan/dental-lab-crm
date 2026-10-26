'use client';

import { useFormAktion } from '@/components/ui/useFormAktion';
import { Button } from '@/components/ui/Button';
import { Feld, Meldung } from '@/components/ui/Formular';
import { MIN_LAENGE } from '@/lib/auth/passwords-regel';
import { portalZugangEinrichten, type FormZustand } from './actions';

export function PortalEinrichtungsFormular({ token, email }: { token: string; email: string }) {
  const [zustand, aktion, laeuft] = useFormAktion<FormZustand>(portalZugangEinrichten, null);
  return (
    <form onSubmit={aktion} className="space-y-6">
      <input type="hidden" name="token" value={token} />
      {/* برای مدیر رمز مرورگر: کدام حساب */}
      <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
      <Feld label="Neues Passwort" name="passwort" type="password" autoComplete="new-password" minLength={MIN_LAENGE} required hinweis={`Mindestens ${MIN_LAENGE} Zeichen.`} />
      <Feld label="Passwort wiederholen" name="passwort2" type="password" autoComplete="new-password" minLength={MIN_LAENGE} required />
      <div className="space-y-5 pt-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird eingerichtet …' : 'Zugang einrichten'}
        </Button>
        <div aria-live="polite">{zustand?.fehler ? <Meldung art="fehler">{zustand.fehler}</Meldung> : null}</div>
      </div>
    </form>
  );
}
