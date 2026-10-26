import { describe, expect, it } from 'vitest';
import { PRODUKTIONSSCHRITTE } from '@/lib/katalog/stammdaten';
import type { Umstaende } from '@/lib/orders/status';
import { erledigenVon, initialen, planVon, spalteVon, zaehneKurz, zielPruefen, type Schritt } from './schritte';

const ALLE: Schritt[] = PRODUKTIONSSCHRITTE.map((s) => ({ key: s.key, label: s.label, portal: s.portal }));
const STANDARD = ['eingang', 'cad_design', 'freigabe_warten', 'druck', 'nachhaertung', 'ausarbeitung', 'qualitaetskontrolle', 'uebergabe'];
const PROTHESE = ['eingang', 'cad_design', 'freigabe_warten', 'druck', 'nachhaertung', 'einprobe', 'ausarbeitung', 'qualitaetskontrolle', 'uebergabe'];
const schritt = (key: string) => ALLE.find((s) => s.key === key)!;
const keys = (p: Schritt[]) => p.map((s) => s.key);

const fertigung: Umstaende = { lieferart: 'fertigung', freigabeNoetig: true };
const design: Umstaende = { lieferart: 'design', freigabeNoetig: true };
const kronePlan = planVon(ALLE, { stepKeys: STANDARD, ...fertigung, einprobe: false });

describe('planVon', () => {
  it('Krone (Fertige Arbeit): alle Standardschritte, ohne Einprobe', () => {
    expect(keys(kronePlan)).toEqual(STANDARD);
  });

  it('Prothese mit Einprobe: Einprobe nach der Nachhärtung', () => {
    const p = planVon(ALLE, { stepKeys: PROTHESE, ...fertigung, einprobe: true });
    expect(keys(p)).toEqual(PROTHESE);
    expect(keys(planVon(ALLE, { stepKeys: PROTHESE, ...fertigung, einprobe: false }))).not.toContain('einprobe');
  });

  it('»Nur Design« endet mit der Freigabe', () => {
    expect(keys(planVon(ALLE, { stepKeys: STANDARD, ...design, einprobe: false }))).toEqual(['eingang', 'cad_design', 'freigabe_warten']);
  });

  it('ohne Freigabe fehlt »Warten auf Freigabe«', () => {
    expect(keys(planVon(ALLE, { stepKeys: STANDARD, lieferart: 'fertigung', freigabeNoetig: false, einprobe: false }))).not.toContain('freigabe_warten');
  });

  it('nur aktive Schritte', () => {
    const ohneNachhaertung = ALLE.filter((s) => s.key !== 'nachhaertung');
    expect(keys(planVon(ohneNachhaertung, { stepKeys: STANDARD, ...fertigung, einprobe: false }))).not.toContain('nachhaertung');
  });
});

describe('spalteVon', () => {
  it('aus dem Status, wenn kein passender Schritt gespeichert ist', () => {
    expect(spalteVon('eingereicht', null, kronePlan, ALLE)).toBe('eingang');
    expect(spalteVon('in_produktion', null, kronePlan, ALLE)).toBe('druck');
    expect(spalteVon('fertig', null, kronePlan, ALLE)).toBe('qualitaetskontrolle');
    expect(spalteVon('versendet', null, kronePlan, ALLE)).toBe('uebergabe');
    expect(spalteVon('rueckfrage', null, kronePlan, ALLE)).toBe('rueckfrage');
    expect(spalteVon('in_ueberarbeitung', null, kronePlan, ALLE)).toBe('ueberarbeitung');
  });

  it('der gespeicherte Schritt gilt nur, wenn er zum Status passt', () => {
    expect(spalteVon('in_produktion', 'ausarbeitung', kronePlan, ALLE)).toBe('ausarbeitung');
    // nach der Freigabe steht noch »cad_design« gespeichert: Status gewinnt
    expect(spalteVon('in_produktion', 'cad_design', kronePlan, ALLE)).toBe('druck');
  });

  it('fertige, stornierte und »Nur Design«-Aufträge nach der Freigabe sind nicht auf dem Brett', () => {
    for (const s of ['entwurf', 'freigegeben', 'geliefert', 'abgeschlossen', 'storniert'] as const) expect(spalteVon(s, null, kronePlan, ALLE)).toBeNull();
  });
});

