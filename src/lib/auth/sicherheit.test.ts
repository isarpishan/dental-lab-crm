import { beforeAll, describe, expect, it } from 'vitest';
import { attrappePruefen, passwortHash, passwortPruefen, passwortRegelVerletzt } from './passwords';
import { base32Dekodieren, base32Kodieren, hotp, totp, totpPruefen } from './totp';

beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://test';
  process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.APP_SECRET = 'x'.repeat(40);
  process.env.CRM_HOST = 'crm.test';
  process.env.PORTAL_HOST = 'portal.test';
});

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  const geheimnis = base32Kodieren(Buffer.from('12345678901234567890'));

  it('RFC-4226-Testwerte', () => {
    const roh = Buffer.from('12345678901234567890');
    expect(hotp(roh, 0)).toBe('755224');
    expect(hotp(roh, 9)).toBe('520489');
  });

  it('RFC-6238-Testwerte (8 Stellen, SHA1)', () => {
    expect(totp(geheimnis, 59_000, 8)).toBe('94287082');
    expect(totp(geheimnis, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totp(geheimnis, 2_000_000_000_000, 8)).toBe('69279037');
  });

  it('akzeptiert ±30 Sekunden, nicht mehr', () => {
    const jetzt = 1_700_000_000_000;
    const code = totp(geheimnis, jetzt);
    expect(totpPruefen(geheimnis, code, jetzt + 30_000)).toBe(true);
    expect(totpPruefen(geheimnis, code, jetzt + 95_000)).toBe(false);
    expect(totpPruefen(geheimnis, 'abc123', jetzt)).toBe(false);
  });

  it('Base32 hin und zurück', () => {
    const daten = Buffer.from([0, 1, 2, 250, 251, 252, 253]);
    expect(base32Dekodieren(base32Kodieren(daten))).toEqual(daten);
  });
});

describe('Passwörter', () => {
  it('Hash prüft richtig und falsch', async () => {
    const h = await passwortHash('ein-sehr-gutes-passwort');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await passwortPruefen('ein-sehr-gutes-passwort', h)).toBe(true);
    expect(await passwortPruefen('falsch', h)).toBe(false);
    expect(await attrappePruefen('egal')).toBe(false);
  });

  it('Mindestlänge', () => {
    expect(passwortRegelVerletzt('kurz')).toMatch(/mindestens 12/);
    expect(passwortRegelVerletzt('lang-genug-passwort')).toBeNull();
  });
});

describe('Verschlüsselung und Signatur', async () => {
  const { entschluesseln, verschluesseln, signieren, signaturPruefen } = await import('@/lib/crypto');

  it('ver- und entschlüsselt, jedes Mal anders', () => {
    const a = verschluesseln('Max Mustermann');
    const b = verschluesseln('Max Mustermann');
    expect(a).not.toBe(b);
    expect(entschluesseln(a)).toBe('Max Mustermann');
  });

  it('erkennt Manipulation', () => {
    const teile = verschluesseln('geheim').split('.');
    teile[3] = Buffer.from('anders').toString('base64url');
    expect(() => entschluesseln(teile.join('.'))).toThrow();
  });

  it('Signatur', () => {
    const s = signieren('nutzer-1.123');
    expect(signaturPruefen(s)).toBe('nutzer-1.123');
    expect(signaturPruefen(s.replace('nutzer-1', 'nutzer-2'))).toBeNull();
  });
});
