'use client';

import { Button } from '@/components/ui/Button';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Benachrichtigung } from '@/db/schema';
import type { Ergebnis } from '@/lib/aktion';
import { BENACHRICHTIGUNG_NAMEN } from '@/lib/benachrichtigungen/regeln';

/**
 * «E-Mail-Benachrichtigungen»: یک ردیف برای هر رویداد، با خط جداکننده مثل فهرست‌های سایت.
 * در پورتال (Praxis-Admin) و در صفحهٔ Ordination داخلی. بدون حق تغییر فقط «An / Aus» دیده می‌شود.
 */
export function EinstellungenFormular({
  werte,
  aktion,
  bearbeitbar,
  practiceId,
}: {
  werte: Record<Benachrichtigung, boolean>;
  aktion: (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
  bearbeitbar: boolean;
  /** فقط در پنل داخلی */
  practiceId?: string;
}) {
  const [zustand, senden, laeuft] = useFormAktion<Ergebnis>(aktion, null);
  const zeilen = (
    <ul className="border-t border-line" aria-label="E-Mail-Benachrichtigungen">
      {(Object.entries(BENACHRICHTIGUNG_NAMEN) as [Benachrichtigung, { titel: string; text: string }][]).map(([k, n]) => {
        return (
          <li key={k} className="border-b border-line">
            {bearbeitbar ? (
              <label className="flex cursor-pointer items-start gap-4 py-4">
                <input type="checkbox" name="an" value={k} defaultChecked={werte[k]} className="mt-1.5 size-4 shrink-0 accent-rose" />
                <span className="min-w-0">
                  <span className="block text-[17px] font-light">{n.titel}</span>
                  <span className="block text-[13px] text-muted">{n.text}</span>
                </span>
              </label>
            ) : (
              <div className="flex items-start justify-between gap-4 py-4">
                <span className="min-w-0">
                  <span className="block text-[17px] font-light">{n.titel}</span>
                  <span className="block text-[13px] text-muted">{n.text}</span>
                </span>
                <span className={`shrink-0 text-[13px] ${werte[k] ? 'text-white' : 'text-muted'}`}>{werte[k] ? 'An' : 'Aus'}</span>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
  if (!bearbeitbar) return <div className="max-w-[760px]">{zeilen}</div>;
  return (
    <form onSubmit={senden} className="max-w-[760px]">
      {practiceId ? <input type="hidden" name="practiceId" value={practiceId} /> : null}
      {zeilen}
      <div className="mt-8 flex flex-wrap items-center gap-6">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
      </div>
      <div className="mt-6" aria-live="polite">
        <Rueckmeldung zustand={zustand} />
      </div>
    </form>
  );
}
