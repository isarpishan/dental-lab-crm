import { DATEI_NAMEN, type DateiPlatz } from '@/lib/orders/form-schema';

/**
 * کدام فایل‌ها در سفارش پذیرفته می‌شوند (Spec فاز ۱، بخش D.۴). نوع فایل فقط از
 * پسوند تعیین می‌شود، نه از Content-Type مرورگر. دانلود همیشه «attachment» است،
 * پس هیچ فایل آپلودشده‌ای در مرورگر اجرا نمی‌شود.
 */

type Typ = { art: 'scan' | 'foto' | 'dokument'; mime: string };

const ENDUNGEN: Record<string, Typ> = {
  stl: { art: 'scan', mime: 'model/stl' },
  ply: { art: 'scan', mime: 'application/octet-stream' },
  obj: { art: 'scan', mime: 'model/obj' },
  '3mf': { art: 'scan', mime: 'model/3mf' },
  zip: { art: 'scan', mime: 'application/zip' },
  jpg: { art: 'foto', mime: 'image/jpeg' },
  jpeg: { art: 'foto', mime: 'image/jpeg' },
  png: { art: 'foto', mime: 'image/png' },
  heic: { art: 'foto', mime: 'image/heic' },
  pdf: { art: 'dokument', mime: 'application/pdf' },
};

/** برای `<input accept>`. */
export const ANNEHMEN = Object.keys(ENDUNGEN)
  .map((e) => `.${e}`)
  .join(',');
export const FORMATE_TEXT = 'STL, PLY, OBJ, 3MF, ZIP, JPG, PNG, HEIC oder PDF';

/** جای هر فایل: جاهای لازم (`required_files`)، «Weitere Dateien»، پیوست پیام‌ها و طرح لابراتوار. */
export type Ablage = DateiPlatz | 'sonstiges' | 'nachricht' | 'design';
export const ABLAGEN: readonly Ablage[] = ['ok', 'uk', 'biss', 'scanbody', 'gegenkiefer', 'fotos', 'sonstiges', 'nachricht', 'design'];
export const ABLAGE_HINWEIS: Record<Ablage, string> = {
  ok: 'Vollständiger Oberkiefer-Scan',
  uk: 'Vollständiger Unterkiefer-Scan',
  biss: 'Scan der Bisslage',
  scanbody: 'Scan mit eingeschraubtem Scanbody',
  gegenkiefer: 'Vollständiger Scan des gegenüberliegenden Kiefers',
  fotos: 'Frontal lächelnd, in Ruhe, Nahaufnahme, seitlich, Referenzbilder',
  sonstiges: 'Zum Beispiel Fotos, Röntgenbilder oder ein Befund',
  nachricht: 'Anhang einer Nachricht',
  design: 'Design-Datei von DDL',
};

export const ABLAGE_NAMEN: Record<Ablage, string> = { ...DATEI_NAMEN, sonstiges: 'Weitere Dateien', nachricht: 'Anhang', design: 'Design' };

export function istAblage(wert: string): wert is Ablage {
  return (ABLAGEN as readonly string[]).includes(wert);
}

export function endungVon(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/** نام فایل بدون مسیر و نویسه‌های کنترلی، حداکثر ۲۰۰ نویسه. */
export function dateinameBereinigen(name: string): string {
  const ohnePfad = name.split(/[\\/]/).pop() ?? '';
  // نویسه‌های کنترلی عمداً حذف می‌شوند
  const sauber = ohnePfad.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (sauber.length <= 200) return sauber;
  const endung = endungVon(sauber);
  return `${sauber.slice(0, 190)}….${endung}`;
}

export type DateiPruefung = { ok: true; art: Typ['art']; mime: string; name: string } | { ok: false; fehler: string };

export function dateiPruefen(name: string, groesse: number | null, maxBytes: number): DateiPruefung {
  const sauber = dateinameBereinigen(name);
  const typ = ENDUNGEN[endungVon(sauber)];
  if (!sauber || !typ) return { ok: false, fehler: `Dieses Dateiformat wird nicht angenommen. Erlaubt sind ${FORMATE_TEXT}.` };
  if (groesse === 0) return { ok: false, fehler: 'Die Datei ist leer.' };
  if (groesse !== null && groesse > maxBytes) return { ok: false, fehler: `Die Datei ist größer als ${groesseText(maxBytes)}.` };
  return { ok: true, art: typ.art, mime: typ.mime, name: sauber };
}

const zahl = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 });

/** «12,4 MB» */
export function groesseText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${zahl.format(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${zahl.format(bytes / 1024 ** 2)} MB`;
  return `${zahl.format(bytes / 1024 ** 3)} GB`;
}
