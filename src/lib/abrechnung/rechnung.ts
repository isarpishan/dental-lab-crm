import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import { and, desc, eq, sql } from 'drizzle-orm';
import { createElement } from 'react';
import { db } from '@/db/client';
import { invoiceLines, invoices, payments, practices, settings, type RabattArt, type Zahlungsart } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { ausstellerLaden } from '@/lib/dokumente/aussteller';
import type { Aussteller } from '@/lib/dokumente/aussteller-werte';
import { AppError } from '@/lib/errors';
import { heuteIso } from '@/lib/format';
import { belegnummer, naechsteNummer, voraussichtlicheNummer } from '@/lib/nummern';
import { RechnungPdf } from '@/lib/pdf/rechnung';
import { ausPuffer, loeschen, speichern } from '@/lib/storage';
import { faelle, type Fall } from './daten';
import { mahnungenVon, mahnwesenLaden, type Mahnung } from './mahnung-daten';
import { faelligeStufe, type Mahnstufe } from './mahnwesen';
import { zahlstand, type Zahlstand } from './offen';
import { rabattCent, type Position } from './positionen';
import { faelligAm, fehlendeAngaben, monatsgrenzen, rechnungsdatenAus, type Rechnungsdaten } from './rechnungsdaten';
import { versandVon, type Versand } from './versand';

/**
 * Rechnung و Gutschrift (Spec فاز ۲، قدم ۲). پیش‌نویس ذخیره نمی‌شود: `entwurf` هر بار از سفارش‌های
 * فاکتورنشده ساخته می‌شود. `ausstellen` همان را در یک تراکنش با قفل هر Ordination دوباره می‌سازد،
 * شمارهٔ پیوسته (`R-2026-0001`) می‌گیرد، PDF را ذخیره می‌کند و همه‌چیز را همان‌طور که چاپ شد نگه
 * می‌دارد. بعد از صدور فقط Gutschrift ممکن است (`G-2026-0001`)؛ Storno = Gutschrift برای کل مبلغ.
 * روی فاکتور فقط شمارهٔ سفارش و Patienten-ID می‌آید، هرگز نام بیمار.
 */

export type Empfaenger = { name: string; zeilen: string[]; uid: string | null; kundennummer: string };
/** صادرکننده همراه با داده‌های پرداخت، همان‌طور که روی PDF آمد */
export type AusstellerStand = Aussteller & Rechnungsdaten;
export type Zeile = {
  orderId: string | null;
  auftragsnummer: string | null;
  patientencode: string | null;
  leistungsdatum: string | null;
  bezeichnung: string;
  menge: number;
  einheit: string;
  einzelpreisCent: number;
  /** Rabatt همان‌طور که در `invoice_lines` ذخیره می‌شود (`Rabatt` در `positionen.ts`) */
  rabattArt: RabattArt | null;
  rabattWert: number | null;
  /** مبلغ کسرشده؛ در Storno منفی */
  rabattCent: number;
  /** menge × einzelpreis − rabatt */
  betragCent: number;
};
export type Auswahl = { monat: string } | { orderId: string };
type StaffAkteur = { kind: 'staff'; id: string; label: string };

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

export async function rechnungsdatenLaden(): Promise<{ aussteller: Aussteller; daten: Rechnungsdaten; fehlt: string[] }> {
  const [aussteller, [r]] = await Promise.all([ausstellerLaden(), db().select({ value: settings.value }).from(settings).where(eq(settings.key, 'rechnung')).limit(1)]);
  const daten = rechnungsdatenAus(r?.value);
  return { aussteller, daten, fehlt: fehlendeAngaben(aussteller, daten) };
}

async function empfaengerVon(practiceId: string): Promise<Empfaenger | null> {
  const [p] = await db().select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!p) return null;
  const ort = [p.zip, p.city].filter(Boolean).join(' ');
  return {
    name: p.name,
    zeilen: [p.street, ort, p.country && p.country !== 'AT' ? p.country : null].filter((x): x is string => Boolean(x?.trim())),
    uid: p.uidNumber?.trim() || null,
    kundennummer: p.customerNo,
  };
}

