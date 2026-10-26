import { z } from 'zod';
import type { KatalogEintrag } from '@/lib/katalog/auswahl';
import { TEMPI, TEMPO_KURZ, type Tempo } from '@/lib/katalog/tempo';
import {
  AESTHETIK_MERKMALE,
  blockFehler,
  blockTitel,
  farbName,
  sichtbareBloecke,
  type Antworten,
  type Lieferart,
  type Zahnfarbe,
} from './assistent';
import type { ZahnAuswahl } from './bridge';
import { DATEI_NAMEN, type Block, type DateiPlatz } from './form-schema';
import type { ProthesenAuswahl } from './prothese';

/**
 * بررسی سفارش، هم در مرورگر و هم در سرور، با همان قاعده‌ها (Spec فاز ۱، بخش D):
 * - شکل هر جواب با zod، از روی همان قطعهٔ `form_schema` (`antwortSchema`)
 * - کامل بودن با `blockFehler`
 * - Lieferart، Tempo، فایل‌های لازم، Behandler و Wunschtermin
 *
 * سرور فقط چیزی را ذخیره می‌کند که این‌جا پاک‌سازی شده است (`config`): جواب
 * قطعه‌هایی که دیگر دیده نمی‌شوند (مثلاً Gaumenabdeckung وقتی فقط UK مانده) حذف می‌شوند.
 */

/* ── شکل جواب هر قطعه ─────────────────────────────────────────── */

const fdi = z.string().regex(/^[1-4][1-8]$/);
const kurz = z.string().max(200).optional();
const auswahlAus = (werte: readonly string[]) => z.enum(werte as [string, ...string[]]);

export function antwortSchema(block: Block): z.ZodType {
  switch (block.typ) {
    case 'zahnleiste': {
      const arten = block.werkzeuge.flatMap((w) => (w === 'bruecke' ? ['bruecke_anker', 'bruecke_glied'] : [w]));
      return z.record(fdi, z.strictObject({ art: auswahlAus(arten), spanne: z.string().regex(/^b\d{2}-\d{2}$/).optional() }));
    }
    case 'kieferbogen':
      return z.record(
        fdi,
        z.strictObject({ zahn: z.enum(['ersatzzahn', 'extraktion']).optional(), basis: z.boolean().optional(), klammer: z.boolean().optional() }),
      );
    case 'bildauswahl':
    case 'auswahl':
      return auswahlAus(block.optionen.map((o) => o.wert));
    case 'kiefer':
      return z.enum(['OK', 'UK', 'beide']);
    case 'schalter':
      return z.boolean();
    case 'zahnfarbe':
      return z.strictObject({
        system: z.enum(['vita_classical', 'vita_3d_master', 'folgt']),
        farbe: z.string().max(10).optional(),
        farbanpassung: z.boolean().optional(),
      });
    case 'implantat':
      return z.strictObject({
        hersteller: kurz,
        herstellerAndere: kurz,
        system: kurz,
        scanbodyHersteller: kurz,
        scanbodyTyp: kurz,
        scanbodyArtikel: kurz,
      });
    case 'aesthetik':
      return z.strictObject({ merkmale: z.array(auswahlAus(AESTHETIK_MERKMALE)).max(AESTHETIK_MERKMALE.length).optional(), text: z.string().max(2000).optional() });
    case 'text':
      return z.string().max(2000);
  }
}

/* ── حالت فرم (Entwurf) ──────────────────────────────────────── */

export type Plan = { behandlerId: string | null; wunschtermin: string | null; text: string };
export const LEERER_PLAN: Plan = { behandlerId: null, wunschtermin: null, text: '' };

