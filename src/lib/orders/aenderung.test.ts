import { describe, expect, it } from 'vitest';
import { aenderungSchema, aenderungText } from './aenderung';

describe('Änderungswunsch', () => {
  it('lesbarer Text', () => {
    expect(aenderungText({ zaehne: [12], arten: ['länger'], text: 'an 11 angleichen' })).toBe('Zahn 12: länger · an 11 angleichen');
    expect(aenderungText({ zaehne: [16, 14, 14], arten: ['Okklusion', 'Kontaktpunkte'], text: ' zu hoch ' })).toBe('Zahn 14, 16: Okklusion, Kontaktpunkte · zu hoch');
    expect(aenderungText({ zaehne: [], arten: [], text: 'Bitte heller' })).toBe('Bitte heller');
    expect(aenderungText({ zaehne: [], arten: ['Form'], text: 'runder' })).toBe('Form · runder');
  });

  it('Text ist Pflicht, Zähne und Arten werden geprüft', () => {
    expect(aenderungSchema.safeParse({ zaehne: [], arten: [], text: '' }).success).toBe(false);
    expect(aenderungSchema.safeParse({ zaehne: [19], arten: [], text: 'abc' }).success).toBe(false);
    expect(aenderungSchema.safeParse({ zaehne: [11], arten: ['dicker'], text: 'abc' }).success).toBe(false);
    expect(aenderungSchema.safeParse({ zaehne: [11, 48], arten: ['Form'], text: 'abc' }).success).toBe(true);
  });
});
