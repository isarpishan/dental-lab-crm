import { createHmac, randomBytes } from 'node:crypto';

/**
 * رمز یک‌بارمصرف زمانی (TOTP، RFC 6238) با node:crypto، سازگار با Google
 * Authenticator، Microsoft Authenticator، 1Password و غیره: SHA1، ۶ رقم، ۳۰ ثانیه.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Kodieren(daten: Buffer): string {
  let bits = 0;
  let wert = 0;
  let aus = '';
  for (const byte of daten) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      aus += ALPHABET[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += ALPHABET[(wert << (5 - bits)) & 31];
  return aus;
}

export function base32Dekodieren(text: string): Buffer {
  const sauber = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let wert = 0;
  const aus: number[] = [];
  for (const zeichen of sauber) {
    const i = ALPHABET.indexOf(zeichen);
    if (i < 0) throw new Error('Ungültiges Base32-Zeichen');
    wert = (wert << 5) | i;
    bits += 5;
    if (bits >= 8) {
      aus.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(aus);
}

export function geheimnisErzeugen(): string {
  return base32Kodieren(randomBytes(20));
}

export function hotp(geheimnis: Buffer, zaehler: number, stellen = 6): string {
  const puffer = Buffer.alloc(8);
  puffer.writeBigUInt64BE(BigInt(zaehler));
  const mac = createHmac('sha1', geheimnis).update(puffer).digest();
  const versatz = mac[mac.length - 1] & 0x0f;
  const zahl = (mac.readUInt32BE(versatz) & 0x7fffffff) % 10 ** stellen;
  return zahl.toString().padStart(stellen, '0');
}

export function totp(geheimnisBase32: string, zeitMs = Date.now(), stellen = 6): string {
  return hotp(base32Dekodieren(geheimnisBase32), Math.floor(zeitMs / 30_000), stellen);
}

/** کد را با یک بازهٔ ۳۰ ثانیه‌ای قبل و بعد قبول می‌کند (ساعت گوشی کمی جلو یا عقب). */
export function totpPruefen(geheimnisBase32: string, code: string, zeitMs = Date.now()): boolean {
  const sauber = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(sauber)) return false;
  const geheimnis = base32Dekodieren(geheimnisBase32);
  const zaehler = Math.floor(zeitMs / 30_000);
  return [-1, 0, 1].some((d) => hotp(geheimnis, zaehler + d) === sauber);
}

export function otpauthUri(geheimnisBase32: string, konto: string): string {
  const aussteller = 'Digital Dental Lab';
  const label = encodeURIComponent(`${aussteller}:${konto}`);
  const params = new URLSearchParams({ secret: geheimnisBase32, issuer: aussteller, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params}`;
}

/** برای نوشتن دستی در اپ: «ABCD EFGH …». */
export function inGruppen(geheimnisBase32: string): string {
  return geheimnisBase32.match(/.{1,4}/g)?.join(' ') ?? geheimnisBase32;
}