/** همهٔ آنچه فرم نگه می‌دارد، به‌جز بیمار و فایل‌ها (که جدا ذخیره می‌شوند). */
export type EntwurfDaten = {
  auswahl: string | null;
  behandlung: string | null;
  antworten: Antworten;
  bestaetigt: Readonly<Record<string, boolean>>;
  lieferart: Lieferart | null;
  /** Standard، Express یا Same-Day (`lib/katalog/tempo.ts`) */
  tempo: Tempo | null;
  /** «Daten werden nachgereicht»: ارسال بدون همهٔ فایل‌های لازم. */
  nachgereicht: boolean;
  plan: Plan;
};

export const LEERER_ENTWURF: EntwurfDaten = {
  auswahl: null,
  behandlung: null,
  antworten: {},
  bestaetigt: {},
  lieferart: null,
  tempo: null,
  nachgereicht: false,
  plan: LEERER_PLAN,
};

const isoDatum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** شکل Entwurf برای ذخیره (بررسی سبک؛ بررسی کامل موقع ارسال). */
export const entwurfSchema = z.object({
  auswahl: z.string().max(60).nullable(),
  behandlung: z.string().max(60).nullable(),
  antworten: z.record(z.string().max(60), z.unknown()).refine((a) => JSON.stringify(a).length <= 50_000, 'Zu viele Angaben'),
  bestaetigt: z.record(z.string().max(80), z.boolean()),
  lieferart: z.enum(['design', 'fertigung']).nullable(),
  tempo: z.enum(TEMPI).nullable(),
  nachgereicht: z.boolean(),
  plan: z.object({ behandlerId: z.uuid().nullable(), wunschtermin: isoDatum.nullable(), text: z.string().max(4000) }),
});

/* ── بررسی کامل ──────────────────────────────────────────────── */

export type SchrittFehler = { schritt: string; text: string };

export type Pruefung = {
  fehler: SchrittFehler[];
  /** جاهای لازمی که فایلی ندارند (حتی با «nachgereicht»). */
  fehlendeDateien: DateiPlatz[];
  /** فقط جواب‌های قطعه‌های دیده‌شده، با شکل درست. */
  config: Record<string, unknown>;
  lieferart: Lieferart | null;
};

export type PruefOptionen = {
  /** جاهایی که دست‌کم یک فایل آپلودشده دارند. */
  dateiPlaetze: readonly string[];
  patientGewaehlt: boolean;
  /** Ordination دست‌کم یک Behandler فعال دارد. */
  behandlerNoetig: boolean;
  /** امروز به وقت وین، «2026-10-01». */
  heute: string;
};

export function lieferartVon(eintrag: KatalogEintrag, gewaehlt: Lieferart | null): Lieferart | null {
  if (eintrag.lieferOptionen.length === 1) return eintrag.lieferOptionen[0];
  return gewaehlt && eintrag.lieferOptionen.includes(gewaehlt) ? gewaehlt : null;
}

export function fehlendeDateien(eintrag: KatalogEintrag, dateiPlaetze: readonly string[]): DateiPlatz[] {
  return eintrag.requiredFiles.filter((p) => !dateiPlaetze.includes(p));
}

export function wunschterminFehler(termin: string | null, heute: string): string | null {
  if (!termin) return null;
  if (!isoDatum.safeParse(termin).success || Number.isNaN(Date.parse(termin))) return 'Bitte ein gültiges Datum angeben.';
  if (termin < heute) return 'Der Wunschtermin liegt in der Vergangenheit.';
  return null;
}