describe('zielPruefen (Ziehen auf dem Brett)', () => {
  it('innerhalb der Produktion ohne Statuswechsel', () => {
    expect(zielPruefen({ status: 'in_produktion', spalte: 'nachhaertung' }, schritt('ausarbeitung'), fertigung, kronePlan)).toEqual({ ok: true, nach: null });
    expect(zielPruefen({ status: 'in_produktion', spalte: 'ausarbeitung' }, schritt('druck'), fertigung, kronePlan)).toEqual({ ok: true, nach: null });
  });

  it('aus dem 3D-Druck vorwärts nur mit »Erledigt« (Drucker und Charge, MDR)', () => {
    const r = zielPruefen({ status: 'in_produktion', spalte: 'druck' }, schritt('nachhaertung'), fertigung, kronePlan);
    expect(r.ok).toBe(false);
    expect(zielPruefen({ status: 'in_produktion', spalte: 'druck' }, schritt('qualitaetskontrolle'), fertigung, kronePlan).ok).toBe(false);
    expect(zielPruefen({ status: 'in_produktion', spalte: 'druck' }, schritt('nachhaertung'), fertigung, kronePlan, true)).toEqual({ ok: true, nach: null });
  });

  it('mit Statuswechsel, wenn `status.ts` es erlaubt', () => {
    expect(zielPruefen({ status: 'eingereicht', spalte: 'eingang' }, schritt('cad_design'), fertigung, kronePlan)).toEqual({ ok: true, nach: 'in_planung' });
    expect(zielPruefen({ status: 'in_produktion', spalte: 'ausarbeitung' }, schritt('qualitaetskontrolle'), fertigung, kronePlan)).toEqual({ ok: true, nach: 'fertig' });
    expect(zielPruefen({ status: 'fertig', spalte: 'qualitaetskontrolle' }, schritt('uebergabe'), fertigung, kronePlan)).toEqual({ ok: true, nach: 'versendet' });
    // Nacharbeit nach der Qualitätskontrolle
    expect(zielPruefen({ status: 'fertig', spalte: 'qualitaetskontrolle' }, schritt('ausarbeitung'), fertigung, kronePlan)).toEqual({ ok: true, nach: 'in_produktion' });
  });

  it('die Freigabe gibt nur die Ordination', () => {
    const r = zielPruefen({ status: 'design_freigabe', spalte: 'freigabe_warten' }, schritt('druck'), fertigung, kronePlan);
    expect(r.ok).toBe(false);
    expect(zielPruefen({ status: 'in_planung', spalte: 'cad_design' }, schritt('druck'), fertigung, kronePlan)).toEqual({
      ok: false,
      grund: 'Vor der Produktion braucht es die Freigabe der Ordination.',
    });
  });

  it('Rückfrage, Freigabe und Überarbeitung nur über die Auftragsseite', () => {
    for (const k of ['rueckfrage', 'freigabe_warten', 'ueberarbeitung']) {
      expect(zielPruefen({ status: 'in_planung', spalte: 'cad_design' }, schritt(k), fertigung, kronePlan).ok).toBe(false);
    }
  });

  it('Schritte, die nicht zum Auftrag gehören', () => {
    const r = zielPruefen({ status: 'in_produktion', spalte: 'nachhaertung' }, schritt('einprobe'), fertigung, kronePlan);
    expect(r).toEqual({ ok: false, grund: '„Einprobe“ gehört nicht zu diesem Auftrag.' });
  });

  it('zurück über Statusgrenzen nur, wenn erlaubt', () => {
    expect(zielPruefen({ status: 'versendet', spalte: 'uebergabe' }, schritt('qualitaetskontrolle'), fertigung, kronePlan).ok).toBe(false);
    expect(zielPruefen({ status: 'in_produktion', spalte: 'druck' }, schritt('cad_design'), fertigung, kronePlan).ok).toBe(false);
  });

  it('ohne Freigabe: von der Planung direkt in den Druck', () => {
    const ohne = { lieferart: 'fertigung', freigabeNoetig: false } as const;
    const plan = planVon(ALLE, { stepKeys: STANDARD, ...ohne, einprobe: false });
    expect(zielPruefen({ status: 'in_planung', spalte: 'cad_design' }, schritt('druck'), ohne, plan)).toEqual({ ok: true, nach: 'in_produktion' });
  });
});

