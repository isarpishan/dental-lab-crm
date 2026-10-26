import 'server-only';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import {
  documents,
  invoiceLines,
  invoices,
  orderPositions,
  orders,
  orderStatusHistory,
  orderTeeth,
  patients,
  payments,
  practices,
  workTypes,
  type LieferOption,
  type Zuschlag,
} from '@/db/schema';
import { heuteIso } from '@/lib/format';
import { leistungsdatum, monatVon } from './leistung';
import { saldoAus, zahlstand, type Saldo } from './offen';
import { summe, vorschlag, type Position, type PositionEinheit } from './positionen';

/**
 * دادهٔ Abrechnung هر سفارش از دیتابیس: Leistungsdatum، پیشنهاد پوزیشن‌ها از `price_snapshot`،
 * دندان‌ها و فک‌ها، و پوزیشن‌های ویرایش‌شدهٔ Büro (اگر باشد، جای پیشنهاد را می‌گیرد).
 * سفارشی با Leistungsdatum که روی Rechnung معتبر نیامده، «noch nicht verrechnet» است.
 */
export type Fall = {
  orderId: string;
  orderNo: string | null;
  practiceId: string;
  behandlung: string;
  status: string;
  lieferart: 'design' | 'fertigung' | null;
  leistungsdatum: Date | null;
  monat: string | null;
  vorschlag: Position[];
  /** ویرایش Büro، یا null اگر همان پیشنهاد است */
  gespeichert: Position[] | null;
  positionen: Position[];
  summe: { cent: number; preisFehlt: boolean };
  patientencode: string | null;
  /** روی یک Rechnung معتبر (استورنو‌نشده) آمده است؛ پوزیشن‌ها قفل‌اند */
  rechnung: { invoiceId: string; nummer: string; am: Date } | null;
};

type PreisStand = {
  preisAb?: number | null;
  einheit?: LieferOption['einheit'] | null;
  zuschlag?: Zuschlag | null;
  neuanfertigung?: { reklamation: string; kostenlos: boolean } | null;
};

const kieferVon = (fdi: number): 'OK' | 'UK' => (Math.floor(fdi / 10) <= 2 ? 'OK' : 'UK');

