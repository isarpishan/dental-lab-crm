import { z } from 'zod';

/**
 * ساختار `work_types.form_schema`: هر Behandlung می‌گوید فرمش از کدام قطعه‌ها
 * ساخته شده است (Spec فاز ۱، بخش D). با همین ساختار می‌شود Behandlung تازه
 * اضافه کرد، بدون برنامه‌نویسی دوباره.
 *
 * اینجا فقط «شکل تعریف» است. zod schema جواب هر قطعه (config سفارش) در
 * `pruefung.ts` (`antwortSchema`) ساخته می‌شود، کنار بقیهٔ بررسی‌های ارسال.
 */

export const ZAHNLEISTEN_WERKZEUGE = ['krone', 'bruecke', 'implantatkrone', 'veneer', 'inlay', 'provisorium'] as const;
export const DATEI_PLAETZE = ['ok', 'uk', 'biss', 'scanbody', 'gegenkiefer', 'fotos'] as const;
export type DateiPlatz = (typeof DATEI_PLAETZE)[number];
export const DATEI_NAMEN: Record<DateiPlatz, string> = {
  ok: 'Oberkiefer-Scan',
  uk: 'Unterkiefer-Scan',
  biss: 'Bissregistrierung',
  scanbody: 'Scan mit Scanbody',
  gegenkiefer: 'Gegenkiefer-Scan',
  fotos: 'Fotos',
};

const basis = {
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  pflicht: z.boolean().default(false),
  /** فقط وقتی فک بالا یا پایین درگیر است (مثلاً Gaumenabdeckung فقط OK). */
  nurWenn: z.object({ kiefer: z.enum(['OK', 'UK']) }).optional(),
};

const option = z.object({ wert: z.string(), label: z.string() });

export const blockSchema = z.discriminatedUnion('typ', [
  z.object({ typ: z.literal('zahnleiste'), ...basis, werkzeuge: z.array(z.enum(ZAHNLEISTEN_WERKZEUGE)).min(1) }),
  z.object({ typ: z.literal('kieferbogen'), ...basis }),
  z.object({
    typ: z.literal('bildauswahl'),
    ...basis,
    label: z.string(),
    optionen: z.array(option.extend({ bild: z.string() })).min(2),
  }),
  z.object({ typ: z.literal('implantat'), ...basis }),
  z.object({ typ: z.literal('aesthetik'), ...basis }),
  z.object({ typ: z.literal('zahnfarbe'), ...basis, farbanpassung: z.boolean().default(true) }),
  z.object({ typ: z.literal('kiefer'), ...basis, label: z.string() }),
  z.object({ typ: z.literal('auswahl'), ...basis, label: z.string(), optionen: z.array(option).min(2) }),
  z.object({ typ: z.literal('text'), ...basis, label: z.string() }),
  z.object({ typ: z.literal('schalter'), ...basis, label: z.string() }),
]);

export const formSchemaSchema = z
  .object({ bloecke: z.array(blockSchema).min(1) })
  .refine((f) => new Set(f.bloecke.map((b) => b.id)).size === f.bloecke.length, 'Block-IDs müssen eindeutig sein');

export type Block = z.infer<typeof blockSchema>;
export type FormSchema = z.infer<typeof formSchemaSchema>;