/** یک ردیف فاکتور از یک پوزیشن؛ Rabatt از مبلغ ردیف کم می‌شود. */
export function zeileVon(p: Position, f: Pick<Zeile, 'orderId' | 'auftragsnummer' | 'patientencode' | 'leistungsdatum'>): Zeile {
  const einzelpreisCent = p.einzelpreisCent ?? 0;
  const grund = einzelpreisCent * p.menge;
  const rabatt = rabattCent(grund, p.rabatt);
  return {
    ...f,
    bezeichnung: p.bezeichnung,
    menge: p.menge,
    einheit: p.einheit,
    einzelpreisCent,
    rabattArt: p.rabatt?.art ?? null,
    rabattWert: p.rabatt?.wert ?? null,
    rabattCent: rabatt,
    betragCent: grund - rabatt,
  };
}

const zeilenAus = (fs: Fall[]): Zeile[] =>
  fs.flatMap((f) =>
    f.positionen.map((p) =>
      zeileVon(p, { orderId: f.orderId, auftragsnummer: f.orderNo, patientencode: f.patientencode, leistungsdatum: f.leistungsdatum ? heuteIso(f.leistungsdatum) : null }),
    ),
  );

export type Entwurf = {
  art: 'sammel' | 'einzel';
  practiceId: string;
  empfaenger: Empfaenger;
  zeitraum: [string, string];
  faelle: Fall[];
  ohnePreis: Fall[];
  zeilen: Zeile[];
  summeCent: number;
  datum: string;
  faellig: string;
  /** Sammelrechnung برای ماهی که هنوز تمام نشده: مجاز، فقط با یک تذکر */
  monatLaeuft: boolean;
  aussteller: AusstellerStand;
  fehlt: string[];
};

/** پیش‌نمایش: Sammelrechnung یک ماه یا Einzelrechnung یک سفارش، فقط از کارهای فاکتورنشده. */
export async function entwurf(practiceId: string, auswahl: Auswahl, jetzt = new Date()): Promise<Entwurf | null> {
  const [empfaenger, alle, r] = await Promise.all([
    empfaengerVon(practiceId),
    'orderId' in auswahl ? faelle({ orderIds: [auswahl.orderId] }) : faelle({ practiceId }),
    rechnungsdatenLaden(),
  ]);
  if (!empfaenger) return null;
  const offen = alle
    .filter((f) => f.practiceId === practiceId && f.leistungsdatum && !f.rechnung && ('monat' in auswahl ? f.monat === auswahl.monat : true))
    .sort((a, b) => a.leistungsdatum!.getTime() - b.leistungsdatum!.getTime() || (a.orderNo ?? '').localeCompare(b.orderNo ?? ''));
  const datum = heuteIso(jetzt);
  const zeitraum: [string, string] =
    'monat' in auswahl ? monatsgrenzen(auswahl.monat) : [offen[0] ? heuteIso(offen[0].leistungsdatum!) : datum, offen[0] ? heuteIso(offen[0].leistungsdatum!) : datum];
  const zeilen = zeilenAus(offen);
  return {
    art: 'monat' in auswahl ? 'sammel' : 'einzel',
    practiceId,
    empfaenger,
    zeitraum,
    faelle: offen,
    ohnePreis: offen.filter((f) => f.summe.preisFehlt),
    zeilen,
    summeCent: zeilen.reduce((s, z) => s + z.betragCent, 0),
    datum,
    faellig: faelligAm(datum, r.daten.zahlungszielTage),
    monatLaeuft: 'monat' in auswahl && zeitraum[1] >= datum,
    aussteller: { ...r.aussteller, ...r.daten },
    fehlt: r.fehlt,
  };
}

const pdf = (el: unknown) => renderToBuffer(el as Parameters<typeof renderToBuffer>[0]);

async function ablegen(
  tx: Tx,
  werte: Omit<typeof invoices.$inferInsert, 'storageKey' | 'sha256' | 'size'>,
  zeilen: Zeile[],
  inhalt: Buffer,
  dateien: string[],
) {
  const f = await speichern(ausPuffer(new Uint8Array(inhalt)), 20 * 1024 * 1024);
  dateien.push(f.key);
  const [neu] = await tx
    .insert(invoices)
    .values({ ...werte, storageKey: f.key, sha256: f.sha256, size: f.groesse })
    .returning({ id: invoices.id, nummer: invoices.nummer });
  if (zeilen.length) await tx.insert(invoiceLines).values(zeilen.map((z, i) => ({ ...z, invoiceId: neu.id, position: i + 1 })));
  return neu;
}

/** همه‌چیز یا هیچ‌چیز: اگر تراکنش برگردد، فایل‌های PDF نوشته‌شده هم پاک می‌شوند و شماره مصرف نمی‌شود. */
export async function mitDateien<T>(f: (dateien: string[]) => Promise<T>): Promise<T> {
  const dateien: string[] = [];
  try {
    return await f(dateien);
  } catch (e) {
    for (const k of dateien) await loeschen(k);
    throw e;
  }
}

