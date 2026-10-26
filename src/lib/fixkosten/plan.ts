import { centLesen } from '@/lib/abrechnung/geld';
import { AUSGABE_KATEGORIEN } from '@/lib/ausgaben/text';
import { passtZurArt, type PrivatArt } from '@/lib/privat/text';
import { RHYTHMEN, type Rhythmus } from './text';

/**
 * «Fixkosten» (Spec فاز ۵، قدم ۳): زمان‌بندی بدون دیتابیس، تا با آزمون واحد سنجیده شود. یک Vorlage با «Erste
 * Fälligkeit» (تاریخ) و Rhythmus؛ روزِ همان تاریخ روز هر سررسید است (۳۱ در فوریه ← آخر ماه). هر سررسید یک
 * «Periode» دارد («2026-10»)؛ در دیتابیس هر Vorlage برای هر Periode فقط یک بار اجرا می‌شود.
 */

export type Plan = { ab: string; tag: number; rhythmus: Rhythmus; bis: string | null };
export type Faelligkeit = { periode: string; faelligAm: string };

const SCHRITT: Record<Rhythmus, number> = { monatlich: 1, quartal: 3, jaehrlich: 12 };

const tageImMonat = (j: number, m: number) => new Date(Date.UTC(j, m, 0)).getUTCDate();

/** سررسید در ماهِ `index` (سال × ۱۲ + ماه − ۱) */
function inMonat(index: number, tag: number): Faelligkeit {
  const j = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const t = Math.min(tag, tageImMonat(j, m));
  const mm = String(m).padStart(2, '0');
  return { periode: `${j}-${mm}`, faelligAm: `${j}-${mm}-${String(t).padStart(2, '0')}` };
}

const monatIndex = (datum: string) => Number(datum.slice(0, 4)) * 12 + Number(datum.slice(5, 7)) - 1;

/**
 * همهٔ سررسیدها تا امروز (خودِ امروز هم)، قدیمی‌ترین اول؛ حداکثر `max` تای آخر، تا یک تاریخ خیلی قدیمی صدها ردیف
 * نسازد. `bis`: آخرین روزی که هنوز سررسید دارد.
 */
export function faelligkeiten(p: Plan, heute: string, max = 24): Faelligkeit[] {
  const aus: Faelligkeit[] = [];
  const ende = monatIndex(heute);
  for (let i = monatIndex(p.ab); i <= ende; i += SCHRITT[p.rhythmus]) {
    const f = inMonat(i, p.tag);
    if (f.faelligAm < p.ab) continue;
    if (p.bis && f.faelligAm > p.bis) break;
    if (f.faelligAm > heute) break;
    aus.push(f);
  }
  return aus.slice(-max);
}

/** سررسید بعدی بعد از امروز؛ بعد از `bis` ← null */
export function naechsteFaelligkeit(p: Plan, heute: string): Faelligkeit | null {
  const start = monatIndex(p.ab);
  const schritt = SCHRITT[p.rhythmus];
  // از ماه جاری (یا شروع) جلو برو؛ حداکثر سه سال
  let i = start;
  const jetzt = monatIndex(heute);
  if (jetzt > start) i = start + Math.floor((jetzt - start) / schritt) * schritt;
  for (let n = 0; n < 40; n++, i += schritt) {
    const f = inMonat(i, p.tag);
    if (f.faelligAm < p.ab || f.faelligAm <= heute) continue;
    return p.bis && f.faelligAm > p.bis ? null : f;
  }
  return null;
}

/** سررسیدِ ماهِ یک تاریخ (مثلاً ماهِ یک ردیف بانک)؛ اگر در آن ماه چیزی سررسید نیست ← null */
export function faelligkeitImMonat(p: Plan, datum: string): Faelligkeit | null {
  const j = Number(datum.slice(0, 4));
  const m = Number(datum.slice(5, 7));
  const monatsEnde = `${datum.slice(0, 7)}-${String(tageImMonat(j, m)).padStart(2, '0')}`;
  return faelligkeiten(p, monatsEnde, 1).find((f) => f.periode === datum.slice(0, 7)) ?? null;
}

