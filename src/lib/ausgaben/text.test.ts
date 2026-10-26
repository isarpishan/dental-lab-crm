import { describe, expect, it } from 'vitest';
import { afaPruefen, ausBrutto, belegTypVon, lieferantNormal, monatTitel, mwstAusNetto, mwstPasst } from './text';

describe('Ausgaben: Beträge', () => {
  it('MwSt aus Netto, gerundet', () => {
    expect(mwstAusNetto(10000, 20)).toBe(2000);
    expect(mwstAusNetto(999, 20)).toBe(200);
    expect(mwstAusNetto(1234, 13)).toBe(160);
    expect(mwstAusNetto(5000, 0)).toBe(0);
  });

  it('Netto aus Brutto, Summe bleibt genau', () => {
    expect(ausBrutto(12000, 20)).toEqual({ nettoCent: 10000, mwstCent: 2000 });
    const r = ausBrutto(1999, 20);
    expect(r.nettoCent + r.mwstCent).toBe(1999);
    expect(ausBrutto(1100, 10)).toEqual({ nettoCent: 1000, mwstCent: 100 });
  });

  it('MwSt passt zum Satz, ein Cent Toleranz', () => {
    expect(mwstPasst(10000, 2000, 20)).toBe(true);
    expect(mwstPasst(10000, 2001, 20)).toBe(true);
    expect(mwstPasst(10000, 2100, 20)).toBe(false);
    expect(mwstPasst(1666, 333, 20)).toBe(true);
  });

  it('AfA nur bei Geräten und Software über € 1.000 brutto', () => {
    expect(afaPruefen({ kategorie: 'geraete', bruttoCent: 100_001 })).toBe(true);
    expect(afaPruefen({ kategorie: 'geraete', bruttoCent: 100_000 })).toBe(false);
    expect(afaPruefen({ kategorie: 'material', bruttoCent: 500_000 })).toBe(false);
  });

  it('Lieferant und Monat', () => {
    expect(lieferantNormal('  Formlabs   GmbH ')).toBe(lieferantNormal('formlabs gmbh'));
    expect(monatTitel('2026-01')).toBe('Jänner 2026');
  });
});

describe('Ausgaben: Belegtyp aus den ersten Bytes', () => {
  const b = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  it('erkennt PDF, JPEG, PNG, WebP, HEIC', () => {
    expect(belegTypVon(b('%PDF-1.7\n'))?.typ).toBe('application/pdf');
    expect(belegTypVon(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.endung).toBe('jpg');
    expect(belegTypVon(b('\x89PNG\r\n\x1a\n\0\0\0\0'))?.typ).toBe('image/png');
    expect(belegTypVon(b('RIFF\0\0\0\0WEBPVP8 '))?.typ).toBe('image/webp');
    expect(belegTypVon(b('\0\0\0\x18ftypheic\0\0\0\0'))?.typ).toBe('image/heic');
  });
  it('lehnt HTML und SVG ab', () => {
    expect(belegTypVon(b('<html><script>'))).toBeNull();
    expect(belegTypVon(b('<svg xmlns='))).toBeNull();
  });
});
