import { describe, expect, it } from 'vitest';
import { monateImJahr, steuerVorschau, tarifSteuerCent, type SteuerEingaben } from './rechnen';
import { JAHRESWERTE, werteFuer } from './werte';

const w = JAHRESWERTE[2026];

describe('Steuer: Tarif 2026', () => {
  it('Stufen von Hand nachgerechnet', () => {
    expect(tarifSteuerCent(1_353_900, w.tarif)).toBe(0);
    expect(tarifSteuerCent(2_199_200, w.tarif)).toBe(169_060); // 8.453 × 20 %
    expect(tarifSteuerCent(3_000_000, w.tarif)).toBe(409_300); // + 8.008 × 30 %
    expect(tarifSteuerCent(-500, w.tarif)).toBe(0);
  });

  it('Gehalt 2.000 × 12 = 24.000 ← Tarif € 2.293,00 (vor Absetzbeträgen)', () => {
    expect(tarifSteuerCent(200_000 * 12, w.tarif)).toBe(229_300); // 1.690,60 + 2.008 × 30 %
  });

  it('unbekanntes Jahr ← Werte des letzten bekannten, als geschätzt markiert', () => {
    expect(werteFuer(2026).geschaetzt).toBe(false);
    expect(werteFuer(2027)).toMatchObject({ geschaetzt: true, werte: { jahr: 2026 } });
  });
});

describe('Steuer: Vorschau', () => {
  const basis: SteuerEingaben = { gehaltMonatCent: 200_000, gehaltMonate: 12, beginn: '2026-10-03', svsQuartalCent: null, vorauszahlungenCent: 0, gewinnSchaetzungCent: null };

  it('Monate der Selbständigkeit', () => {
    expect(monateImJahr('2026-10-03', 2026)).toBe(3);
    expect(monateImJahr('2025-05-01', 2026)).toBe(12);
    expect(monateImJahr('2027-01-01', 2026)).toBe(0);
  });

  it('Gründungsjahr: hochgerechnet, Mindestbeiträge 160,81 €/Monat, PV-Nachzahlung, keine KV-Nachzahlung', () => {
    const v = steuerVorschau(2026, '2026-10-25', basis, { gewinnBisHeuteCent: 300_000 }, w);
    expect(v).toMatchObject({ gruendungsjahr: 1, monateSelbstaendig: 3, monateBisher: 1, gewinnJahrCent: 900_000, gewinnQuelle: 'hochgerechnet' });
    expect(v.svsLaufendCent).toBe(48_243); // 3 × 160,81
    expect(v.gewinnfreibetragCent).toBe(127_764); // 15 % von 8.517,57
    expect(v.gewinnSteuerlichCent).toBe(723_993);
    expect(v.steuerOhneCent).toBe(229_300);
    expect(v.steuerMitCent).toBe(446_498); // beide Teile in der 30-%-Stufe: Mehrsteuer gleich 30 % des Gewinns
    expect(v.estMehrCent).toBe(217_198);
    expect(v.beitragsgrundlageCent).toBe(765_821); // Einkünfte + PV 305,86 + KV 112,42
    expect(v.pvNachCent).toBe(111_091); // 18,5 % von (7.658,21 − 1.653,30)
    expect(v.kvNachCent).toBe(0);
    expect(v.ruecklageCent).toBe(328_289);
    expect(v.ruecklageMonatCent).toBe(109_430);
    expect(v.ruecklageQuote).toBeCloseTo(0.3648, 3);
  });

  it('drittes Jahr: auch KV wird nachbemessen; eigene Schätzung und Vorschreibung gelten', () => {
    const v = steuerVorschau(2026, '2026-10-25', { ...basis, beginn: '2024-01-15', svsQuartalCent: 50_000, gewinnSchaetzungCent: 2_400_000, vorauszahlungenCent: 100_000 }, { gewinnBisHeuteCent: 0 }, w);
    expect(v).toMatchObject({ gruendungsjahr: 3, monateSelbstaendig: 12, gewinnJahrCent: 2_400_000, gewinnQuelle: 'schaetzung', svsQuelle: 'vorschreibung', svsLaufendCent: 200_000 });
    expect(v.kvNachCent).toBeGreaterThan(0);
    expect(v.estOffenCent).toBe(v.estMehrCent - 100_000);
  });

  it('Verlust: Steuer sinkt (Gutschrift), keine SVS-Nachzahlung, Rücklage 0 je Monat', () => {
    const v = steuerVorschau(2026, '2026-12-31', basis, { gewinnBisHeuteCent: -200_000 }, w);
    expect(v.gewinnfreibetragCent).toBe(0);
    expect(v.estMehrCent).toBeLessThan(0);
    expect(v.svsNachCent).toBe(0);
    expect(v.ruecklageMonatCent).toBe(0);
    expect(v.ruecklageQuote).toBeNull();
  });

  it('Höchstbeitragsgrundlage begrenzt die Nachzahlung', () => {
    const v = steuerVorschau(2026, '2026-12-31', { ...basis, beginn: '2020-01-01', gewinnSchaetzungCent: 50_000_000 }, { gewinnBisHeuteCent: 0 }, w);
    expect(v.beitragsgrundlageCent).toBe(8_085 * 12 * 100);
  });
});
