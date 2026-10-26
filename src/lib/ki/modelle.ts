/**
 * Modelle für das Lesen der Belege (Claude). Standard ist das aktuelle Opus; Sonnet und Haiku sind günstiger.
 * Preise je 1 Million Tokens in US-Dollar laut Anthropic (Stand Oktober 2026), nur für die ungefähre Kostenanzeige
 * in «Einstellungen → KI»; maßgeblich ist die Abrechnung von Anthropic.
 */
export const KI_MODELLE = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', text: 'Am genauesten, auch bei schlechten Fotos. Standard.', eingabeUsd: 4, ausgabeUsd: 20 },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', text: 'Fast so genau, etwa halb so teuer.', eingabeUsd: 2, ausgabeUsd: 10 },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', text: 'Am günstigsten, für klare PDF-Rechnungen meist ausreichend.', eingabeUsd: 0.1, ausgabeUsd: 0.5 },
] as const;

export type KiModell = (typeof KI_MODELLE)[number]['id'];
export const KI_STANDARD: KiModell = 'claude-opus-5-5';

export const istKiModell = (s: unknown): s is KiModell => KI_MODELLE.some((m) => m.id === s);

/** Ungefähre Kosten in US-Dollar; unbekanntes Modell → undefined (nicht 0). */
export function kostenUsd(modell: string, eingabe: number, ausgabe: number): number | undefined {
  const m = KI_MODELLE.find((x) => x.id === modell);
  return m ? (eingabe * m.eingabeUsd + ausgabe * m.ausgabeUsd) / 1_000_000 : undefined;
}
