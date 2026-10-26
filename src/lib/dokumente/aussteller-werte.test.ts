import { describe, expect, it } from 'vitest';
import { AUSSTELLER } from '@/lib/katalog/stammdaten';
import { AUSSTELLER_STANDARD, ausstellerAus } from './aussteller-werte';

describe('Aussteller', () => {
  it('Stammdaten mit getrennter PLZ: Ort enthält die PLZ', () => {
    const a = ausstellerAus(AUSSTELLER);
    expect(a.ort).toBe('1200 Wien');
    expect(a.strasse).toBe('Adalbert-Stifter-Straße 35/6/1');
  });

  it('PLZ steht nicht doppelt, wenn der Ort sie schon hat', () => {
    expect(ausstellerAus({ plz: '1200', ort: '1200 Wien' }).ort).toBe('1200 Wien');
  });

  it('ohne Einstellung oder mit leeren Feldern: Werte aus dem Impressum', () => {
    expect(ausstellerAus(undefined)).toEqual(AUSSTELLER_STANDARD);
    expect(ausstellerAus({ name: ' ', ort: '' }).name).toBe(AUSSTELLER_STANDARD.name);
    expect(ausstellerAus('kaputt')).toEqual(AUSSTELLER_STANDARD);
  });
});
