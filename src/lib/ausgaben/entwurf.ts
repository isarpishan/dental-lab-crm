import type { BelegVorschlag } from '@/lib/ai-safe';
import type { PrivatAusgabeKategorie } from '@/lib/privat/text';
import { ausBrutto, istMwstSatz, mwstPasst, type AusgabeKategorie } from './text';

/**
 * Vorschlag der KI → Startwerte des Formulars «Zu prüfen» (Browser und Server, ohne `server-only`). Beträge werden
 * in sich stimmig gemacht, damit das Speichern nicht an einer Rundung scheitert; was dabei geschätzt wurde, kommt zu
 * den unsicheren Feldern und wird im Formular markiert.
 */
export type Entwurf = {
  rechnungsdatum?: string;
  lieferant?: string;
  rechnungsnummer?: string;
  kategorie?: AusgabeKategorie;
  beschreibung?: string;
  nettoCent?: number;
  mwstCent?: number;
  bruttoCent?: number;
  /** null = »Anderer Betrag« */
  mwstSatz?: number | null;
  /** Vorschlag der KI (Spec فاز ۵، قدم ۲); ältere Vorschläge ohne Bereich = DDL */
  bereich?: 'ddl' | 'privat';
  privatKategorie?: PrivatAusgabeKategorie;
  unsicher: string[];
  hinweise: string[];
};

const cent = (n: number | null) => (n == null || !Number.isFinite(n) ? undefined : Math.round(n * 100));
const zahl = (n: number) => n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Beschreibung höchstens 300 Zeichen; der Originalbetrag einer fremden Währung bleibt dabei immer ganz erhalten. */
function beschreibungMit(text: string | null, original: string | undefined) {
  const zusatz = original ? `(Original: ${original})` : '';
  const t = (text ?? '').trim().slice(0, 300 - (zusatz ? zusatz.length + 1 : 0)).trim();
  return [t, zusatz].filter(Boolean).join(' ') || undefined;
}

export function entwurfAus(v: BelegVorschlag, heute: string): Entwurf {
  const unsicher = new Set<string>(v.unsicher);
  const hinweise: string[] = [];
  let netto = cent(v.netto);
  let mwst = cent(v.mwst);
  let brutto = cent(v.brutto);
  let satz: number | null | undefined = v.mwstSatz === 'gemischt' ? null : v.mwstSatz ? Number(v.mwstSatz) : undefined;

  if (brutto == null && netto != null && mwst != null) brutto = netto + mwst;
  if (netto == null && brutto != null && satz != null && istMwstSatz(satz)) ({ nettoCent: netto, mwstCent: mwst } = ausBrutto(brutto, satz));
  if (netto != null && brutto != null && (mwst == null || netto + mwst !== brutto)) {
    mwst = brutto - netto;
    unsicher.add('mwst');
  }
  if (netto != null && mwst != null && satz != null && istMwstSatz(satz) && !mwstPasst(netto, mwst, satz)) {
    satz = null;
    unsicher.add('mwstSatz');
  }
  if (netto != null && netto <= 0) netto = undefined;
  if (mwst != null && mwst < 0) mwst = undefined;

  // fremde Währung (z. B. Anthropic in USD): Beträge bleiben leer, damit nie ein Dollarbetrag als Euro gespeichert
  // wird (Wunsch des Nutzers). Der Euro-Betrag kommt vom Kontoauszug; der Originalbetrag steht unter »Wofür?«.
  const waehrung = v.waehrung?.trim().toUpperCase();
  let original: string | undefined;
  if (waehrung && waehrung !== 'EUR') {
    const b = v.brutto ?? (v.netto != null && v.mwst != null ? v.netto + v.mwst : v.netto);
    original = b != null && Number.isFinite(b) ? `${waehrung} ${zahl(b)}` : waehrung;
    hinweise.push(`Rechnung in ${waehrung}${b != null ? ` (${zahl(b)} ${waehrung})` : ''}: bitte den Euro-Betrag laut Kontoauszug oder Kreditkartenabrechnung eintragen.`);
    ['netto', 'brutto'].forEach((f) => unsicher.add(f));
    unsicher.delete('mwst');
    netto = mwst = brutto = undefined;
  }
  if (v.hinweis) hinweise.push(v.hinweis);

  const datum = v.rechnungsdatum && /^\d{4}-\d{2}-\d{2}$/.test(v.rechnungsdatum) && !Number.isNaN(Date.parse(v.rechnungsdatum)) ? v.rechnungsdatum : undefined;
  if (!datum) unsicher.add('rechnungsdatum');
  else if (datum > heute) {
    hinweise.push('Das gelesene Datum liegt in der Zukunft. Bitte prüfen.');
    unsicher.add('rechnungsdatum');
  }

  return {
    rechnungsdatum: datum && datum <= heute ? datum : undefined,
    lieferant: v.lieferant?.trim().slice(0, 120) || undefined,
    rechnungsnummer: v.rechnungsnummer?.trim().slice(0, 60) || undefined,
    kategorie: v.kategorie ?? undefined,
    beschreibung: beschreibungMit(v.beschreibung, original),
    nettoCent: netto,
    mwstCent: mwst,
    bruttoCent: brutto,
    mwstSatz: satz,
    // `??`: ältere, schon gespeicherte Vorschläge haben diese Felder nicht
    bereich: v.bereich ?? 'ddl',
    privatKategorie: v.privatKategorie ?? undefined,
    unsicher: [...unsicher],
    hinweise,
  };
}
