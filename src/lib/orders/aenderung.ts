import { z } from 'zod';
import { istZahn } from './fdi';

/**
 * «Änderung anfordern» (Spec فاز ۱، بخش G؛ قانون تأییدشدهٔ DDL برای تغییرها): دندان‌ها،
 * نوع تغییر و توضیح اجباری. خروجی یک متن خوانا برای تب «Kommunikation»، مثل
 * «Zahn 12: länger · an 11 angleichen».
 */

export const AENDERUNGS_ARTEN = [
  'länger',
  'kürzer',
  'breiter',
  'schmaler',
  'Form',
  'Symmetrie',
  'Mittellinie',
  'Inzisalkante',
  'Kontaktpunkte',
  'Okklusion',
  'Emergenz',
  'Sonstiges',
] as const;

export const aenderungSchema = z.object({
  zaehne: z.array(z.number().int().refine(istZahn, 'Ungültige Zahnnummer')).max(32),
  arten: z.array(z.enum(AENDERUNGS_ARTEN)).max(AENDERUNGS_ARTEN.length),
  text: z.string().trim().min(3, 'Bitte beschreiben Sie kurz, was geändert werden soll.').max(5000, 'Der Text ist zu lang.'),
  dateiIds: z.array(z.uuid()).max(20).default([]),
});
export type AenderungEingabe = z.infer<typeof aenderungSchema>;

export function aenderungText(a: Pick<AenderungEingabe, 'zaehne' | 'arten' | 'text'>): string {
  const zaehne = [...new Set(a.zaehne)].sort((x, y) => x - y);
  const kopf = [zaehne.length ? `Zahn ${zaehne.join(', ')}` : null, a.arten.length ? a.arten.join(', ') : null].filter(Boolean).join(': ');
  return kopf ? `${kopf} · ${a.text.trim()}` : a.text.trim();
}
