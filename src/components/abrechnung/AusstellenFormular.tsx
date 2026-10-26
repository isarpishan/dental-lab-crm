'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';

/**
 * آخرین قدم پیش‌نمایش: تأیید صریح، چون فاکتور صادرشده دیگر تغییر نمی‌کند (فقط Gutschrift). اگر آدرس
 * ایمیل هست، فاکتور همان موقع با PDF پیوست فرستاده می‌شود (قدم ۳؛ پیش‌فرض روشن).
 */
export function AusstellenFormular({
  practiceId,
  monat,
  orderId,
  gesperrt,
  an,
  stammdaten,
  aktion,
}: {
  practiceId: string;
  monat?: string;
  orderId?: string;
  gesperrt: boolean;
  an: string | null;
  stammdaten: string;
  aktion: (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
}) {
  const [geprueft, setGeprueft] = useState(false);
  const [zustand, absenden, laeuft] = useFormAktion(aktion, null);
  return (
    <form onSubmit={absenden} className="grid max-w-[680px] gap-6" aria-label="Rechnung ausstellen">
      <input type="hidden" name="practiceId" value={practiceId} />
      {monat ? <input type="hidden" name="monat" value={monat} /> : null}
      {orderId ? <input type="hidden" name="orderId" value={orderId} /> : null}
      <label className={`flex items-start gap-3 text-[15px] font-light ${gesperrt ? 'opacity-50' : ''}`}>
        <input
          type="checkbox"
          name="geprueft"
          value="ja"
          disabled={gesperrt}
          checked={geprueft}
          onChange={(e) => setGeprueft(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-rose"
        />
        <span>Ich habe die Rechnung geprüft. Eine ausgestellte Rechnung kann nicht mehr geändert werden, nur mit einer Gutschrift korrigiert.</span>
      </label>
      {an ? (
        <label className={`flex items-start gap-3 text-[15px] font-light ${gesperrt ? 'opacity-50' : ''}`}>
          <input type="checkbox" name="senden" value="ja" defaultChecked disabled={gesperrt} className="mt-1 size-4 shrink-0 accent-rose" />
          <span>Danach als PDF per E-Mail an {an} senden.</span>
        </label>
      ) : (
        <p className="text-[13px] text-muted">
          Keine E-Mail-Adresse für Rechnungen hinterlegt, die Rechnung wird nur ausgestellt.{' '}
          <Link href={stammdaten} className="underline underline-offset-4 hover:text-white">
            In den Stammdaten eintragen
          </Link>
        </p>
      )}
      {zustand?.fehler ? <Meldung art="fehler">{zustand.fehler}</Meldung> : null}
      <div>
        <Button type="submit" disabled={gesperrt || !geprueft || laeuft}>
          {laeuft ? 'Wird ausgestellt …' : 'Rechnung ausstellen'}
        </Button>
      </div>
    </form>
  );
}
