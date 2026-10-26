import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';

/**
 * فایل ZIP ساده (بدون فشرده‌سازی، «stored»)، تا چند فایل طرح با یک دانلود برسند. بدون
 * وابستگی تازه: فایل‌های STL خودشان کم فشرده می‌شوند و این شکل را همهٔ برنامه‌ها باز می‌کنند.
 * CRC هر فایل اول با یک بار خواندن حساب می‌شود، بعد فایل جریان‌وار فرستاده می‌شود (بدون نگه‌داشتن در حافظه).
 * حداکثر ۴ GB برای کل فایل (ZIP بدون ZIP64)؛ سقف آپلود خیلی کمتر است.
 */

export type ZipEintrag = { name: string; groesse: number; oeffnen: () => AsyncIterable<Buffer | Uint8Array> };

async function crcVon(quelle: AsyncIterable<Buffer | Uint8Array>): Promise<number> {
  let c = 0;
  for await (const stueck of quelle) c = crc32(stueck, c);
  return c;
}

/** نام‌های تکراری داخل ZIP: «Krone.stl»، «Krone (2).stl» */
export function eindeutigeNamen(namen: string[]): string[] {
  const gesehen = new Map<string, number>();
  return namen.map((n) => {
    const k = n.toLowerCase();
    const anzahl = (gesehen.get(k) ?? 0) + 1;
    gesehen.set(k, anzahl);
    if (anzahl === 1) return n;
    const i = n.lastIndexOf('.');
    return i > 0 ? `${n.slice(0, i)} (${anzahl})${n.slice(i)}` : `${n} (${anzahl})`;
  });
}

function dosZeit(d: Date): { zeit: number; datum: number } {
  return {
    zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    datum: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function zipErstellen(eintraege: ZipEintrag[], jetzt = new Date()): Readable {
  const { zeit, datum } = dosZeit(jetzt);
  const namen = eindeutigeNamen(eintraege.map((e) => e.name));
  return Readable.from(
    (async function* () {
      const zentral: Buffer[] = [];
      let versatz = 0;
      for (const [i, e] of eintraege.entries()) {
        const crc = await crcVon(e.oeffnen());
        const name = Buffer.from(namen[i], 'utf8');
        const kopf = Buffer.alloc(30);
        kopf.writeUInt32LE(0x04034b50, 0);
        kopf.writeUInt16LE(20, 4); // Version
        kopf.writeUInt16LE(0x0800, 6); // Namen in UTF-8
        kopf.writeUInt16LE(0, 8); // stored
        kopf.writeUInt16LE(zeit, 10);
        kopf.writeUInt16LE(datum, 12);
        kopf.writeUInt32LE(crc >>> 0, 14);
        kopf.writeUInt32LE(e.groesse, 18);
        kopf.writeUInt32LE(e.groesse, 22);
        kopf.writeUInt16LE(name.length, 26);
        kopf.writeUInt16LE(0, 28);
        yield kopf;
        yield name;
        let geschrieben = 0;
        for await (const stueck of e.oeffnen()) {
          geschrieben += stueck.length;
          yield stueck;
        }
        if (geschrieben !== e.groesse) throw new Error(`Größe stimmt nicht: ${namen[i]}`);

        const z = Buffer.alloc(46);
        z.writeUInt32LE(0x02014b50, 0);
        z.writeUInt16LE(20, 4);
        z.writeUInt16LE(20, 6);
        z.writeUInt16LE(0x0800, 8);
        z.writeUInt16LE(0, 10);
        z.writeUInt16LE(zeit, 12);
        z.writeUInt16LE(datum, 14);
        z.writeUInt32LE(crc >>> 0, 16);
        z.writeUInt32LE(e.groesse, 20);
        z.writeUInt32LE(e.groesse, 24);
        z.writeUInt16LE(name.length, 28);
        z.writeUInt32LE(versatz, 42);
        zentral.push(z, name);
        versatz += 30 + name.length + e.groesse;
      }
      const verzeichnis = Buffer.concat(zentral);
      const ende = Buffer.alloc(22);
      ende.writeUInt32LE(0x06054b50, 0);
      ende.writeUInt16LE(eintraege.length, 8);
      ende.writeUInt16LE(eintraege.length, 10);
      ende.writeUInt32LE(verzeichnis.length, 12);
      ende.writeUInt32LE(versatz, 16);
      yield verzeichnis;
      yield ende;
    })(),
  );
}
