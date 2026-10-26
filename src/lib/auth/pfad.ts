/**
 * فقط آدرس‌های داخلی همین سایت، تا لینک «weiter» (بعد از ورود) به سایت دیگری نبرد.
 * مرورگرها Tab و خط تازه را از آدرس حذف می‌کنند: «/<Tab>/evil.example» ← «//evil.example». پس هر
 * کاراکتر کنترلی، فاصله و «\» رد می‌شود، نه فقط «//» در ابتدا. بدون دیتابیس، تا آزمون‌پذیر بماند.
 */
export function sichererPfad(pfad: string | null | undefined): string {
  if (!pfad || pfad.length > 500) return '/';
  if (!/^\/(?![/\\])/.test(pfad)) return '/';
  if (/[\s\\\u0000-\u001f\u007f]/.test(pfad)) return '/';
  return pfad;
}
