import { describe, expect, it } from 'vitest';
import { anwenden, betroffeneKiefer, hatBasis, zusammenfassung, type ProthesenAuswahl } from './prothese';

const leer: ProthesenAuswahl = {};

describe('Teilprothese', () => {
  it('Ersatzzahn bringt automatisch Basis mit', () => {
    const a = anwenden(leer, 11, 'ersatzzahn');
    expect(hatBasis(a[11])).toBe(true);
  });

  it('Klammer nur auf verbleibenden Zähnen', () => {
    let a = anwenden(leer, 13, 'klammer');
    expect(a[13].klammer).toBe(true);
    a = anwenden(a, 13, 'ersatzzahn');
    expect(a[13]).toEqual({ zahn: 'ersatzzahn' });
    expect(anwenden(a, 13, 'klammer')).toBe(a);
  });

  it('Basis unter ersetztem Zahn lässt sich nicht einzeln entfernen', () => {
    const a = anwenden(leer, 21, 'extraktion');
    expect(anwenden(a, 21, 'basis')).toBe(a);
  });

  it('zweiter Klick entfernt, leere Einträge verschwinden', () => {
    const a = anwenden(anwenden(leer, 24, 'basis'), 24, 'basis');
    expect(a).toEqual({});
  });

  it('erkennt betroffene Kiefer und fasst zusammen', () => {
    let a = anwenden(leer, 11, 'ersatzzahn');
    a = anwenden(a, 21, 'extraktion');
    a = anwenden(a, 13, 'klammer');
    a = anwenden(a, 23, 'klammer');
    expect(betroffeneKiefer(a)).toEqual(['OK']);
    expect(zusammenfassung(a)).toEqual([
      'Ersatzzahn: 11',
      'Extraktion (wird ersetzt): 21',
      'Klammer: 13, 23',
    ]);
  });
});
