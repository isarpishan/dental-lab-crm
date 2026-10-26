'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';
import type { VereinbarungInhalt } from '@/lib/vereinbarung/text';
import { VereinbarungText } from './VereinbarungText';

/**
 * خواندن و پذیرش در پورتال: متن در یک کادر با اسکرول. تیک و دکمه تا رسیدن به انتهای متن غیرفعال‌اند
 * (IntersectionObserver روی نشانهٔ پایان). فقط Praxis-Admin می‌پذیرد؛ بقیه فقط می‌خوانند. خود سرور
 * نقش و sha256 را دوباره چک می‌کند (`lib/vereinbarung/annahme.ts`).
 */
export function VereinbarungLesen({
  inhalt,
  sha256,
  admin,
  praxis,
  aktion,
}: {
  inhalt: VereinbarungInhalt;
  sha256: string;
  admin: boolean;
  praxis: string;
  aktion: (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
}) {
  const kasten = useRef<HTMLDivElement>(null);
  const ende = useRef<HTMLParagraphElement>(null);
  const [gelesen, setGelesen] = useState(false);
  const [bestaetigt, setBestaetigt] = useState(false);
  const [zustand, absenden, laeuft] = useFormAktion(aktion, null);

  useEffect(() => {
    if (!kasten.current || !ende.current) return;
    const beobachter = new IntersectionObserver(([e]) => e?.isIntersecting && setGelesen(true), { root: kasten.current, threshold: 1 });
    beobachter.observe(ende.current);
    return () => beobachter.disconnect();
  }, []);

  return (
    <div className="max-w-[860px]">
      <div
        ref={kasten}
        tabIndex={0}
        role="region"
        aria-label="Text der Vereinbarung"
        className="max-h-[62vh] overflow-y-auto border-y border-line py-10 pr-4 outline-none focus-visible:border-rose max-[640px]:max-h-[56vh]"
      >
        <VereinbarungText inhalt={inhalt} />
        <p ref={ende} className="mt-12 text-[13px] text-muted">
          Ende der Vereinbarung.
        </p>
      </div>

      {admin ? (
        <form onSubmit={absenden} className="mt-10 grid gap-7">
          <input type="hidden" name="version" value={inhalt.version} />
          <input type="hidden" name="sha256" value={sha256} />
          {!gelesen ? <p className="text-[15px] font-light text-muted">Bitte lesen Sie die Vereinbarung bis zum Ende. Danach können Sie sie annehmen.</p> : null}
          <label className={`flex max-w-[680px] items-start gap-3 text-[15px] font-light ${gelesen ? '' : 'opacity-50'}`}>
            <input
              type="checkbox"
              name="gelesen"
              value="ja"
              disabled={!gelesen}
              checked={bestaetigt}
              onChange={(e) => setBestaetigt(e.target.checked)}
              className="mt-1 size-4 shrink-0 accent-rose"
            />
            <span>
              Ich habe die Vereinbarung gelesen und bin berechtigt, sie für {praxis} abzuschließen.
            </span>
          </label>
          {zustand?.fehler ? <Meldung art="fehler">{zustand.fehler}</Meldung> : null}
          <div>
            <Button type="submit" disabled={!gelesen || !bestaetigt || laeuft}>
              {laeuft ? 'Wird gespeichert …' : 'Vereinbarung annehmen'}
            </Button>
          </div>
          <p className="max-w-[680px] text-[13px] text-muted">
            Die angenommene Fassung wird gespeichert. Sie bekommen eine Bestätigung per E-Mail und finden sie jederzeit unter „Einstellungen“ als PDF. Vertragssprache: Deutsch.
          </p>
        </form>
      ) : (
        <p className="mt-10 max-w-[680px] text-[15px] font-light text-paragraph">
          Annehmen kann nur ein Praxis-Admin von {praxis}. Bis dahin bleibt das Portal gesperrt. Bitte geben Sie Ihrer Praxisleitung Bescheid oder melden Sie sich bei uns unter lab@drpishan.at.
        </p>
      )}
    </div>
  );
}
