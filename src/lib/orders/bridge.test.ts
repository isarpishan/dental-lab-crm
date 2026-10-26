import { describe, expect, it } from 'vitest';
import {
  AuswahlFehler,
  brueckeAnlegen,
  brueckenzahnUmschalten,
  einzelUmschalten,
  entfernen,
  verbundenMitNaechstem,
  zusammenfassung,
  type ZahnAuswahl,
} from './bridge';

const leer: ZahnAuswahl = {};

describe('Brücke', () => {
  it('Enden sind Anker, dazwischen Glieder — Reihenfolge der Klicks egal', () => {
    const a = brueckeAnlegen(leer, 14, 16);
    const b = brueckeAnlegen(leer, 16, 14);
    expect(a).toEqual(b);
    expect(a[16].art).toBe('bruecke_anker');
    expect(a[15].art).toBe('bruecke_glied');
    expect(a[14].art).toBe('bruecke_anker');
  });

  it('geht über die Mittellinie (12 → 22)', () => {
    const a = brueckeAnlegen(leer, 12, 22);
    expect(Object.keys(a).map(Number).sort()).toEqual([11, 12, 21, 22]);
    expect(a[11].art).toBe('bruecke_glied');
    expect(a[21].art).toBe('bruecke_glied');
    expect(verbundenMitNaechstem(a, 11)).toBe(true);
    expect(verbundenMitNaechstem(a, 22)).toBe(false);
  });

  it('im Unterkiefer über die Mittellinie (42 → 32)', () => {
    const a = brueckeAnlegen(leer, 32, 42);
    expect(a[41].art).toBe('bruecke_glied');
    expect(a[31].art).toBe('bruecke_glied');
    expect(a[42].art).toBe('bruecke_anker');
  });

  it('lehnt zwei Kiefer und einzelne Zähne ab', () => {
    expect(() => brueckeAnlegen(leer, 14, 44)).toThrow(AuswahlFehler);
    expect(() => brueckeAnlegen(leer, 14, 14)).toThrow(AuswahlFehler);
  });

  it('Glied ↔ Anker nur in der Mitte, Enden bleiben Anker', () => {
    let a = brueckeAnlegen(leer, 13, 16);
    a = brueckenzahnUmschalten(a, 15);
    expect(a[15].art).toBe('bruecke_anker');
    expect(brueckenzahnUmschalten(a, 16)).toBe(a);
  });

  it('überdeckt alte Brücken und Einzelkronen im Bereich', () => {
    let a = einzelUmschalten(leer, 15, 'krone');
    a = brueckeAnlegen(a, 23, 25);
    a = brueckeAnlegen(a, 14, 16);
    expect(a[15].art).toBe('bruecke_glied');
    a = brueckeAnlegen(a, 24, 26);
    expect(a[23]).toBeUndefined();
    expect(a[26].art).toBe('bruecke_anker');
  });

  it('Krone auf einen Brückenzahn löst die ganze Brücke auf', () => {
    let a = brueckeAnlegen(leer, 14, 16);
    a = einzelUmschalten(a, 15, 'krone');
    expect(a).toEqual({ 15: { art: 'krone' } });
  });

  it('Entfernen eines Brückenzahns entfernt die Brücke', () => {
    const a = entfernen(brueckeAnlegen(leer, 34, 36), 35);
    expect(a).toEqual({});
  });
});

describe('Einzelbehandlungen und Übersicht', () => {
  it('zweiter Klick mit demselben Werkzeug entfernt', () => {
    const a = einzelUmschalten(einzelUmschalten(leer, 11, 'veneer'), 11, 'veneer');
    expect(a).toEqual({});
  });

  it('fasst verständlich zusammen', () => {
    let a = einzelUmschalten(leer, 26, 'krone');
    a = einzelUmschalten(a, 16, 'krone');
    a = einzelUmschalten(a, 21, 'veneer');
    a = brueckeAnlegen(a, 14, 16);
    expect(zusammenfassung(a)).toEqual([
      'Krone: 26',
      'Veneer: 21',
      'Brücke 16–14: Anker 16, 14 · Glied 15',
    ]);
  });
});
