import type { Zuschlag } from '@/db/schema';
import { euroBetrag } from './preise';

/**
 * سه Service-Level جدا برای هر سفارش (خواستهٔ کاربر، ۵ اکتبر ۲۰۲۶):
 * - Standard: زمان عادی همان Behandlung («ca. 2 Wochen»، «nach Prüfung»)
 * - Express: کمتر از ۲۴ ساعت، nach Verfügbarkeit، با Expresszuschlag
 * - Same-Day: همان Werktag، nach Verfügbarkeit، با Same-Day-Zuschlag جدا؛ فقط جایی که
 *   این روند شدنی است (Krone، Inlay/Onlay)
 * هر Behandlung در «Preise» جدا می‌گوید کدام را دارد (`work_types.express_available` و
 * `same_day_available`). Prothese دیگر Express ندارد (تصمیم کاربر).
 */

// `db/schema.ts` این را با مسیر نسبی می‌خواند؛ پس این فایل و `preise.ts` در زمان اجرا فقط به هم وابسته‌اند.
export const TEMPI = ['standard', 'express', 'same_day'] as const;
export type Tempo = (typeof TEMPI)[number];
export type Eilig = Exclude<Tempo, 'standard'>;

/** نام کامل، در فرم سفارش و «Preise». */
export const TEMPO_NAMEN: Record<Tempo, string> = { standard: 'Standard', express: 'Express < 24 Stunden', same_day: 'Same-Day' };
/** نام کوتاه برای تگ‌ها و خلاصه‌ها (Kanban، فهرست‌ها، Laufzettel). */
export const TEMPO_KURZ: Record<Tempo, string> = { standard: 'Standard', express: 'Express', same_day: 'Same-Day' };
/** زمان ثابت Express و Same-Day؛ زمان Standard از خود Behandlung می‌آید. */
export const TEMPO_ZEIT: Record<Eilig, string> = { express: '< 24 Stunden', same_day: 'am selben Werktag' };
/** یک خط توضیح در فرم سفارش. */
export const TEMPO_BESCHREIBUNG: Record<Eilig, string> = {
  express: 'Fertigstellung innerhalb von 24 Stunden, nach Verfügbarkeit',
  same_day: 'Fertigstellung am selben Werktag, nach Verfügbarkeit',
};
export const ZUSCHLAG_NAMEN: Record<Eilig, string> = { express: 'Expresszuschlag', same_day: 'Same-Day-Zuschlag' };
/** برچسب کاشی Behandlung در فرم سفارش. */
export const SAME_DAY_TAG = 'Same-Day möglich';

/** «Expresszuschlag € 40 pro Auftrag»، یا «Same-Day-Zuschlag nach Prüfung» تا Inhaber مبلغی وارد کند. */
export function zuschlagText(tempo: Eilig, z: Zuschlag): string {
  return z.betrag != null ? `${ZUSCHLAG_NAMEN[tempo]} ${euroBetrag(z.betrag)} pro ${z.einheit}` : `${ZUSCHLAG_NAMEN[tempo]} nach Prüfung`;
}

/** ترتیب در Kanban و Kalender: Same-Day اول، بعد Express، بعد Standard. */
export function tempoRang(t: Tempo | null): number {
  return t === 'same_day' ? 2 : t === 'express' ? 1 : 0;
}

export const istEilig = (t: Tempo | null): t is Eilig => t === 'express' || t === 'same_day';

/** آنچه از یک Behandlung لازم است (ردیف `work_types` یا `BehandlungDef`). */
export type TempoQuelle = { expressAvailable: boolean; expressSurcharge: Zuschlag; sameDayAvailable: boolean; sameDaySurcharge: Zuschlag };

/** Service-Levelهای این Behandlung، Standard همیشه اول. */
export function angeboteneTempi(b: Pick<TempoQuelle, 'expressAvailable' | 'sameDayAvailable'>): Tempo[] {
  return ['standard', ...(b.expressAvailable ? (['express'] as const) : []), ...(b.sameDayAvailable ? (['same_day'] as const) : [])];
}

export function zuschlagVon(b: TempoQuelle, t: Eilig): Zuschlag {
  return t === 'express' ? b.expressSurcharge : b.sameDaySurcharge;
}
