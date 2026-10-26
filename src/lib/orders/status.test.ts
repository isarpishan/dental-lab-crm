import { describe, expect, it } from 'vitest';
import { PORTAL_STATUS } from '@/lib/katalog/stammdaten';
import { moeglicheUebergaenge, STATUS, uebergangErlaubt, type Umstaende } from './status';

const fertigung: Umstaende = { lieferart: 'fertigung', freigabeNoetig: true };
const design: Umstaende = { lieferart: 'design', freigabeNoetig: true };

describe('Status-Übergänge', () => {
  it('kennt genau die Status aus den Stammdaten', () => {
    expect([...STATUS].sort()).toEqual(PORTAL_STATUS.map((s) => s.key).sort());
  });

  it('Entwurf → eingereicht oder Rückfrage, von beiden Seiten', () => {
    for (const wer of ['praxis', 'labor'] as const) {
      expect(uebergangErlaubt('entwurf', 'eingereicht', wer, fertigung)).toBe(true);
      expect(uebergangErlaubt('entwurf', 'rueckfrage', wer, fertigung)).toBe(true);
    }
    expect(uebergangErlaubt('entwurf', 'in_produktion', 'labor', fertigung)).toBe(false);
  });

  it('nur das Labor plant und stellt Rückfragen', () => {
    expect(uebergangErlaubt('eingereicht', 'in_planung', 'labor', fertigung)).toBe(true);
    expect(uebergangErlaubt('eingereicht', 'in_planung', 'praxis', fertigung)).toBe(false);
    expect(uebergangErlaubt('in_planung', 'rueckfrage', 'praxis', fertigung)).toBe(false);
  });

  it('Freigabe gibt nur die Ordination, je nach Lieferart', () => {
    expect(uebergangErlaubt('design_freigabe', 'in_produktion', 'praxis', fertigung)).toBe(true);
    expect(uebergangErlaubt('design_freigabe', 'freigegeben', 'praxis', fertigung)).toBe(false);
    expect(uebergangErlaubt('design_freigabe', 'freigegeben', 'praxis', design)).toBe(true);
    expect(uebergangErlaubt('design_freigabe', 'in_produktion', 'praxis', design)).toBe(false);
    expect(uebergangErlaubt('design_freigabe', 'in_produktion', 'labor', fertigung)).toBe(false);
  });

  it('ohne Freigabe geht es von der Planung direkt weiter', () => {
    const ohne = { lieferart: 'fertigung', freigabeNoetig: false } as const;
    expect(uebergangErlaubt('in_planung', 'in_produktion', 'labor', ohne)).toBe(true);
    expect(uebergangErlaubt('in_planung', 'design_freigabe', 'labor', ohne)).toBe(false);
    expect(uebergangErlaubt('in_planung', 'in_produktion', 'labor', fertigung)).toBe(false);
  });

  it('Überarbeitung nach Freigabe nur bei »Nur Design«', () => {
    expect(uebergangErlaubt('freigegeben', 'in_ueberarbeitung', 'praxis', design)).toBe(true);
    expect(uebergangErlaubt('freigegeben', 'in_ueberarbeitung', 'praxis', fertigung)).toBe(false);
  });

  it('die Ordination storniert nur vor der Produktion', () => {
    expect(moeglicheUebergaenge('eingereicht', 'praxis', fertigung)).toContain('storniert');
    expect(moeglicheUebergaenge('in_planung', 'praxis', fertigung)).toContain('storniert');
    for (const s of ['in_produktion', 'einprobe', 'fertig', 'versendet'] as const) {
      expect(moeglicheUebergaenge(s, 'praxis', fertigung)).not.toContain('storniert');
    }
  });

  it('nach der Qualitätskontrolle zurück in die Produktion, nur durch das Labor', () => {
    expect(uebergangErlaubt('fertig', 'in_produktion', 'labor', fertigung)).toBe(true);
    expect(uebergangErlaubt('fertig', 'in_produktion', 'praxis', fertigung)).toBe(false);
    expect(uebergangErlaubt('versendet', 'fertig', 'labor', fertigung)).toBe(false);
  });

  it('abgeschlossen und storniert sind endgültig', () => {
    for (const wer of ['praxis', 'labor'] as const) {
      expect(moeglicheUebergaenge('abgeschlossen', wer, fertigung)).toEqual([]);
      expect(moeglicheUebergaenge('storniert', wer, fertigung)).toEqual([]);
    }
  });
});
