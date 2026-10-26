import 'server-only';
import { and, count, countDistinct, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '@/db/client';
import { complaints, orders, patients, practices, workTypes, type Entscheidung, type ReklamationsGrund } from '@/db/schema';
import { ENTSCHEIDUNG_NAMEN, GRUND_NAMEN } from './regeln';

/**
 * خواندن Reklamationها: برای صفحهٔ سفارش (هر دو طرف؛ دسترسی را `auftragDetail` پیش‌تر چک کرده)،
 * برای صفحهٔ «Reklamationen» در پنل داخلی، و برای داشبورد. فقط کد بیمار.
 */

export type ReklamationInfo = {
  id: string;
  nr: string;
  grund: string;
  text: string;
  am: Date;
  vonLabor: boolean;
  garantie: { bis: string | null; gueltig: boolean };
  entscheidung: Entscheidung;
  entscheidungLabel: string;
  notiz: string | null;
  kostenlos: boolean | null;
  neuerAuftrag: { id: string; nr: string } | null;
  entschiedenAm: Date | null;
  repariertAm: Date | null;
  /** das Labor muss noch etwas tun: entscheiden, oder die Reparatur zurückgeben */
  offen: boolean;
};

const neu = alias(orders, 'neu');

/** «Offen» für das Labor: noch nicht entschieden, oder Reparatur noch nicht zurück. */
const offenBedingung = or(eq(complaints.decision, 'offen'), and(eq(complaints.decision, 'reparatur'), isNull(complaints.repairedAt)));

function info(c: typeof complaints.$inferSelect, neuNr: string | null): ReklamationInfo {
  return {
    id: c.id,
    nr: c.complaintNo,
    grund: GRUND_NAMEN[c.reason],
    text: c.description,
    am: c.createdAt,
    vonLabor: c.reportedByKind === 'staff',
    garantie: { bis: c.warrantyUntil, gueltig: c.warrantyValid },
    entscheidung: c.decision,
    entscheidungLabel: c.decision === 'reparatur' && c.repairedAt ? 'Repariert' : ENTSCHEIDUNG_NAMEN[c.decision],
    notiz: c.decisionNote,
    kostenlos: c.freeOfCharge,
    neuerAuftrag: c.newOrderId && neuNr ? { id: c.newOrderId, nr: neuNr } : null,
    entschiedenAm: c.decidedAt,
    repariertAm: c.repairedAt,
    offen: c.decision === 'offen' || (c.decision === 'reparatur' && !c.repairedAt),
  };
}

export async function reklamationenZuAuftrag(orderId: string): Promise<ReklamationInfo[]> {
  const zeilen = await db()
    .select({ c: complaints, neuNr: neu.orderNo })
    .from(complaints)
    .leftJoin(neu, eq(neu.id, complaints.newOrderId))
    .where(eq(complaints.orderId, orderId))
    .orderBy(desc(complaints.createdAt));
  return zeilen.map((z) => info(z.c, z.neuNr));
}

export type ReklamationsFilter = { status: string; ordination: string; behandlung: string; grund: string; suche: string };

export const STATUS_FILTER: { wert: string; label: string }[] = [
  { wert: '', label: 'Offen' },
  { wert: 'alle', label: 'Alle' },
  { wert: 'neuanfertigung', label: 'Neuanfertigung' },
  { wert: 'reparatur', label: 'Reparatur' },
  { wert: 'abgelehnt', label: 'Abgelehnt' },
];

export function reklamationsFilterAus(p: Record<string, string | string[] | undefined>): ReklamationsFilter {
  const t = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).trim().slice(0, 80) : '');
  const status = t('status');
  return { status: STATUS_FILTER.some((s) => s.wert === status) ? status : '', ordination: t('ordination'), behandlung: t('behandlung'), grund: t('grund'), suche: t('suche') };
}

export type ReklamationsZeile = ReklamationInfo & { orderId: string; orderNo: string; patientCode: string | null; behandlung: string; praxis: string };