const jahrVon = (d: Date) => Number(heuteIso(d).slice(0, 4));

const rechnungPdf = (e: Entwurf, nummer: string, am: Date, vorschau = false) =>
  pdf(
    createElement(RechnungPdf, { titel: 'Rechnung', nummer, am, aussteller: e.aussteller, empfaenger: e.empfaenger, zeitraum: e.zeitraum, faellig: e.faellig, zeilen: e.zeilen, summeCent: e.summeCent, vorschau }),
  );

/**
 * پیش‌نمایش Rechnung پیش از صدور: همان PDF که `ausstellen` می‌سازد، با شمارهٔ احتمالی و مُهر «VORSCHAU».
 * هیچ‌چیز ذخیره نمی‌شود و هیچ شماره‌ای مصرف نمی‌شود. null: Ordination نیست یا چیزی برای فاکتور نیست.
 */
export async function rechnungVorschau(practiceId: string, auswahl: Auswahl): Promise<Buffer | null> {
  const am = new Date();
  const e = await entwurf(practiceId, auswahl, am);
  if (!e?.faelle.length) return null;
  const jahr = jahrVon(am);
  return rechnungPdf(e, belegnummer('R', jahr, await voraussichtlicheNummer(db(), 'rechnung', jahr)), am, true);
}

export async function ausstellen(practiceId: string, auswahl: Auswahl, akteur: StaffAkteur, ip: string | null) {
  const neu = await mitDateien((dateien) =>
    db().transaction(async (tx) => {
      // در هر لحظه فقط یک Rechnung برای هر Ordination؛ وگرنه یک سفارش ممکن بود روی دو Rechnung بیاید
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rechnung:${practiceId}`}))`);
      const am = new Date();
      const e = await entwurf(practiceId, auswahl, am);
      if (!e) throw new AppError('Ordination nicht gefunden.');
      if (e.fehlt.length) throw new AppError(`Bitte zuerst in den Einstellungen ergänzen: ${e.fehlt.join(', ')}.`);
      if (!e.faelle.length) throw new AppError('Nichts zu verrechnen: die Arbeiten stehen schon auf einer Rechnung.');
      if (e.ohnePreis.length) throw new AppError(`Noch ohne Preis: ${e.ohnePreis.map((f) => f.orderNo).join(', ')}. Bitte zuerst die Positionen ergänzen.`);
      const jahr = jahrVon(am);
      const nummer = belegnummer('R', jahr, await naechsteNummer(tx, 'rechnung', jahr));
      const inhalt = await rechnungPdf(e, nummer, am);
      return ablegen(
        tx,
        {
          nummer,
          art: 'rechnung',
          practiceId,
          abrechnung: e.art,
          zeitraumVon: e.zeitraum[0],
          zeitraumBis: e.zeitraum[1],
          ausgestelltAm: am,
          faelligAm: e.faellig,
          summeCent: e.summeCent,
          empfaenger: e.empfaenger,
          aussteller: e.aussteller,
          ausgestelltVon: akteur.id,
          ausgestelltVonLabel: akteur.label,
        },
        e.zeilen,
        inhalt,
        dateien,
      );
    }),
  );
  await logAudit({ aktion: 'rechnung_ausgestellt', akteur, ziel: { typ: 'rechnung', id: neu.id }, details: { nummer: neu.nummer, practiceId }, ip });
  return neu;
}

export type Zahlung = { id: string; betragCent: number; am: string; art: Zahlungsart; notiz: string | null; von: string };
export type RechnungsZeile = typeof invoices.$inferSelect & {
  bezugNummer: string | null;
  gutschriften: { nummer: string; storno: boolean; summeCent: number }[];
  /** وضعیت پرداخت (قدم ۳)؛ فقط برای Rechnung، نه Gutschrift */
  stand: Zahlstand | null;
  zahlungen: Zahlung[];
  /** ارسال‌ها با ایمیل، تازه‌ترین اول */
  versand: Versand[];
  /** Zahlungserinnerung و Mahnungها (قدم ۴)، به ترتیب مرحله */
  mahnungen: Mahnung[];
  /** مرحله‌ای که الان رسیده، یا null */
  mahnStufe: Mahnstufe | null;
};

