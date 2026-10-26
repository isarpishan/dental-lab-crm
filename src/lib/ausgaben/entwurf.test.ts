import { describe, expect, it } from 'vitest';
import type { BelegVorschlag } from '@/lib/ai-safe';
import { entwurfAus } from './entwurf';

const basis: BelegVorschlag = {
  istRechnung: true,
  lieferant: 'SprintRay Europe GmbH',
  rechnungsnummer: 'INV-1',
  rechnungsdatum: '2026-10-21',
  waehrung: 'EUR',
  netto: 450,
  mwst: 90,
  brutto: 540,
  mwstSatz: '20',
  bereich: 'ddl',
  kategorie: 'material',
  privatKategorie: null,
  beschreibung: 'Crown HT A2',
  unsicher: [],
  hinweis: null,
};

describe('Vorschlag der KI → Formular', () => {
  it('übernimmt eine saubere Rechnung unverändert', () => {
    const e = entwurfAus(basis, '2026-10-24');
    expect(e).toMatchObject({ nettoCent: 45000, mwstCent: 9000, bruttoCent: 54000, mwstSatz: 20, rechnungsdatum: '2026-10-21', kategorie: 'material' });
    expect(e.unsicher).toEqual([]);
  });

  it('nur Brutto und Satz: Netto und MwSt werden gerechnet', () => {
    const e = entwurfAus({ ...basis, netto: null, mwst: null, brutto: 59.88 }, '2026-10-24');
    expect(e).toMatchObject({ nettoCent: 4990, mwstCent: 998, bruttoCent: 5988, mwstSatz: 20 });
  });

  it('Summe stimmt nicht: MwSt aus Brutto − Netto, als unsicher markiert', () => {
    const e = entwurfAus({ ...basis, mwst: 91 }, '2026-10-24');
    expect(e.mwstCent).toBe(9000);
    expect(e.unsicher).toContain('mwst');
  });

  it('MwSt passt nicht zum Satz: »Anderer Betrag«', () => {
    const e = entwurfAus({ ...basis, netto: 100, mwst: 15, brutto: 115 }, '2026-10-24');
    expect(e.mwstSatz).toBeNull();
    expect(e.unsicher).toContain('mwstSatz');
  });

  it('fremde Währung, Zukunftsdatum und unlesbares Datum', () => {
    const usd = entwurfAus({ ...basis, waehrung: 'usd', netto: 10, mwst: 2, brutto: 12 }, '2026-10-24');
    expect(usd.hinweise[0]).toMatch(/Rechnung in USD \(12,00 USD\): bitte den Euro-Betrag/);
    // nie ein Dollarbetrag als Euro: Beträge leer, Original unter »Wofür?«
    expect(usd).toMatchObject({ nettoCent: undefined, mwstCent: undefined, bruttoCent: undefined, mwstSatz: 20, beschreibung: 'Crown HT A2 (Original: USD 12,00)' });
    expect(usd.unsicher).toEqual(expect.arrayContaining(['netto', 'brutto']));
    expect(entwurfAus({ ...basis, waehrung: 'USD', netto: null, mwst: null, brutto: 10, mwstSatz: '0', beschreibung: null }, '2026-10-24').beschreibung).toBe('(Original: USD 10,00)');
    const z = entwurfAus({ ...basis, rechnungsdatum: '2027-01-01' }, '2026-10-24');
    expect(z.rechnungsdatum).toBeUndefined();
    expect(z.unsicher).toContain('rechnungsdatum');
    expect(entwurfAus({ ...basis, rechnungsdatum: '21.10.2026' }, '2026-10-24').rechnungsdatum).toBeUndefined();
  });

  it('reicht den Bereich und die Privat-Kategorie weiter (älterer Vorschlag ohne Bereich = DDL)', () => {
    const p = entwurfAus({ ...basis, lieferant: 'BILLA', bereich: 'privat', kategorie: null, privatKategorie: 'lebensmittel' }, '2026-10-25');
    expect(p.bereich).toBe('privat');
    expect(p.privatKategorie).toBe('lebensmittel');
    const { bereich: _b, privatKategorie: _p, ...alt } = basis;
    expect(entwurfAus(alt as BelegVorschlag, '2026-10-25').bereich).toBe('ddl');
  });
});