/** مبلغ به ازای یک ماه (برای جمع «pro Monat»): فصلی ÷ ۳، سالانه ÷ ۱۲ */
export const proMonatCent = (cent: number, r: Rhythmus) => Math.round(cent / SCHRITT[r]);

export type Bereich = 'ddl' | 'privat';

export type VorlageWerte = {
  bereich: Bereich;
  art: PrivatArt;
  titel: string;
  gegenpartei: string | null;
  kategorie: string;
  betragCent: number;
  mwstSatz: number | null;
  rhythmus: Rhythmus;
  ab: string;
  tag: number;
  bis: string | null;
  notiz: string | null;
};

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const gueltig = (d: string) => DATUM.test(d) && !Number.isNaN(Date.parse(d)) && d >= '2000-01-01' && d <= '2100-12-31';

/** فرم ← مقدارهای ذخیره‌شدنی. DDL فقط Ausgabe و با نرخ MwSt؛ Privat Ausgabe یا Einnahme. */
export function vorlagePruefen(roh: Record<string, string>, bereich: Bereich): { ok: true; werte: VorlageWerte } | { ok: false; fehler: string } {
  const titel = (roh.titel ?? '').trim().replace(/\s+/g, ' ');
  if (!titel) return { ok: false, fehler: 'Bitte einen Titel angeben, z. B. »Miete«.' };
  if (titel.length > 120) return { ok: false, fehler: 'Der Titel ist zu lang.' };
  const art: PrivatArt = bereich === 'ddl' ? 'ausgabe' : (roh.art as PrivatArt);
  if (art !== 'ausgabe' && art !== 'einnahme') return { ok: false, fehler: 'Bitte Ausgabe oder Einnahme wählen.' };
  const kategorie = (roh.kategorie ?? '').trim();
  const kategorieOk = bereich === 'ddl' ? (AUSGABE_KATEGORIEN as readonly string[]).includes(kategorie) : passtZurArt(art, kategorie);
  if (!kategorieOk) return { ok: false, fehler: 'Bitte eine Kategorie wählen.' };
  const b = centLesen(roh.betrag);
  if (!b.ok) return { ok: false, fehler: `Betrag: ${b.fehler}` };
  if (b.wert == null || b.wert <= 0) return { ok: false, fehler: 'Bitte den Betrag angeben.' };
  let mwstSatz: number | null = null;
  if (bereich === 'ddl') {
    mwstSatz = Number(roh.satz);
    if (![20, 13, 10, 0].includes(mwstSatz) || roh.satz === '') return { ok: false, fehler: 'Bitte den MwSt-Satz wählen.' };
  }
  const rhythmus = roh.rhythmus as Rhythmus;
  if (!(RHYTHMEN as readonly string[]).includes(rhythmus)) return { ok: false, fehler: 'Bitte wählen, wie oft der Betrag fällig ist.' };
  const ab = (roh.ab ?? '').trim();
  if (!gueltig(ab)) return { ok: false, fehler: 'Bitte die erste Fälligkeit als Datum angeben.' };
  const bis = (roh.bis ?? '').trim();
  if (bis && !gueltig(bis)) return { ok: false, fehler: 'Bitte für »Endet am« ein gültiges Datum angeben oder das Feld leer lassen.' };
  if (bis && bis < ab) return { ok: false, fehler: '»Endet am« liegt vor der ersten Fälligkeit.' };
  const gegenpartei = (roh.gegenpartei ?? '').trim().replace(/\s+/g, ' ');
  if (gegenpartei.length > 120) return { ok: false, fehler: 'Der Name ist zu lang.' };
  const notiz = (roh.notiz ?? '').trim();
  if (notiz.length > 300) return { ok: false, fehler: 'Die Notiz ist zu lang (höchstens 300 Zeichen).' };
  return {
    ok: true,
    werte: { bereich, art, titel, gegenpartei: gegenpartei || null, kategorie, betragCent: b.wert, mwstSatz, rhythmus, ab, tag: Number(ab.slice(8, 10)), bis: bis || null, notiz: notiz || null },
  };
}