/** همهٔ Rechnungها و Gutschriftهای یک Ordination، تازه‌ترین اول، با پرداخت‌ها و وضعیت ارسال. */
export async function rechnungenVon(practiceId: string, heute = heuteIso()): Promise<RechnungsZeile[]> {
  const alle = await db().select().from(invoices).where(eq(invoices.practiceId, practiceId)).orderBy(desc(invoices.ausgestelltAm));
  if (!alle.length) return [];
  const [zahlungen, versand, mahnungen, m] = await Promise.all([
    db().select().from(payments).where(eq(payments.practiceId, practiceId)).orderBy(payments.eingegangenAm, payments.erfasstAm),
    versandVon(alle.map((r) => r.id)),
    mahnungenVon(alle.map((r) => r.id)),
    mahnwesenLaden(),
  ]);
  const nachId = new Map(alle.map((r) => [r.id, r]));
  return alle.map((r) => {
    const gutschriften = alle.filter((g) => g.bezugId === r.id);
    const eigene = zahlungen
      .filter((z) => z.invoiceId === r.id)
      .map((z) => ({ id: z.id, betragCent: z.betragCent, am: z.eingegangenAm, art: z.art, notiz: z.notiz, von: z.erfasstVonLabel }));
    const stand =
      r.art === 'rechnung'
        ? zahlstand(
            {
              summeCent: r.summeCent,
              gutschriftenCent: gutschriften.reduce((s, g) => s + g.summeCent, 0),
              gezahltCent: eigene.reduce((s, z) => s + z.betragCent, 0),
              storniert: gutschriften.some((g) => g.storno),
              faelligAm: r.faelligAm,
            },
            heute,
          )
        : null;
    const briefe = mahnungen.get(r.id) ?? [];
    const letzte = briefe.at(-1);
    return {
      ...r,
      bezugNummer: r.bezugId ? (nachId.get(r.bezugId)?.nummer ?? null) : null,
      gutschriften: gutschriften.map((g) => ({ nummer: g.nummer, storno: g.storno, summeCent: g.summeCent })),
      stand,
      zahlungen: eigene,
      versand: versand.get(r.id) ?? [],
      mahnungen: briefe,
      mahnStufe: faelligeStufe({ faelligAm: r.faelligAm, stand, letzte: letzte ? { stufe: letzte.stufe, frist: letzte.frist } : null }, heute, m),
    };
  });
}

async function rechnungMitZeilen(id: string) {
  const [r] = await db().select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!r) return null;
  const [zeilen, gutschriften] = await Promise.all([
    db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(invoiceLines.position),
    db().select().from(invoices).where(and(eq(invoices.bezugId, id), eq(invoices.art, 'gutschrift'))),
  ]);
  return { r, zeilen, gutschriften };
}

type GutschriftVorgabe = { storno: true; grund: string } | { storno: false; grund: string; zeilen: { bezeichnung: string; betragCent: number }[] };

/** ردیف‌های Gutschrift: در Storno همهٔ ردیف‌های Rechnung منفی، وگرنه ردیف‌های آزاد «Pauschal». بدون بررسی مبلغ. */
function gutschriftZeilen(alt: (typeof invoiceLines.$inferSelect)[], vorgabe: GutschriftVorgabe): Zeile[] {
  if (vorgabe.storno) {
    return alt.map((z) => ({
      orderId: z.orderId,
      auftragsnummer: z.auftragsnummer,
      patientencode: z.patientencode,
      leistungsdatum: z.leistungsdatum,
      bezeichnung: z.bezeichnung,
      menge: z.menge,
      einheit: z.einheit,
      einzelpreisCent: -z.einzelpreisCent,
      rabattArt: z.rabattArt,
      rabattWert: z.rabattWert,
      rabattCent: -z.rabattCent,
      betragCent: -z.betragCent,
    }));
  }
  return vorgabe.zeilen.map((z) => ({
    orderId: null,
    auftragsnummer: null,
    patientencode: null,
    leistungsdatum: null,
    bezeichnung: z.bezeichnung,
    menge: 1,
    einheit: 'Pauschal',
    einzelpreisCent: -z.betragCent,
    rabattArt: null,
    rabattWert: null,
    rabattCent: 0,
    betragCent: -z.betragCent,
  }));
}

function gutschriftPdf(r: typeof invoices.$inferSelect, vorgabe: GutschriftVorgabe, zeilen: Zeile[], nummer: string, am: Date, vorschau = false) {
  return pdf(
    createElement(RechnungPdf, {
      titel: vorgabe.storno ? 'Stornorechnung' : 'Gutschrift',
      nummer,
      am,
      aussteller: r.aussteller as AusstellerStand,
      empfaenger: r.empfaenger as Empfaenger,
      zeitraum: r.zeitraumVon && r.zeitraumBis ? [r.zeitraumVon, r.zeitraumBis] : null,
      faellig: null,
      zeilen,
      summeCent: zeilen.reduce((s, z) => s + z.betragCent, 0),
      bezug: { nummer: r.nummer, am: r.ausgestelltAm },
      grund: vorgabe.grund,
      vorschau,
    }),
  );
}

