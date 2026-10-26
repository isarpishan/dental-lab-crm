/**
 * «Privat» (Spec فاز ۵، قدم ۲): پول شخصی Inhaber، کاملاً جدا از دفتر DDL. بدون `server-only`، چون فرم مرورگر هم
 * همین فهرست‌ها و بررسی‌ها را می‌خواهد. Kategorienها از سند «دستیار مالی»، به آلمانی اتریش.
 */

export const PRIVAT_ARTEN = ['ausgabe', 'einnahme'] as const;
export type PrivatArt = (typeof PRIVAT_ARTEN)[number];

export const PRIVAT_AUSGABE_KATEGORIEN = [
  'lebensmittel',
  'restaurant',
  'wohnen',
  'haushalt',
  'energie',
  'oeffis',
  'auto',
  'gesundheit',
  'kleidung',
  'freizeit',
  'abos',
  'bildung',
  'geschenke',
  'versicherungen',
  'kredit',
  'verliehen',
  'sonstiges',
] as const;
export const PRIVAT_EINNAHME_KATEGORIEN = ['gehalt', 'entnahme', 'rueckzahlung', 'sonstige_einnahme'] as const;
export const PRIVAT_KATEGORIEN = [...PRIVAT_AUSGABE_KATEGORIEN, ...PRIVAT_EINNAHME_KATEGORIEN] as const;
export type PrivatAusgabeKategorie = (typeof PRIVAT_AUSGABE_KATEGORIEN)[number];
export type PrivatKategorie = (typeof PRIVAT_KATEGORIEN)[number];

export const PRIVAT_KATEGORIE_NAMEN: Record<PrivatKategorie, string> = {
  lebensmittel: 'Lebensmittel & Supermarkt',
  restaurant: 'Restaurant & Café',
  wohnen: 'Wohnen & Miete',
  haushalt: 'Haushalt & Einrichtung',
  energie: 'Energie & Internet',
  oeffis: 'Öffis',
  auto: 'Auto & Tanken',
  gesundheit: 'Gesundheit',
  kleidung: 'Kleidung',
  freizeit: 'Freizeit',
  abos: 'Abos',
  bildung: 'Bildung',
  geschenke: 'Geschenke',
  versicherungen: 'Versicherungen',
  kredit: 'Kredit',
  verliehen: 'Geld verliehen',
  sonstiges: 'Sonstiges',
  gehalt: 'Gehalt',
  entnahme: 'Entnahme aus DDL',
  rueckzahlung: 'Rückzahlung (verliehenes Geld)',
  sonstige_einnahme: 'Sonstige Einnahme',
};

/**
 * Geld verleihen und zurückbekommen ist weder Ausgabe noch Einnahme: steht in der Liste, zählt aber nicht in
 * Einnahmen, Ausgaben, »Gespart« und Sparquote (Wunsch des Inhabers, 26. Oktober 2026).
 */
export const PRIVAT_OHNE_ERGEBNIS: readonly PrivatKategorie[] = ['verliehen', 'rueckzahlung'];
export const zaehltImErgebnis = (k: string) => !(PRIVAT_OHNE_ERGEBNIS as readonly string[]).includes(k);

export const kategorienFuer = (art: PrivatArt): readonly PrivatKategorie[] => (art === 'einnahme' ? PRIVAT_EINNAHME_KATEGORIEN : PRIVAT_AUSGABE_KATEGORIEN);
export const passtZurArt = (art: PrivatArt, k: string): k is PrivatKategorie => (kategorienFuer(art) as readonly string[]).includes(k);

export const PRIVAT_QUELLEN = ['hand', 'beleg', 'vorlage', 'bank'] as const;
