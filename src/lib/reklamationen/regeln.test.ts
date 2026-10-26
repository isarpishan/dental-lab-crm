import { describe, expect, it } from 'vitest';
import { entscheidungSchema, entscheidungText, gewaehrleistung, meldungSchema, meldungText, reklamierbar } from './regeln';

describe('gewaehrleistung', () => {
  it('24 Monate ab Lieferung, der letzte Tag zählt noch', () => {
    expect(gewaehrleistung('2026-10-02', 24, '2028-10-02')).toEqual({ bis: '2028-10-02', gueltig: true });
    expect(gewaehrleistung('2026-10-02', 24, '2028-10-03')).toEqual({ bis: '2028-10-02', gueltig: false });
  });
  it('kurzer Zielmonat: letzter Tag des Monats', () => {
    expect(gewaehrleistung('2026-08-31', 6, '2027-01-01').bis).toBe('2027-02-28');
    expect(gewaehrleistung('2027-08-31', 6, '2027-01-01').bis).toBe('2028-02-29');
  });
  it('über den Jahreswechsel', () => {
    expect(gewaehrleistung('2026-11-15', 3, '2026-12-01').bis).toBe('2027-02-15');
  });
  it('ohne Lieferdatum zugunsten der Ordination', () => {
    expect(gewaehrleistung(null, 24, '2030-01-01')).toEqual({ bis: null, gueltig: true });
  });
});

describe('reklamierbar', () => {
  it('nur gelieferte Fertige Arbeit', () => {
    expect(reklamierbar('geliefert', 'fertigung')).toBe(true);
    expect(reklamierbar('abgeschlossen', 'fertigung')).toBe(true);
    expect(reklamierbar('versendet', 'fertigung')).toBe(false);
    expect(reklamierbar('in_produktion', 'fertigung')).toBe(false);
    expect(reklamierbar('abgeschlossen', 'design')).toBe(false);
  });
});

describe('Eingaben', () => {
  it('Meldung braucht Grund und Text', () => {
    expect(meldungSchema.safeParse({ grund: 'passung', text: 'Krone sitzt zu hoch' }).success).toBe(true);
    expect(meldungSchema.safeParse({ grund: 'passung', text: 'kurz' }).success).toBe(false);
    expect(meldungSchema.safeParse({ grund: 'zirkon', text: 'Krone sitzt zu hoch' }).success).toBe(false);
  });
  it('Ablehnung nur mit Begründung', () => {
    expect(entscheidungSchema.safeParse({ entscheidung: 'abgelehnt', notiz: '' }).success).toBe(false);
    expect(entscheidungSchema.safeParse({ entscheidung: 'abgelehnt', notiz: 'Okklusion nach Einschleifen in der Ordination verändert.' }).success).toBe(true);
    expect(entscheidungSchema.safeParse({ entscheidung: 'reparatur', notiz: '' }).success).toBe(true);
    expect(entscheidungSchema.safeParse({ entscheidung: 'offen', notiz: '' }).success).toBe(false);
  });
});

describe('Texte', () => {
  it('Meldung: Nummer, Grund, Zähne sortiert', () => {
    expect(meldungText('RK-2026-0001', { grund: 'bruch', zaehne: [16, 14], text: 'Riss am Verbinder' })).toBe('Reklamation RK-2026-0001 · Bruch · Zahn 14, 16\nRiss am Verbinder');
  });
  it('Entscheidung', () => {
    expect(entscheidungText('RK-2026-0001', { entscheidung: 'neuanfertigung', notiz: '', kostenlos: true }, 'A-2026-0007')).toBe(
      'Reklamation RK-2026-0001: Wir fertigen die Arbeit neu an (Auftrag A-2026-0007, ohne Berechnung).',
    );
    expect(entscheidungText('RK-2026-0001', { entscheidung: 'abgelehnt', notiz: 'Nach Ablauf eingeschliffen.', kostenlos: false }, null)).toBe(
      'Reklamation RK-2026-0001: Abgelehnt.\nBegründung: Nach Ablauf eingeschliffen.',
    );
  });
});
