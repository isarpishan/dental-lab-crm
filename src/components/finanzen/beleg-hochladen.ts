import { BELEG_MAX_BYTES } from '@/lib/ausgaben/text';

/**
 * Belege aus dem Browser hochladen (Ausgaben und Privat, Spec فاز ۵، قدم ۲): Fotos vom Handy werden vorher verkleinert
 * (lange Seite 2400 px), damit sie schnell hochgehen und trotzdem gut lesbar bleiben. Body = Datei, Name in `?name=`.
 */

/** HEIC (iPhone) wird im Browser zu JPEG, wenn er es lesen kann (Safari); die KI liest kein HEIC. */
async function verkleinern(datei: File): Promise<Blob> {
  const heic = /^image\/hei[cf]$/.test(datei.type) || /\.hei[cf]$/i.test(datei.name);
  if (!/^image\/(jpeg|png|webp)$/.test(datei.type) && !heic) return datei;
  try {
    const bild = await createImageBitmap(datei, { imageOrientation: 'from-image' });
    const faktor = Math.min(1, 2400 / Math.max(bild.width, bild.height));
    if (faktor === 1 && datei.size < 2_500_000 && !heic) return datei;
    const leinwand = document.createElement('canvas');
    leinwand.width = Math.round(bild.width * faktor);
    leinwand.height = Math.round(bild.height * faktor);
    leinwand.getContext('2d')?.drawImage(bild, 0, 0, leinwand.width, leinwand.height);
    const klein = await new Promise<Blob | null>((fertig) => leinwand.toBlob(fertig, 'image/jpeg', 0.85));
    return klein && (heic || klein.size < datei.size) ? klein : datei;
  } catch {
    return datei;
  }
}

/** Datei für das Hochladen: verkleinert, mit passendem Namen; oder ein Fehlertext. */
export async function vorbereiten(datei: File): Promise<{ inhalt: Blob; name: string } | { fehler: string }> {
  const inhalt = await verkleinern(datei);
  if (inhalt.size > BELEG_MAX_BYTES) return { fehler: 'Der Beleg ist zu groß (höchstens 20 MB).' };
  return { inhalt, name: inhalt === datei ? datei.name : datei.name.replace(/\.[^.]*$/, '') + '.jpg' };
}

export async function senden(ziel: string, d: { inhalt: Blob; name: string }) {
  return fetch(`${ziel}${ziel.includes('?') ? '&' : '?'}name=${encodeURIComponent(d.name)}`, {
    method: 'POST',
    body: d.inhalt,
    headers: { 'Content-Type': d.inhalt.type || 'application/octet-stream' },
  });
}

/** Beleg zu einer gespeicherten Zeile (`ziel` = `/api/…/[id]/beleg`); null oder ein Fehlertext. */
export async function belegHochladen(ziel: string, datei: File): Promise<string | null> {
  const d = await vorbereiten(datei);
  if ('fehler' in d) return d.fehler;
  try {
    const r = await senden(ziel, d);
    if (r.ok) return null;
    return ((await r.json().catch(() => null)) as { fehler?: string } | null)?.fehler ?? 'Der Beleg konnte nicht hochgeladen werden.';
  } catch {
    return 'Keine Verbindung. Der Beleg wurde nicht hochgeladen.';
  }
}
