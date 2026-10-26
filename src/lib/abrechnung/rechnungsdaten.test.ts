import { describe, expect, it } from 'vitest';
import { AUSSTELLER_STANDARD } from '@/lib/dokumente/aussteller-werte';
import { faelligAm, fehlendeAngaben, ibanFormat, ibanGueltig, monatsgrenzen, RECHNUNGSDATEN_STANDARD, rechnungsdatenAus } from './rechnungsdaten';

describe('Rechnungsdaten', () => {
  it('IBAN: Prüfziffer und Format', () => {
    expect(ibanGueltig('AT611904300234573201')).toBe(true);
    expect(ibanGueltig('AT61 1904 3002 3457 3201')).toBe(true);
    // دو رقم جابه‌جا پیدا می‌شود
    expect(ibanGueltig('AT671400006210116556')).toBe(false);
    expect(ibanGueltig('AT6714000062101165')).toBe(false);
    expect(ibanGueltig('')).toBe(false);
    expect(ibanFormat('at611904300234573201')).toBe('AT61 1904 3002 3457 3201');
  });

  it('fällig: Kalendertage, auch über den Monatswechsel', () => {
    expect(faelligAm('2026-10-03', 14)).toBe('2026-10-17');
    expect(faelligAm('2026-12-25', 14)).toBe('2027-01-08');
  });

  it('Monatsgrenzen, auch im Februar', () => {
    expect(monatsgrenzen('2026-09')).toEqual(['2026-09-01', '2026-09-30']);
    expect(monatsgrenzen('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('fehlende Angaben sperren die Rechnung', () => {
    expect(fehlendeAngaben(AUSSTELLER_STANDARD, RECHNUNGSDATEN_STANDARD)).toEqual(['IBAN']);
    expect(fehlendeAngaben(AUSSTELLER_STANDARD, { ...RECHNUNGSDATEN_STANDARD, iban: 'AT611904300234573201' })).toEqual([]);
    expect(fehlendeAngaben({ ...AUSSTELLER_STANDARD, strasse: ' ' }, { ...RECHNUNGSDATEN_STANDARD, iban: 'AT611904300234573201', hinweis: '' })).toEqual([
      'Anschrift des Ausstellers',
      'Hinweis zur Umsatzsteuer',
    ]);
  });

  it('gespeicherte Werte über den Standard, Unsinn wird ignoriert', () => {
    expect(rechnungsdatenAus({ iban: 'AT67', zahlungszielTage: 30 })).toMatchObject({ iban: 'AT67', zahlungszielTage: 30, hinweis: RECHNUNGSDATEN_STANDARD.hinweis });
    expect(rechnungsdatenAus('kaputt')).toEqual(RECHNUNGSDATEN_STANDARD);
  });
});