/**
 * پیش‌نمایش Gutschrift یا Stornorechnung با همان ورودی فرم، حتی ناقص (مبلغ خالی ← € 0,00). بررسی‌ها
 * (سقف مبلغ، Storno تکراری) فقط موقع صدور؛ پیام خطا همان‌جا در فرم می‌آید. چیزی ذخیره نمی‌شود.
 */
export async function gutschriftVorschau(rechnungId: string, vorgabe: GutschriftVorgabe): Promise<Buffer | null> {
  const v = await rechnungMitZeilen(rechnungId);
  if (!v || v.r.art !== 'rechnung') return null;
  const am = new Date();
  const jahr = jahrVon(am);
  return gutschriftPdf(v.r, vorgabe, gutschriftZeilen(v.zeilen, vorgabe), belegnummer('G', jahr, await voraussichtlicheNummer(db(), 'gutschrift', jahr)), am, true);
}

/**
 * Gutschrift به یک Rechnung. `storno`: کل مبلغ با همهٔ ردیف‌ها منفی (سفارش‌ها دوباره باز می‌شوند)؛
 * وگرنه ردیف‌های آزاد (مثلاً Kulanz) تا سقف ماندهٔ همان Rechnung.
 */
export async function gutschreiben(
  rechnungId: string,
  vorgabe: GutschriftVorgabe,
  akteur: StaffAkteur,
  ip: string | null,
) {
  const neu = await mitDateien((dateien) =>
    db().transaction(async (tx) => {
      const vorher = await rechnungMitZeilen(rechnungId);
      if (!vorher || vorher.r.art !== 'rechnung') throw new AppError('Rechnung nicht gefunden.');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rechnung:${vorher.r.practiceId}`}))`);
      const { r, zeilen: alt, gutschriften } = (await rechnungMitZeilen(rechnungId))!;
      if (gutschriften.some((g) => g.storno)) throw new AppError(`${r.nummer} ist bereits storniert.`);
      const rest = r.summeCent + gutschriften.reduce((s, g) => s + g.summeCent, 0);
      if (vorgabe.storno) {
        if (gutschriften.length) throw new AppError(`Zu ${r.nummer} gibt es schon eine Gutschrift. Bitte für den Rest eine weitere Gutschrift ausstellen.`);
      } else {
        const summe = vorgabe.zeilen.reduce((s, z) => s + z.betragCent, 0);
        if (summe <= 0) throw new AppError('Der Betrag der Gutschrift muss größer als 0 sein.');
        if (summe > rest) throw new AppError(`Die Gutschrift ist höher als der offene Rechnungsbetrag von ${r.nummer}.`);
      }
      const zeilen = gutschriftZeilen(alt, vorgabe);
      const am = new Date();
      const jahr = jahrVon(am);
      const nummer = belegnummer('G', jahr, await naechsteNummer(tx, 'gutschrift', jahr));
      const summeCent = zeilen.reduce((s, z) => s + z.betragCent, 0);
      const aussteller = r.aussteller as AusstellerStand;
      const empfaenger = r.empfaenger as Empfaenger;
      const inhalt = await gutschriftPdf(r, vorgabe, zeilen, nummer, am);
      return ablegen(
        tx,
        {
          nummer,
          art: 'gutschrift',
          storno: vorgabe.storno,
          practiceId: r.practiceId,
          bezugId: r.id,
          abrechnung: 'gutschrift',
          zeitraumVon: r.zeitraumVon,
          zeitraumBis: r.zeitraumBis,
          ausgestelltAm: am,
          summeCent,
          empfaenger,
          aussteller,
          grund: vorgabe.grund,
          ausgestelltVon: akteur.id,
          ausgestelltVonLabel: akteur.label,
        },
        zeilen,
        inhalt,
        dateien,
      );
    }),
  );
  await logAudit({
    aktion: vorgabe.storno ? 'rechnung_storniert' : 'gutschrift_ausgestellt',
    akteur,
    ziel: { typ: 'rechnung', id: rechnungId },
    details: { gutschrift: neu.nummer, grund: vorgabe.grund },
    ip,
  });
  return neu;
}