export async function faelle(filter: { practiceId?: string; orderIds?: string[] } = {}): Promise<Fall[]> {
  if (filter.orderIds && !filter.orderIds.length) return [];
  const bedingungen = [ne(orders.status, 'entwurf')];
  if (filter.practiceId) bedingungen.push(eq(orders.practiceId, filter.practiceId));
  if (filter.orderIds) bedingungen.push(inArray(orders.id, filter.orderIds));
  const zeilen = await db()
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      practiceId: orders.practiceId,
      status: orders.status,
      lieferart: orders.deliveryKind,
      tempo: orders.tempo,
      config: orders.config,
      stand: orders.priceSnapshot,
      approvedAt: orders.approvedAt,
      deliveredAt: orders.deliveredAt,
      behandlung: workTypes.name,
      patientencode: patients.code,
    })
    .from(orders)
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .leftJoin(patients, eq(patients.id, orders.patientId))
    .where(and(...bedingungen))
    .orderBy(asc(orders.submittedAt));
  const ids = zeilen.map((z) => z.id);
  if (!ids.length) return [];

  const [zaehne, lieferscheine, freigaben, gespeichert, rechnungen] = await Promise.all([
    db().select().from(orderTeeth).where(inArray(orderTeeth.orderId, ids)),
    db()
      .select({ orderId: documents.orderId, am: documents.issuedAt })
      .from(documents)
      .where(and(inArray(documents.orderId, ids), eq(documents.kind, 'lieferschein'))),
    db()
      .select({ orderId: orderStatusHistory.orderId, am: sql`min(${orderStatusHistory.at})`.mapWith(orderStatusHistory.at) })
      .from(orderStatusHistory)
      .where(and(inArray(orderStatusHistory.orderId, ids), eq(orderStatusHistory.status, 'freigegeben')))
      .groupBy(orderStatusHistory.orderId),
    db().select().from(orderPositions).where(inArray(orderPositions.orderId, ids)).orderBy(asc(orderPositions.position)),
    verrechnet(ids),
  ]);
  const gruppe = <T extends { orderId: string }>(liste: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of liste) m.set(x.orderId, [...(m.get(x.orderId) ?? []), x]);
    return m;
  };
  const zaehneVon = gruppe(zaehne);
  const gespeichertVon = gruppe(gespeichert);
  const lieferscheinVon = new Map(lieferscheine.map((l) => [l.orderId, l.am]));
  const freigabeVon = new Map(freigaben.map((f) => [f.orderId, f.am]));

  return zeilen.map((z) => {
    const stand = (z.stand ?? {}) as PreisStand;
    const zz = (zaehneVon.get(z.id) ?? []).map((t) => ({ fdi: t.fdi, treatment: t.treatment, spanId: t.spanId }));
    const k = (z.config as Record<string, unknown>).kiefer;
    const kiefer: ('OK' | 'UK')[] =
      k === 'beide' ? ['OK', 'UK'] : k === 'OK' || k === 'UK' ? [k] : (['OK', 'UK'] as const).filter((x) => zz.some((t) => kieferVon(t.fdi) === x));
    const v = vorschlag({
      behandlung: z.behandlung ?? 'Auftrag',
      lieferart: z.lieferart,
      preisAb: stand.preisAb ?? null,
      einheit: stand.einheit ?? null,
      tempo: z.tempo,
      zuschlag: stand.zuschlag ?? null,
      zaehne: zz,
      kiefer,
      neuanfertigung: stand.neuanfertigung ?? null,
    });
    const g = gespeichertVon.get(z.id);
    const eigene = g?.length
      ? g.map((p) => ({
          bezeichnung: p.bezeichnung,
          menge: p.menge,
          einheit: p.einheit as PositionEinheit,
          einzelpreisCent: p.einzelpreisCent,
          rabatt: p.rabattArt && p.rabattWert ? { art: p.rabattArt, wert: p.rabattWert } : null,
        }))
      : null;
    const positionen = eigene ?? v;
    const datum = leistungsdatum({
      status: z.status,
      lieferart: z.lieferart,
      approvedAt: z.approvedAt,
      freigegebenAm: freigabeVon.get(z.id) ?? null,
      lieferscheinAm: lieferscheinVon.get(z.id) ?? null,
      deliveredAt: z.deliveredAt,
    });
    return {
      orderId: z.id,
      orderNo: z.orderNo,
      practiceId: z.practiceId,
      behandlung: z.behandlung ?? 'Auftrag',
      status: z.status,
      lieferart: z.lieferart,
      leistungsdatum: datum,
      monat: datum ? monatVon(datum) : null,
      vorschlag: v,
      gespeichert: eigene,
      positionen,
      summe: summe(positionen),
      patientencode: z.patientencode,
      rechnung: rechnungen.get(z.id) ?? null,
    };
  });
}

/**
 * سفارش‌هایی که روی یک Rechnung معتبر آمده‌اند: Rechnung‌ای که Gutschrift کامل (`storno`) ندارد.
 * بعد از Storno سفارش دوباره «noch nicht verrechnet» است و می‌شود درست فاکتورش کرد.
 */
export async function verrechnet(orderIds: string[]): Promise<Map<string, { invoiceId: string; nummer: string; am: Date }>> {
  if (!orderIds.length) return new Map();
  const storniert = alias(invoices, 'storno');
  const zeilen = await db()
    .selectDistinct({ orderId: invoiceLines.orderId, invoiceId: invoices.id, nummer: invoices.nummer, am: invoices.ausgestelltAm })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .leftJoin(storniert, and(eq(storniert.bezugId, invoices.id), eq(storniert.storno, true)))
    .where(and(eq(invoices.art, 'rechnung'), inArray(invoiceLines.orderId, orderIds), isNull(storniert.id)));
  return new Map(zeilen.filter((z) => z.orderId).map((z) => [z.orderId!, { invoiceId: z.invoiceId, nummer: z.nummer, am: z.am }]));
}

