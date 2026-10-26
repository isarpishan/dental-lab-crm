import { z } from 'zod';

/**
 * تنظیمات از متغیرهای محیطی، یک بار اعتبارسنجی. اگر چیزی کم باشد، برنامه
 * با پیام روشن متوقف می‌شود، نه وسط یک درخواست.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'DATA_ENCRYPTION_KEY muss 32 Byte (base64) sein'),
  APP_SECRET: z.string().min(32),
  CRM_HOST: z.string().min(1),
  PORTAL_HOST: z.string().min(1),
  STORAGE_DIR: z.string().default('./data/files'),
  SMTP_URL: z.string().default('smtp://127.0.0.1:1025'),
  MAIL_FROM: z.string().default('Digital Dental Lab <lab@drpishan.at>'),
  UPLOAD_MAX_MB: z.coerce.number().int().positive().default(300),
});

export type Config = z.infer<typeof schema>;

let geladen: Config | null = null;

export function config(): Config {
  if (!geladen) {
    const r = schema.safeParse(process.env);
    if (!r.success) {
      const felder = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Konfiguration unvollständig (.env): ${felder}`);
    }
    geladen = r.data;
  }
  return geladen;
}

export const istProduktion = process.env.NODE_ENV === 'production';
