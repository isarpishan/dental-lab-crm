import { describe, expect, it } from 'vitest';
import { vorschlaegeBerechnen, rechnungsnummernIn, type BankZeile, type Kandidaten } from './abgleich';
import { auszugAuswerten, fingerabdruecke, jahrKorrigieren, type GelesenerAuszug, type GelesenerUmsatz } from './auswerten';

// erfundene Daten, nicht vom echten Konto
const umsatz = (u: Partial<GelesenerUmsatz>): GelesenerUmsatz => ({
  buchungstag: '2026-09-02',
  valuta: null,
  betrag: -10,
  gegenpartei: null,
  iban: null,
  text: 'Bezahlung Karte',
  referenz: null,
  bereich: 'privat',
  kategorie: null,
  privatKategorie: null,
  rechnungsnummer: null,
  ...u,
});
const auszug = (u: GelesenerUmsatz[], g: Partial<GelesenerAuszug> = {}): GelesenerAuszug => ({
  istKontoauszug: true,
  iban: 'AT00 1234 0000 0000 0001',
  auszugNummer: '9',
  auszugDatum: '2026-09-30',
  alterKontostand: 100,
  neuerKontostand: 100 + u.reduce((s, x) => s + x.betrag, 0),
  summeEin: null,
  summeAus: null,
  umsaetze: u,
  ...g,
});

