/**
 * چیدمان «Einstellungen» که کاربر پسندید (۴ اکتبر ۲۰۲۶): ورودی‌ها چپ، Vorschau راست و چسبیده هنگام اسکرول؛
 * زیر xl، Vorschau زیر بخش‌ها. فایل جدا (نه در `PdfVorschau.tsx`)، چون صفحه‌های سرور هم این‌ها را می‌خوانند و
 * مقدارهای یک ماژول «use client» در سرور فقط ارجاع‌اند، نه متن.
 */
export const NEBEN_RASTER = 'xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,600px)] xl:gap-x-14';
export const NEBEN_VORSCHAU = 'border-t border-line py-14 xl:sticky xl:top-[100px] xl:self-start [&>figure]:max-w-[700px]';
