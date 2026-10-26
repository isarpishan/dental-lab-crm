import { describe, expect, it } from 'vitest';
import { centText } from '@/lib/abrechnung/geld';
import { betragKurz, empfangsText, scanAntwortText, schluesselAusKopf } from './scan-text';

describe('Handy-Scanner: Antwort für den Kurzbefehl', () => {
  it('gelesen mit Lieferant und Betrag', () => {
    expect(scanAntwortText({ status: 'gelesen', fehler: null, lieferant: 'Henry Schein', brutto: 84.2, waehrung: 'EUR' })).toBe(
      `Gelesen: Henry Schein, ${centText(8420)}. Liegt unter »Zu prüfen«.`,
    );
  });

  it('fremde Währung bleibt in ihrer Währung', () => {
    expect(betragKurz(19.9, 'usd')).toBe('19,90 USD');
    expect(betragKurz(null, 'EUR')).toBeNull();
  });

  it('gelesen ohne Angaben', () => {
    expect(scanAntwortText({ status: 'gelesen', fehler: null })).toBe('Hochgeladen und gelesen. Liegt unter »Zu prüfen«.');
  });

  it('gelesen mit Hinweis', () => {
    expect(scanAntwortText({ status: 'gelesen', fehler: 'Das sieht nicht nach einer Rechnung aus. Bitte prüfen oder verwerfen.' })).toBe(
      'Hochgeladen. Das sieht nicht nach einer Rechnung aus. Bitte prüfen oder verwerfen.',
    );
  });

  it('nicht gelesen (ohne Schlüssel oder Fehler)', () => {
    expect(scanAntwortText({ status: 'fehler', fehler: 'irgendwas' })).toBe('Hochgeladen, aber nicht gelesen. Bitte unter »Zu prüfen« von Hand eintragen.');
  });
});

describe('Handy-Scanner: Schlüssel aus der Kopfzeile', () => {
  const k = 'ddls_AbC-12_xyz';
  it('mit, ohne und doppeltem »Bearer«, mit Leerzeichen', () => {
    expect(schluesselAusKopf(`Bearer ${k}`)).toBe(k);
    expect(schluesselAusKopf(k)).toBe(k);
    expect(schluesselAusKopf(`Bearer Bearer ${k}`)).toBe(k);
    expect(schluesselAusKopf(`  bearer   ${k} \n`)).toBe(k);
  });
  it('sonst nichts', () => {
    expect(schluesselAusKopf(null)).toBeNull();
    expect(schluesselAusKopf('')).toBeNull();
    expect(schluesselAusKopf('Bearer ')).toBeNull();
    expect(schluesselAusKopf('Bearer abc')).toBeNull();
    expect(schluesselAusKopf(`Bearer ${k} extra`)).toBeNull();
    expect(schluesselAusKopf(`Bearer ddls_${'a'.repeat(120)}`)).toBeNull();
  });
});

describe('Handy-Scanner: was kam an', () => {
  it('leer, Text, Binär', () => {
    expect(empfangsText(0, null, new Uint8Array())).toBe('(Empfangen: 0 Byte, Typ –, Anfang –)');
    expect(empfangsText(10, 'text/plain', new TextEncoder().encode('kein beleg'))).toBe('(Empfangen: 10 Byte, Typ text/plain, Anfang »kein beleg«)');
    expect(empfangsText(4, 'image/tiff', Uint8Array.from([0x4d, 0x4d, 0x00, 0x2a]))).toBe('(Empfangen: 4 Byte, Typ image/tiff, Anfang 4d 4d 00 2a)');
  });
});
