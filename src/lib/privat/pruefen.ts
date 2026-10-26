import { centLesen } from '@/lib/abrechnung/geld';
import { PRIVAT_ARTEN, passtZurArt, type PrivatArt, type PrivatKategorie } from './text';

export type PrivatWerte = {
  art: PrivatArt;
  datum: string;
  betragCent: number;
  kategorie: PrivatKategorie;
  haendler: string | null;
  notiz: string | null;
};

/** فرم ← مقدارهای ذخیره‌شدنی؛ خطا به آلمانی، مثل بقیهٔ فرم‌ها. */
export function privatPruefen(roh: Record<string, string>, heute: string): { ok: true; werte: PrivatWerte } | { ok: false; fehler: string } {
  const art = roh.art as PrivatArt;
  if (!(PRIVAT_ARTEN as readonly string[]).includes(art)) return { ok: false, fehler: 'Bitte Ausgabe oder Einnahme wählen.' };
  const datum = (roh.datum ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(datum)) || datum < '2000-01-01') return { ok: false, fehler: 'Bitte ein gültiges Datum angeben.' };
  if (datum > heute) return { ok: false, fehler: 'Das Datum liegt in der Zukunft.' };
  const b = centLesen(roh.betrag);
  if (!b.ok) return { ok: false, fehler: `Betrag: ${b.fehler}` };
  if (b.wert == null || b.wert <= 0) return { ok: false, fehler: 'Bitte den Betrag angeben.' };
  if (b.wert > 100_000_000) return { ok: false, fehler: 'Der Betrag ist zu groß.' };
  const kategorie = (roh.kategorie ?? '').trim();
  if (!passtZurArt(art, kategorie)) return { ok: false, fehler: 'Bitte eine Kategorie wählen.' };
  const haendler = (roh.haendler ?? '').trim().replace(/\s+/g, ' ');
  if (haendler.length > 120) return { ok: false, fehler: 'Der Name ist zu lang.' };
  const notiz = (roh.notiz ?? '').trim();
  if (notiz.length > 300) return { ok: false, fehler: 'Die Notiz ist zu lang (höchstens 300 Zeichen).' };
  return { ok: true, werte: { art, datum, betragCent: b.wert, kategorie, haendler: haendler || null, notiz: notiz || null } };
}