export type MonatsGruppe = { monat: string; faelle: Fall[]; cent: number; ohnePreis: number };

const nachMonat = (liste: Fall[]): MonatsGruppe[] => {
  const m = new Map<string, Fall[]>();
  for (const f of liste) if (f.monat) m.set(f.monat, [...(m.get(f.monat) ?? []), f]);
  return [...m.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monat, fs]) => ({
      monat,
      faelle: fs.sort((a, b) => (a.leistungsdatum?.getTime() ?? 0) - (b.leistungsdatum?.getTime() ?? 0)),
      cent: fs.reduce((s, f) => s + f.summe.cent, 0),
      ohnePreis: fs.filter((f) => f.summe.preisFehlt).length,
    }));
};

/** «Konto» یک Ordination: کارهای انجام‌شده‌ای که هنوز فاکتور نشده‌اند، ماه‌به‌ماه، و تعداد کارهای در جریان. */
export async function konto(practiceId: string) {
  const alle = await faelle({ practiceId });
  const offen = alle.filter((f) => f.leistungsdatum && !f.rechnung);
  return {
    gruppen: nachMonat(offen),
    cent: offen.reduce((s, f) => s + f.summe.cent, 0),
    ohnePreis: offen.filter((f) => f.summe.preisFehlt).length,
    inArbeit: alle.filter((f) => !f.leistungsdatum && f.status !== 'storniert').length,
  };
}

/** صفحهٔ کلی «Abrechnung»: برای هر Ordination که کار فاکتورنشده دارد. بیشترین مبلغ اول. */
export async function uebersicht(jetzt = new Date()) {
  const offen = (await faelle()).filter((f) => f.leistungsdatum && !f.rechnung);
  if (!offen.length) return [];
  const ids = [...new Set(offen.map((f) => f.practiceId))];
  const praxen = await db()
    .select({ id: practices.id, name: practices.name, customerNo: practices.customerNo, billingMode: practices.billingMode })
    .from(practices)
    .where(inArray(practices.id, ids));
  const dieserMonat = monatVon(jetzt);
  return praxen
    .map((p) => {
      const fs = offen.filter((f) => f.practiceId === p.id);
      const monate = [...new Set(fs.map((f) => f.monat!))].sort();
      return {
        ...p,
        auftraege: fs.length,
        cent: fs.reduce((s, f) => s + f.summe.cent, 0),
        ohnePreis: fs.filter((f) => f.summe.preisFehlt).length,
        aeltesterMonat: monate[0],
        // ماه‌های تمام‌شده: آمادهٔ Sammelrechnung
        frueher: fs.filter((f) => f.monat! < dieserMonat).length,
      };
    })
    .sort((a, b) => b.cent - a.cent || a.name.localeCompare(b.name));
}

/** وضعیت پرداخت همهٔ Rechnungها (بدون Gutschriftها)، پایهٔ `offenePosten` و `offeneRechnungen`. */
async function rechnungsStaende(heute: string) {
  const [alle, gezahlt] = await Promise.all([
    db()
      .select({
        id: invoices.id,
        practiceId: invoices.practiceId,
        nummer: invoices.nummer,
        art: invoices.art,
        storno: invoices.storno,
        bezugId: invoices.bezugId,
        summeCent: invoices.summeCent,
        ausgestelltAm: invoices.ausgestelltAm,
        faelligAm: invoices.faelligAm,
      })
      .from(invoices),
    db().select({ invoiceId: payments.invoiceId, cent: sql<number>`sum(${payments.betragCent})::int` }).from(payments).groupBy(payments.invoiceId),
  ]);
  const zahlungen = new Map(gezahlt.map((z) => [z.invoiceId, z.cent]));
  return alle
    .filter((x) => x.art === 'rechnung')
    .map((r) => {
      const gs = alle.filter((g) => g.bezugId === r.id);
      const stand = zahlstand(
        { summeCent: r.summeCent, gutschriftenCent: gs.reduce((s, g) => s + g.summeCent, 0), gezahltCent: zahlungen.get(r.id) ?? 0, storniert: gs.some((g) => g.storno), faelligAm: r.faelligAm },
        heute,
      );
      return { ...r, stand };
    });
}

