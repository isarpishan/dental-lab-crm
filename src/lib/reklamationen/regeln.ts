import { z } from 'zod';
import { ENTSCHEIDUNGEN, REKLAMATIONS_GRUENDE, type Entscheidung, type ReklamationsGrund } from '@/db/schema';

/**
 * قاعده‌های خالص Reklamation (Spec فاز ۱، بخش J)، بدون دیتابیس و قابل‌تست: نام‌ها، Gewährleistung،
 * این‌که کدام سفارش reklamierbar است، و شکل ورودی‌ها.
 */

export const GRUND_NAMEN: Record<ReklamationsGrund, string> = {
  passung: 'Passung',
  bruch: 'Bruch',
  farbe: 'Farbe',
  form: 'Form',
  sonstiges: 'Sonstiges',
};

export const ENTSCHEIDUNG_NAMEN: Record<Entscheidung, string> = {
  offen: 'In Prüfung',
  neuanfertigung: 'Neuanfertigung',
  reparatur: 'Reparatur',
  abgelehnt: 'Abgelehnt',
};

/** فقط «Fertige Arbeit» که تحویل شده (Nur Design «Überarbeitung anfordern» دارد). */
export function reklamierbar(status: string, lieferart: string | null): boolean {
  return lieferart === 'fertigung' && (status === 'geliefert' || status === 'abgeschlossen');
}

/**
 * «28.02.» + ۱۲ ماه: Gewährleistung تا همان روز ماهِ `monate` بعد؛ اگر آن ماه کوتاه‌تر است، آخرین روزش
 * (۳۱.۰۸.۲۰۲۶ + ۶ ← ۲۸.۰۲.۲۰۲۷). `geliefert` و `heute` تاریخ ISO به وقت وین‌اند.
 */
export function gewaehrleistung(geliefert: string | null, monate: number, heute: string): { bis: string | null; gueltig: boolean } {
  // ohne Lieferdatum (Altfall) zugunsten der Ordination
  if (!geliefert) return { bis: null, gueltig: true };
  const [j, m, t] = geliefert.split('-').map(Number);
  const zielMonat = m - 1 + monate;
  const jahr = j + Math.floor(zielMonat / 12);
  const monat = ((zielMonat % 12) + 12) % 12;
  const letzter = new Date(Date.UTC(jahr, monat + 1, 0)).getUTCDate();
  const bis = `${jahr}-${String(monat + 1).padStart(2, '0')}-${String(Math.min(t, letzter)).padStart(2, '0')}`;
  return { bis, gueltig: heute <= bis };
}

export const meldungSchema = z.object({
  grund: z.enum(REKLAMATIONS_GRUENDE, { error: 'Bitte einen Grund wählen.' }),
  zaehne: z.array(z.number().int().min(11).max(48)).max(32).default([]),
  text: z.string().trim().min(5, 'Bitte beschreiben Sie das Problem kurz.').max(5000, 'Der Text ist zu lang.'),
  dateiIds: z.array(z.uuid()).max(20).default([]),
});
export type Meldung = z.infer<typeof meldungSchema>;

export const entscheidungSchema = z
  .object({
    entscheidung: z.enum(ENTSCHEIDUNGEN.filter((e) => e !== 'offen') as ['neuanfertigung', 'reparatur', 'abgelehnt'], { error: 'Bitte eine Entscheidung wählen.' }),
    notiz: z.string().trim().max(3000, 'Der Text ist zu lang.'),
    kostenlos: z.boolean().default(false),
  })
  .refine((e) => e.entscheidung !== 'abgelehnt' || e.notiz.length >= 5, { message: 'Bitte begründen Sie die Ablehnung für die Ordination.', path: ['notiz'] });
export type EntscheidungsEingabe = z.infer<typeof entscheidungSchema>;

/** متن پیام «Reklamation» در Kommunikation (نخستین خط: شماره و دلیل). */
export function meldungText(nr: string, m: Pick<Meldung, 'grund' | 'zaehne' | 'text'>): string {
  const kopf = [`Reklamation ${nr}`, GRUND_NAMEN[m.grund], m.zaehne.length ? `Zahn ${[...m.zaehne].sort((a, b) => a - b).join(', ')}` : null].filter(Boolean).join(' · ');
  return `${kopf}\n${m.text}`;
}

export function entscheidungText(nr: string, e: EntscheidungsEingabe, neuerAuftrag: string | null): string {
  const kopf =
    e.entscheidung === 'neuanfertigung'
      ? `Reklamation ${nr}: Wir fertigen die Arbeit neu an${neuerAuftrag ? ` (Auftrag ${neuerAuftrag}${e.kostenlos ? ', ohne Berechnung' : ''})` : ''}.`
      : e.entscheidung === 'reparatur'
        ? `Reklamation ${nr}: Wir reparieren die Arbeit.`
        : `Reklamation ${nr}: Abgelehnt.`;
  if (!e.notiz) return kopf;
  return `${kopf}\n${e.entscheidung === 'abgelehnt' ? `Begründung: ${e.notiz}` : e.notiz}`;
}
