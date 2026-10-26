import { randomInt } from 'node:crypto';

/**
 * کد بیمار و جست‌وجوی نام. نام‌ها رمزگذاری شده‌اند، پس جست‌وجو بعد از رمزگشایی و
 * فقط روی بیماران همان Ordination انجام می‌شود (Spec فاز ۱، بخش D.۱).
 */

/** بدون 0/O و 1/I/L، تا تلفنی و دست‌نویس اشتباه خوانده نشود. */
const ZEICHEN = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** «P-7K3Q»: تصادفی، نه پشت‌سرهم (Spec، مدل داده). */
export function patientenCode(zufall: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += ZEICHEN[zufall(ZEICHEN.length)];
  return `P-${code}`;
}

/** حروف کوچک، بدون نشانه‌ها (Müller ← muller، ß ← ss). */
export function normalisieren(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export type PatientName = { vorname: string; nachname: string; code: string };

/** کلمه‌ای که شبیه کد است: با «P-» شروع می‌شود، رقم دارد، یا دقیقاً چهار نویسهٔ کد است. */
function passtZuCode(wort: string, code: string): boolean {
  const ohne = wort.replace(/^p-/, '');
  if (!ohne) return false;
  if (wort.startsWith('p-') || /\d/.test(wort)) return code.includes(ohne);
  return code === `p-${ohne}`;
}

/**
 * هر کلمهٔ جست‌وجو باید ابتدای یکی از نام‌ها باشد، یا به کد بخورد.
 * «mus max» ← Max Mustermann؛ «7k3» ← P-7K3Q.
 */
export function passt(suche: string, p: PatientName): boolean {
  const woerter = normalisieren(suche).split(/\s+/).filter(Boolean);
  if (!woerter.length) return true;
  const namen = normalisieren(`${p.vorname} ${p.nachname}`).split(/[\s-]+/);
  const code = normalisieren(p.code);
  return woerter.every((w) => namen.some((n) => n.startsWith(w)) || passtZuCode(w, code));
}

/** برای پیدا کردن بیمار تکراری موقع ساختن. */
export function gleicherName(a: { vorname: string; nachname: string }, b: { vorname: string; nachname: string }): boolean {
  return normalisieren(a.vorname) === normalisieren(b.vorname) && normalisieren(a.nachname) === normalisieren(b.nachname);
}
