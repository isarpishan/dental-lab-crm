import type { LieferOption, RabattArt, Zuschlag } from '@/db/schema';
import { preisLesen } from '@/lib/katalog/preise';
import { istEilig, ZUSCHLAG_NAMEN, type Tempo } from '@/lib/katalog/tempo';
import { centAusEuro, centLesen, centText } from './geld';

/**
 * پوزیشن‌های فاکتور هر سفارش (Spec فاز ۲، بخش ۲ و تصمیم‌های قدم ۱). پیشنهاد خودکار از قیمتی که
 * هنگام ثبت سفارش ذخیره شد (`orders.price_snapshot`)؛ قیمت «ab» فقط پیش‌فرض است و Büro آن را
 * ویرایش می‌کند (`order_positions`). اینجا بدون دیتابیس، تا آزمون‌پذیر باشد.
 */
export const POSITION_EINHEITEN = ['Zahn', 'Glied', 'Kiefer', 'Fall', 'Auftrag', 'Stück'] as const;
export type PositionEinheit = (typeof POSITION_EINHEITEN)[number];

/** درصد به صدم درصد (1000 = 10 %)، مبلغ به سنت؛ همیشه مثبت. */
export type Rabatt = { art: RabattArt; wert: number };

export type Position = { bezeichnung: string; menge: number; einheit: PositionEinheit; einzelpreisCent: number | null; rabatt?: Rabatt | null };

export type Grundlage = {
  behandlung: string;
  lieferart: 'design' | 'fertigung' | null;
  /** یورو، از `price_snapshot.preisAb`؛ null یعنی «Preis auf Anfrage» */
  preisAb: number | null;
  einheit: LieferOption['einheit'] | null;
  tempo: Tempo | null;
  /** Zuschlag همان Tempo (Express یا Same-Day) از `price_snapshot.zuschlag`؛ null یعنی «nach Prüfung» */
  zuschlag: Zuschlag | null;
  zaehne: { fdi: number; treatment: string; spanId: string | null }[];
  kiefer: ('OK' | 'UK')[];
  neuanfertigung: { reklamation: string; kostenlos: boolean } | null;
};

const LIEFERART: Record<'design' | 'fertigung', string> = { design: 'Nur Design', fertigung: 'Fertige Arbeit' };
const KIEFER: Record<'OK' | 'UK', string> = { OK: 'Oberkiefer', UK: 'Unterkiefer' };
// Klammer و Prothesenbasis دندان جدا حساب نمی‌شوند
const KEIN_ZAHN = new Set(['klammer', 'basis']);

const zahnNummern = (z: Grundlage['zaehne']) => [...new Set(z.filter((x) => !KEIN_ZAHN.has(x.treatment)).map((x) => x.fdi))].sort((a, b) => a - b);

/** تعداد برای یک واحد: Zahn = دندان‌ها، Glied = اعضای Brücke، Kiefer = فک‌ها، بقیه ۱. حداقل ۱. */
export function menge(einheit: PositionEinheit, g: Grundlage): number {
  switch (einheit) {
    case 'Zahn':
      return Math.max(1, zahnNummern(g.zaehne).length);
    case 'Glied': {
      const spannen = g.zaehne.filter((z) => z.spanId);
      return Math.max(1, zahnNummern(spannen.length ? spannen : g.zaehne).length);
    }
    case 'Kiefer':
      return Math.max(1, g.kiefer.length);
    default:
      return 1;
  }
}

function genauer(g: Grundlage): string | null {
  const zaehne = zahnNummern(g.zaehne);
  if (zaehne.length && g.einheit !== 'Kiefer') return `${zaehne.length === 1 ? 'Zahn' : 'Zähne'} ${zaehne.join(', ')}`;
  if (g.kiefer.length === 2) return 'Ober- und Unterkiefer';
  if (g.kiefer.length === 1) return KIEFER[g.kiefer[0]];
  return null;
}

export function vorschlag(g: Grundlage): Position[] {
  const einheit: PositionEinheit = g.einheit ?? 'Fall';
  const kostenlos = g.neuanfertigung?.kostenlos === true;
  const teile = [g.behandlung, g.lieferart ? LIEFERART[g.lieferart] : null, genauer(g)].filter(Boolean).join(' · ');
  const zusatz = g.neuanfertigung ? ` – Neuanfertigung (Reklamation ${g.neuanfertigung.reklamation})${kostenlos ? ', kostenlos' : ''}` : '';
  const positionen: Position[] = [
    { bezeichnung: teile + zusatz, menge: menge(einheit, g), einheit, einzelpreisCent: kostenlos ? 0 : g.preisAb == null ? null : centAusEuro(g.preisAb) },
  ];
  // Expresszuschlag و Same-Day-Zuschlag جدا، هر کدام یک ردیف
  if (istEilig(g.tempo) && !kostenlos) {
    const z = g.zuschlag;
    const proAuftrag = !z || z.einheit === 'Auftrag';
    const e: PositionEinheit = proAuftrag ? 'Auftrag' : z.einheit;
    positionen.push({ bezeichnung: ZUSCHLAG_NAMEN[g.tempo], menge: proAuftrag ? 1 : menge(e, g), einheit: e, einzelpreisCent: z?.betrag == null ? null : centAusEuro(z.betrag) });
  }
  return positionen;
}

