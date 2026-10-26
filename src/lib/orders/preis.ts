import type { LieferOption, Zuschlag } from '@/db/schema';
import { centText } from '@/lib/abrechnung/geld';
import { positionBetrag, rabattText, vorschlag, type Position, type PositionEinheit } from '@/lib/abrechnung/positionen';
import { istEilig, ZUSCHLAG_NAMEN, type Tempo } from '@/lib/katalog/tempo';
import { kieferImAuftrag, type Antworten, type Lieferart } from './assistent';
import type { Block } from './form-schema';
import { zaehneAus } from './pruefung';

/**
 * قیمت هر سفارش برای Ordination، روشن و با جمع (خواستهٔ کاربر، ۲۵ اکتبر ۲۰۲۶: «مهم‌ترین چیز برای Ordination
 * این است که بداند این Auftrag چقدر می‌شود»). همان محاسبهٔ پیشنهاد پوزیشن‌های Abrechnung (`vorschlag`)، تا
 * عدد فرم، صفحهٔ سفارش و فاکتور یکی باشد. بدون دیتابیس، پس در مرورگر (فرم) هم کار می‌کند.
 */
export type PreisZeile = { text: string; menge: string; betragCent: number | null };

export type PreisArt =
  /** از قیمت‌های «ab» و دندان‌ها؛ نهایی پس از بررسی */
  | 'schaetzung'
  /** Büro پوزیشن‌ها را ذخیره کرده؛ همین روی Rechnung می‌آید */
  | 'festgelegt'
  /** روی یک Rechnung آمده است */
  | 'verrechnet'
  | 'storniert';

export type PreisUebersicht = {
  art: PreisArt;
  zeilen: PreisZeile[];
  /** جمع ردیف‌هایی که مبلغ دارند (سنت) */
  bekanntCent: number;
  /** ردیف‌هایی که هنوز مبلغ ندارند («Preis auf Anfrage»، «Expresszuschlag nach Prüfung») */
  offen: string[];
  rechnung: string | null;
};

const MEHRZAHL: Record<PositionEinheit, string> = { Zahn: 'Zähne', Glied: 'Glieder', Kiefer: 'Kiefer', Fall: 'Fälle', Auftrag: 'Aufträge', Stück: 'Stück' };

function mengeText(p: Position): string {
  const einheit = p.menge === 1 ? p.einheit : MEHRZAHL[p.einheit];
  if (p.einzelpreisCent == null) return `${p.menge} ${einheit}`;
  const basis = p.menge === 1 ? `1 ${einheit}` : `${p.menge} ${einheit} × ${centText(p.einzelpreisCent)}`;
  return p.rabatt ? `${basis} · Rabatt ${rabattText(p.rabatt)}` : basis;
}

/** ردیف «Expresszuschlag» را از نامش می‌شناسیم، برای متن «… nach Prüfung». */
const offenerName = (p: Position) => (Object.values(ZUSCHLAG_NAMEN).includes(p.bezeichnung as (typeof ZUSCHLAG_NAMEN)[keyof typeof ZUSCHLAG_NAMEN]) ? p.bezeichnung : 'Preis');

export function preisAusPositionen(positionen: readonly Position[], art: PreisArt, rechnung: string | null = null): PreisUebersicht {
  const zeilen = positionen.map((p) => ({ text: p.bezeichnung, menge: mengeText(p), betragCent: positionBetrag(p) }));
  return {
    art,
    zeilen,
    bekanntCent: zeilen.reduce((s, z) => s + (z.betragCent ?? 0), 0),
    offen: positionen.filter((p) => p.einzelpreisCent == null).map(offenerName),
    rechnung,
  };
}

/** تخمین در فرم «Neuer Auftrag»: از جواب‌های تا این لحظه (دندان‌ها، فک‌ها)، Lieferart و Tempo. */
export function preisSchaetzung(e: {
  behandlung: string;
  lieferart: Lieferart | null;
  option: LieferOption | null | undefined;
  tempo: Tempo | null;
  zuschlag: Zuschlag | null | undefined;
  bloecke: readonly Block[];
  antworten: Antworten;
}): PreisUebersicht {
  const positionen = vorschlag({
    behandlung: e.behandlung,
    lieferart: e.lieferart,
    preisAb: e.option?.preisAb ?? null,
    einheit: e.option?.einheit ?? null,
    tempo: e.tempo,
    zuschlag: istEilig(e.tempo) ? (e.zuschlag ?? null) : null,
    zaehne: zaehneAus(e.bloecke, e.antworten as Record<string, unknown>),
    kiefer: kieferImAuftrag(e.bloecke, e.antworten),
    neuanfertigung: null,
  });
  return preisAusPositionen(positionen, 'schaetzung');
}

/** متن بزرگ: جمع، یا «Preis auf Anfrage» وقتی هیچ مبلغی نیست. */
export function preisGross(p: PreisUebersicht): string {
  if (p.art === 'storniert') return 'Storniert';
  if (!p.zeilen.some((z) => z.betragCent != null)) return 'Preis auf Anfrage';
  // Neuanfertigung in der Gewährleistung
  if (!p.offen.length && p.zeilen.every((z) => z.betragCent === 0)) return 'Ohne Berechnung';
  return centText(p.bekanntCent);
}

/** سطر کوچک زیر جمع در ستون کنار صفحه: «netto»، «zzgl. Expresszuschlag nach Prüfung» … */
export function preisKurz(p: PreisUebersicht): string {
  if (p.art === 'storniert') return 'wird nicht verrechnet';
  if (!p.zeilen.some((z) => z.betragCent != null)) return 'nach Prüfung';
  const teile = [...(p.art === 'verrechnet' ? [`Rechnung ${p.rechnung ?? ''}`.trim()] : p.art === 'festgelegt' ? ['vom Labor geprüft'] : []), 'netto'];
  if (p.offen.length) teile.push(`zzgl. ${p.offen.join(' und ')} nach Prüfung`);
  return teile.join(', ');
}
