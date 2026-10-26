import { DATEI_NAMEN, type DateiPlatz, type FormSchema } from '@/lib/orders/form-schema';

/**
 * «Neue Behandlung» و عکس هر Behandlung در صفحهٔ «Preise» (خواستهٔ کاربر، ۶ اکتبر ۲۰۲۶). اینجا فقط
 * بخش‌های بدون دیتابیس، تا آزمون‌پذیر باشند؛ ذخیره در `verwaltung.ts`.
 */

/** کلید از متن: «Individueller Löffel» ← «individueller_loeffel». */
export function schluesselAus(text: string, max = 50): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/, '');
}

/** کلید تازه برای `work_types`، همیشه با حرف شروع می‌شود و با کلیدهای موجود یکی نیست («modell_2»). */
export function behandlungsSchluessel(name: string, vorhanden: Set<string>): string {
  let basis = schluesselAus(name, 40);
  if (!/^[a-z]/.test(basis)) basis = `b_${basis}`.replace(/_+$/, '');
  let key = basis;
  for (let i = 2; vorhanden.has(key); i++) key = `${basis}_${i}`;
  return key;
}

export const BILD_TYPEN = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type BildTyp = (typeof BILD_TYPEN)[number];

/** نوع عکس از چند بایت اول فایل، نه از نام یا نوعی که مرورگر می‌گوید. */
export function bildTyp(kopf: Uint8Array): BildTyp | null {
  const ab = (i: number, ...b: number[]) => b.every((x, j) => kopf[i + j] === x);
  if (ab(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ab(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (ab(0, 0x52, 0x49, 0x46, 0x46) && ab(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

/** خلاصهٔ فرم یک Behandlung برای انتخاب «Auftragsformular wie»: چه پرسیده می‌شود و کدام Scanها لازم‌اند. */
export function formularUebersicht(formSchema: FormSchema, requiredFiles: string[]): { fragen: string[]; dateien: string[] } {
  const fragen = formSchema.bloecke.map((b) => {
    switch (b.typ) {
      case 'zahnleiste':
        return 'Zähne im Zahnschema';
      case 'kieferbogen':
        return 'Zähne im Kieferbogen';
      case 'zahnfarbe':
        return 'Zahnfarbe';
      case 'implantat':
        return 'Implantat';
      case 'aesthetik':
        return 'Ästhetik';
      default:
        return b.label;
    }
  });
  const dateien = requiredFiles.map((d) => DATEI_NAMEN[d as DateiPlatz] ?? d);
  return { fragen, dateien };
}
