import { describe, expect, it } from 'vitest';
import { aenderungen } from './aktion';

describe('aenderungen', () => {
  it('Reihenfolge der Schlüssel zählt nicht (jsonb sortiert sie um)', () => {
    expect(aenderungen({ d: { einheit: 'Zahn', preisAb: null } }, { d: { preisAb: null, einheit: 'Zahn' } })).toEqual({});
  });
  it('meldet nur echte Änderungen, mit vorher und nachher', () => {
    expect(aenderungen({ a: 1, b: 'x', c: null }, { a: 1, b: 'y', c: undefined })).toEqual({ b: { von: 'x', zu: 'y' } });
  });
});