async function praxisNamen(ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; customerNo: string }>();
  const zeilen = await db().select({ id: practices.id, name: practices.name, customerNo: practices.customerNo }).from(practices).where(inArray(practices.id, ids));
  return new Map(zeilen.map((p) => [p.id, p]));
}

/**
 * Ordinationهایی که Rechnung باز یا Guthaben دارند (Spec فاز ۲، بخش 6a، قدم ۳)، برای صفحهٔ کلی «Abrechnung»:
 * اول آن‌هایی که مبلغ سررسیده دارند، بعد بیشترین مانده.
 */
export async function offenePosten(heute = heuteIso()): Promise<(Saldo & { id: string; name: string; customerNo: string })[]> {
  const nachPraxis = new Map<string, { stand: ReturnType<typeof zahlstand>; faelligAm: string | null }[]>();
  for (const r of await rechnungsStaende(heute)) nachPraxis.set(r.practiceId, [...(nachPraxis.get(r.practiceId) ?? []), { stand: r.stand, faelligAm: r.faelligAm }]);
  const salden = [...nachPraxis].map(([id, zeilen]) => ({ id, ...saldoAus(zeilen) })).filter((x) => x.offenCent !== 0);
  if (!salden.length) return [];
  const namen = await praxisNamen(salden.map((x) => x.id));
  return salden
    .map((x) => ({ ...x, name: namen.get(x.id)?.name ?? '–', customerNo: namen.get(x.id)?.customerNo ?? '' }))
    .sort((a, b) => b.ueberfaelligCent - a.ueberfaelligCent || b.offenCent - a.offenCent || a.name.localeCompare(b.name));
}

export type OffeneRechnung = {
  id: string;
  nummer: string;
  practiceId: string;
  praxis: string;
  customerNo: string;
  ausgestelltAm: string;
  faelligAm: string | null;
  summeCent: number;
  gezahltCent: number;
  offenCent: number;
  ueberfaellig: boolean;
};

/**
 * Rechnungهایی که هنوز مبلغی از آن‌ها باز است، هر Rechnung یک ردیف، برای «Zahlung buchen» در تب «Offen»
 * (پول که در بانک آمد، از روی شمارهٔ Verwendungszweck). قدیمی‌ترین سررسید اول.
 */
export async function offeneRechnungen(heute = heuteIso()): Promise<OffeneRechnung[]> {
  const offen = (await rechnungsStaende(heute)).filter((r) => r.stand.status !== 'storniert' && r.stand.offenCent > 0);
  const namen = await praxisNamen([...new Set(offen.map((r) => r.practiceId))]);
  return offen
    .map((r) => ({
      id: r.id,
      nummer: r.nummer,
      practiceId: r.practiceId,
      praxis: namen.get(r.practiceId)?.name ?? '–',
      customerNo: namen.get(r.practiceId)?.customerNo ?? '',
      ausgestelltAm: heuteIso(r.ausgestelltAm),
      faelligAm: r.faelligAm,
      summeCent: r.summeCent,
      gezahltCent: r.stand.gezahltCent,
      offenCent: r.stand.offenCent,
      ueberfaellig: r.stand.ueberfaellig,
    }))
    .sort((a, b) => (a.faelligAm ?? '9999').localeCompare(b.faelligAm ?? '9999') || a.nummer.localeCompare(b.nummer));
}
