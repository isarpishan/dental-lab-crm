import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { MIN_LAENGE } from './passwords-regel';

export { MIN_LAENGE };

/**
 * hash رمزها با scrypt از node:crypto (بدون کتابخانه).
 * قالب: `scrypt$N$r$p$salt$hash` تا پارامترها بعداً بی‌دردسر قوی‌تر شوند.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const LAENGE = 64;

function scryptAsync(passwort: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  const optionen: ScryptOptions = { N: n, r, p, maxmem: 128 * n * r * 2 };
  return new Promise((ok, fehler) => scrypt(passwort.normalize('NFKC'), salt, LAENGE, optionen, (e, k) => (e ? fehler(e) : ok(k))));
}

export async function passwortHash(passwort: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(passwort, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function passwortPruefen(passwort: string, gespeichert: string): Promise<boolean> {
  const [art, n, r, p, salt, hash] = gespeichert.split('$');
  if (art !== 'scrypt' || !salt || !hash) return false;
  const erwartet = Buffer.from(hash, 'base64url');
  const berechnet = await scryptAsync(passwort, Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p));
  return erwartet.length === berechnet.length && timingSafeEqual(erwartet, berechnet);
}

/** وقتی کاربری با این ایمیل نیست، همین کار را انجام بده تا زمان پاسخ چیزی لو ندهد. */
let attrappe: string | null = null;
export async function attrappePruefen(passwort: string): Promise<false> {
  attrappe ??= await passwortHash('attrappe-passwort-für-zeitgleiche-antworten');
  await passwortPruefen(passwort, attrappe);
  return false;
}

export function passwortRegelVerletzt(passwort: string): string | null {
  if (passwort.length < MIN_LAENGE) return `Das Passwort muss mindestens ${MIN_LAENGE} Zeichen lang sein.`;
  if (passwort.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}
