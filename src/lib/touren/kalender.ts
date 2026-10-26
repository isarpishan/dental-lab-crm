import 'server-only';
import { and, asc, eq, gte, inArray, lte, ne, notInArray, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { orders, patients, pickupRequests, practices, tours, workTypes } from '@/db/schema';
import { heuteIso } from '@/lib/format';
import { tempoRang, type Tempo } from '@/lib/katalog/tempo';
import { plusTage, wochentag } from './plan';

/**
 * داده‌های تقویم (Spec فاز ۱، بخش I): Liefertermin (یا Wunschtermin وقتی هنوز Liefertermin نیست)،
 * Abholungen و روزهای تور، برای بازهٔ `von` تا `bis`. فقط کد بیمار.
 */

export type Termin = {
  art: 'liefertermin' | 'wunschtermin';
  orderId: string;
  orderNo: string;
  patientCode: string | null;
  behandlung: string;
  praxis: string;
  tempo: Tempo;
  erledigt: boolean;
  ueberfaellig: boolean;
};
export type KalenderAbholung = { id: string; praxis: string; status: 'offen' | 'eingeplant' | 'erledigt'; tour: string | null; orderNo: string | null };
export type KalenderTag = { termine: Termin[]; abholungen: KalenderAbholung[]; touren: string[] };

export type KalenderFilter = { ordination: string; behandlung: string };

const ERLEDIGT = new Set(['geliefert', 'abgeschlossen']);

export async function kalender(von: string, bis: string, f: KalenderFilter): Promise<Map<string, KalenderTag>> {
  const tag = sql<string>`coalesce(${orders.dueDate}, ${orders.desiredDate})::text`;
  const bedingungen: SQL[] = [notInArray(orders.status, ['entwurf', 'storniert']), sql`coalesce(${orders.dueDate}, ${orders.desiredDate}) between ${von} and ${bis}`];
  const praxisFilter = /^[0-9a-f-]{36}$/.test(f.ordination) ? f.ordination : null;
  if (praxisFilter) bedingungen.push(eq(orders.practiceId, praxisFilter));
  if (f.behandlung) bedingungen.push(eq(orders.workTypeKey, f.behandlung));

  const [termine, abholungen, alleTouren] = await Promise.all([
    db()
      .select({ o: orders, tag, code: patients.code, behandlung: workTypes.name, praxis: practices.name })
      .from(orders)
      .leftJoin(patients, eq(patients.id, orders.patientId))
      .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .leftJoin(practices, eq(practices.id, orders.practiceId))
      .where(and(...bedingungen))
      .orderBy(asc(orders.orderNo)),
    f.behandlung
      ? Promise.resolve([])
      : db()
          .select({ a: pickupRequests, praxis: practices.name, tour: tours.name, nr: orders.orderNo })
          .from(pickupRequests)
          .innerJoin(practices, eq(practices.id, pickupRequests.practiceId))
          .leftJoin(tours, eq(tours.id, pickupRequests.tourId))
          .leftJoin(orders, eq(orders.id, pickupRequests.orderId))
          .where(
            and(
              ne(pickupRequests.status, 'storniert'),
              gte(sql`coalesce(${pickupRequests.plannedDate}, ${pickupRequests.desiredDate})`, von),
              lte(sql`coalesce(${pickupRequests.plannedDate}, ${pickupRequests.desiredDate})`, bis),
              praxisFilter ? eq(pickupRequests.practiceId, praxisFilter) : undefined,
            ),
          ),
    praxisFilter
      ? db().select({ name: tours.name, tage: tours.weekdays }).from(tours).innerJoin(practices, eq(practices.tourId, tours.id)).where(and(eq(tours.isActive, true), eq(practices.id, praxisFilter)))
      : db().select({ name: tours.name, tage: tours.weekdays }).from(tours).where(eq(tours.isActive, true)).orderBy(asc(tours.name)),
  ]);

  const heute = heuteIso();
  const tage = new Map<string, KalenderTag>();
  const holen = (d: string) => {
    let t = tage.get(d);
    if (!t) tage.set(d, (t = { termine: [], abholungen: [], touren: [] }));
    return t;
  };
  for (let d = von; d <= bis; d = plusTage(d, 1)) {
    const touren = alleTouren.filter((t) => t.tage.includes(wochentag(d))).map((t) => t.name);
    if (touren.length) holen(d).touren = touren;
  }
  for (const z of termine) {
    const erledigt = ERLEDIGT.has(z.o.status) || (z.o.status === 'freigegeben' && z.o.deliveryKind === 'design');
    holen(z.tag).termine.push({
      art: z.o.dueDate ? 'liefertermin' : 'wunschtermin',
      orderId: z.o.id,
      orderNo: z.o.orderNo ?? '–',
      patientCode: z.code,
      behandlung: z.behandlung ?? '–',
      praxis: z.praxis ?? '–',
      tempo: z.o.tempo ?? 'standard',
      erledigt,
      ueberfaellig: !erledigt && z.tag < heute,
    });
  }
  // Same-Day zuerst, dann Express
  for (const t of tage.values()) t.termine.sort((a, b) => tempoRang(b.tempo) - tempoRang(a.tempo));
  for (const z of abholungen) {
    holen(z.a.plannedDate ?? z.a.desiredDate).abholungen.push({
      id: z.a.id,
      praxis: z.praxis,
      status: z.a.status as KalenderAbholung['status'],
      tour: z.tour,
      orderNo: z.nr,
    });
  }
  return tage;
}

/** Ordinationen mit Tour, für Filter und Formulare. */
export async function praxenMitTour(ids?: string[]) {
  return db()
    .select({ id: practices.id, name: practices.name, tourId: practices.tourId })
    .from(practices)
    .where(and(eq(practices.isActive, true), ids ? inArray(practices.id, ids) : undefined))
    .orderBy(asc(practices.name));
}
