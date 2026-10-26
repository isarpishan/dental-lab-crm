import 'server-only';
import { db } from '@/db/client';
import { dunningLetters, invoices, payments } from '@/db/schema';
import { datumZeit, heuteIso, isoDatumText } from '@/lib/format';
import { belegTitel } from './beleg';
import { xlsxErstellen, type Blatt, type Wert } from './excel';
import { MAHNSTUFE_NAMEN, type Mahnstufe } from './mahnwesen';
import { ZAHLUNGSART_NAMEN, zahlstand, type Zahlstatus } from './offen';
import { rechnungsdatenLaden, type AusstellerStand, type Empfaenger } from './rechnung';

/**
 * خروجی Excel برای Steuerberater (Spec فاز ۲، قدم ۵؛ جواب Steuerberater: Excel، که BMD هم می‌خواند).
 * چهار برگه: «Übersicht»، «Rechnungen» (همهٔ Rechnungها و Gutschriftهای دوره، طبق تاریخ صدور)،
 * «Zahlungen» (پرداخت‌های دوره) و «Offene Posten» (مانده‌ها در روز Stichtag). Stichtag = پایان دوره،
 * یا امروز اگر دوره هنوز تمام نشده؛ وضعیت پرداخت همیشه در همان روز حساب می‌شود، تا خروجی یک ماه بسته
 * بعداً عوض نشود. گیرنده و متن معافیت همان‌طور که روی هر فاکتور چاپ شد. بدون Patienten-ID و ردیف‌ها.
 */
const STATUS: Record<Zahlstatus, string> = {
  offen: 'offen',
  teilweise: 'teilweise bezahlt',
  bezahlt: 'bezahlt',
  ausgeglichen: 'ausgeglichen (Gutschrift)',
  guthaben: 'Guthaben',
  storniert: 'storniert',
};

const tageZwischen = (von: string, bis: string) => Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);
const summe = (xs: { summeCent: number }[]) => xs.reduce((s, x) => s + x.summeCent, 0);

