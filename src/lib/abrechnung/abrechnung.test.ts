import { describe, expect, it } from 'vitest';
import { centEingabe, centLesen, centText } from './geld';
import { leistungsdatum, monatName, monatVon } from './leistung';
import { menge, positionBetrag, rabattAnzeige, rabattCent, rabattEingabe, rabattLesen, summe, vorschlag, type Grundlage } from './positionen';

const basis: Grundlage = {
  behandlung: 'Krone',
  lieferart: 'fertigung',
  preisAb: 120,
  einheit: 'Zahn',
  tempo: 'standard',
  zuschlag: null,
  zaehne: [],
  kiefer: [],
  neuanfertigung: null,
};
const zahn = (fdi: number, treatment = 'krone', spanId: string | null = null) => ({ fdi, treatment, spanId });

describe('Geld', () => {
  it('liest österreichische Beträge in Cent', () => {
    expect(centLesen('1.234,50')).toEqual({ ok: true, wert: 123450 });
    expect(centLesen('89,5')).toEqual({ ok: true, wert: 8950 });
    expect(centLesen('120')).toEqual({ ok: true, wert: 12000 });
    expect(centLesen('')).toEqual({ ok: true, wert: null });
    expect(centLesen('abc').ok).toBe(false);
  });

  it('zeigt Cent als Euro', () => {
    expect(centText(123450).replace(/\s/g, ' ')).toBe('€ 1.234,50');
    expect(centEingabe(8950)).toBe('89,50');
    expect(centEingabe(null)).toBe('');
  });

  it('rechnet ohne Gleitkommafehler', () => {
    // سه بار ۰٫۱ و ۰٫۲ یورو: به سنت دقیق
    expect(summe([{ bezeichnung: 'a', menge: 3, einheit: 'Stück', einzelpreisCent: 10 }, { bezeichnung: 'b', menge: 3, einheit: 'Stück', einzelpreisCent: 20 }]).cent).toBe(90);
  });
});

describe('Positionen', () => {
  it('Krone: ein Zahn pro Zahn, Preis aus dem Stand bei Auftragseingang', () => {
    const p = vorschlag({ ...basis, zaehne: [zahn(14), zahn(15)] });
    expect(p).toEqual([{ bezeichnung: 'Krone · Fertige Arbeit · Zähne 14, 15', menge: 2, einheit: 'Zahn', einzelpreisCent: 12000 }]);
    expect(summe(p)).toEqual({ cent: 24000, preisFehlt: false });
  });

  it('Brücke: Glieder der Spanne', () => {
    const g = { ...basis, behandlung: 'Brücke', einheit: 'Glied' as const, zaehne: [zahn(14, 'pfeiler', 's1'), zahn(15, 'glied', 's1'), zahn(16, 'pfeiler', 's1')] };
    expect(menge('Glied', g)).toBe(3);
  });

  it('Kiefer und Fall', () => {
    expect(menge('Kiefer', { ...basis, kiefer: ['OK', 'UK'] })).toBe(2);
    expect(menge('Kiefer', basis)).toBe(1);
    expect(menge('Fall', { ...basis, zaehne: [zahn(11), zahn(21)] })).toBe(1);
    expect(vorschlag({ ...basis, behandlung: 'Totalprothese', einheit: 'Kiefer', kiefer: ['UK'] })[0].bezeichnung).toBe('Totalprothese · Fertige Arbeit · Unterkiefer');
  });

  it('Klammern und Basis zählen nicht als Zähne', () => {
    expect(menge('Zahn', { ...basis, zaehne: [zahn(14), zahn(15, 'klammer'), zahn(16, 'basis')] })).toBe(1);
  });

  it('ohne Preis: Zeile ohne Betrag, »Preis fehlt«', () => {
    const p = vorschlag({ ...basis, preisAb: null, zaehne: [zahn(11)] });
    expect(p[0].einzelpreisCent).toBeNull();
    expect(summe(p).preisFehlt).toBe(true);
  });

  it('Express als eigene Zeile, pro Auftrag oder pro Einheit', () => {
    const proAuftrag = vorschlag({ ...basis, zaehne: [zahn(14), zahn(15)], tempo: 'express', zuschlag: { betrag: 40, einheit: 'Auftrag' } });
    expect(proAuftrag[1]).toEqual({ bezeichnung: 'Expresszuschlag', menge: 1, einheit: 'Auftrag', einzelpreisCent: 4000 });
    const proZahn = vorschlag({ ...basis, zaehne: [zahn(14), zahn(15)], tempo: 'express', zuschlag: { betrag: 15, einheit: 'Zahn' } });
    expect(proZahn[1]).toMatchObject({ menge: 2, einheit: 'Zahn', einzelpreisCent: 1500 });
    const offen = vorschlag({ ...basis, tempo: 'express', zuschlag: { betrag: null, einheit: 'Auftrag' } });
    expect(offen[1].einzelpreisCent).toBeNull();
  });

  it('Same-Day mit eigenem Zuschlag, nicht als Expresszuschlag', () => {
    const p = vorschlag({ ...basis, zaehne: [zahn(26)], tempo: 'same_day', zuschlag: { betrag: 60, einheit: 'Auftrag' } });
    expect(p).toHaveLength(2);
    expect(p[1]).toEqual({ bezeichnung: 'Same-Day-Zuschlag', menge: 1, einheit: 'Auftrag', einzelpreisCent: 6000 });
    expect(vorschlag({ ...basis, zaehne: [zahn(26)], tempo: 'standard', zuschlag: null })).toHaveLength(1);
  });

  it('kostenlose Neuanfertigung: 0 €, kein Expresszuschlag', () => {
    const p = vorschlag({ ...basis, zaehne: [zahn(11)], tempo: 'express', zuschlag: { betrag: 40, einheit: 'Auftrag' }, neuanfertigung: { reklamation: 'R-2026-0001', kostenlos: true } });
    expect(p).toHaveLength(1);
    expect(p[0].einzelpreisCent).toBe(0);
    expect(p[0].bezeichnung).toContain('Neuanfertigung (Reklamation R-2026-0001), kostenlos');
  });
});