describe('erledigenVon (»Erledigt«)', () => {
  const prothese = planVon(ALLE, { stepKeys: PROTHESE, ...fertigung, einprobe: true });

  it('geht zum nächsten Schritt des Auftrags', () => {
    expect(erledigenVon({ status: 'eingereicht', spalte: 'eingang' }, fertigung, kronePlan)).toMatchObject({ art: 'weiter', ziel: { key: 'cad_design' }, nach: 'in_planung' });
    expect(erledigenVon({ status: 'in_produktion', spalte: 'druck' }, fertigung, kronePlan)).toMatchObject({ art: 'weiter', ziel: { key: 'nachhaertung' }, nach: null });
    expect(erledigenVon({ status: 'in_produktion', spalte: 'nachhaertung' }, fertigung, prothese)).toMatchObject({ ziel: { key: 'einprobe' }, nach: 'einprobe' });
    expect(erledigenVon({ status: 'einprobe', spalte: 'einprobe' }, fertigung, prothese)).toMatchObject({ ziel: { key: 'ausarbeitung' }, nach: 'in_produktion' });
    expect(erledigenVon({ status: 'fertig', spalte: 'qualitaetskontrolle' }, fertigung, kronePlan)).toMatchObject({ ziel: { key: 'uebergabe' }, nach: 'versendet' });
  });

  it('Übergabe erledigt = geliefert', () => {
    expect(erledigenVon({ status: 'versendet', spalte: 'uebergabe' }, fertigung, kronePlan)).toEqual({ art: 'geliefert' });
  });

  it('Design und Überarbeitung gehen über das Hochladen weiter', () => {
    expect(erledigenVon({ status: 'in_planung', spalte: 'cad_design' }, fertigung, kronePlan).art).toBe('design');
    expect(erledigenVon({ status: 'in_ueberarbeitung', spalte: 'ueberarbeitung' }, fertigung, kronePlan).art).toBe('design');
    expect(erledigenVon({ status: 'in_planung', spalte: 'cad_design' }, design, planVon(ALLE, { stepKeys: STANDARD, ...design, einprobe: false })).art).toBe('design');
  });

  it('Rückfrage und Freigabe warten auf die Ordination', () => {
    expect(erledigenVon({ status: 'rueckfrage', spalte: 'rueckfrage' }, fertigung, kronePlan).art).toBe('warten');
    expect(erledigenVon({ status: 'design_freigabe', spalte: 'freigabe_warten' }, fertigung, kronePlan).art).toBe('warten');
  });
});

describe('initialen', () => {
  it('erster und letzter Name', () => {
    expect(initialen('Isar Pishan')).toBe('IP');
    expect(initialen('Anna Maria Huber')).toBe('AH');
    expect(initialen('Labor')).toBe('LA');
    expect(initialen('  ')).toBeNull();
  });
});

describe('zaehneKurz', () => {
  it('Nachbarn werden zu einer Spanne', () => {
    expect(zaehneKurz([14, 15, 16])).toBe('14–16');
    expect(zaehneKurz([12, 11, 21, 22])).toBe('12–22');
    expect(zaehneKurz([36, 46])).toBe('46, 36');
    expect(zaehneKurz([24])).toBe('24');
  });

  it('kein Lauf über die Kiefergrenze, Doppelte zählen einmal', () => {
    expect(zaehneKurz([28, 48])).toBe('28, 48');
    expect(zaehneKurz([15, 15, 16])).toBe('15–16');
  });

  it('viele einzelne Zähne: nur die Anzahl', () => {
    expect(zaehneKurz([18, 16, 14, 12, 21, 23, 25])).toBe('7 Zähne');
    expect(zaehneKurz([])).toBeNull();
  });
});
