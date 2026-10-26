'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import type { Ergebnis } from '@/lib/aktion';

function LinkKopieren({ link }: { link: string }) {
  const [kopiert, setKopiert] = useState(false);
  return (
    <div className="mt-4 text-[13px] text-muted">
      Falls die E-Mail nicht ankommt, können Sie den Link auch selbst weitergeben:
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <code className="break-all text-white">{link}</code>
        <Button
          variant="text"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setKopiert(true);
          }}
        >
          {kopiert ? 'Kopiert' : 'Link kopieren'}
        </Button>
      </div>
    </div>
  );
}

/** نتیجهٔ یک server action زیر فرم: خطا، یا موفقیت (با لینک دعوت برای کپی، اگر هست). */
export function Rueckmeldung({ zustand }: { zustand: Ergebnis }) {
  if (!zustand) return null;
  if (zustand.fehler) return <Meldung art="fehler">{zustand.fehler}</Meldung>;
  if (!zustand.erfolg) return null;
  return (
    <Meldung art="erfolg">
      {zustand.erfolg}
      {zustand.link ? <LinkKopieren link={zustand.link} /> : null}
    </Meldung>
  );
}

