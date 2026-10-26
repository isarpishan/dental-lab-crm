import { describe, expect, it } from 'vitest';
import { faelligkeitImMonat, faelligkeiten, naechsteFaelligkeit, proMonatCent, vorlagePruefen } from './plan';

const monatlich = (ab: string, bis: string | null = null) => ({ ab, tag: Number(ab.slice(8)), rhythmus: 'monatlich' as const, bis });

describe('Fixkosten: Fälligkeiten', () => {
  it('monatlich bis heute, heute eingeschlossen', () => {
    expect(faelligkeiten(monatlich('2026-08-25'), '2026-10-25').map((f) => f.faelligAm)).toEqual(['2026-08-25', '2026-09-25', '2026-10-25']);
    expect(faelligkeiten(monatlich('2026-08-26'), '2026-10-25').map((f) => f.periode)).toEqual(['2026-08', '2026-09']);
  });

  it('31. im Februar ← letzter Tag, danach wieder der 31.', () => {
    const f = faelligkeiten(monatlich('2027-01-31'), '2027-03-31');
    expect(f.map((x) => x.faelligAm)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(faelligkeiten(monatlich('2028-01-31'), '2028-02-29').at(-1)?.faelligAm).toBe('2028-02-29');
  });

  it('über den Jahreswechsel, vierteljährlich und jährlich', () => {
    expect(faelligkeiten({ ab: '2026-11-01', tag: 1, rhythmus: 'quartal', bis: null }, '2027-06-01').map((f) => f.periode)).toEqual(['2026-11', '2027-02', '2027-05']);
    expect(faelligkeiten({ ab: '2025-03-15', tag: 15, rhythmus: 'jaehrlich', bis: null }, '2026-10-25').map((f) => f.faelligAm)).toEqual(['2025-03-15', '2026-03-15']);
  });

  it('endet mit »bis«; erste Fälligkeit in der Zukunft ← nichts', () => {
    expect(faelligkeiten(monatlich('2026-01-10', '2026-03-10'), '2026-10-25').map((f) => f.periode)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(faelligkeiten(monatlich('2026-11-01'), '2026-10-25')).toEqual([]);
  });

  it('höchstens die letzten 24', () => {
    const f = faelligkeiten(monatlich('2020-01-01'), '2026-10-25');
    expect(f).toHaveLength(24);
    expect(f.at(-1)?.periode).toBe('2026-10');
  });

  it('nächste Fälligkeit', () => {
    expect(naechsteFaelligkeit(monatlich('2026-01-01'), '2026-10-25')?.faelligAm).toBe('2026-11-01');
    expect(naechsteFaelligkeit(monatlich('2026-01-25'), '2026-10-25')?.faelligAm).toBe('2026-11-25');
    expect(naechsteFaelligkeit(monatlich('2026-12-05'), '2026-10-25')?.faelligAm).toBe('2026-12-05');
    expect(naechsteFaelligkeit({ ab: '2026-02-01', tag: 1, rhythmus: 'quartal', bis: null }, '2026-10-25')?.faelligAm).toBe('2026-11-01');
    expect(naechsteFaelligkeit(monatlich('2026-01-01', '2026-10-31'), '2026-10-25')).toBeNull();
  });

  it('Betrag pro Monat', () => {
    expect(proMonatCent(30000, 'quartal')).toBe(10000);
    expect(proMonatCent(10000, 'jaehrlich')).toBe(833);
  });
});

describe('Fixkosten: Formular', () => {
  const basis = { titel: ' Miete  Labor ', kategorie: 'buero', betrag: '1.200', satz: '20', rhythmus: 'monatlich', ab: '2026-11-03', bis: '', gegenpartei: '', notiz: '' };

  it('DDL: immer Ausgabe, Tag aus dem Datum', () => {
    const r = vorlagePruefen({ ...basis, art: 'einnahme' }, 'ddl');
    expect(r.ok && r.werte).toMatchObject({ art: 'ausgabe', titel: 'Miete Labor', betragCent: 120000, mwstSatz: 20, tag: 3, gegenpartei: null, bis: null });
  });

  it('DDL braucht Labor-Kategorie und MwSt-Satz', () => {
    expect(vorlagePruefen({ ...basis, kategorie: 'lebensmittel' }, 'ddl').ok).toBe(false);
    expect(vorlagePruefen({ ...basis, satz: '' }, 'ddl').ok).toBe(false);
  });

  it('Privat: Kategorie passend zur Art, kein MwSt-Satz', () => {
    const r = vorlagePruefen({ ...basis, art: 'einnahme', kategorie: 'gehalt' }, 'privat');
    expect(r.ok && r.werte.mwstSatz).toBeNull();
    expect(vorlagePruefen({ ...basis, art: 'einnahme', kategorie: 'wohnen' }, 'privat').ok).toBe(false);
  });

  it('»Endet am« nicht vor der ersten Fälligkeit; Datum Pflicht', () => {
    expect(vorlagePruefen({ ...basis, bis: '2026-10-01' }, 'ddl').ok).toBe(false);
    expect(vorlagePruefen({ ...basis, ab: '' }, 'ddl').ok).toBe(false);
    expect(vorlagePruefen({ ...basis, rhythmus: 'woechentlich' }, 'ddl').ok).toBe(false);
  });

  it('Fälligkeit im Monat einer Bankbuchung', () => {
    const p = { ab: '2026-07-15', tag: 15, rhythmus: 'monatlich' as const, bis: null };
    expect(faelligkeitImMonat(p, '2026-09-13')).toEqual({ periode: '2026-09', faelligAm: '2026-09-15' });
    expect(faelligkeitImMonat(p, '2026-06-20')).toBeNull();
    expect(faelligkeitImMonat({ ...p, rhythmus: 'quartal' }, '2026-08-15')).toBeNull();
    expect(faelligkeitImMonat({ ...p, rhythmus: 'quartal' }, '2026-10-02')).toEqual({ periode: '2026-10', faelligAm: '2026-10-15' });
    expect(faelligkeitImMonat({ ...p, bis: '2026-08-31' }, '2026-09-13')).toBeNull();
  });
});
