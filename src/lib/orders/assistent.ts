import { zusammenfassung as zahnZusammenfassung, type ZahnAuswahl } from './bridge';
import { kieferVon, sortiert, type Kiefer } from './fdi';
import type { Block, FormSchema } from './form-schema';
import { betroffeneKiefer, zusammenfassung as protheseZusammenfassung, type ProthesenAuswahl } from './prothese';

/**
 * منطق فرم قدم‌به‌قدم «Neuer Auftrag» (خواستهٔ کاربر، ۱ اکتبر ۲۰۲۶): هر بار
 * فقط یک سؤال باز است. قدم بعدی وقتی ظاهر می‌شود که قدم قبلی جواب کامل داشته
 * باشد. هر قطعهٔ `form_schema` یک قدم است، به همان ترتیب.
 *
 * همهٔ تابع‌ها خالص‌اند تا هم در مرورگر و هم در سرور (اعتبارسنجی موقع ارسال،
 * قدم ۵) همان نتیجه را بدهند.
 */

export type Antworten = Readonly<Record<string, unknown>>;
export type Lieferart = 'design' | 'fertigung';
export type KieferWahl = 'OK' | 'UK' | 'beide';

export type Zahnfarbe = {
  system: 'vita_classical' | 'vita_3d_master' | 'folgt';
  farbe?: string;
  farbanpassung?: boolean;
};

export type ImplantatAngaben = {
  hersteller?: string;
  herstellerAndere?: string;
  system?: string;
  scanbodyHersteller?: string;
  scanbodyTyp?: string;
  scanbodyArtikel?: string;
};

export type Aesthetik = { merkmale?: string[]; text?: string };

export const LIEFERART_NAMEN: Record<Lieferart, string> = {
  design: 'Nur Design (Datei)',
  fertigung: 'Fertige Arbeit',
};

export const KIEFER_NAMEN: Record<KieferWahl, string> = {
  OK: 'Oberkiefer',
  UK: 'Unterkiefer',
  beide: 'Ober- und Unterkiefer',
};

export const VITA_CLASSICAL = ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4'];

export const VITA_3D_MASTER = [
  '0M1', '0M2', '0M3',
  '1M1', '1M2',
  '2L1.5', '2L2.5', '2M1', '2M2', '2M3', '2R1.5', '2R2.5',
  '3L1.5', '3L2.5', '3M1', '3M2', '3M3', '3R1.5', '3R2.5',
  '4L1.5', '4L2.5', '4M1', '4M2', '4M3', '4R1.5', '4R2.5',
  '5M1', '5M2', '5M3',
];

export const AESTHETIK_MERKMALE = ['Zahnform', 'Länge', 'Breite', 'Symmetrie', 'Mittellinie', 'Inzisalkanten', 'Proportionen'];

/** «A3.5» ← «A3,5»: در de-AT اعشار با ویرگول نوشته می‌شود. */
export function farbName(farbe: string): string {
  return farbe.replace('.', ',');
}

/* ── کدام قطعه‌ها دیده می‌شوند ─────────────────────────────────── */

/** فک‌هایی که این سفارش تا اینجا درگیرشان است، از روی دندان‌ها یا انتخاب «Kiefer». */
export function kieferImAuftrag(bloecke: readonly Block[], antworten: Antworten): Kiefer[] {
  const kiefer = new Set<Kiefer>();
  for (const b of bloecke) {
    const wert = antworten[b.id];
    if (!wert) continue;
    if (b.typ === 'zahnleiste') {
      for (const fdi of Object.keys(wert as ZahnAuswahl)) kiefer.add(kieferVon(Number(fdi)));
    } else if (b.typ === 'kieferbogen') {
      for (const k of betroffeneKiefer(wert as ProthesenAuswahl)) kiefer.add(k);
    } else if (b.typ === 'kiefer') {
      const k = wert as KieferWahl;
      if (k === 'OK' || k === 'beide') kiefer.add('OK');
      if (k === 'UK' || k === 'beide') kiefer.add('UK');
    }
  }
  return (['OK', 'UK'] as const).filter((k) => kiefer.has(k));
}

/** قطعه‌هایی که با جواب‌های فعلی معنا دارند (`nurWenn`). */
export function sichtbareBloecke(schema: FormSchema, antworten: Antworten): Block[] {
  const kiefer = kieferImAuftrag(schema.bloecke, antworten);
  return schema.bloecke.filter((b) => !b.nurWenn || kiefer.includes(b.nurWenn.kiefer));
}

/* ── کامل بودن جواب ────────────────────────────────────────────── */

const leer = (s: unknown) => typeof s !== 'string' || s.trim() === '';

/**
 * اگر جواب این قطعه کامل نیست، پیامی برای کاربر؛ وگرنه null.
 * قطعه‌های اختیاری هم باید شکل درست داشته باشند، ولی خالی بودنشان اشکال ندارد.
 */
