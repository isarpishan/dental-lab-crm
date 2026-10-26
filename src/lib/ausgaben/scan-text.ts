import { centText } from '@/lib/abrechnung/geld';

/**
 * پاسخ `api/ausgaben/scan` به Kurzbefehl آیفون: یک جملهٔ کوتاه آلمانی که «Mitteilung anzeigen» مستقیم نشانش
 * می‌دهد (برای همین متن ساده، نه JSON). بدون `server-only`، تا آزمون منطقی داشته باشد.
 */
export function betragKurz(betrag: number | null | undefined, waehrung: string | null | undefined): string | null {
  if (betrag == null || !Number.isFinite(betrag)) return null;
  const w = (waehrung ?? 'EUR').toUpperCase();
  return w === 'EUR' ? centText(Math.round(betrag * 100)) : `${betrag.toLocaleString('de-AT', { minimumFractionDigits: 2 })} ${w}`;
}

export function scanAntwortText(r: {
  status: 'gelesen' | 'fehler';
  fehler: string | null;
  lieferant?: string | null;
  brutto?: number | null;
  waehrung?: string | null;
}): string {
  if (r.status === 'gelesen') {
    // «gelesen» mit Hinweis (z. B. »sieht nicht nach einer Rechnung aus«)
    if (r.fehler) return `Hochgeladen. ${r.fehler}`;
    const was = [r.lieferant?.trim(), betragKurz(r.brutto, r.waehrung)].filter(Boolean).join(', ');
    return was ? `Gelesen: ${was}. Liegt unter »Zu prüfen«.` : 'Hochgeladen und gelesen. Liegt unter »Zu prüfen«.';
  }
  return 'Hochgeladen, aber nicht gelesen. Bitte unter »Zu prüfen« von Hand eintragen.';
}

/**
 * Schlüssel aus der Kopfzeile `Authorization`. Nachsichtig, weil er am iPhone von Hand eingefügt wird: mit oder ohne
 * »Bearer«, auch doppelt (»Bearer Bearer ddls_…«), Leerzeichen und Zeilenumbrüche drumherum.
 */
export function schluesselAusKopf(kopf: string | null): string | null {
  const s = kopf?.trim().match(/^(?:Bearer\s+)*(ddls_[A-Za-z0-9_-]+)$/i)?.[1];
  return s && s.length <= 100 ? s : null;
}

/**
 * Zusatz zur Fehlermeldung, wenn kein Beleg erkannt wurde: Größe, angegebener Typ und die ersten Bytes (lesbar oder
 * hex). So lässt sich an der Mitteilung am iPhone sehen, was der Kurzbefehl wirklich geschickt hat.
 */
export function empfangsText(bytes: number, typ: string | null, anfang: Uint8Array): string {
  const lesbar = [...anfang].every((b) => b >= 0x20 && b < 0x7f);
  const kopf = anfang.length ? (lesbar ? `»${String.fromCharCode(...anfang)}«` : [...anfang].map((b) => b.toString(16).padStart(2, '0')).join(' ')) : '–';
  return `(Empfangen: ${bytes.toLocaleString('de-AT')} Byte, Typ ${typ || '–'}, Anfang ${kopf})`;
}
