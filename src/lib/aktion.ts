import { AppError } from '@/lib/errors';

/**
 * کمک‌های مشترک server actionها (الگوی ثابت: نشست و نقش ← zod ← عملیات ←
 * logAudit ← revalidate). اینجا فایل `'use server'` نیست، چون چیزهای غیرتابعی هم دارد.
 */
/** `id`: was angelegt wurde, wenn der Browser danach weiterarbeitet (z. B. den Beleg einer Ausgabe hochlädt) */
export type Ergebnis = { fehler?: string; erfolg?: string; link?: string; id?: string } | null;

/** AppError پیام آلمانی برای کاربر است؛ هر خطای دیگر (و redirect) بالا می‌رود. */
export async function ausfuehren(f: () => Promise<Ergebnis>): Promise<Ergebnis> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof AppError) return { fehler: e.message };
    throw e;
  }
}

export const akteurVon = (u: { id: string; name: string }) => ({ kind: 'staff' as const, id: u.id, label: u.name });

/** JSON با کلیدهای مرتب: Postgres ترتیب کلیدهای jsonb را عوض می‌کند. */
function stabil(wert: unknown): string {
  if (Array.isArray(wert)) return `[${wert.map(stabil).join(',')}]`;
  if (wert && typeof wert === 'object' && !(wert instanceof Date)) {
    return `{${Object.keys(wert)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabil((wert as Record<string, unknown>)[k] ?? null)}`)
      .join(',')}}`;
  }
  return JSON.stringify(wert ?? null);
}

/** فرق قبل و بعد برای audit: فقط فیلدهایی که واقعاً عوض شده‌اند. */
export function aenderungen<T extends Record<string, unknown>>(vorher: T, nachher: Partial<T>): Record<string, { von: unknown; zu: unknown }> {
  const diff: Record<string, { von: unknown; zu: unknown }> = {};
  for (const [k, zu] of Object.entries(nachher)) {
    const von = vorher[k];
    if (stabil(von) !== stabil(zu)) diff[k] = { von: von ?? null, zu: zu ?? null };
  }
  return diff;
}
