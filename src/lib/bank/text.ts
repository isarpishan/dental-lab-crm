/**
 * «Bank» (Spec فاز ۵، قدم ۴): فهرست‌های ثابت. بدون `@/`، چون `db/schema.ts` آن را می‌خواند.
 * حساب BAWAG مخلوط است (شخصی و لابراتوار): هر ردیف به DDL، Privat یا «Ignorieren» می‌رود.
 */
export const BANK_BEREICHE = ['ddl', 'privat', 'ignorieren'] as const;
export type BankBereich = (typeof BANK_BEREICHE)[number];

/**
 * نتیجهٔ هر ردیف پس از تأیید:
 * - `rechnung`: پرداخت یک Rechnung (ردیف `payments`)
 * - `ausgabe`: به یک Ausgabe لابراتوار وصل
 * - `ddl_offen`: مال لابراتوار، ولی هنوز Ausgabe (Beleg) ندارد ← «Beleg fehlt»
 * - `privat`: به یک Privat-Buchung وصل (تازه یا موجود)
 * - `ignoriert`: مثلاً پول بین اعضای خانواده یا حساب‌های خودی
 */
export const ZUORDNUNGEN = ['rechnung', 'ausgabe', 'ddl_offen', 'privat', 'ignoriert'] as const;
export type Zuordnung = (typeof ZUORDNUNGEN)[number];

export const AUSZUG_STATUS = ['gelesen', 'fehler'] as const;