describe('Leistungsdatum', () => {
  const tag = new Date('2026-10-05T10:00:00Z');
  const d = { status: 'abgeschlossen', lieferart: 'design' as const, approvedAt: null, freigegebenAm: null, lieferscheinAm: null, deliveredAt: null };

  it('Nur Design: Freigabe, sonst »freigegeben«', () => {
    expect(leistungsdatum({ ...d, approvedAt: tag })).toEqual(tag);
    expect(leistungsdatum({ ...d, freigegebenAm: tag })).toEqual(tag);
    expect(leistungsdatum(d)).toBeNull();
  });

  it('Fertige Arbeit: Lieferschein, sonst geliefert', () => {
    const f = { ...d, lieferart: 'fertigung' as const };
    expect(leistungsdatum({ ...f, lieferscheinAm: tag, deliveredAt: new Date() })).toEqual(tag);
    expect(leistungsdatum({ ...f, deliveredAt: tag })).toEqual(tag);
  });

  it('storniert wird nie verrechnet', () => {
    expect(leistungsdatum({ ...d, status: 'storniert', approvedAt: tag })).toBeNull();
  });

  it('Monat nach Wiener Zeit, österreichisch benannt', () => {
    expect(monatVon(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10');
    expect(monatName('2027-01')).toBe('Jänner 2027');
  });
});

describe('Rabatt', () => {
  const ohneNbsp = (t: string) => t.replace(/\s/g, ' ');

  it('liest Prozent und Euro, leer oder 0 heißt ohne Rabatt', () => {
    expect(rabattLesen('10', 'prozent', 12000)).toEqual({ ok: true, wert: { art: 'prozent', wert: 1000 } });
    expect(rabattLesen('2,5 %', 'prozent', 12000)).toEqual({ ok: true, wert: { art: 'prozent', wert: 250 } });
    expect(rabattLesen('12,50', 'betrag', 12000)).toEqual({ ok: true, wert: { art: 'betrag', wert: 1250 } });
    expect(rabattLesen('', 'prozent', 12000)).toEqual({ ok: true, wert: null });
    expect(rabattLesen('0', 'betrag', 12000)).toEqual({ ok: true, wert: null });
  });

  it('lehnt ab, was eine Position negativ machen würde', () => {
    expect(rabattLesen('150', 'prozent', 12000).ok).toBe(false);
    expect(rabattLesen('130', 'betrag', 12000).ok).toBe(false);
    expect(rabattLesen('120', 'betrag', 12000).ok).toBe(true);
    expect(rabattLesen('abc', 'prozent', 12000).ok).toBe(false);
    expect(rabattLesen('-5', 'betrag', 12000).ok).toBe(false);
  });

  it('Prozent vom Betrag der Position, auf Cent gerundet; Euro für die ganze Position', () => {
    expect(rabattCent(999, { art: 'prozent', wert: 1000 })).toBe(100);
    expect(positionBetrag({ bezeichnung: 'Krone', menge: 2, einheit: 'Zahn', einzelpreisCent: 12000, rabatt: { art: 'prozent', wert: 1000 } })).toBe(21600);
    expect(positionBetrag({ bezeichnung: 'Krone', menge: 2, einheit: 'Zahn', einzelpreisCent: 12000, rabatt: { art: 'betrag', wert: 1000 } })).toBe(23000);
    expect(
      summe([
        { bezeichnung: 'a', menge: 1, einheit: 'Zahn', einzelpreisCent: 12000, rabatt: { art: 'prozent', wert: 1000 } },
        { bezeichnung: 'b', menge: 2, einheit: 'Zahn', einzelpreisCent: 5000, rabatt: { art: 'betrag', wert: 1000 } },
        { bezeichnung: 'c', menge: 1, einheit: 'Stück', einzelpreisCent: 3000 },
      ]).cent,
    ).toBe(10800 + 9000 + 3000);
  });

  it('Anzeige: Prozent mit abgezogenem Betrag; in der Stornorechnung umgekehrtes Vorzeichen', () => {
    const a = rabattAnzeige({ rabattArt: 'prozent', rabattWert: 1000, rabattCent: 1200 })!;
    expect(a.prozent).toBe('10 %');
    expect(ohneNbsp(a.betrag)).toBe('− € 12,00');
    expect(ohneNbsp(rabattAnzeige({ rabattArt: 'betrag', rabattWert: 1000, rabattCent: -1000 })!.betrag)).toBe('+ € 10,00');
    expect(rabattAnzeige({ rabattArt: null, rabattWert: null, rabattCent: 0 })).toBeNull();
    expect(rabattEingabe({ art: 'prozent', wert: 250 })).toBe('2,5');
    expect(rabattEingabe({ art: 'betrag', wert: 1000 })).toBe('10,00');
  });
});