export async function reklamationsListe(f: ReklamationsFilter): Promise<ReklamationsZeile[]> {
  const bedingungen = [
    f.status === '' ? offenBedingung : f.status === 'alle' ? undefined : eq(complaints.decision, f.status as Entscheidung),
    /^[0-9a-f-]{36}$/.test(f.ordination) ? eq(complaints.practiceId, f.ordination) : undefined,
    f.behandlung ? eq(orders.workTypeKey, f.behandlung) : undefined,
    f.grund && f.grund in GRUND_NAMEN ? eq(complaints.reason, f.grund as ReklamationsGrund) : undefined,
  ];
  const zeilen = await db()
    .select({ c: complaints, neuNr: neu.orderNo, orderNo: orders.orderNo, code: patients.code, behandlung: workTypes.name, praxis: practices.name })
    .from(complaints)
    .innerJoin(orders, eq(orders.id, complaints.orderId))
    .innerJoin(practices, eq(practices.id, complaints.practiceId))
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .leftJoin(patients, eq(patients.id, orders.patientId))
    .leftJoin(neu, eq(neu.id, complaints.newOrderId))
    .where(and(...bedingungen))
    .orderBy(desc(complaints.createdAt))
    .limit(500);
  const suche = f.suche.toLowerCase();
  return zeilen
    .map((z) => ({ ...info(z.c, z.neuNr), orderId: z.c.orderId, orderNo: z.orderNo ?? '–', patientCode: z.code, behandlung: z.behandlung ?? '–', praxis: z.praxis }))
    .filter((z) => !suche || [z.nr, z.orderNo, z.patientCode ?? '', z.neuerAuftrag?.nr ?? ''].some((x) => x.toLowerCase().includes(suche)));
}

/**
 * چند Reklamation برای هر Ordination و هر Behandlung (Spec J)، و روی چند کار: سهم کارهای
 * تحویل‌شدهٔ «Fertige Arbeit» که دست‌کم یک Reklamation داشته‌اند (چند Reklamation روی یک کار یک بار
 * شمرده می‌شود، تا سهم از ۱۰۰٪ بیشتر نشود). از ابتدا، نه فقط با فیلتر.
 */
export async function reklamationsStatistik() {
  const geliefert = and(eq(orders.deliveryKind, 'fertigung'), isNotNull(orders.deliveredAt));
  const [jePraxis, jeBehandlung, praxisGeliefert, behandlungGeliefert] = await Promise.all([
    db()
      .select({ id: complaints.practiceId, name: practices.name, anzahl: count(), arbeiten: countDistinct(complaints.orderId) })
      .from(complaints)
      .innerJoin(practices, eq(practices.id, complaints.practiceId))
      .groupBy(complaints.practiceId, practices.name),
    db()
      .select({ key: workTypes.key, name: workTypes.name, anzahl: count(), arbeiten: countDistinct(complaints.orderId) })
      .from(complaints)
      .innerJoin(orders, eq(orders.id, complaints.orderId))
      .innerJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .groupBy(workTypes.key, workTypes.name),
    db().select({ id: orders.practiceId, n: count() }).from(orders).where(geliefert).groupBy(orders.practiceId),
    db().select({ key: orders.workTypeKey, n: count() }).from(orders).where(geliefert).groupBy(orders.workTypeKey),
  ]);
  const sortiert = <T extends { anzahl: number; name: string }>(l: T[]) => l.sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de'));
  return {
    praxen: sortiert(jePraxis.map((p) => ({ ...p, geliefert: praxisGeliefert.find((g) => g.id === p.id)?.n ?? 0 }))),
    behandlungen: sortiert(jeBehandlung.map((w) => ({ ...w, geliefert: behandlungGeliefert.find((g) => g.key === w.key)?.n ?? 0 }))),
  };
}

export async function offeneReklamationen(): Promise<number> {
  const [r] = await db().select({ n: count() }).from(complaints).where(offenBedingung);
  return r.n;
}
