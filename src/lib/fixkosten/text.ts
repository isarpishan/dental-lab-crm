/**
 * «Fixkosten» (Spec فاز ۵، قدم ۳): فهرست‌های ثابت. بدون `@/`، چون `db/schema.ts` آن را می‌خواند.
 */
export const RHYTHMEN = ['monatlich', 'quartal', 'jaehrlich'] as const;
export type Rhythmus = (typeof RHYTHMEN)[number];

export const RHYTHMUS_NAMEN: Record<Rhythmus, string> = { monatlich: 'Monatlich', quartal: 'Vierteljährlich', jaehrlich: 'Jährlich' };

/** وضعیت هر اجرا: Privat همان لحظه «gebucht»؛ DDL «offen» تا Inhaber در «Zu prüfen» تأیید یا رد کند */
export const LAUF_STATUS = ['offen', 'gebucht', 'uebersprungen'] as const;
export type LaufStatus = (typeof LAUF_STATUS)[number];
