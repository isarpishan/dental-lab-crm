import { describe, expect, it } from 'vitest';
import { mahnungMail } from './mail';
import { faelligeStufe, MAHNWESEN_STANDARD as M, mahnwesenAus, mahnwesenFehler } from './mahnwesen';
import { zahlstand } from './offen';

const stand = (x: Partial<Parameters<typeof zahlstand>[0]> = {}, heute = '2026-11-30') =>
  zahlstand({ summeCent: 10000, gutschriftenCent: 0, gezahltCent: 0, storniert: false, faelligAm: '2026-10-18', ...x }, heute);
const r = (x: { letzte?: { stufe: number; frist: string } | null; stand?: ReturnType<typeof zahlstand>; faelligAm?: string | null } = {}) => ({
  faelligAm: '2026-10-18',
  stand: stand(),
  letzte: null,
  ...x,
});

describe('Mahnstufen', () => {
  it('Zahlungserinnerung erst 7 Tage nach der Fälligkeit', () => {
    expect(faelligeStufe(r(), '2026-10-24', M)).toBeNull();
    expect(faelligeStufe(r(), '2026-10-25', M)).toBe(1);
  });

  it('nächste Stufe erst nach ihrer Schwelle und nach Ablauf der letzten Frist', () => {
    const nachErinnerung = { stufe: 1, frist: '2026-11-01' };
    expect(faelligeStufe(r({ letzte: nachErinnerung }), '2026-11-07', M)).toBeNull(); // erst 20 Tage
    expect(faelligeStufe(r({ letzte: nachErinnerung }), '2026-11-08', M)).toBe(2); // 21 Tage
    expect(faelligeStufe(r({ letzte: { stufe: 1, frist: '2026-11-10' } }), '2026-11-08', M)).toBeNull(); // Frist läuft noch
    expect(faelligeStufe(r({ letzte: { stufe: 2, frist: '2026-11-15' } }), '2026-11-22', M)).toBe(3); // 35 Tage
    expect(faelligeStufe(r({ letzte: { stufe: 3, frist: '2026-11-29' } }), '2027-02-01', M)).toBeNull(); // nach der 2. Mahnung nichts mehr
  });

  it('nichts bei bezahlt, Guthaben, storniert oder ohne Fälligkeit', () => {
    expect(faelligeStufe(r({ stand: stand({ gezahltCent: 10000 }) }), '2026-12-01', M)).toBeNull();
    expect(faelligeStufe(r({ stand: stand({ gezahltCent: 10000, gutschriftenCent: -2000 }) }), '2026-12-01', M)).toBeNull();
    expect(faelligeStufe(r({ stand: stand({ storniert: true, gutschriftenCent: -10000 }) }), '2026-12-01', M)).toBeNull();
    expect(faelligeStufe(r({ faelligAm: null }), '2026-12-01', M)).toBeNull();
    // teilweise bezahlt: weiter gemahnt
    expect(faelligeStufe(r({ stand: stand({ gezahltCent: 4000 }) }), '2026-10-25', M)).toBe(1);
  });

  it('Einstellungen: Standard, gespeicherte Werte, Prüfung der Reihenfolge', () => {
    expect(mahnwesenAus(null)).toEqual({ erinnerungTage: 7, mahnung1Tage: 21, mahnung2Tage: 35, fristTage: 7 });
    expect(mahnwesenAus({ erinnerungTage: 10, fristTage: 'x' })).toEqual({ ...M, erinnerungTage: 7 });
    expect(mahnwesenAus({ erinnerungTage: 10 })).toEqual({ ...M, erinnerungTage: 10 });
    expect(mahnwesenFehler(M)).toBeNull();
    expect(mahnwesenFehler({ ...M, mahnung1Tage: 5 })).toMatch(/aufeinander folgen/);
    expect(mahnwesenFehler({ ...M, fristTage: 0 })).toMatch(/Frist/);
    expect(mahnwesenFehler({ ...M, mahnung2Tage: 400 })).toMatch(/zwischen 1 und 365/);
  });
});

describe('Mahnungs-E-Mail', () => {
  const basis = { nummer: 'R-2026-0007', offenCent: 6000, frist: '2026-11-08', aussteller: { name: 'Isar Pishan · Digital Dental Lab', iban: 'AT611904300234573201', bic: '' }, portalLink: null };
  it('Erinnerung freundlich, Mahnung mit Bezug; Betrag, Frist, IBAN', () => {
    const e = mahnungMail({ stufe: 1, ...basis });
    const text = e.text.replace(/ /g, ' ');
    expect(e.betreff).toBe('Zahlungserinnerung zur Rechnung R-2026-0007 – Digital Dental Lab');
    expect(text).toContain('Sicher ist das nur übersehen worden.');
    for (const t of ['€ 60,00', '08.11.2026', 'AT61 1904 3002 3457 3201', 'Verwendungszweck: R-2026-0007']) expect(text).toContain(t);
    expect(e.html).not.toContain('Rechnungen im Portal');
    const m = mahnungMail({ stufe: 3, ...basis, portalLink: 'https://portal.example.invalid/rechnungen' });
    expect(m.betreff).toBe('2. Mahnung zur Rechnung R-2026-0007 – Digital Dental Lab');
    expect(m.text).toContain('trotz unserer Erinnerung noch offen');
    expect(m.html).toContain('Rechnungen im Portal');
  });
});
