import { describe, expect, it } from 'vitest';
import { belegDateiname, belegTitel } from './beleg';
import { rechnungMail } from './mail';
import { saldoAus, zahlstand } from './offen';

const r = (x: Partial<Parameters<typeof zahlstand>[0]> = {}) => ({ summeCent: 10000, gutschriftenCent: 0, gezahltCent: 0, storniert: false, faelligAm: '2026-10-18', ...x });

describe('Zahlstand einer Rechnung', () => {
  it('offen, teilweise, bezahlt', () => {
    expect(zahlstand(r(), '2026-10-04')).toEqual({ status: 'offen', offenCent: 10000, gezahltCent: 0, ueberfaellig: false });
    expect(zahlstand(r({ gezahltCent: 4000 }), '2026-10-04')).toMatchObject({ status: 'teilweise', offenCent: 6000 });
    expect(zahlstand(r({ gezahltCent: 10000 }), '2026-10-04')).toMatchObject({ status: 'bezahlt', offenCent: 0, ueberfaellig: false });
  });

  it('überfällig erst nach dem Fälligkeitstag', () => {
    expect(zahlstand(r(), '2026-10-18').ueberfaellig).toBe(false);
    expect(zahlstand(r(), '2026-10-19').ueberfaellig).toBe(true);
    expect(zahlstand(r({ gezahltCent: 4000 }), '2026-11-01')).toMatchObject({ status: 'teilweise', ueberfaellig: true });
    expect(zahlstand(r({ gezahltCent: 10000 }), '2026-11-01').ueberfaellig).toBe(false);
  });

  it('Gutschrift mindert den offenen Betrag; ganz gutgeschrieben = ausgeglichen', () => {
    expect(zahlstand(r({ gutschriftenCent: -3000 }), '2026-10-04')).toMatchObject({ status: 'offen', offenCent: 7000 });
    expect(zahlstand(r({ gutschriftenCent: -3000, gezahltCent: 7000 }), '2026-10-04')).toMatchObject({ status: 'bezahlt', offenCent: 0 });
    expect(zahlstand(r({ gutschriftenCent: -10000 }), '2026-10-04')).toMatchObject({ status: 'ausgeglichen', offenCent: 0 });
  });

  it('Gutschrift nach voller Zahlung = Guthaben', () => {
    expect(zahlstand(r({ gezahltCent: 10000, gutschriftenCent: -2500 }), '2026-10-04')).toMatchObject({ status: 'guthaben', offenCent: -2500, ueberfaellig: false });
  });

  it('storniert: nie überfällig; schon bezahlt = Guthaben', () => {
    expect(zahlstand(r({ storniert: true, gutschriftenCent: -10000 }), '2026-12-01')).toEqual({ status: 'storniert', offenCent: 0, gezahltCent: 0, ueberfaellig: false });
    expect(zahlstand(r({ storniert: true, gutschriftenCent: -10000, gezahltCent: 10000 }), '2026-12-01')).toMatchObject({ status: 'storniert', offenCent: -10000 });
  });
});

describe('Saldo einer Ordination', () => {
  it('Summe, überfällig, älteste Fälligkeit', () => {
    const heute = '2026-11-01';
    const zeilen = [
      { faelligAm: '2026-10-18', stand: zahlstand(r({ faelligAm: '2026-10-18' }), heute) },
      { faelligAm: '2026-11-14', stand: zahlstand(r({ faelligAm: '2026-11-14', summeCent: 5000, gezahltCent: 1000 }), heute) },
      { faelligAm: '2026-09-30', stand: zahlstand(r({ faelligAm: '2026-09-30', gezahltCent: 10000 }), heute) },
    ];
    expect(saldoAus(zeilen)).toEqual({ offenCent: 14000, ueberfaelligCent: 10000, offeneRechnungen: 2, aeltesteFaelligkeit: '2026-10-18' });
  });

  it('Guthaben auf einer anderen Rechnung wird verrechnet', () => {
    const heute = '2026-11-01';
    const zeilen = [
      { faelligAm: '2026-10-18', stand: zahlstand(r({ faelligAm: '2026-10-18' }), heute) },
      { faelligAm: '2026-10-01', stand: zahlstand(r({ faelligAm: '2026-10-01', gezahltCent: 10000, gutschriftenCent: -6000 }), heute) },
    ];
    expect(saldoAus(zeilen)).toMatchObject({ offenCent: 4000, ueberfaelligCent: 4000 });
    expect(saldoAus([])).toEqual({ offenCent: 0, ueberfaelligCent: 0, offeneRechnungen: 0, aeltesteFaelligkeit: null });
  });
});

describe('Rechnungs-E-Mail', () => {
  // Intl بین «€» و عدد فاصلهٔ ثابت می‌گذارد
  const mail = (...a: Parameters<typeof rechnungMail>) => {
    const m = rechnungMail(...a);
    return { ...m, text: m.text.replace(/\u00a0/g, ' ') };
  };
  const basis = {
    nummer: 'R-2026-0007',
    am: new Date('2026-10-04T10:00:00Z'),
    summeCent: 123450,
    faelligAm: '2026-10-18',
    zeitraum: ['2026-09-01', '2026-09-30'] as [string, string],
    bezug: null,
    ordination: 'Ordination Dr. Test',
    aussteller: { name: 'Isar Pishan · Digital Dental Lab', iban: 'AT611904300234573201', bic: '' },
    portalLink: 'https://portal.example.invalid/rechnungen',
  };

  it('Rechnung: Nummer, Betrag, Fälligkeit, IBAN, Verwendungszweck, Portal', () => {
    const m = mail({ titel: 'Rechnung', ...basis });
    expect(m.betreff).toBe('Rechnung R-2026-0007 – Digital Dental Lab');
    for (const t of ['R-2026-0007', '1.234,50', '18.10.2026', 'AT61 1904 3002 3457 3201', 'Verwendungszweck: R-2026-0007', '01.09.2026 – 30.09.2026', basis.portalLink]) {
      expect(m.text).toContain(t);
    }
    expect(m.html).toContain('Rechnungen im Portal');
    expect(m.text).not.toContain('BIC');
  });

  it('ohne Portal-Zugang kein Link; Gutschrift und Storno mit Bezug', () => {
    const bezug = { nummer: 'R-2026-0007', am: new Date('2026-10-04T10:00:00Z') };
    const g = mail({ titel: 'Gutschrift', ...basis, nummer: 'G-2026-0002', summeCent: -3000, faelligAm: null, bezug, portalLink: null });
    expect(g.betreff).toBe('Gutschrift G-2026-0002 zur Rechnung R-2026-0007 – Digital Dental Lab');
    expect(g.text).toContain('über € 30,00 zur Rechnung R-2026-0007 vom 04.10.2026');
    expect(g.text).not.toContain('Portal');
    expect(g.html).not.toContain('Rechnungen im Portal');
    const s = mail({ titel: 'Stornorechnung', ...basis, nummer: 'G-2026-0003', summeCent: -123450, faelligAm: null, bezug });
    expect(s.text).toContain('Die Rechnung R-2026-0007 ist damit vollständig aufgehoben.');
    expect(s.text).not.toContain('IBAN');
  });

  it('Titel und Dateiname des PDFs', () => {
    expect(belegTitel({ art: 'rechnung', storno: false })).toBe('Rechnung');
    expect(belegTitel({ art: 'gutschrift', storno: true })).toBe('Stornorechnung');
    expect(belegDateiname({ art: 'gutschrift', storno: false, nummer: 'G-2026-0002' })).toBe('Gutschrift_G-2026-0002.pdf');
  });
});
