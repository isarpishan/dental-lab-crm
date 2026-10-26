import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { db } from '@/db/client';
import { ausstellerAus } from '@/lib/dokumente/aussteller-werte';
import { heuteIso } from '@/lib/format';
import { belegnummer, voraussichtlicheNummer } from '@/lib/nummern';
import { RechnungPdf } from '@/lib/pdf/rechnung';
import { rechnungsdatenLaden, type Zeile } from './rechnung';
import { faelligAm, monatsgrenzen, type Rechnungsdaten } from './rechnungsdaten';

/**
 * پیش‌نمایش زندهٔ «Einstellungen» (مثل بخش Vorschau در arkan-crm): یک Musterrechnung با همان چیزی که
 * Inhaber در فرم‌های «Aussteller» و «Rechnungen» نوشته، پیش از ذخیره. فیلدی که در درخواست نیست، مقدار
 * ذخیره‌شده را می‌گیرد؛ فیلد خالی همان رفتار سند واقعی را دارد (مثلاً Aussteller خالی ← مقدار Impressum).
 */
const AUSSTELLER_FELDER = ['name', 'zusatz', 'strasse', 'plz', 'ort', 'land', 'telefon', 'email', 'web'] as const;
const RECHNUNG_FELDER = ['iban', 'bic', 'uid', 'zahlungszielTage', 'hinweis', 'fusstext'] as const;

const ohneLeer = (v: string | null) => (v ?? '').replace(/\s/g, '').toUpperCase();

export async function musterVorschau(q: URLSearchParams): Promise<Buffer> {
  const gespeichert = await rechnungsdatenLaden();
  const aussteller = AUSSTELLER_FELDER.some((k) => q.has(k)) ? ausstellerAus(Object.fromEntries(AUSSTELLER_FELDER.map((k) => [k, q.get(k) ?? '']))) : gespeichert.aussteller;
  const zielText = q.get('zahlungszielTage')?.trim();
  const ziel = zielText ? Number(zielText) : NaN;
  const daten: Rechnungsdaten = RECHNUNG_FELDER.some((k) => q.has(k))
    ? {
        iban: ohneLeer(q.get('iban')),
        bic: ohneLeer(q.get('bic')),
        uid: ohneLeer(q.get('uid')),
        // ungültige Eingabe (z. B. «x» oder 200): der gespeicherte Wert, bis das Feld wieder stimmt
        zahlungszielTage: Number.isInteger(ziel) && ziel >= 0 && ziel <= 120 ? ziel : gespeichert.daten.zahlungszielTage,
        hinweis: (q.get('hinweis') ?? '').trim(),
        fusstext: (q.get('fusstext') ?? '').trim(),
      }
    : gespeichert.daten;

  const am = new Date();
  const heute = heuteIso(am);
  const jahr = Number(heute.slice(0, 4));
  // Sammelrechnung für den Vormonat, wie am Monatsanfang üblich
  const [j, m] = heute.split('-').map(Number);
  const vormonat = m === 1 ? `${j - 1}-12` : `${j}-${String(m - 1).padStart(2, '0')}`;
  const zeitraum = monatsgrenzen(vormonat);
  const zeile = (z: Omit<Zeile, 'orderId' | 'betragCent' | 'rabattArt' | 'rabattWert' | 'rabattCent'>): Zeile => ({
    ...z,
    orderId: null,
    rabattArt: null,
    rabattWert: null,
    rabattCent: 0,
    betragCent: z.einzelpreisCent * z.menge,
  });
  const zeilen = [
    zeile({ auftragsnummer: `A-${jahr}-0000`, patientencode: 'P-MUST', leistungsdatum: faelligAm(zeitraum[0], 7), bezeichnung: 'Schiene · Fertige Arbeit · Oberkiefer', menge: 1, einheit: 'Kiefer', einzelpreisCent: 12000 }),
    zeile({ auftragsnummer: `A-${jahr}-0000`, patientencode: 'P-MUST', leistungsdatum: faelligAm(zeitraum[0], 14), bezeichnung: 'Bohrschablone · Unterkiefer', menge: 1, einheit: 'Kiefer', einzelpreisCent: 9000 }),
  ];
  return renderToBuffer(
    createElement(RechnungPdf, {
      titel: 'Rechnung',
      nummer: belegnummer('R', jahr, await voraussichtlicheNummer(db(), 'rechnung', jahr)),
      am,
      aussteller: { ...aussteller, ...daten },
      empfaenger: { name: 'Muster-Ordination Dr. Beispiel', zeilen: ['Musterstraße 1', '1010 Wien'], uid: null, kundennummer: 'K-0000' },
      zeitraum,
      faellig: faelligAm(heute, daten.zahlungszielTage),
      zeilen,
      summeCent: zeilen.reduce((s, z) => s + z.betragCent, 0),
      vorschau: true,
    }) as Parameters<typeof renderToBuffer>[0],
  );
}
