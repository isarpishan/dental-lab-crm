'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Feld, Meldung } from '@/components/ui/Formular';
import { zeitraumFehler, type Zeitraum } from '@/lib/abrechnung/zeitraum';

/**
 * خروجی Excel برای Steuerberater (Spec فاز ۲، قدم ۵): یک فرم GET ساده به `/api/abrechnung/export`، تا
 * مرورگر فایل را مستقیم دانلود کند و صفحه سر جایش بماند. دورهٔ نادرست پیش از ارسال گفته می‌شود.
 */
export function ExportFormular({
  von,
  bis,
  vorlagen,
  ziel = '/api/abrechnung/export',
  knopf = 'Excel herunterladen',
}: {
  von: string;
  bis: string;
  vorlagen: Zeitraum[];
  /** «Ausgaben»: ZIP mit Excel und Belegen */
  ziel?: string;
  knopf?: string;
}) {
  const [fehler, setFehler] = useState<string | null>(null);
  return (
    <div>
      <form
        method="get"
        action={ziel}
        aria-label="Export für die Steuerberatung"
        className="grid max-w-[680px] gap-6 sm:grid-cols-2"
        onSubmit={(e) => {
          const f = new FormData(e.currentTarget);
          const x = zeitraumFehler(String(f.get('von') ?? ''), String(f.get('bis') ?? ''));
          if (x) e.preventDefault();
          setFehler(x);
        }}
      >
        <Feld label="Von" name="von" type="date" defaultValue={von} required />
        <Feld label="Bis" name="bis" type="date" defaultValue={bis} required />
        {fehler ? (
          <div className="sm:col-span-2">
            <Meldung art="fehler">{fehler}</Meldung>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Button type="submit">{knopf}</Button>
        </div>
      </form>
      <p className="mt-8 flex flex-wrap items-baseline gap-x-6 gap-y-3 text-[13px]">
        <span className="text-muted">Direkt:</span>
        {vorlagen.map((v) => (
          <a key={v.name} href={`${ziel}?von=${v.von}&bis=${v.bis}`} className="border-b border-current pb-1 text-muted hover:text-white">
            {v.name}
          </a>
        ))}
      </p>
    </div>
  );
}
