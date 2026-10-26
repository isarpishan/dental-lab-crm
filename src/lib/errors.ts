/**
 * خطایی که کاربر باید درستش کند، یا تکرارش فایده ندارد: ورودی غلط، کلید
 * نبودن، لینک منقضی. worker این را دوباره امتحان نمی‌کند (الگوی Content Studio).
 * پیامش آلمانی است، چون مستقیم به کاربر نشان داده می‌شود.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppError';
  }
}

/** Unique-Verletzung in Postgres (23505). Drizzle packt den Fehler des Treibers in `cause`. */
export function istDoppelt(e: unknown): boolean {
  const code = (x: unknown) => (x && typeof x === 'object' && 'code' in x ? (x as { code?: unknown }).code : undefined);
  return code(e) === '23505' || code((e as { cause?: unknown } | null)?.cause) === '23505';
}