export function auftragPruefen(eintrag: KatalogEintrag | null, d: EntwurfDaten, o: PruefOptionen): Pruefung {
  const fehler: SchrittFehler[] = [];
  if (!o.patientGewaehlt) fehler.push({ schritt: 'patient', text: 'Bitte einen Patienten wählen oder anlegen.' });
  if (!eintrag) {
    fehler.push({ schritt: 'behandlung', text: 'Bitte eine Behandlung wählen.' });
    return { fehler, fehlendeDateien: [], config: {}, lieferart: null };
  }

  const config: Record<string, unknown> = {};
  for (const block of sichtbareBloecke(eintrag.formSchema, d.antworten)) {
    const roh = d.antworten[block.id];
    let wert: unknown = undefined;
    if (roh !== undefined) {
      const r = antwortSchema(block).safeParse(roh);
      if (!r.success) {
        fehler.push({ schritt: `b-${block.id}`, text: `${blockTitel(block)}: Angabe ungültig.` });
        continue;
      }
      wert = r.data;
    }
    const text = blockFehler(block, wert);
    if (text) fehler.push({ schritt: `b-${block.id}`, text });
    else if (wert !== undefined) config[block.id] = wert;
  }

  const lieferart = lieferartVon(eintrag, d.lieferart);
  if (!lieferart) fehler.push({ schritt: 'lieferart', text: 'Bitte die Lieferart wählen.' });
  if (d.tempo === null) fehler.push({ schritt: 'tempo', text: 'Bitte das Tempo wählen.' });
  else if (!eintrag.tempi.includes(d.tempo)) fehler.push({ schritt: 'tempo', text: `${TEMPO_KURZ[d.tempo]} ist für diese Behandlung nicht möglich. Bitte ein anderes Tempo wählen.` });

  const fehlend = fehlendeDateien(eintrag, o.dateiPlaetze);
  if (fehlend.length && !d.nachgereicht) {
    fehler.push({
      schritt: 'dateien',
      text: `Es fehlen: ${fehlend.map((p) => DATEI_NAMEN[p]).join(', ')}. Bitte hochladen oder »Daten werden nachgereicht« ankreuzen.`,
    });
  }

  if (o.behandlerNoetig && !d.plan.behandlerId) fehler.push({ schritt: 'plan', text: 'Bitte die Behandlerin oder den Behandler wählen.' });
  const termin = wunschterminFehler(d.plan.wunschtermin, o.heute);
  if (termin) fehler.push({ schritt: 'plan', text: termin });

  return { fehler, fehlendeDateien: fehlend, config, lieferart };
}

/* ── aus der Konfiguration abgeleitet ─────────────────────────── */

export type AuftragsZahn = { fdi: number; treatment: string; spanId: string | null };

/** ردیف‌های `order_teeth`: از Zahnleiste (Krone، Anker، Glied، …) یا Kieferbogen (Ersatzzahn، Klammer، …). */
export function zaehneAus(bloecke: readonly Block[], config: Record<string, unknown>): AuftragsZahn[] {
  const zaehne: AuftragsZahn[] = [];
  for (const b of bloecke) {
    const wert = config[b.id];
    if (!wert) continue;
    if (b.typ === 'zahnleiste') {
      for (const [f, e] of Object.entries(wert as ZahnAuswahl)) zaehne.push({ fdi: Number(f), treatment: e.art, spanId: e.spanne ?? null });
    } else if (b.typ === 'kieferbogen') {
      for (const [f, e] of Object.entries(wert as ProthesenAuswahl)) {
        if (e.zahn) zaehne.push({ fdi: Number(f), treatment: e.zahn, spanId: null });
        if (e.basis && !e.zahn) zaehne.push({ fdi: Number(f), treatment: 'basis', spanId: null });
        if (e.klammer) zaehne.push({ fdi: Number(f), treatment: 'klammer', spanId: null });
      }
    }
  }
  return zaehne.sort((a, b) => a.fdi - b.fdi || a.treatment.localeCompare(b.treatment));
}

/** خلاصهٔ Zahnfarbe برای ستون `shade`: «A3,5»، «3M2»، «Farbe folgt». */
export function farbeKurz(bloecke: readonly Block[], config: Record<string, unknown>): string | null {
  const b = bloecke.find((x) => x.typ === 'zahnfarbe');
  const f = b ? (config[b.id] as Zahnfarbe | undefined) : undefined;
  if (!f) return null;
  return f.system === 'folgt' ? 'Farbe folgt' : f.farbe ? farbName(f.farbe) : null;
}
