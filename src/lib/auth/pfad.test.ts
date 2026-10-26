import { describe, expect, it } from 'vitest';
import { sichererPfad } from './pfad';

describe('sichererPfad (Rückweg nach der Anmeldung)', () => {
  it('eigene Pfade bleiben', () => {
    expect(sichererPfad('/auftraege/123?tab=dateien')).toBe('/auftraege/123?tab=dateien');
    expect(sichererPfad('/s/A-2026-0001')).toBe('/s/A-2026-0001');
    expect(sichererPfad('/auftraege/%2F%2Fx')).toBe('/auftraege/%2F%2Fx');
  });
  it('fremde Ziele werden zur Startseite', () => {
    for (const boese of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      ' /evil',
      '/ /evil.example',
      '/a\\b',
      'evil.example',
      'javascript:alert(1)',
      '',
      null,
      undefined,
      `/${'a'.repeat(600)}`,
    ]) {
      expect(sichererPfad(boese)).toBe('/');
    }
  });
});