export async function buchhaltungsExport(z: { von: string; bis: string }, erstelltVon: string, jetzt = new Date()) {
  const heute = heuteIso(jetzt);
  const stichtag = z.bis < heute ? z.bis : heute;
  // داده‌ها کم‌اند (چند صد سند در سال): همه خوانده و اینجا فیلتر می‌شوند
  const [alle, zahlungen, briefe, { aussteller, daten }] = await Promise.all([
    db().select().from(invoices),
    db().select().from(payments),
    db().select({ invoiceId: dunningLetters.invoiceId, stufe: dunningLetters.stufe, am: dunningLetters.erstelltAm }).from(dunningLetters),
    rechnungsdatenLaden(),
  ]);
  /** آخرین Mahnung هر Rechnung تا Stichtag */
  const letzteMahnung = (id: string) =>
    briefe
      .filter((m) => m.invoiceId === id && heuteIso(m.am) <= stichtag)
      .sort((a, b) => b.stufe - a.stufe)
      .map((m) => `${MAHNSTUFE_NAMEN[m.stufe as Mahnstufe]} vom ${isoDatumText(heuteIso(m.am))}`)[0] ?? null;
  const belege = alle
    .map((r) => ({ ...r, tag: heuteIso(r.ausgestelltAm), empf: r.empfaenger as Empfaenger, aus: r.aussteller as AusstellerStand }))
    .sort((a, b) => a.tag.localeCompare(b.tag) || a.nummer.localeCompare(b.nummer));
  const nachId = new Map(belege.map((b) => [b.id, b]));

  // وضعیت هر Rechnung در Stichtag: فقط Gutschriftها و پرداخت‌های تا همان روز
  const stand = new Map(
    belege
      .filter((r) => r.art === 'rechnung' && r.tag <= stichtag)
      .map((r) => {
        const gs = belege.filter((g) => g.bezugId === r.id && g.tag <= stichtag);
        const gezahltCent = zahlungen.filter((p) => p.invoiceId === r.id && p.eingegangenAm <= stichtag).reduce((s, p) => s + p.betragCent, 0);
        const gutschriftenCent = summe(gs);
        return [r.id, { ...zahlstand({ summeCent: r.summeCent, gutschriftenCent, gezahltCent, storniert: gs.some((g) => g.storno), faelligAm: r.faelligAm }, stichtag), gutschriftenCent }];
      }),
  );

  const imZeitraum = belege.filter((b) => b.tag >= z.von && b.tag <= z.bis);
  const rechnungen = imZeitraum.filter((b) => b.art === 'rechnung');
  const gutschriften = imZeitraum.filter((b) => b.art === 'gutschrift');
  const eingaenge = zahlungen.filter((p) => p.eingegangenAm >= z.von && p.eingegangenAm <= z.bis).sort((a, b) => a.eingegangenAm.localeCompare(b.eingegangenAm));
  const offen = belege
    .filter((r) => (stand.get(r.id)?.offenCent ?? 0) !== 0)
    .sort((a, b) => (a.faelligAm ?? a.tag).localeCompare(b.faelligAm ?? b.tag) || a.nummer.localeCompare(b.nummer));

  const blattBelege: Blatt = {
    name: 'Rechnungen',
    filter: true,
    spalten: [
      { titel: 'Belegnummer', art: 'text', breite: 14 },
      { titel: 'Belegart', art: 'text', breite: 15 },
      { titel: 'Belegdatum', art: 'datum', breite: 12 },
      { titel: 'Leistung von', art: 'datum', breite: 12 },
      { titel: 'Leistung bis', art: 'datum', breite: 12 },
      { titel: 'Fällig am', art: 'datum', breite: 12 },
      { titel: 'Kundennummer', art: 'text', breite: 13 },
      { titel: 'Kunde', art: 'text', breite: 34 },
      { titel: 'UID Kunde', art: 'text', breite: 14 },
      { titel: 'Betrag (EUR)', art: 'geld', breite: 14 },
      { titel: 'Zu Rechnung', art: 'text', breite: 14 },
      { titel: 'Grund', art: 'text', breite: 30 },
      { titel: 'Bezahlt am Stichtag', art: 'geld', breite: 18 },
      { titel: 'Offen am Stichtag', art: 'geld', breite: 17 },
      { titel: 'Status am Stichtag', art: 'text', breite: 22 },
      { titel: 'Steuerhinweis', art: 'text', breite: 40 },
    ],
    zeilen: imZeitraum.map((b): Wert[] => {
      const s = stand.get(b.id);
      return [
        b.nummer,
        belegTitel(b),
        b.tag,
        b.zeitraumVon,
        b.zeitraumBis,
        b.faelligAm,
        b.empf.kundennummer,
        b.empf.name,
        b.empf.uid,
        b.summeCent,
        b.bezugId ? (nachId.get(b.bezugId)?.nummer ?? null) : null,
        b.grund,
        s ? s.gezahltCent : null,
        s ? s.offenCent : null,
        s ? STATUS[s.status] + (s.ueberfaellig ? ', überfällig' : '') : null,
        b.aus.hinweis,
      ];
    }),
  };

  const blattZahlungen: Blatt = {
    name: 'Zahlungen',
    filter: true,
    spalten: [
      { titel: 'Zahlungsdatum', art: 'datum', breite: 13 },
      { titel: 'Betrag (EUR)', art: 'geld', breite: 14 },
      { titel: 'Zahlungsart', art: 'text', breite: 13 },
      { titel: 'Rechnung', art: 'text', breite: 14 },
      { titel: 'Rechnungsdatum', art: 'datum', breite: 14 },
      { titel: 'Kundennummer', art: 'text', breite: 13 },
      { titel: 'Kunde', art: 'text', breite: 34 },
      { titel: 'Notiz', art: 'text', breite: 30 },
      { titel: 'Erfasst von', art: 'text', breite: 18 },
    ],
    zeilen: eingaenge.map((p): Wert[] => {
      const r = nachId.get(p.invoiceId);
      return [p.eingegangenAm, p.betragCent, ZAHLUNGSART_NAMEN[p.art], r?.nummer ?? null, r?.tag ?? null, r?.empf.kundennummer ?? null, r?.empf.name ?? null, p.notiz, p.erfasstVonLabel];
    }),
  };

  const blattOffen: Blatt = {
    name: 'Offene Posten',
    filter: true,
    spalten: [
      { titel: 'Rechnung', art: 'text', breite: 14 },
      { titel: 'Rechnungsdatum', art: 'datum', breite: 14 },
      { titel: 'Fällig am', art: 'datum', breite: 12 },
      { titel: 'Kundennummer', art: 'text', breite: 13 },
      { titel: 'Kunde', art: 'text', breite: 34 },
      { titel: 'Rechnungsbetrag', art: 'geld', breite: 16 },
      { titel: 'Gutschriften', art: 'geld', breite: 14 },
      { titel: 'Bezahlt', art: 'geld', breite: 14 },
      { titel: 'Offen', art: 'geld', breite: 14 },
      { titel: 'Tage überfällig', art: 'zahl', breite: 15 },
      { titel: 'Status', art: 'text', breite: 22 },
      { titel: 'Letzte Mahnung', art: 'text', breite: 30 },
    ],
    zeilen: offen.map((r): Wert[] => {
      const s = stand.get(r.id)!;
      return [
        r.nummer,
        r.tag,
        r.faelligAm,
        r.empf.kundennummer,
        r.empf.name,
        r.summeCent,
        s.gutschriftenCent,
        s.gezahltCent,
        s.offenCent,
        s.ueberfaellig && r.faelligAm ? tageZwischen(r.faelligAm, stichtag) : 0,
        STATUS[s.status] + (s.ueberfaellig ? ', überfällig' : ''),
        letzteMahnung(r.id),
      ];
    }),
  };

  const offenSumme = offen.reduce((x, r) => x + stand.get(r.id)!.offenCent, 0);
  const blattUebersicht: Blatt = {
    name: 'Übersicht',
    spalten: [
      { titel: 'Angabe', art: 'text', breite: 42 },
      { titel: 'Wert', art: 'text', breite: 44 },
      { titel: 'Anzahl', art: 'zahl', breite: 10 },
      { titel: 'Betrag (EUR)', art: 'geld', breite: 16 },
    ],
    zeilen: [
      ['Aussteller', aussteller.name, null, null],
      ['Zeitraum (Belegdatum)', `${isoDatumText(z.von)} – ${isoDatumText(z.bis)}`, null, null],
      ['Stichtag für Zahlstand und offene Posten', isoDatumText(stichtag), null, null],
      ['Erstellt', `${datumZeit(jetzt)} von ${erstelltVon}`, null, null],
      ['Rechnungen', null, rechnungen.length, summe(rechnungen)],
      ['Gutschriften und Stornorechnungen', null, gutschriften.length, summe(gutschriften)],
      ['Summe der Belege (netto)', null, imZeitraum.length, summe(imZeitraum)],
      ['Zahlungseingänge', null, eingaenge.length, eingaenge.reduce((s, p) => s + p.betragCent, 0)],
      ['Offene Posten am Stichtag', null, offen.length, offenSumme],
      ['Steuerhinweis auf den Rechnungen', daten.hinweis, null, null],
      ['Alle Beträge in Euro, netto. Gutschriften und Stornorechnungen sind negativ.', null, null, null],
    ],
  };

  return {
    dateiname: `DDL_Buchhaltung_${z.von}_bis_${z.bis}.xlsx`,
    inhalt: await xlsxErstellen([blattUebersicht, blattBelege, blattZahlungen, blattOffen], jetzt),
    zahlen: { belege: imZeitraum.length, zahlungen: eingaenge.length, offenePosten: offen.length },
  };
}
