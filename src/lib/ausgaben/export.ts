import 'server-only';
import { and, gte, isNull, lte } from 'drizzle-orm';
import { db } from '@/db/client';
import { expenses } from '@/db/schema';
import { xlsxErstellen, type Blatt, type Wert } from '@/lib/abrechnung/excel';
import { datumZeit, isoDatumText } from '@/lib/format';
import { lesen } from '@/lib/storage';
import { eindeutigeNamen, type ZipEintrag } from '@/lib/zip';
import { afaPruefen, KATEGORIE_NAMEN } from './text';

/**
 * Ausgaben eines Zeitraums für die Steuerberatung: ein ZIP mit der Excel-Liste und allen Belegen, damit nichts
 * ausgedruckt werden muss. Zeitraum nach »Bezahlt am« (Einnahmen-Ausgaben-Rechnung: Abflussprinzip). Jeder Beleg
 * heißt im ZIP »Datum_Lieferant_Nummer«, und genau dieser Name steht in der Excel-Zeile.
 */
const sauber = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);

export async function ausgabenExport(z: { von: string; bis: string }, erstelltVon: string, jetzt = new Date()) {
  const zeilen = (
    await db()
      .select()
      .from(expenses)
      .where(and(isNull(expenses.geloeschtAm), gte(expenses.bezahltAm, z.von), lte(expenses.bezahltAm, z.bis)))
  ).sort((a, b) => a.bezahltAm.localeCompare(b.bezahltAm) || a.rechnungsdatum.localeCompare(b.rechnungsdatum) || a.lieferant.localeCompare(b.lieferant, 'de-AT'));

  const mitBeleg = zeilen.filter((a) => a.belegKey);
  const belegNamen = eindeutigeNamen(
    mitBeleg.map((a) => {
      const endung = (a.belegName ?? '').split('.').pop()?.toLowerCase() || 'pdf';
      return `Belege/${[a.bezahltAm, sauber(a.lieferant), a.rechnungsnummer ? sauber(a.rechnungsnummer) : null].filter(Boolean).join('_')}.${endung}`;
    }),
  );
  const nameVon = new Map(mitBeleg.map((a, i) => [a.id, belegNamen[i]]));

  const summe = (xs: typeof zeilen, f: 'nettoCent' | 'mwstCent' | 'bruttoCent') => xs.reduce((s, a) => s + a[f], 0);
  const blattAusgaben: Blatt = {
    name: 'Ausgaben',
    filter: true,
    spalten: [
      { titel: 'Bezahlt am', art: 'datum', breite: 12 },
      { titel: 'Rechnungsdatum', art: 'datum', breite: 14 },
      { titel: 'Lieferant', art: 'text', breite: 28 },
      { titel: 'Rechnungsnummer', art: 'text', breite: 18 },
      { titel: 'Kategorie', art: 'text', breite: 20 },
      { titel: 'Beschreibung', art: 'text', breite: 36 },
      { titel: 'Netto (EUR)', art: 'geld', breite: 13 },
      { titel: 'MwSt-Satz', art: 'text', breite: 11 },
      { titel: 'MwSt (EUR)', art: 'geld', breite: 12 },
      { titel: 'Brutto = Ausgabe (EUR)', art: 'geld', breite: 20 },
      { titel: 'Beleg', art: 'text', breite: 44 },
      { titel: 'Hinweis', art: 'text', breite: 24 },
      { titel: 'Erfasst von', art: 'text', breite: 18 },
    ],
    zeilen: zeilen.map((a): Wert[] => [
      a.bezahltAm,
      a.rechnungsdatum,
      a.lieferant,
      a.rechnungsnummer,
      KATEGORIE_NAMEN[a.kategorie],
      a.beschreibung,
      a.nettoCent,
      a.mwstSatz == null ? 'gemischt' : `${a.mwstSatz} %`,
      a.mwstCent,
      a.bruttoCent,
      nameVon.get(a.id) ?? 'fehlt',
      afaPruefen(a) ? 'über € 1.000: AfA prüfen' : null,
      a.erfasstVonLabel,
    ]),
  };

  const kategorien = [...new Set(zeilen.map((a) => a.kategorie))].sort((a, b) => KATEGORIE_NAMEN[a].localeCompare(KATEGORIE_NAMEN[b], 'de-AT'));
  const blattUebersicht: Blatt = {
    name: 'Übersicht',
    spalten: [
      { titel: 'Angabe', art: 'text', breite: 44 },
      { titel: 'Anzahl', art: 'zahl', breite: 10 },
      { titel: 'Netto (EUR)', art: 'geld', breite: 14 },
      { titel: 'MwSt (EUR)', art: 'geld', breite: 14 },
      { titel: 'Brutto = Ausgabe (EUR)', art: 'geld', breite: 20 },
    ],
    zeilen: [
      [`Zeitraum (bezahlt): ${isoDatumText(z.von)} – ${isoDatumText(z.bis)}`, null, null, null, null],
      [`Erstellt ${datumZeit(jetzt)} von ${erstelltVon}`, null, null, null, null],
      ...kategorien.map((k): Wert[] => {
        const xs = zeilen.filter((a) => a.kategorie === k);
        return [KATEGORIE_NAMEN[k], xs.length, summe(xs, 'nettoCent'), summe(xs, 'mwstCent'), summe(xs, 'bruttoCent')];
      }),
      ['Summe', zeilen.length, summe(zeilen, 'nettoCent'), summe(zeilen, 'mwstCent'), summe(zeilen, 'bruttoCent')],
      ['Ohne Beleg', zeilen.length - mitBeleg.length, null, null, null],
      ['Unecht steuerbefreit (§ 6 Abs. 1 Z 20 UStG): kein Vorsteuerabzug, Ausgabe = Bruttobetrag.', null, null, null, null],
    ],
  };

  const excel = await xlsxErstellen([blattUebersicht, blattAusgaben], jetzt);
  const eintraege: ZipEintrag[] = [
    {
      name: `Ausgaben_${z.von}_bis_${z.bis}.xlsx`,
      groesse: excel.length,
      oeffnen: async function* () {
        yield excel;
      },
    },
    ...mitBeleg.map((a) => ({ name: nameVon.get(a.id)!, groesse: a.belegGroesse ?? 0, oeffnen: () => lesen(a.belegKey!) })),
  ];
  return {
    dateiname: `DDL_Ausgaben_${z.von}_bis_${z.bis}.zip`,
    eintraege,
    zahlen: { ausgaben: zeilen.length, belege: mitBeleg.length, bruttoCent: summe(zeilen, 'bruttoCent') },
  };
}
