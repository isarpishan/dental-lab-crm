import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { centLesen } from '@/lib/abrechnung/geld';
import { AppError } from '@/lib/errors';
import { ddlUebersicht } from '@/lib/finanzen/daten';
import { heuteIso } from '@/lib/format';
import { steuerVorschau, type SteuerEingaben, type SteuerVorschau } from './rechnen';
import { werteFuer, type Jahreswerte } from './werte';

/**
 * «Einstellungen → Steuer» (Spec فاز ۵، قدم ۵؛ فقط Inhaber): ورودی‌های هر سال در `settings` با کلید `steuer`
 * (`{ "2026": {…} }`). عددها از Lohnzettel و نامهٔ SVS؛ چیزی خودکار از جای دیگر نمی‌آید.
 */
const KEY = 'steuer';

type Gespeichert = Record<string, SteuerEingaben>;

async function alle(): Promise<Gespeichert> {
  const [z] = await db().select().from(settings).where(eq(settings.key, KEY)).limit(1);
  return (z?.value as Gespeichert | null) ?? {};
}

/** Eingaben eines Jahres; ohne eigene Eingaben die des Vorjahres als Vorschlag (Gehalt bleibt meist gleich). */
export async function steuerEingaben(jahr: number): Promise<{ eingaben: SteuerEingaben | null; ausVorjahr: boolean }> {
  const a = await alle();
  if (a[jahr]) return { eingaben: a[jahr], ausVorjahr: false };
  const vorher = a[jahr - 1];
  return vorher ? { eingaben: { ...vorher, vorauszahlungenCent: 0, gewinnSchaetzungCent: null }, ausVorjahr: true } : { eingaben: null, ausVorjahr: false };
}

const betrag = (feld: string, roh: string | undefined, pflicht: boolean): number | null => {
  const r = centLesen(roh);
  if (!r.ok) throw new AppError(`${feld}: ${r.fehler}`);
  if (r.wert == null) {
    if (pflicht) throw new AppError(`Bitte »${feld}« angeben.`);
    return null;
  }
  return r.wert;
};

export function steuerPruefen(roh: Record<string, string>): SteuerEingaben {
  const gehaltMonatCent = betrag('Gehalt je Monat (BMG LSt)', roh.gehalt, false) ?? 0;
  const gehaltMonate = Number(roh.monate || '12');
  if (!Number.isInteger(gehaltMonate) || gehaltMonate < 0 || gehaltMonate > 12) throw new AppError('Bitte für die Monate mit Gehalt eine Zahl von 0 bis 12 angeben.');
  const beginn = (roh.beginn ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(beginn) || Number.isNaN(Date.parse(beginn)) || beginn < '2000-01-01') throw new AppError('Bitte den Beginn der Selbständigkeit als Datum angeben.');
  // Gewinn darf negativ sein (Verlust): »-1.000« erlauben
  const schaetzungText = (roh.schaetzung ?? '').trim();
  const negativ = schaetzungText.startsWith('-');
  const schaetzung = betrag('Erwarteter Gewinn', negativ ? schaetzungText.slice(1) : schaetzungText, false);
  return {
    gehaltMonatCent,
    gehaltMonate,
    beginn,
    svsQuartalCent: betrag('SVS je Quartal', roh.svs, false),
    vorauszahlungenCent: betrag('ESt-Vorauszahlungen', roh.vorauszahlungen, false) ?? 0,
    gewinnSchaetzungCent: schaetzung == null ? null : negativ ? -schaetzung : schaetzung,
  };
}

export async function steuerSpeichern(jahr: number, roh: Record<string, string>) {
  const neu = steuerPruefen(roh);
  const a = await alle();
  const vorher = a[jahr] ?? null;
  const wert = { ...a, [jahr]: neu };
  await db()
    .insert(settings)
    .values({ key: KEY, value: wert })
    .onConflictDoUpdate({ target: settings.key, set: { value: wert, updatedAt: new Date() } });
  return { vorher, nachher: neu };
}

export type SteuerSeite = { jahr: number; vorschau: SteuerVorschau | null; eingaben: SteuerEingaben | null; ausVorjahr: boolean; werteGeschaetzt: boolean; werte: Jahreswerte };

/** Vorschau für das laufende Jahr (DDL-Gewinn vom 1. Jänner bis heute aus der Übersicht). */
export async function steuerSeite(heute = heuteIso()): Promise<SteuerSeite> {
  const jahr = Number(heute.slice(0, 4));
  const [{ eingaben, ausVorjahr }, u] = await Promise.all([steuerEingaben(jahr), ddlUebersicht(heute.slice(0, 7))]);
  const { werte, geschaetzt } = werteFuer(jahr);
  return {
    jahr,
    eingaben,
    ausVorjahr,
    werteGeschaetzt: geschaetzt,
    werte,
    vorschau: eingaben ? steuerVorschau(jahr, heute, eingaben, { gewinnBisHeuteCent: u.jahr.einnahmenCent - u.jahr.ausgabenCent }, werte) : null,
  };
}
