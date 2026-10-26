import { z } from 'zod';

/**
 * صادرکنندهٔ اسناد، بدون دیتابیس (تا آزمون‌پذیر باشد؛ بارگذاری در `aussteller.ts`). روی اسناد و در
 * Vereinbarung، `ort` همیشه کد پستی را هم دارد («1200 Wien»).
 */
export type Aussteller = {
  name: string;
  zusatz: string;
  strasse: string;
  ort: string;
  land: string;
  telefon: string;
  email: string;
  web: string;
};

export const AUSSTELLER_STANDARD: Aussteller = {
  name: 'Isar Pishan · Digital Dental Lab',
  zusatz: 'Digital Dental Lab – Digitale Zahntechnik',
  strasse: 'Adalbert-Stifter-Straße 35/6/1',
  ort: '1200 Wien',
  land: 'Österreich',
  telefon: '+43 1 332 71 46',
  email: 'lab@drpishan.at',
  web: 'ddl-pishan.at',
};

const gespeichert = z
  .object({ name: z.string(), zusatz: z.string(), strasse: z.string(), plz: z.string(), ort: z.string(), land: z.string(), telefon: z.string(), email: z.string(), web: z.string() })
  .partial();

/**
 * از مقدار ذخیره‌شدهٔ `settings.aussteller`. Stammdaten (`lib/katalog/stammdaten.ts`) کد پستی را جدا در
 * `plz` نگه می‌دارد؛ این‌جا به `ort` چسبانده می‌شود (پیش‌تر نادیده می‌ماند و اسناد فقط «Wien» داشتند).
 * فیلدهای خالی یا نامعتبر مقدار Impressum را می‌گیرند.
 */
export function ausstellerAus(wert: unknown): Aussteller {
  const r = gespeichert.safeParse(wert ?? {});
  const d = r.success ? r.data : {};
  const gesetzt = Object.fromEntries(
    Object.entries(d)
      .filter(([k, v]) => k !== 'plz' && typeof v === 'string' && v.trim() !== '')
      .map(([k, v]) => [k, (v as string).trim()]),
  ) as Partial<Aussteller>;
  const a: Aussteller = { ...AUSSTELLER_STANDARD, ...gesetzt };
  const plz = d.plz?.trim();
  if (plz && gesetzt.ort && !/^\d/.test(gesetzt.ort)) a.ort = `${plz} ${gesetzt.ort}`;
  return a;
}
