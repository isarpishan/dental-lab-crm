import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebStream } from 'node:stream/web';
import { speicherPfad as pfad } from '@/lib/speicherpfad';

/**
 * فایل‌ها روی دیسک (`STORAGE_DIR`؛ روی سرور لابراتوار /srv/ddl/files روی SSD رمزگذاری‌شده با LUKS). نام هر فایل
 * تصادفی است و نام اصلی فقط رمزگذاری‌شده در دیتابیس. هیچ مسیر مستقیمی از وب به
 * این پوشه نیست؛ دانلود فقط از `api/dateien/[id]` با چک دسترسی.
 *
 * فایل اول با پسوند «.teil» نوشته و بعد از کامل شدن تغییر نام داده می‌شود، تا
 * آپلود نیمه‌کاره هرگز به‌جای فایل کامل خوانده نشود.
 */

export class ZuGross extends Error {}

export async function speichern(quelle: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ key: string; groesse: number; sha256: string }> {
  const id = randomUUID();
  const key = `${id.slice(0, 2)}/${id}`;
  const ziel = pfad(key);
  const teil = `${ziel}.teil`;
  await mkdir(path.dirname(ziel), { recursive: true, mode: 0o700 });

  const hash = createHash('sha256');
  let groesse = 0;
  const zaehlen = new Transform({
    transform(stueck: Buffer, _kodierung, weiter) {
      groesse += stueck.length;
      if (groesse > maxBytes) return weiter(new ZuGross());
      hash.update(stueck);
      weiter(null, stueck);
    },
  });
  try {
    await pipeline(Readable.fromWeb(quelle as WebStream<Uint8Array>), zaehlen, createWriteStream(teil, { flags: 'wx', mode: 0o600 }));
    await rename(teil, ziel);
  } catch (e) {
    await rm(teil, { force: true });
    throw e;
  }
  return { key, groesse, sha256: hash.digest('hex') };
}

export function lesen(key: string) {
  return createReadStream(pfad(key));
}

export async function loeschen(key: string) {
  await rm(pfad(key), { force: true });
}

/** PDFهای ساخته‌شده در برنامه (اسناد): همان مسیر `speichern`، از یک Buffer. */
export function ausPuffer(daten: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([daten as Uint8Array<ArrayBuffer>]).stream();
}

/** نسخهٔ مستقل یک فایل با نام تصادفی تازه (مثلاً اسکن‌ها برای Neuanfertigung). */
export async function kopieren(key: string): Promise<string> {
  const id = randomUUID();
  const neu = `${id.slice(0, 2)}/${id}`;
  await mkdir(path.dirname(pfad(neu)), { recursive: true, mode: 0o700 });
  await copyFile(pfad(key), pfad(neu), constants.COPYFILE_EXCL);
  return neu;
}

/** کل فایل در حافظه (فقط برای فایل‌های کوچک، مثل PDF اسناد که sha256 آن‌ها پیش از تحویل چک می‌شود). */
export function ganzLesen(key: string): Promise<Buffer> {
  return readFile(pfad(key));
}

/** بایت‌های اول یک فایل (برای تشخیص نوع از روی محتوا) */
export async function kopfLesen(key: string, bytes = 16): Promise<Uint8Array> {
  const f = await open(pfad(key), 'r');
  try {
    const puffer = new Uint8Array(bytes);
    const { bytesRead } = await f.read(puffer, 0, bytes, 0);
    return puffer.subarray(0, bytesRead);
  } finally {
    await f.close();
  }
}