export function blockFehler(block: Block, wert: unknown): string | null {
  switch (block.typ) {
    case 'zahnleiste': {
      const anzahl = Object.keys((wert as ZahnAuswahl | undefined) ?? {}).length;
      return block.pflicht && anzahl === 0 ? 'Bitte mindestens einen Zahn auswählen.' : null;
    }
    case 'kieferbogen': {
      const ersetzt = Object.values((wert as ProthesenAuswahl | undefined) ?? {}).some((e) => e.zahn);
      return block.pflicht && !ersetzt ? 'Bitte mindestens einen Ersatzzahn oder eine Extraktion markieren.' : null;
    }
    case 'bildauswahl':
    case 'auswahl': {
      if (wert === undefined) return block.pflicht ? 'Bitte eine Option wählen.' : null;
      return block.optionen.some((o) => o.wert === wert) ? null : 'Bitte eine Option wählen.';
    }
    case 'kiefer':
      if (wert === undefined) return block.pflicht ? 'Bitte einen Kiefer wählen.' : null;
      return wert === 'OK' || wert === 'UK' || wert === 'beide' ? null : 'Bitte einen Kiefer wählen.';
    case 'schalter':
      if (wert === undefined) return block.pflicht ? 'Bitte Ja oder Nein wählen.' : null;
      return typeof wert === 'boolean' ? null : 'Bitte Ja oder Nein wählen.';
    case 'zahnfarbe': {
      const f = wert as Zahnfarbe | undefined;
      if (f?.system === 'folgt') return null;
      const liste = f?.system === 'vita_3d_master' ? VITA_3D_MASTER : VITA_CLASSICAL;
      if (f?.farbe && liste.includes(f.farbe)) return null;
      return block.pflicht ? 'Bitte eine Zahnfarbe wählen oder »Farbe folgt«.' : null;
    }
    case 'implantat': {
      if (!block.pflicht) return null;
      const i = (wert as ImplantatAngaben | undefined) ?? {};
      if (leer(i.hersteller) || (i.hersteller === 'andere' && leer(i.herstellerAndere))) return 'Bitte den Implantathersteller angeben.';
      if (leer(i.system)) return 'Bitte Implantatsystem oder Plattform angeben.';
      return null;
    }
    case 'aesthetik': {
      const a = (wert as Aesthetik | undefined) ?? {};
      return block.pflicht && !a.merkmale?.length && leer(a.text) ? 'Bitte mindestens einen Punkt wählen oder die gewünschte Ästhetik beschreiben.' : null;
    }
    case 'text':
      return block.pflicht && leer(wert) ? 'Bitte ausfüllen.' : null;
  }
}

/* ── متن‌ها ────────────────────────────────────────────────────── */

/** عنوان کوتاه، برای ردیف جمع‌شده و خلاصه. */
export function blockTitel(block: Block): string {
  switch (block.typ) {
    case 'zahnleiste':
    case 'kieferbogen':
      return 'Zähne';
    case 'zahnfarbe':
      return 'Zahnfarbe';
    case 'implantat':
      return 'Implantat';
    case 'aesthetik':
      return 'Ästhetik';
    default:
      return block.label;
  }
}

/** سؤال قدمِ باز. */
export function blockFrage(block: Block): string {
  switch (block.typ) {
    case 'zahnleiste':
      return 'Welche Zähne?';
    case 'kieferbogen':
      return 'Welche Zähne ersetzt die Prothese?';
    case 'kiefer':
      return 'Welcher Kiefer?';
    case 'schalter':
      return `${block.label}?`;
    case 'zahnfarbe':
      return 'Welche Zahnfarbe?';
    case 'implantat':
      return 'Angaben zum Implantat';
    case 'aesthetik':
      return 'Was soll gestaltet werden?';
    default:
      return block.label;
  }
}

/** جواب به شکل یک خط متن، برای ردیف جمع‌شده و «Zusammenfassung». */
export function blockText(block: Block, wert: unknown): string {
  switch (block.typ) {
    case 'zahnleiste':
      return zahnZusammenfassung((wert as ZahnAuswahl | undefined) ?? {}).join(' · ') || '–';
    case 'kieferbogen':
      return protheseZusammenfassung((wert as ProthesenAuswahl | undefined) ?? {}).join(' · ') || '–';
    case 'bildauswahl':
    case 'auswahl':
      return block.optionen.find((o) => o.wert === wert)?.label ?? 'keine Angabe';
    case 'kiefer':
      return KIEFER_NAMEN[wert as KieferWahl] ?? '–';
    case 'schalter':
      return wert === true ? 'Ja' : wert === false ? 'Nein' : 'keine Angabe';
    case 'zahnfarbe': {
      const f = wert as Zahnfarbe | undefined;
      if (!f) return '–';
      const teile = [f.system === 'folgt' ? 'Farbe folgt' : `${f.system === 'vita_3d_master' ? 'VITA 3D-Master' : 'VITA classical'} ${farbName(f.farbe ?? '')}`];
      if (f.farbanpassung) teile.push('Individuelle Farbanpassung');
      return teile.join(' · ');
    }
    case 'implantat': {
      const i = (wert as ImplantatAngaben | undefined) ?? {};
      const hersteller = i.hersteller === 'andere' ? i.herstellerAndere : i.hersteller;
      const teile = [hersteller, i.system].filter((t) => !leer(t));
      const scanbody = [i.scanbodyHersteller, i.scanbodyTyp, i.scanbodyArtikel].filter((t) => !leer(t)).join(' ');
      if (scanbody) teile.push(`Scanbody ${scanbody}`);
      return teile.join(' · ') || '–';
    }
    case 'aesthetik': {
      const a = (wert as Aesthetik | undefined) ?? {};
      const teile = [...(a.merkmale ?? [])];
      if (!leer(a.text)) teile.push(`„${a.text!.trim()}“`);
      return teile.join(' · ') || 'keine Angabe';
    }
    case 'text':
      return leer(wert) ? 'keine Angabe' : (wert as string).trim();
  }
}

/** موقعیت Implantatها از Zahnleiste، برای نمایش در قدم «Implantat». */
export function implantatPositionen(bloecke: readonly Block[], antworten: Antworten): number[] {
  const zahnleiste = bloecke.find((b) => b.typ === 'zahnleiste');
  if (!zahnleiste) return [];
  const wert = (antworten[zahnleiste.id] as ZahnAuswahl | undefined) ?? {};
  return sortiert(
    Object.entries(wert)
      .filter(([, e]) => e.art === 'implantatkrone')
      .map(([fdi]) => Number(fdi)),
  );
}
