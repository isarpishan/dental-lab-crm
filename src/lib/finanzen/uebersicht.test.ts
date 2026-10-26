import { describe, expect, it } from 'vitest';
import { datenAb, datenVor, monatVerschieben, monatWahl, nachKategorie, uebersichtBerechnen, veraenderung } from './uebersicht';

describe('Übersicht: Monate', () => {
  it('verschiebt über Jahresgrenzen', () => {
    expect(monatVerschieben('2026-10', -5)).toBe('2026-05');
    expect(monatVerschieben('2026-02', -5)).toBe('2025-09');
    expect(monatVerschieben('2026-12', 1)).toBe('2027-01');
    expect(monatVerschieben('2026-01', -1)).toBe('2025-12');
  });

  it('wählt nur gültige Monate bis heute', () => {
    expect(monatWahl(undefined, '2026-10')).toBe('2026-10');
    expect(monatWahl('2026-09', '2026-10')).toBe('2026-09');
    expect(monatWahl('2026-11', '2026-10')).toBe('2026-10');
    expect(monatWahl('2026-13', '2026-10')).toBe('2026-10');
    expect(monatWahl('quatsch', '2026-10')).toBe('2026-10');
  });

  it('lädt ab Jahresanfang oder fünf Monate zurück', () => {
    expect(datenAb('2026-10')).toBe('2026-01-01');
    expect(datenAb('2026-03')).toBe('2025-10-01');
    expect(datenVor('2026-09')).toBe('2026-10-01');
    expect(datenVor('2026-12')).toBe('2027-01-01');
  });
});

describe('Übersicht: Summen', () => {
  const d = {
    einnahmen: [
      { datum: '2026-10-03', cent: 100_000 },
      { datum: '2026-10-31', cent: 50_000 },
      { datum: '2026-09-15', cent: 120_000 },
      { datum: '2025-12-20', cent: 99_999 },
    ],
    fakturiert: [
      { datum: '2026-10-01', cent: 200_000 },
      { datum: '2026-10-20', cent: -20_000 },
    ],
    ausgaben: [
      { datum: '2026-10-05', cent: 30_000, kategorie: 'material' },
      { datum: '2026-10-06', cent: 10_000, kategorie: 'software' },
      { datum: '2026-09-01', cent: 200_000, kategorie: 'geraete' },
      { datum: '2026-11-01', cent: 5_000, kategorie: 'material' },
    ],
  };

  it('Monat, Vormonat und Quote', () => {
    const u = uebersichtBerechnen('2026-10', d);
    expect(u.monat).toEqual({ monat: '2026-10', einnahmenCent: 150_000, fakturiertCent: 180_000, ausgabenCent: 40_000, ueberschussCent: 110_000, quote: 110_000 / 150_000 });
    expect(u.vormonat.ueberschussCent).toBe(-80_000);
    expect(u.vormonat.quote).toBeCloseTo(-80_000 / 120_000);
    expect(u.leer).toBe(false);
  });

  it('Jahr bis Monatsende, ohne Vorjahr und ohne Folgemonat', () => {
    const u = uebersichtBerechnen('2026-10', d);
    expect(u.jahr.einnahmenCent).toBe(270_000);
    expect(u.jahr.ausgabenCent).toBe(240_000);
  });

  it('Verlauf: sechs Monate, gewählter zuletzt', () => {
    const u = uebersichtBerechnen('2026-10', d);
    expect(u.verlauf.map((m) => m.monat)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(u.verlauf[0].quote).toBeNull();
  });

  it('leer, wenn bis Monatsende nichts gebucht ist', () => {
    expect(uebersichtBerechnen('2025-01', { einnahmen: [], fakturiert: [], ausgaben: [{ datum: '2025-02-01', cent: 1, kategorie: 'x' }] }).leer).toBe(true);
  });

  it('Veränderung gegenüber Vormonat', () => {
    expect(veraenderung(150, 100)).toBeCloseTo(0.5);
    expect(veraenderung(50, -100)).toBeCloseTo(1.5);
    expect(veraenderung(10, 0)).toBeNull();
  });
});

describe('Übersicht: Kategorien', () => {
  const alle = (datum: string) => datum.startsWith('2026');
  it('sortiert nach Betrag, Anteile ergeben 1', () => {
    const k = nachKategorie(
      [
        { datum: '2026-01-01', cent: 100, kategorie: 'b' },
        { datum: '2026-01-02', cent: 300, kategorie: 'a' },
        { datum: '2026-01-03', cent: 100, kategorie: 'b' },
      ],
      alle,
    );
    expect(k).toEqual([
      { kategorie: 'a', cent: 300, anteil: 0.6 },
      { kategorie: 'b', cent: 200, anteil: 0.4 },
    ]);
  });

  it('fasst nur zusammen, wenn mehr als eine Kategorie übrig bleibt', () => {
    const sechs = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => ({ datum: '2026-01-01', cent: 600 - i * 100, kategorie: k }));
    expect(nachKategorie(sechs, alle, 5).map((x) => x.kategorie)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    const sieben = [...sechs, { datum: '2026-01-01', cent: 50, kategorie: 'g' }];
    const k = nachKategorie(sieben, alle, 5);
    expect(nachKategorie(sieben, alle).map((x) => x.kategorie)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(k.map((x) => x.kategorie)).toEqual(['a', 'b', 'c', 'd', 'e', null]);
    expect(k[5].cent).toBe(150);
  });

  it('ohne Ausgaben leer', () => {
    expect(nachKategorie([], alle)).toEqual([]);
  });
});
