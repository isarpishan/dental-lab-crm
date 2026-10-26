/**
 * «Umsatzliste» BAWAG به‌صورت CSV (در eBanking: Umsätze → Export؛ با Excel باز می‌شود). بدون KI و بدون دیتابیس، با
 * آزمون واحد. هر خط: `IBAN;Buchungstext;Buchungsdatum;Valuta;Betrag;Währung`، با `;` و بدون گیومه، معمولاً ISO-8859-1.
 * مرجع بانک (`MC/000001814`) هر جای متن باشد بیرون کشیده می‌شود تا همان ردیف در PDF و CSV یکی شود (`fingerabdruecke`).
 * کنترل «کامل بودن» مثل PDF ممکن نیست، چون CSV Kontostand ندارد؛ اعداد را خود بانک داده و KI فقط دسته‌بندی می‌کند.
 */

export type CsvUmsatz = {
  buchungstag: string;
  valuta: string | null;
  betragCent: number;
  iban: string | null;
  text: string;
  referenz: string | null;
};

export type CsvGelesen = { ok: true; iban: string; umsaetze: CsvUmsatz[] } | { ok: false; fehler: string };

const IBAN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
// Bank: zwei Buchstaben, »/«, neun Ziffern (MC/000001814); etwas lockerer, damit es zu Referenzen aus dem PDF passt
const REFERENZ = /\b([A-Z]{2}\/(?=[A-Z0-9]*\d{4})[A-Z0-9]{6,12})\b/;
const GEGEN_IBAN = /\b([A-Z]{2}\d{2}[A-Z0-9]{10,30})\b/;

/** UTF-8, sonst ISO-8859-1 (so speichert die BAWAG). */
export function csvText(daten: Uint8Array): string {
  let t: string;
  try {
    t = new TextDecoder('utf-8', { fatal: true }).decode(daten);
  } catch {
    t = new TextDecoder('latin1').decode(daten);
  }
  return t.replace(/^﻿/, '');
}

const ohneGaensefuesse = (s: string) => s.trim().replace(/^"(.*)"$/s, '$1').replace(/""/g, '"');

/** `23.10.2026` → `2026-10-23` */
function datum(s: string): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** `+1.455,60` / `-3,55` → Cent */
function betrag(s: string): number | null {
  const t = s.trim().replace(/\s/g, '');
  if (!/^[+-]?\d{1,3}(\.?\d{3})*(,\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Erste Zeile sieht aus wie eine Umsatzliste der BAWAG (IBAN am Anfang, sechs Spalten)? Für die Erkennung beim Hochladen. */
export function istUmsatzliste(kopf: Uint8Array): boolean {
  const zeile = csvText(kopf).split(/\r?\n/)[0] ?? '';
  const erste = ohneGaensefuesse(zeile.split(';')[0] ?? '').replace(/\s/g, '').toUpperCase();
  return zeile.split(';').length >= 6 && IBAN.test(erste);
}

export function umsatzlisteLesen(daten: Uint8Array): CsvGelesen {
  const zeilen = csvText(daten)
    .split(/\r?\n/)
    .filter((z) => z.trim());
  if (!zeilen.length) return { ok: false, fehler: 'Die Datei ist leer.' };

  let iban: string | null = null;
  const umsaetze: CsvUmsatz[] = [];
  for (const [i, zeile] of zeilen.entries()) {
    const f = zeile.split(';').map(ohneGaensefuesse);
    const konto = (f[0] ?? '').replace(/\s/g, '').toUpperCase();
    // eine Kopfzeile (z. B. nach Speichern in Excel) überspringen
    if (i === 0 && !IBAN.test(konto)) continue;
    if (f.length < 6 || !IBAN.test(konto)) return { ok: false, fehler: `Zeile ${i + 1}: Das ist keine Umsatzliste der BAWAG (Export im eBanking als CSV).` };
    if (iban && konto !== iban) return { ok: false, fehler: 'In der Datei stehen mehrere Konten. Bitte pro Konto eine Datei.' };
    iban = konto;
    // Buchungstext kann selbst ein »;« enthalten: die letzten vier Spalten sind fest
    const [bd, vd, b, waehrung] = f.slice(-4);
    const roh = ohneGaensefuesse(zeile.split(';').slice(1, -4).join(';'));
    const buchungstag = datum(bd);
    if (!buchungstag) return { ok: false, fehler: `Zeile ${i + 1}: Buchungsdatum nicht lesbar.` };
    const cent = betrag(b);
    if (cent == null || cent === 0) return { ok: false, fehler: `Zeile ${i + 1}: Betrag nicht lesbar.` };
    if (waehrung.trim().toUpperCase() !== 'EUR') return { ok: false, fehler: `Zeile ${i + 1}: nur Konten in Euro.` };
    const referenz = REFERENZ.exec(roh)?.[1] ?? null;
    // Gegen-IBAN erst nach der Referenz suchen (davor steht der Verwendungszweck)
    const nachRef = referenz ? roh.slice(roh.indexOf(referenz) + referenz.length) : roh;
    const gegen = GEGEN_IBAN.exec(nachRef)?.[1] ?? null;
    umsaetze.push({
      buchungstag,
      valuta: datum(vd),
      betragCent: cent,
      iban: gegen && gegen !== konto ? gegen : null,
      text: roh
        .replace(/\\+/g, ' ')
        .replace(/\|/g, ' · ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 600),
      referenz,
    });
  }
  if (!iban || !umsaetze.length) return { ok: false, fehler: 'In der Datei stehen keine Umsätze.' };
  return { ok: true, iban, umsaetze };
}
