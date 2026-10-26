import { describe, expect, it } from 'vitest';
import { istIsoDatum, monatsRaster, monatTitel, monatVerschieben, naechsterTourTag, plusTage, tageText, tagKurz, tagLang, wochenBeginn, wochentag, wocheVon } from './plan';

describe('Datum', () => {
  it('Wochentag nach ISO (Mo = 1)', () => {
    expect(wochentag('2026-10-01')).toBe(4); // Donnerstag
    expect(wochentag('2026-10-05')).toBe(1);
    expect(wochentag('2026-10-04')).toBe(7);
  });

  it('Tage zählen, auch über die Zeitumstellung (25.10.2026)', () => {
    expect(plusTage('2026-10-24', 1)).toBe('2026-10-25');
    expect(plusTage('2026-10-25', 1)).toBe('2026-10-26');
    expect(plusTage('2026-12-31', 1)).toBe('2027-01-01');
    expect(plusTage('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('Texte auf Österreichisch', () => {
    expect(tagKurz('2026-10-08')).toBe('Do, 08.10.');
    expect(tagLang('2027-01-04')).toBe('Montag, 4. Jänner 2027');
    expect(monatTitel('2027-01-15')).toBe('Jänner 2027');
  });

  it('nur echte Daten', () => {
    expect(istIsoDatum('2026-02-29')).toBe(false);
    expect(istIsoDatum('2028-02-29')).toBe(true);
    expect(istIsoDatum('2026-1-5')).toBe(false);
    expect(istIsoDatum(undefined)).toBe(false);
  });
});

describe('Tourtage', () => {
  it('Text: Läufe ab drei Tagen mit Strich', () => {
    expect(tageText([1, 2, 3, 4, 5])).toBe('Mo–Fr');
    expect(tageText([5, 1, 3])).toBe('Mo, Mi, Fr');
    expect(tageText([1, 2, 4])).toBe('Mo, Di, Do');
    expect(tageText([])).toBe('–');
  });

  it('nächster Tourtag ab einem Datum (der Tag selbst zählt)', () => {
    expect(naechsterTourTag([2, 4], '2026-10-01')).toBe('2026-10-01'); // Do
    expect(naechsterTourTag([2, 4], '2026-10-02')).toBe('2026-10-06'); // Fr → Di
    expect(naechsterTourTag([1], '2026-10-06')).toBe('2026-10-12');
    expect(naechsterTourTag([], '2026-10-01')).toBeNull();
  });
});

describe('Kalender', () => {
  it('Woche von Montag bis Sonntag', () => {
    expect(wochenBeginn('2026-10-01')).toBe('2026-09-28');
    expect(wocheVon('2026-10-04')).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  });

  it('Monatsraster mit vollen Wochen', () => {
    const okt = monatsRaster('2026-10-17');
    expect(okt[0][0]).toBe('2026-09-28');
    expect(okt[okt.length - 1][6]).toBe('2026-11-01');
    expect(okt.length).toBe(5);
    // Februar 2027 beginnt am Montag und hat genau 4 Wochen
    expect(monatsRaster('2027-02-10').length).toBe(4);
  });

  it('Monat vor und zurück', () => {
    expect(monatVerschieben('2026-12-15', 1)).toBe('2027-01-01');
    expect(monatVerschieben('2026-01-31', -1)).toBe('2025-12-01');
  });
});
