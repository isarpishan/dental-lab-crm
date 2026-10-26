import path from 'node:path';
import { config } from '@/lib/config';

/**
 * مسیر یک فایل در `STORAGE_DIR` از روی کلیدش. بدون `server-only`، چون worker (بیرون از Next) پیوست
 * ایمیل‌ها (PDF فاکتورها) را هم از همین‌جا می‌خواند. کلید فقط همان شکل ثابت را دارد؛ هیچ مسیر دلخواهی
 * پذیرفته نمی‌شود.
 */
const SCHLUESSEL = /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function speicherPfad(key: string): string {
  if (!SCHLUESSEL.test(key)) throw new Error('Ungültiger Speicherschlüssel');
  return path.join(path.resolve(config().STORAGE_DIR), key);
}
