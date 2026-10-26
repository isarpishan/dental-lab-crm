'use client';

import { Auswahl, Feld } from '@/components/ui/Formular';
import type { ImplantatAngaben } from '@/lib/orders/assistent';

/**
 * قطعهٔ `implantat`: همان فهرست چت‌بات DDL (Spec، بخش D). Hersteller از تنظیمات
 * می‌آید و «Andere» همیشه هست. موقعیت Implantat از Zahnleiste خوانده می‌شود.
 */
export function ImplantatAngabenFeld({
  wert,
  onChange,
  hersteller,
  positionen,
}: {
  wert: ImplantatAngaben | undefined;
  onChange: (neu: ImplantatAngaben) => void;
  hersteller: string[];
  positionen: number[];
}) {
  const w = wert ?? {};
  const setzen = (feld: keyof ImplantatAngaben) => (e: { target: { value: string } }) => onChange({ ...w, [feld]: e.target.value });

  return (
    <div className="grid max-w-[760px] grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2">
      {positionen.length ? (
        <p className="text-[15px] text-muted md:col-span-2">
          {positionen.length === 1 ? 'Implantatposition' : 'Implantatpositionen'}: {positionen.join(', ')}
        </p>
      ) : null}
      <Auswahl
        label="Implantathersteller"
        required
        value={w.hersteller ?? ''}
        onChange={setzen('hersteller')}
        optionen={[{ wert: '', label: 'Bitte wählen' }, ...hersteller.map((h) => ({ wert: h, label: h })), { wert: 'andere', label: 'Andere' }]}
      />
      {w.hersteller === 'andere' ? <Feld label="Hersteller (Name)" required value={w.herstellerAndere ?? ''} onChange={setzen('herstellerAndere')} /> : null}
      <Feld label="Implantatsystem / Plattform" required value={w.system ?? ''} onChange={setzen('system')} />
      <Feld label="Scanbody-Hersteller" value={w.scanbodyHersteller ?? ''} onChange={setzen('scanbodyHersteller')} />
      <Feld label="Scanbody-Typ" value={w.scanbodyTyp ?? ''} onChange={setzen('scanbodyTyp')} />
      <Feld label="Scanbody-Artikelnummer" value={w.scanbodyArtikel ?? ''} onChange={setzen('scanbodyArtikel')} />
    </div>
  );
}
