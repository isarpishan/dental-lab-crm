/** عنوان هر سند فاکتور، همان‌طور که روی PDF چاپ شد؛ و نام فایل PDF برای دانلود و پیوست ایمیل. */
export type BelegTitel = 'Rechnung' | 'Stornorechnung' | 'Gutschrift';

export const belegTitel = (r: { art: 'rechnung' | 'gutschrift'; storno: boolean }): BelegTitel => (r.art === 'rechnung' ? 'Rechnung' : r.storno ? 'Stornorechnung' : 'Gutschrift');

export const belegDateiname = (r: { art: 'rechnung' | 'gutschrift'; storno: boolean; nummer: string }) => `${belegTitel(r)}_${r.nummer}.pdf`;
