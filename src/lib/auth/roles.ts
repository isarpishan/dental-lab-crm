import type { PraxisRolle, StaffRolle } from '@/db/schema';

/**
 * تنها جایی که تصمیم می‌گیرد چه کسی چه کاری می‌تواند بکند (Spec فاز ۱، بخش B).
 * هر صفحه و هر server action از `darf` استفاده می‌کند، نه از مقایسهٔ مستقیم نقش.
 */
export const AKTIONEN = [
  'benutzer.verwalten',
  'einstellungen.verwalten',
  'stammdaten.sehen',
  'stammdaten.bearbeiten',
  /** قیمت‌ها، Expresszuschlag و روشن/خاموش‌بودن Behandlungها: فقط Inhaber (تصمیم کاربر). */
  'preise.bearbeiten',
  'auftraege.sehen',
  /** سفارش تلفنی برای یک Ordination (همان فرم پورتال، با دیدن نام بیماران آن Ordination). */
  'auftraege.anlegen',
  'auftraege.bearbeiten',
  /** einen irrtümlich angelegten Auftrag ganz löschen, solange daran nichts gearbeitet wurde: nur Inhaber (Entscheidung des Nutzers, 26.10.2026) */
  'auftraege.loeschen',
  'produktion.bearbeiten',
  /** «Meine Tour» (راننده فقط تورهای خودش) */
  'touren.sehen',
  /** Touren anlegen, Reihenfolge, Abholungen einplanen, für jede Tour »Zugestellt« */
  'touren.bearbeiten',
  /** Reklamation entscheiden: Neuanfertigung, Reparatur oder Ablehnung (Kosten, Kulanz) */
  'reklamationen.entscheiden',
  'patientenname.sehen',
  /** Konto هر Ordination، پوزیشن‌های فاکتور، و بعداً Rechnung و پرداخت (Spec فاز ۲) */
  'abrechnung.sehen',
  'abrechnung.bearbeiten',
  /** «Ausgaben» (Einnahmen-Ausgaben-Rechnung): Rechnungen der Lieferanten mit Beleg. Nur Inhaber (Entscheidung des Nutzers). */
  'ausgaben.verwalten',
  /** «Privat» (Spec فاز ۵، قدم ۲): پول شخصی Inhaber. فقط Inhaber؛ هیچ نقش دیگری. */
  'privat.verwalten',
] as const;
export type Aktion = (typeof AKTIONEN)[number];

const ALLES = [...AKTIONEN];

const RECHTE: Record<StaffRolle, readonly Aktion[]> = {
  inhaber: ALLES,
  buero: [
    'stammdaten.sehen',
    'stammdaten.bearbeiten',
    'auftraege.sehen',
    'auftraege.anlegen',
    'auftraege.bearbeiten',
    'touren.sehen',
    'touren.bearbeiten',
    'reklamationen.entscheiden',
    'patientenname.sehen',
    'abrechnung.sehen',
    'abrechnung.bearbeiten',
  ],
  techniker: ['stammdaten.sehen', 'auftraege.sehen', 'auftraege.bearbeiten', 'produktion.bearbeiten'],
  fahrer: ['touren.sehen'],
  vertrieb: ['stammdaten.sehen', 'auftraege.sehen'],
  nur_lesen: ['stammdaten.sehen', 'auftraege.sehen'],
};

export function darf(rolle: StaffRolle, aktion: Aktion): boolean {
  return RECHTE[rolle].includes(aktion);
}

export const ROLLEN_NAMEN: Record<StaffRolle, string> = {
  inhaber: 'Inhaber',
  buero: 'Büro',
  techniker: 'Techniker',
  fahrer: 'Fahrer',
  vertrieb: 'Vertrieb',
  nur_lesen: 'Nur lesen',
};

export const PRAXIS_ROLLEN_NAMEN: Record<PraxisRolle, string> = {
  praxis_admin: 'Praxis-Admin',
  mitarbeiter: 'Mitarbeiter',
};