/**
 * مبلغ کسرشدهٔ Rabatt از مبلغ یک ردیف (Menge × Einzelpreis)، به سنت. درصد گرد می‌شود؛ مبلغ ثابت
 * برای کل ردیف است، نه هر واحد («€ 10 Rabatt» یعنی ۱۰ یورو کمتر روی همین ردیف).
 */
export function rabattCent(grundCent: number, rabatt: Rabatt | null | undefined): number {
  if (!rabatt) return 0;
  return rabatt.art === 'prozent' ? Math.round((grundCent * rabatt.wert) / 10000) : rabatt.wert;
}

/** مبلغ یک ردیف پس از Rabatt، یا null تا قیمتی نیست. */
export function positionBetrag(p: Position): number | null {
  if (p.einzelpreisCent == null) return null;
  const grund = p.menge * p.einzelpreisCent;
  return grund - rabattCent(grund, p.rabatt);
}

const prozentFormat = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 2 });

/** «10 %»، «2,5 %» یا «€ 10,00» */
export const rabattText = (r: Rabatt) => (r.art === 'prozent' ? `${prozentFormat.format(r.wert / 100)} %` : centText(r.wert));

/** مقدار پیش‌فرض فیلد: 1000 (prozent) ← «10»، 250 ← «2,5»؛ 1000 (betrag) ← «10,00». */
export const rabattEingabe = (r: Rabatt | null | undefined) =>
  !r ? '' : r.art === 'prozent' ? prozentFormat.format(r.wert / 100).replace(/\s/g, '') : (r.wert / 100).toFixed(2).replace('.', ',');

/**
 * Rabatt یک ردیف فاکتور برای نمایش (`invoice_lines`): «10 %» با مبلغ کسرشده، یا فقط مبلغ. در Storno مبلغ
 * کسرشده منفی است، پس علامت آن برعکس می‌شود. null یعنی این ردیف Rabatt ندارد.
 */
export function rabattAnzeige(z: { rabattArt: RabattArt | null; rabattWert: number | null; rabattCent: number }): { prozent: string | null; betrag: string } | null {
  if (!z.rabattArt || !z.rabattWert) return null;
  return {
    prozent: z.rabattArt === 'prozent' ? rabattText({ art: 'prozent', wert: z.rabattWert }) : null,
    betrag: `${z.rabattCent < 0 ? '+' : '−'} ${centText(Math.abs(z.rabattCent))}`,
  };
}

export type RabattLesen = { ok: true; wert: Rabatt | null } | { ok: false; fehler: string };

/**
 * ورودی فرم ← Rabatt. خالی یا ۰ یعنی بدون Rabatt. درصد بیش از ۱۰۰ و مبلغی بیش از مبلغ ردیف رد می‌شود،
 * تا هیچ ردیفی منفی نشود. `grundCent` = Menge × Einzelpreis همان ردیف.
 */
export function rabattLesen(eingabe: string | null | undefined, art: RabattArt, grundCent: number): RabattLesen {
  const t = (eingabe ?? '').trim();
  if (!t) return { ok: true, wert: null };
  if (art === 'prozent') {
    const r = preisLesen(t.replace(/%/g, ''));
    if (!r.ok || r.wert == null) return { ok: false, fehler: `»${t}« ist kein gültiger Rabatt (z. B. 10 oder 2,5).` };
    if (r.wert > 100) return { ok: false, fehler: 'Ein Rabatt in Prozent ist höchstens 100 %.' };
    const wert = Math.round(r.wert * 100);
    return { ok: true, wert: wert ? { art, wert } : null };
  }
  const r = centLesen(t);
  if (!r.ok || r.wert == null) return { ok: false, fehler: `»${t}« ist kein gültiger Rabatt (z. B. 10 oder 12,50).` };
  if (r.wert > grundCent) return { ok: false, fehler: `Der Rabatt ist höher als der Betrag der Position (${centText(grundCent)}).` };
  return { ok: true, wert: r.wert ? { art, wert: r.wert } : null };
}

/** جمع netto به سنت، پس از Rabattها؛ `preisFehlt` اگر یک ردیف هنوز قیمت ندارد (تا آن وقت فاکتوری صادر نمی‌شود). */
export function summe(positionen: readonly Position[]): { cent: number; preisFehlt: boolean } {
  let cent = 0;
  let preisFehlt = false;
  for (const p of positionen) {
    const b = positionBetrag(p);
    if (b == null) preisFehlt = true;
    else cent += b;
  }
  return { cent, preisFehlt };
}
