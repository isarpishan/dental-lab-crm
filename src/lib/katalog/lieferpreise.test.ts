import { describe, expect, it } from 'vitest';
import { abPreise, lieferPreis, preisZeilen } from './lieferpreise';

const krone = { design: { preisAb: 29, einheit: 'Zahn' as const }, fertigung: { preisAb: 250, einheit: 'Zahn' as const } };
// Leerzeichen nach € kann ein geschütztes sein
const ohneNbsp = (zeilen: string[]) => zeilen.map((z) => z.replace(/\s/g, ' '));

describe('Preise auf den Kacheln', () => {
  it('jede Lieferart mit eigenem Namen, Fertig zuerst', () => {
    expect(ohneNbsp(preisZeilen(abPreise(krone)))).toEqual(['Fertig ab € 250 pro Zahn', 'Nur Design ab € 29 pro Zahn']);
  });

  it('Standard-Lieferart »Nur Design« der Ordination steht oben', () => {
    expect(ohneNbsp(preisZeilen(abPreise(krone), 'design'))).toEqual(['Nur Design ab € 29 pro Zahn', 'Fertig ab € 250 pro Zahn']);
  });

  it('nur eine Lieferart (Smile Design): eine Zeile', () => {
    expect(ohneNbsp(preisZeilen(abPreise({ design: { preisAb: 199, einheit: 'Fall' } })))).toEqual(['Nur Design ab € 199 pro Fall']);
  });

  it('fehlender Preis wird benannt, nie still weggelassen', () => {
    const p = abPreise({ design: { preisAb: 29, einheit: 'Zahn' }, fertigung: { preisAb: null, einheit: 'Zahn' } });
    expect(ohneNbsp(preisZeilen(p))).toEqual(['Fertig auf Anfrage', 'Nur Design ab € 29 pro Zahn']);
    expect(lieferPreis(p, 'fertigung')).toBe('Preis auf Anfrage');
  });

  it('ohne jeden Preis: nur »Preis auf Anfrage«', () => {
    expect(preisZeilen(abPreise({ design: { preisAb: null, einheit: 'Kiefer' }, fertigung: { preisAb: null, einheit: 'Kiefer' } }))).toEqual(['Preis auf Anfrage']);
  });

  it('Gruppe (Prothese): je Lieferart der niedrigste Preis aller Mitglieder', () => {
    const teil = { design: { preisAb: 120, einheit: 'Kiefer' as const }, fertigung: { preisAb: 400, einheit: 'Kiefer' as const } };
    const total = { design: { preisAb: 99, einheit: 'Kiefer' as const }, fertigung: { preisAb: 450, einheit: 'Kiefer' as const } };
    expect(ohneNbsp(preisZeilen(abPreise(teil, total)))).toEqual(['Fertig ab € 400 pro Kiefer', 'Nur Design ab € 99 pro Kiefer']);
  });
});
