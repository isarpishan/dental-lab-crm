import 'server-only';
import { and, desc, eq, gte, ilike, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { bankAuszuege, bankUmsaetze, expenses, invoices, payments, practices, privatBuchungen } from '@/db/schema';
import { offeneRechnungen } from '@/lib/abrechnung/daten';
import { KATEGORIE_NAMEN, type AusgabeKategorie } from '@/lib/ausgaben/text';
import { PRIVAT_KATEGORIE_NAMEN, zaehltImErgebnis, type PrivatKategorie } from '@/lib/privat/text';
import { steuerSeite } from '@/lib/steuer/einstellungen';

/**
 * «Frag deine Zahlen» (Spec فاز ۵، قدم ۶): تنها چیزهایی که Claude می‌تواند بخواند. Claude دیتابیس را نمی‌بیند و SQL
 * نمی‌نویسد؛ فقط یکی از این چند پرسش ثابت را با پارامتر (zod) صدا می‌زند. هیچ‌کدام سفارش، بیمار، Patienten-ID یا
 * متن پیام برنمی‌گرداند: فقط مبلغ، تاریخ، Kategorie، نام فروشنده یا Ordination (مشتری تجاری). خروجی‌ها کوتاه‌اند.
 */

/** Tageslimit (wie im Konzept des Finanz-Assistenten: 50 je Tag) */
export const FRAGEN_PRO_TAG = 50;

const DATUM = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als YYYY-MM-DD');
const euro = (cent: number) => Math.round(cent) / 100;

export const WERKZEUGE = [
  {
    name: 'summen',
    description:
      'Summen von Geldbeträgen in einem Zeitraum, optional gruppiert. bereich ddl = Labor (Digital Dental Lab), privat = privates Geld des Inhabers. art: einnahmen (DDL: eingegangene Zahlungen; privat: Einnahmen wie Gehalt; verliehenes Geld und Rückzahlungen zählen bei privat nicht mit, die zeigt »buchungen«), ausgaben, fakturiert (nur DDL: ausgestellte Rechnungen minus Gutschriften = Umsatz). gruppieren: keine, monat, kategorie, lieferant (Händler/Lieferant/Ordination je nach Art), ordination (nur DDL einnahmen/fakturiert).',
    schema: z.object({
      bereich: z.enum(['ddl', 'privat']),
      art: z.enum(['einnahmen', 'ausgaben', 'fakturiert']),
      von: DATUM,
      bis: DATUM,
      gruppieren: z.enum(['keine', 'monat', 'kategorie', 'lieferant', 'ordination']).default('keine'),
    }),
  },
  {
    name: 'buchungen',
    description:
      'Einzelne Buchungen in einem Zeitraum, neueste zuerst, höchstens 40. bereich ddl: art ausgaben (Ausgaben des Labors), einnahmen (eingegangene Zahlungen) oder rechnungen (ausgestellte Rechnungen). bereich privat: einnahmen oder ausgaben. suche: Teil des Namens (Lieferant, Händler oder Ordination).',
    schema: z.object({
      bereich: z.enum(['ddl', 'privat']),
      art: z.enum(['einnahmen', 'ausgaben', 'rechnungen']),
      von: DATUM,
      bis: DATUM,
      suche: z.string().max(60).nullable().default(null),
    }),
  },
  {
    name: 'offene_rechnungen',
    description: 'Alle noch nicht (ganz) bezahlten Rechnungen des Labors mit Ordination, offenem Betrag, Fälligkeit und ob überfällig.',
    schema: z.object({}),
  },
  {
    name: 'steuer_vorschau',
    description: 'Geschätzte Einkommensteuer und SVS-Nachzahlung für das laufende Jahr wegen des Labors, und wie viel pro Monat zurückzulegen ist (Schätzung, keine Steuerberatung).',
    schema: z.object({}),
  },
  {
    name: 'bank',
    description: 'Letzter Kontostand laut Kontoauszug und wie viele Bankzeilen noch zu klären sind bzw. ohne Beleg.',
    schema: z.object({}),
  },
] as const;

export type WerkzeugName = (typeof WERKZEUGE)[number]['name'];

const kategorieName = (bereich: 'ddl' | 'privat', k: string) =>
  bereich === 'ddl' ? (KATEGORIE_NAMEN[k as AusgabeKategorie] ?? k) : (PRIVAT_KATEGORIE_NAMEN[k as PrivatKategorie] ?? k);

type Roh = { datum: string; cent: number; kategorie: string | null; name: string | null };

/** Rohzeilen je Bereich und Art (nur Beträge, Datum, Kategorie, Name) */
async function rohzeilen(bereich: 'ddl' | 'privat', art: 'einnahmen' | 'ausgaben' | 'fakturiert', von: string, bis: string, suche: string | null = null): Promise<Roh[]> {
  const muster = suche ? `%${suche}%` : null;
  if (bereich === 'privat') {
    if (art === 'fakturiert') return [];
    const f: SQL[] = [isNull(privatBuchungen.geloeschtAm), eq(privatBuchungen.art, art === 'einnahmen' ? 'einnahme' : 'ausgabe'), gte(privatBuchungen.datum, von), lte(privatBuchungen.datum, bis)];
    if (muster) f.push(ilike(privatBuchungen.haendler, muster));
    const z = await db().select({ datum: privatBuchungen.datum, cent: privatBuchungen.betragCent, kategorie: privatBuchungen.kategorie, name: privatBuchungen.haendler }).from(privatBuchungen).where(and(...f));
    return z;
  }
  if (art === 'ausgaben') {
    const f: SQL[] = [isNull(expenses.geloeschtAm), gte(expenses.bezahltAm, von), lte(expenses.bezahltAm, bis)];
    if (muster) f.push(ilike(expenses.lieferant, muster));
    return db().select({ datum: expenses.bezahltAm, cent: expenses.bruttoCent, kategorie: expenses.kategorie, name: expenses.lieferant }).from(expenses).where(and(...f));
  }
  if (art === 'einnahmen') {
    const f: SQL[] = [gte(payments.eingegangenAm, von), lte(payments.eingegangenAm, bis)];
    if (muster) f.push(ilike(practices.name, muster));
    return db()
      .select({ datum: payments.eingegangenAm, cent: payments.betragCent, kategorie: sql<string | null>`null`, name: practices.name })
      .from(payments)
      .innerJoin(practices, eq(practices.id, payments.practiceId))
      .where(and(...f));
  }
  const tag = sql<string>`to_char(${invoices.ausgestelltAm} at time zone 'Europe/Vienna', 'YYYY-MM-DD')`;
  const f: SQL[] = [sql`${tag} >= ${von}`, sql`${tag} <= ${bis}`];
  if (muster) f.push(ilike(practices.name, muster));
  return db()
    .select({ datum: tag, cent: invoices.summeCent, kategorie: sql<string | null>`null`, name: practices.name })
    .from(invoices)
    .innerJoin(practices, eq(practices.id, invoices.practiceId))
    .where(and(...f));
}

/** Ein Werkzeug ausführen. Ungültige Eingaben ← Fehlertext für die KI (sie kann es neu versuchen). */
export async function werkzeugAusfuehren(name: string, eingabe: unknown): Promise<unknown> {
  const w = WERKZEUGE.find((x) => x.name === name);
  if (!w) return { fehler: `Unbekanntes Werkzeug ${name}` };
  const p = w.schema.safeParse(eingabe ?? {});
  if (!p.success) return { fehler: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };

  if (w.name === 'summen') {
    const e = p.data as z.infer<(typeof WERKZEUGE)[0]['schema']>;
    if (e.bis < e.von) return { fehler: 'bis liegt vor von' };
    const zeilen = (await rohzeilen(e.bereich, e.art, e.von, e.bis)).filter((z) => e.bereich !== 'privat' || !z.kategorie || zaehltImErgebnis(z.kategorie));
    const gesamt = zeilen.reduce((s, z) => s + z.cent, 0);
    if (e.gruppieren === 'keine') return { zeitraum: `${e.von} bis ${e.bis}`, summe_eur: euro(gesamt), anzahl: zeilen.length };
    const je = new Map<string, { cent: number; n: number }>();
    for (const z of zeilen) {
      const g =
        e.gruppieren === 'monat' ? z.datum.slice(0, 7) : e.gruppieren === 'kategorie' ? (z.kategorie ? kategorieName(e.bereich, z.kategorie) : 'ohne Kategorie') : (z.name ?? 'ohne Name');
      const x = je.get(g) ?? { cent: 0, n: 0 };
      je.set(g, { cent: x.cent + z.cent, n: x.n + 1 });
    }
    const gruppen = [...je.entries()]
      .sort((a, b) => (e.gruppieren === 'monat' ? a[0].localeCompare(b[0]) : b[1].cent - a[1].cent))
      .slice(0, 30)
      .map(([gruppe, x]) => ({ gruppe, summe_eur: euro(x.cent), anzahl: x.n }));
    return { zeitraum: `${e.von} bis ${e.bis}`, summe_eur: euro(gesamt), anzahl: zeilen.length, gruppen, weitere_gruppen: Math.max(0, je.size - 30) };
  }

  if (w.name === 'buchungen') {
    const e = p.data as z.infer<(typeof WERKZEUGE)[1]['schema']>;
    const art = e.art === 'rechnungen' ? 'fakturiert' : e.art;
    const zeilen = (await rohzeilen(e.bereich, art, e.von, e.bis, e.suche)).sort((a, b) => b.datum.localeCompare(a.datum));
    return {
      anzahl: zeilen.length,
      summe_eur: euro(zeilen.reduce((s, z) => s + z.cent, 0)),
      zeilen: zeilen.slice(0, 40).map((z) => ({ datum: z.datum, name: z.name, kategorie: z.kategorie ? kategorieName(e.bereich, z.kategorie) : null, betrag_eur: euro(z.cent) })),
      gekuerzt: zeilen.length > 40,
    };
  }

  if (w.name === 'offene_rechnungen') {
    const r = await offeneRechnungen();
    return {
      summe_offen_eur: euro(r.reduce((s, x) => s + x.offenCent, 0)),
      rechnungen: r.slice(0, 40).map((x) => ({ nummer: x.nummer, ordination: x.praxis, offen_eur: euro(x.offenCent), faellig_am: x.faelligAm, ueberfaellig: x.ueberfaellig })),
    };
  }

  if (w.name === 'steuer_vorschau') {
    const s = await steuerSeite();
    const v = s.vorschau;
    if (!v) return { hinweis: 'Noch keine Angaben unter Einstellungen → Steuer.' };
    return {
      jahr: v.jahr,
      gewinn_jahr_eur: euro(v.gewinnJahrCent),
      gewinn_quelle: v.gewinnQuelle,
      einkommensteuer_zusaetzlich_eur: euro(v.estOffenCent),
      svs_nachzahlung_spaeter_eur: euro(v.svsNachCent),
      svs_laufend_eur: euro(v.svsLaufendCent),
      zuruecklegen_gesamt_eur: euro(Math.max(0, v.ruecklageCent)),
      zuruecklegen_pro_monat_eur: euro(v.ruecklageMonatCent),
      hinweis: 'Schätzung, keine Steuerberatung',
    };
  }

  // bank
  const [letzter] = await db()
    .select({ datum: bankAuszuege.auszugDatum, cent: bankAuszuege.neuerCent })
    .from(bankAuszuege)
    .where(eq(bankAuszuege.status, 'gelesen'))
    .orderBy(desc(bankAuszuege.auszugDatum), desc(bankAuszuege.hochgeladenAm))
    .limit(1);
  const [z] = await db()
    .select({
      klaeren: sql<number>`count(*) filter (where ${bankUmsaetze.zuordnung} is null)::int`,
      ohneBeleg: sql<number>`count(*) filter (where ${bankUmsaetze.zuordnung} = 'ddl_offen')::int`,
    })
    .from(bankUmsaetze);
  return { kontostand_eur: letzter?.cent != null ? euro(letzter.cent) : null, laut_auszug_vom: letzter?.datum ?? null, zu_klaeren: z?.klaeren ?? 0, ohne_beleg: z?.ohneBeleg ?? 0 };
}

/** Link zur passenden Liste im CRM für ein ausgeführtes Werkzeug (unter der Antwort als »Grundlage«). */
export function werkzeugLink(name: string, eingabe: unknown): { text: string; href: string } | null {
  const e = (eingabe ?? {}) as { bereich?: string; art?: string; von?: string; bis?: string };
  const zeit = e.von && e.bis ? ` ${e.von.split('-').reverse().join('.')}–${e.bis.split('-').reverse().join('.')}` : '';
  switch (name) {
    case 'summen':
    case 'buchungen':
      if (e.bereich === 'privat') return { text: `Privat ${e.art === 'einnahmen' ? 'Einnahmen' : 'Ausgaben'}${zeit}`, href: `/privat/buchungen${e.von ? `?jahr=${e.von.slice(0, 4)}` : ''}` };
      if (e.art === 'ausgaben') return { text: `Ausgaben Labor${zeit}`, href: `/abrechnung/ausgaben${e.von ? `?jahr=${e.von.slice(0, 4)}` : ''}` };
      return { text: `${e.art === 'einnahmen' ? 'Zahlungen' : 'Rechnungen'} Labor${zeit}`, href: `/abrechnung/uebersicht${e.bis ? `?monat=${e.bis.slice(0, 7)}` : ''}` };
    case 'offene_rechnungen':
      return { text: 'Offene Rechnungen', href: '/abrechnung?tab=offen' };
    case 'steuer_vorschau':
      return { text: 'Steuer-Vorschau', href: '/abrechnung/steuer' };
    case 'bank':
      return { text: 'Bank', href: '/abrechnung/bank' };
    default:
      return null;
  }
}
