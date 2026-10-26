import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config';

/**
 * رمزگذاری فیلدها (نام بیمار، رازهای 2FA، کلیدهای API) با AES-256-GCM.
 * قالب: `v1.<iv>.<tag>.<متن رمز>` (base64url). «v1» برای وقتی است که روزی کلید
 * عوض شود و داده‌های قدیمی باید هنوز خوانده شوند.
 */
function schluessel(): Buffer {
  return Buffer.from(config().DATA_ENCRYPTION_KEY, 'base64');
}

export function verschluesseln(klartext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', schluessel(), iv);
  const daten = Buffer.concat([c.update(klartext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), daten.toString('base64url')].join('.');
}

export function entschluesseln(wert: string): string {
  const [version, iv, tag, daten] = wert.split('.');
  if (version !== 'v1' || !iv || !tag || daten === undefined) throw new Error('Unbekanntes Verschlüsselungsformat');
  const d = createDecipheriv('aes-256-gcm', schluessel(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(daten, 'base64url')), d.final()]).toString('utf8');
}

/** توکن تصادفی برای لینک‌ها و نشست‌ها. فقط hash آن در دیتابیس می‌رود. */
export function zufallsToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(wert: string): string {
  return createHash('sha256').update(wert).digest('hex');
}

/** امضای کوتاه برای کوکی‌های موقت (مثلاً قدم دوم ورود). */
export function signieren(daten: string): string {
  const mac = createHmac('sha256', config().APP_SECRET).update(daten).digest('base64url');
  return `${daten}~${mac}`;
}

export function signaturPruefen(wert: string): string | null {
  const i = wert.lastIndexOf('~');
  if (i < 1) return null;
  const daten = wert.slice(0, i);
  const erwartet = Buffer.from(signieren(daten).slice(i + 1));
  const erhalten = Buffer.from(wert.slice(i + 1));
  return erwartet.length === erhalten.length && timingSafeEqual(erwartet, erhalten) ? daten : null;
}
