import { describe, expect, it } from 'vitest';
import { euroBetrag, preisAnzeigen, preisLesen } from './preise';

describe('Preise', () => {
  it('liest österreichische Beträge', () => {
    expect(preisLesen('120')).toEqual({ ok: true, wert: 120 });
    expect(preisLesen('120,50')).toEqual({ ok: true, wert: 120.5 });
    expect(preisLesen('€ 1.234,5')).toEqual({ ok: true, wert: 1234.5 });
    expect(preisLesen('  ')).toEqual({ ok: true, wert: null });
    expect(preisLesen('abc').ok).toBe(false);
    expect(preisLesen('-5').ok).toBe(false);
    expect(preisLesen('1,234').ok).toBe(false);
    // Tausenderpunkt ohne Komma (Spec فاز ۵): eindeutig nur mit genau drei Ziffern danach
    expect(preisLesen('3.000')).toEqual({ ok: true, wert: 3000 });
    expect(preisLesen('120.000')).toEqual({ ok: true, wert: 120000 });
    expect(preisLesen('12.50')).toEqual({ ok: true, wert: 12.5 });
    expect(preisLesen('12.5')).toEqual({ ok: true, wert: 12.5 });
    expect(preisLesen('1.23.456').ok).toBe(false);
  });
  it('zeigt Beträge wie in Österreich', () => {
    expect(preisAnzeigen(120.5)).toBe('120,50');
    expect(preisAnzeigen(null)).toBe('');
    expect(euroBetrag(89.5)).toMatch(/^€\s89,50$/);
    expect(euroBetrag(120)).toMatch(/^€\s120$/);
  });
});
