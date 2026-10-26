import type { AssistentZustand } from '@/components/auftrag/AuftragAssistent';
import { LEERER_ENTWURF } from '@/lib/orders/pruefung';
import { brueckeAnlegen } from '@/lib/orders/bridge';
import { anwenden, type ProthesenAuswahl } from '@/lib/orders/prothese';

/**
 * فرم پرشده برای بررسی ظاهر در همهٔ اندازه‌ها (`pnpm qa`):
 * `/vorschau?beispiel=bruecke`، `?beispiel=krone` یا `?beispiel=teilprothese`، و با `&offen=b-zaehne`
 * همان قدم باز می‌ماند.
 */
function teilprothese(): ProthesenAuswahl {
  let p: ProthesenAuswahl = {};
  for (const [fdi, w] of [
    [12, 'ersatzzahn'],
    [22, 'ersatzzahn'],
    [11, 'extraktion'],
    [13, 'klammer'],
    [23, 'klammer'],
  ] as const) {
    p = anwenden(p, fdi, w);
  }
  return p;
}

const BEISPIELE: Record<string, () => Omit<AssistentZustand, 'offen'>> = {
  bruecke: () => ({
    ...LEERER_ENTWURF,
    auswahl: 'bruecke',
    behandlung: 'bruecke',
    antworten: { zaehne: brueckeAnlegen({}, 14, 16), versorgung: 'definitiv', farbe: { system: 'vita_classical', farbe: 'A2' } },
    bestaetigt: { 'b-zaehne': true, 'b-versorgung': true, 'b-farbe': true },
    lieferart: 'fertigung',
    tempo: 'standard',
  }),
  // سه Tempo: Standard، Express و Same-Day (`&offen=tempo`)
  krone: () => ({
    ...LEERER_ENTWURF,
    auswahl: 'krone',
    behandlung: 'krone',
    antworten: { zaehne: { 26: { art: 'krone' } }, versorgung: 'definitiv', farbe: { system: 'vita_classical', farbe: 'A2' } },
    bestaetigt: { 'b-zaehne': true, 'b-versorgung': true, 'b-farbe': true },
    lieferart: 'fertigung',
    tempo: 'same_day',
  }),
  teilprothese: () => ({
    ...LEERER_ENTWURF,
    auswahl: 'prothese',
    behandlung: 'teilprothese',
    antworten: {
      zaehne: teilprothese(),
      prothesenform: 'flipper',
      klammern: 'mit',
      gaumen: 'hufeisen',
      einprobe: true,
      farbe: { system: 'vita_classical', farbe: 'A3.5', farbanpassung: true },
    },
    bestaetigt: Object.fromEntries(['zaehne', 'prothesenform', 'klammern', 'gaumen', 'einprobe', 'farbe'].map((id) => [`b-${id}`, true])),
    lieferart: 'fertigung',
    tempo: 'standard',
  }),
};

export function beispielZustand(name: unknown, offen: unknown): AssistentZustand | undefined {
  const bauen = typeof name === 'string' ? BEISPIELE[name] : undefined;
  if (!bauen) return undefined;
  return { ...bauen(), offen: typeof offen === 'string' ? offen : null };
}
