import { describe, expect, it } from 'vitest';
import type { Block } from './form-schema';
import { preisAusPositionen, preisGross, preisKurz, preisSchaetzung } from './preis';

const leiste: Block = { typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['krone'] } as Block;
const kronen = (...fdi: number[]) => ({ zaehne: Object.fromEntries(fdi.map((f) => [String(f), { art: 'krone' }])) });

describe('Preis für die Ordination', () => {
  it('Krone Express: Zähne × ab-Preis plus Zuschlag, mit Summe', () => {
    const p = preisSchaetzung({
      behandlung: 'Krone',
      lieferart: 'fertigung',
      option: { preisAb: 250, einheit: 'Zahn' },
      tempo: 'express',
      zuschlag: { betrag: 30, einheit: 'Auftrag' },
      bloecke: [leiste],
      antworten: kronen(16, 26),
    });
    expect(p.art).toBe('schaetzung');
    expect(p.bekanntCent).toBe(53000);
    expect(p.offen).toEqual([]);
    expect(p.zeilen.map((z) => [z.menge.replace(/\s/g, ' '), z.betragCent])).toEqual([
      ['2 Zähne × € 250,00', 50000],
      ['1 Auftrag', 3000],
    ]);
    expect(preisGross(p).replace(/\s/g, ' ')).toBe('€ 530,00');
    expect(preisKurz(p)).toBe('netto');
  });

  it('Zuschlag noch ohne Betrag: Summe des Bekannten und »zzgl. … nach Prüfung«', () => {
    const p = preisSchaetzung({
      behandlung: 'Krone',
      lieferart: 'fertigung',
      option: { preisAb: 250, einheit: 'Zahn' },
      tempo: 'same_day',
      zuschlag: { betrag: null, einheit: 'Auftrag' },
      bloecke: [leiste],
      antworten: kronen(16),
    });
    expect(p.bekanntCent).toBe(25000);
    expect(p.offen).toEqual(['Same-Day-Zuschlag']);
    expect(preisKurz(p)).toBe('netto, zzgl. Same-Day-Zuschlag nach Prüfung');
  });

  it('ohne Preis: »Preis auf Anfrage«; Standard ohne Zuschlag-Zeile', () => {
    const p = preisSchaetzung({ behandlung: 'Brücke', lieferart: 'fertigung', option: { preisAb: null, einheit: 'Glied' }, tempo: 'standard', zuschlag: null, bloecke: [leiste], antworten: {} });
    expect(p.zeilen).toHaveLength(1);
    expect(preisGross(p)).toBe('Preis auf Anfrage');
  });

  it('Neuanfertigung kostenlos und verrechnet', () => {
    expect(preisGross(preisAusPositionen([{ bezeichnung: 'Krone – Neuanfertigung, kostenlos', menge: 1, einheit: 'Zahn', einzelpreisCent: 0 }], 'festgelegt'))).toBe('Ohne Berechnung');
    const v = preisAusPositionen([{ bezeichnung: 'Krone', menge: 1, einheit: 'Zahn', einzelpreisCent: 25000, rabatt: { art: 'prozent', wert: 1000 } }], 'verrechnet', 'R-2026-0001');
    expect(v.bekanntCent).toBe(22500);
    expect(v.zeilen[0].menge.replace(/\s/g, ' ')).toBe('1 Zahn · Rabatt 10 %');
    expect(preisKurz(v)).toBe('Rechnung R-2026-0001, netto');
  });
});
