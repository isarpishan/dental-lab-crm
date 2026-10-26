import { describe, expect, it } from 'vitest';
import { einheitWort, farbeNormal, farbenLesen, flaschenStand, herstellerFarbe, herstellerRang, lagerStand, mengeText, verwendung, zahlMitBruch } from './material-text';

describe('Materialien: Hilfen', () => {
  it('Menge mit Einheit, Einzahl und Mehrzahl', () => {
    expect(mengeText(1, 'kapsel')).toBe('1 Kapsel');
    expect(mengeText(0, 'kapsel')).toBe('0 Kapseln');
    expect(mengeText(3, 'flasche')).toBe('3 Flaschen');
    expect(mengeText(1, 'flasche')).toBe('1 Flasche');
  });

  it('Farben lesen: Groß, ohne Leerzeichen, ohne Doppel', () => {
    expect(farbenLesen('a1, A2 ;a3\nA2')).toEqual({ farben: ['A1', 'A2', 'A3'] });
    expect(farbenLesen('')).toEqual({ farben: [] });
    expect(farbenLesen('A3.5, Bleach')).toEqual({ farben: ['A3.5', 'BLEACH'] });
    expect(farbenLesen('A1, <b>')).toHaveProperty('fehler');
  });

  it('Zahnfarbe des Auftrags passt zur Charge trotz Komma', () => {
    expect(farbeNormal('A3,5')).toBe(farbeNormal('a3.5 '));
  });

  it('Reihenfolge und Farbe der Hersteller', () => {
    expect(['Detax', 'Formlabs', 'SprintRay'].sort((a, b) => herstellerRang(a) - herstellerRang(b))).toEqual(['SprintRay', 'Formlabs', 'Detax']);
    expect(herstellerFarbe('SprintRay')).toBe('sprintray');
    expect(herstellerFarbe('formlabs')).toBe('formlabs');
    expect(herstellerFarbe('Detax')).toBe('andere');
  });

  it('Verwendung allgemein statt jeder Behandlung', () => {
    expect(verwendung(['teilprothese', 'totalprothese'])).toBe('Prothesen');
    expect(verwendung(['krone', 'inlay', 'veneer', 'implantatkrone'])).toBe('Kronen & Veneers');
    expect(verwendung(['krone', 'bruecke'])).toBe('Kronen & Brücken');
    expect(verwendung(['schiene', 'retainer'])).toBe('Schienen');
    expect(verwendung(['modell', 'neu_x'], { neu_x: 'Neue Behandlung' })).toBe('Modelle · Neue Behandlung');
  });

  it('Lagerstand: Anteil und Stufe', () => {
    expect(lagerStand(11, 15)).toEqual({ prozent: 73, stufe: 'gut' });
    expect(lagerStand(5, 10)).toEqual({ prozent: 50, stufe: 'mittel' });
    expect(lagerStand(1, 10)).toEqual({ prozent: 10, stufe: 'knapp' });
    expect(lagerStand(0, 4)).toEqual({ prozent: 0, stufe: 'knapp' });
    expect(einheitWort(1, 'flasche')).toBe('Flasche');
    expect(einheitWort(11, 'kapsel')).toBe('Kapseln');
    expect(einheitWort(0, 'flasche')).toBe('Flaschen');
    expect(einheitWort(0.5, 'flasche')).toBe('Flasche');
    expect(einheitWort(1.5, 'flasche')).toBe('Flaschen');
  });

  it('angebrochene Flasche zählt anteilig', () => {
    expect(flaschenStand(3, null)).toBe(3);
    expect(flaschenStand(3, 2)).toBe(2.5);
    expect(flaschenStand(1, 1)).toBe(0.25);
    expect(flaschenStand(0, 2)).toBe(0);
    expect(zahlMitBruch(2.5)).toBe('2½');
    expect(zahlMitBruch(0.25)).toBe('¼');
    expect(zahlMitBruch(1.75)).toBe('1¾');
    expect(zahlMitBruch(3)).toBe('3');
    expect(lagerStand(2.5, 4)).toEqual({ prozent: 63, stufe: 'gut' });
  });
});
