import { describe, expect, it } from 'vitest';
import { fingerabdruecke } from './auswerten';
import { istUmsatzliste, umsatzlisteLesen } from './csv';

// erfundene Daten im Aufbau der BAWAG-Umsatzliste, nicht vom echten Konto
const KONTO = 'AT001400000000000001';
const zeilen = [
  `${KONTO};Lohn 09/26                                        FE/000000101|BWFBATW1 AT001813000000000002 Muster GmbH;23.09.2026;23.09.2026;+1.455,60;EUR`,
  `${KONTO};Bezahlung Karte                                   MC/000000100|POS          6148  D001 22.09. 15:48|TEDI FIL  1115\\\\WIEN\\1200;23.09.2026;22.09.2026;-3,55;EUR`,
  `${KONTO};Firma AP26-1|OG/000000099|ADYBDEB2XXX DE52100190001000027873|Firma;19.09.2026;19.09.2026;-39,43;EUR`,
  `${KONTO};BG/000000098|Entgelt f\xfcr Kontof\xfchrung;01.09.2026;31.08.2026;-6,08;EUR`,
];
const latin1 = (t: string) => Uint8Array.from([...t].map((c) => c.charCodeAt(0)));

describe('Umsatzliste (CSV)', () => {
  it('liest Betrag, Datum, Referenz und Gegen-IBAN', () => {
    const r = umsatzlisteLesen(latin1(zeilen.join('\r\n') + '\r\n'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.iban).toBe(KONTO);
    expect(r.umsaetze.map((u) => u.betragCent)).toEqual([145560, -355, -3943, -608]);
    expect(r.umsaetze[0]).toMatchObject({ buchungstag: '2026-09-23', referenz: 'FE/000000101', iban: 'AT001813000000000002' });
    expect(r.umsaetze[1]).toMatchObject({ valuta: '2026-09-22', referenz: 'MC/000000100', iban: null });
    expect(r.umsaetze[1].text).toContain('TEDI FIL 1115 WIEN 1200');
    expect(r.umsaetze[2]).toMatchObject({ referenz: 'OG/000000099', iban: 'DE52100190001000027873' });
    expect(r.umsaetze[3].text).toBe('BG/000000098 · Entgelt für Kontoführung');
  });

  it('gleiche Bankreferenz wie im PDF ⇒ gleicher Fingerabdruck', () => {
    const r = umsatzlisteLesen(latin1(zeilen[1]));
    if (!r.ok) throw new Error(r.fehler);
    const pdf = fingerabdruecke(KONTO, [{ buchungstag: '2026-09-23', betragCent: -355, text: 'ganz anderer Text', referenz: 'MC/000000100' }]);
    expect(fingerabdruecke(r.iban, r.umsaetze)).toEqual(pdf);
  });

  it('erkennt die Datei und lehnt Fremdes ab', () => {
    expect(istUmsatzliste(latin1(zeilen[0]))).toBe(true);
    expect(istUmsatzliste(latin1('%PDF-1.7'))).toBe(false);
    expect(umsatzlisteLesen(latin1('Datum;Betrag\n1.1.2026;5')).ok).toBe(false);
    expect(umsatzlisteLesen(latin1(`${zeilen[0]}\nAT001400000000000099;x;01.09.2026;01.09.2026;-1,00;EUR`))).toMatchObject({ ok: false });
    expect(umsatzlisteLesen(latin1(`${KONTO};x;01.09.2026;01.09.2026;-1,00;USD`))).toMatchObject({ ok: false });
  });

  it('überspringt eine Kopfzeile und versteht ; im Text', () => {
    const r = umsatzlisteLesen(latin1(`Konto;Text;Buchung;Valuta;Betrag;Währung\n${KONTO};Miete; Oktober FE/000000102;01.10.2026;01.10.2026;-800,00;EUR`));
    expect(r).toMatchObject({ ok: true, umsaetze: [{ betragCent: -80000, text: 'Miete; Oktober FE/000000102', referenz: 'FE/000000102' }] });
  });
});