describe('Bank: Kontoauszug auswerten', () => {
  it('vollständig: Kontostand passt, Beträge in Cent', () => {
    const r = auszugAuswerten(auszug([umsatz({ betrag: -23.4, referenz: 'MC/1' }), umsatz({ betrag: 1500, referenz: 'FE/2' })]));
    expect(r.ok && r.umsaetze.map((u) => u.betragCent)).toEqual([-2340, 150000]);
    expect(r.ok && r.iban).toBe('AT001234000000000001');
  });

  it('fehlende Zeile ← abgelehnt, mit Differenz', () => {
    const r = auszugAuswerten(auszug([umsatz({ betrag: -5 })], { neuerKontostand: 90 }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.fehler).toMatch(/Nicht vollständig gelesen.*5,00.*10,00/);
  });

  it('Summe Ein/Aus wird zusätzlich geprüft (auch als negative Zahl gedruckt)', () => {
    const u = [umsatz({ betrag: -5 }), umsatz({ betrag: 20 })];
    expect(auszugAuswerten(auszug(u, { summeEin: 20, summeAus: -5 })).ok).toBe(true);
    expect(auszugAuswerten(auszug(u, { summeEin: 25, summeAus: 10 })).ok).toBe(false);
  });

  it('kein Kontoauszug, IBAN oder Kontostand fehlt', () => {
    expect(auszugAuswerten(auszug([], { istKontoauszug: false })).ok).toBe(false);
    expect(auszugAuswerten(auszug([], { iban: null })).ok).toBe(false);
    expect(auszugAuswerten(auszug([], { alterKontostand: null })).ok).toBe(false);
  });

  it('Jänner-Auszug mit Dezember-Buchungen ← Vorjahr', () => {
    expect(jahrKorrigieren('2027-12-30', '2027-01-31')).toBe('2026-12-30');
    expect(jahrKorrigieren('2026-09-02', '2026-09-30')).toBe('2026-09-02');
  });

  it('Fingerabdruck: Referenz, sonst Datum, Betrag, Text und Zähler', () => {
    const f = fingerabdruecke('AT00', [
      { buchungstag: '2026-09-01', betragCent: -608, text: 'Entgelt  für Kontoführung', referenz: null },
      { buchungstag: '2026-09-01', betragCent: -608, text: 'Entgelt für Kontoführung', referenz: null },
      { buchungstag: '2026-09-02', betragCent: -2300, text: 'x', referenz: 'mc/000001716' },
    ]);
    expect(f[0]).not.toBe(f[1]);
    expect(f[0].endsWith('|1') && f[1].endsWith('|2')).toBe(true);
    expect(f[2]).toBe('AT00|ref|MC/000001716');
  });
});

describe('Bank: Vorschläge', () => {
  const zeile = (z: Partial<BankZeile>): BankZeile => ({
    id: Math.random().toString(36),
    buchungstag: '2026-10-10',
    betragCent: -1000,
    text: '',
    gegenpartei: null,
    bereich: 'privat',
    kategorie: null,
    privatKategorie: null,
    rechnungsnummer: null,
    ...z,
  });
  const leer: Kandidaten = { rechnungen: [], ausgaben: [], privat: [] };

  it('Rechnungsnummer im Verwendungszweck', () => {
    expect(rechnungsnummernIn('Zahlung R-2026-0012 und r 2026 0013')).toEqual(['R20260012', 'R20260013']);
    const k = { ...leer, rechnungen: [{ id: 'r1', nummer: 'R-2026-0012', offenCent: 50000, praxis: 'Ordi A' }] };
    const z = zeile({ betragCent: 50000, text: 'R2026-0012 Danke', bereich: 'ddl' });
    expect(vorschlaegeBerechnen([z], k).get(z.id)).toMatchObject({ aktion: 'rechnung', id: 'r1', sicher: true, betragCent: 50000 });
  });

  it('Teilzahlungen auf dieselbe Rechnung zählen den offenen Betrag herunter', () => {
    const k = { ...leer, rechnungen: [{ id: 'r1', nummer: 'R-2026-0012', offenCent: 50000, praxis: 'Ordi A' }] };
    const a = zeile({ betragCent: 30000, text: 'R-2026-0012' });
    const b = zeile({ betragCent: 30000, text: 'R-2026-0012' });
    const v = vorschlaegeBerechnen([a, b], k);
    expect(v.get(a.id)).toMatchObject({ aktion: 'rechnung', betragCent: 30000, sicher: true });
    expect(v.get(b.id)).toMatchObject({ aktion: 'rechnung', betragCent: 20000, sicher: false });
  });

  it('nur gleicher offener Betrag ← Rechnung, aber nicht sicher', () => {
    const k = { ...leer, rechnungen: [{ id: 'r1', nummer: 'R-2026-0001', offenCent: 12000, praxis: 'Ordi A' }] };
    const z = zeile({ betragCent: 12000, bereich: 'ddl' });
    expect(vorschlaegeBerechnen([z], k).get(z.id)).toMatchObject({ aktion: 'rechnung', sicher: false });
  });

  it('vorhandene Ausgabe und Privat-Buchung werden verbunden, jede nur einmal', () => {
    const k: Kandidaten = {
      rechnungen: [],
      ausgaben: [{ id: 'a1', bruttoCent: 2190, bezahltAm: '2026-10-08', lieferant: 'Anthropic' }],
      privat: [{ id: 'p1', art: 'einnahme', betragCent: 300000, datum: '2026-10-01', titel: 'Gehalt' }],
    };
    const z1 = zeile({ betragCent: -2190, bereich: 'ddl', gegenpartei: 'ANTHROPIC' });
    const z2 = zeile({ betragCent: -2190, bereich: 'ddl' });
    const z3 = zeile({ betragCent: 300000, buchungstag: '2026-10-03', bereich: 'privat' });
    const v = vorschlaegeBerechnen([z1, z2, z3], k);
    expect(v.get(z1.id)).toMatchObject({ aktion: 'ausgabe', id: 'a1', sicher: true });
    expect(v.get(z2.id)).toMatchObject({ aktion: 'ddl_offen' });
    expect(v.get(z3.id)).toMatchObject({ aktion: 'privat_verbinden', id: 'p1', sicher: true });
  });

  it('zu weit weg ← nicht verbinden', () => {
    const k: Kandidaten = { ...leer, privat: [{ id: 'p1', art: 'ausgabe', betragCent: 1000, datum: '2026-09-01', titel: 'BILLA' }] };
    const z = zeile({ privatKategorie: 'lebensmittel' });
    expect(vorschlaegeBerechnen([z], k).get(z.id)).toMatchObject({ aktion: 'privat_neu', kategorie: 'lebensmittel', sicher: true });
  });

  it('Privat neu: Kategorie muss zur Richtung passen, sonst »Sonstiges« und nicht sicher', () => {
    const a = zeile({ betragCent: 5000, privatKategorie: 'restaurant' });
    const b = zeile({ betragCent: -5000, privatKategorie: 'gehalt' });
    const v = vorschlaegeBerechnen([a, b], leer);
    expect(v.get(a.id)).toMatchObject({ aktion: 'privat_neu', kategorie: 'sonstige_einnahme', sicher: false });
    expect(v.get(b.id)).toMatchObject({ aktion: 'privat_neu', kategorie: 'sonstiges', sicher: false });
  });

  it('fällige Fixkosten des Labors: gleicher Betrag in der Nähe, jede Fälligkeit nur einmal', () => {
    const k: Kandidaten = { ...leer, fixkosten: [{ id: 'l1', betragCent: 2190, faelligAm: '2026-10-09', titel: 'Claude-Abo' }] };
    const a = zeile({ betragCent: -2190, bereich: 'ddl' });
    const b = zeile({ betragCent: -2190, bereich: 'ddl' });
    const weit = zeile({ betragCent: -2190, bereich: 'ddl', buchungstag: '2026-11-30' });
    const v = vorschlaegeBerechnen([a, b, weit], k);
    expect(v.get(a.id)).toEqual({ aktion: 'fixkosten', id: 'l1', text: 'Claude-Abo', sicher: true });
    expect(v.get(b.id)).toMatchObject({ aktion: 'ddl_offen' });
    expect(vorschlaegeBerechnen([weit], k).get(weit.id)).toMatchObject({ aktion: 'ddl_offen' });
    // Eingang nie
    const ein = zeile({ betragCent: 2190, bereich: 'ddl' });
    expect(vorschlaegeBerechnen([ein], k).get(ein.id)?.aktion).not.toBe('fixkosten');
  });

  it('DDL ohne Gegenstück ← »Beleg fehlt«; ignorieren nie sicher', () => {
    const a = zeile({ bereich: 'ddl', kategorie: 'software' });
    const b = zeile({ bereich: 'ignorieren' });
    const v = vorschlaegeBerechnen([a, b], leer);
    expect(v.get(a.id)).toEqual({ aktion: 'ddl_offen', kategorie: 'software', sicher: false });
    expect(v.get(b.id)).toEqual({ aktion: 'ignorieren', sicher: false });
  });
});
