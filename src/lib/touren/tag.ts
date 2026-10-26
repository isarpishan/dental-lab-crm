import 'server-only';
import { and, asc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { orders, pickupRequests, practices, staffUsers, tours, workTypes } from '@/db/schema';
import { heuteIso } from '@/lib/format';
import type { Tempo } from '@/lib/katalog/tempo';
import { naechsterTourTag, wochentag } from './plan';

/**
 * برنامهٔ یک روزِ تورها (Spec فاز ۱، بخش I). توقف‌ها ذخیره نمی‌شوند؛ هر بار حساب می‌شوند:
 * - **Lieferung:** سفارش «Fertige Arbeit» در «Übergabe» (وضعیت `versendet`)، روی **نزدیک‌ترین** روزِ تور
 *   همان Ordination (اگر امروز نرسید، خودکار به روز بعدی تور می‌رود).
 * - **Abholung:** درخواست «eingeplant» برای همین تور و روز؛ عقب‌افتاده‌ها روی نزدیک‌ترین روز.
 * - روزهای گذشته: آنچه همان روز انجام شد (`delivered_at`، `done_at`).
 * ترتیب = ترتیب Ordinationها در تور. راننده هیچ دادهٔ بیماری نمی‌بیند (نه نام، نه کد).
 */

export type Lieferung = { orderId: string; orderNo: string; behandlung: string; tempo: Tempo; erledigt: Date | null };
export type Abholung = { id: string; notiz: string | null; orderNo: string | null; geplant: string | null; gewuenscht: string; erledigt: Date | null; verspaetet: boolean };
export type Stopp = {
  praxis: { id: string; name: string; customerNo: string; adresse: string | null; telefon: string | null; hinweise: string | null };
  lieferungen: Lieferung[];
  abholungen: Abholung[];
};
export type TourTag = { tour: { id: string; name: string; fahrer: string | null; fahrerId: string | null; tage: number[] }; stopps: Stopp[] };

const ADRESSE = (p: { street: string | null; zip: string | null; city: string | null }) => [p.street, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null;

/** «heute» in Wien als SQL-Datum für Zeitstempel */
const wienTag = (spalte: SQL | typeof orders.deliveredAt | typeof pickupRequests.doneAt) => sql`(${spalte} at time zone 'Europe/Vienna')::date`;

export async function tagesplan(datum: string, nurFahrer?: string): Promise<TourTag[]> {
  const heute = heuteIso();
  const alle = await db()
    .select({ t: tours, fahrer: staffUsers.name })
    .from(tours)
    .leftJoin(staffUsers, eq(staffUsers.id, tours.driverId))
    .where(and(eq(tours.isActive, true), nurFahrer ? eq(tours.driverId, nurFahrer) : undefined))
    .orderBy(asc(tours.name));
  const fahren = alle.filter(({ t }) => t.weekdays.includes(wochentag(datum)));
  if (!fahren.length) return [];
  const tourIds = fahren.map(({ t }) => t.id);

  const [praxen, bereit, zugestellt, abholungen] = await Promise.all([
    db()
      .select()
      .from(practices)
      .where(and(inArray(practices.tourId, tourIds), eq(practices.isActive, true)))
      .orderBy(asc(practices.tourPosition), asc(practices.name)),
    // offen: nur für den nächsten Tourtag ab heute
    datum >= heute
      ? db()
          .select({ id: orders.id, nr: orders.orderNo, praxis: orders.practiceId, tempo: orders.tempo, behandlung: workTypes.name })
          .from(orders)
          .innerJoin(practices, eq(practices.id, orders.practiceId))
          .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
          .where(and(eq(orders.status, 'versendet'), eq(orders.deliveryKind, 'fertigung'), inArray(practices.tourId, tourIds)))
          .orderBy(asc(orders.orderNo))
      : Promise.resolve([]),
    db()
      .select({ id: orders.id, nr: orders.orderNo, praxis: orders.practiceId, tempo: orders.tempo, behandlung: workTypes.name, am: orders.deliveredAt })
      .from(orders)
      .innerJoin(practices, eq(practices.id, orders.practiceId))
      .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .where(and(eq(orders.status, 'geliefert'), inArray(practices.tourId, tourIds), sql`${wienTag(orders.deliveredAt)} = ${datum}`))
      .orderBy(asc(orders.orderNo)),
    db()
      .select({ a: pickupRequests, nr: orders.orderNo })
      .from(pickupRequests)
      .leftJoin(orders, eq(orders.id, pickupRequests.orderId))
      .where(
        and(
          inArray(pickupRequests.tourId, tourIds),
          or(
            and(eq(pickupRequests.status, 'eingeplant'), datum >= heute ? lte(pickupRequests.plannedDate, datum) : eq(pickupRequests.plannedDate, datum)),
            and(eq(pickupRequests.status, 'erledigt'), sql`${wienTag(pickupRequests.doneAt)} = ${datum}`),
          ),
        ),
      )
      .orderBy(asc(pickupRequests.createdAt)),
  ]);

  // Abholungen bei Ordinationen, die nicht auf der Route dieser Tour liegen: ans Ende der Route
  const fremdIds = [...new Set(abholungen.filter(({ a }) => !praxen.some((p) => p.id === a.practiceId && p.tourId === a.tourId)).map(({ a }) => a.practiceId))];
  const fremde = fremdIds.length ? await db().select().from(practices).where(inArray(practices.id, fremdIds)).orderBy(asc(practices.name)) : [];

  return fahren.map(({ t, fahrer }) => {
    // gilt dieser Tag als »nächster Tourtag« für offene Arbeiten?
    const naechster = naechsterTourTag(t.weekdays, heute) === datum;
    const route = praxen.filter((p) => p.tourId === t.id);
    const dazu = fremde.filter((p) => !route.some((r) => r.id === p.id) && abholungen.some(({ a }) => a.tourId === t.id && a.practiceId === p.id));
    const stopps: Stopp[] = [...route, ...dazu]
      .map((p) => ({
        praxis: { id: p.id, name: p.name, customerNo: p.customerNo, adresse: ADRESSE(p), telefon: p.phone, hinweise: p.deliveryNotes },
        lieferungen: [
          ...(naechster && p.tourId === t.id ? bereit.filter((o) => o.praxis === p.id).map((o) => ({ orderId: o.id, orderNo: o.nr ?? '–', behandlung: o.behandlung ?? '–', tempo: o.tempo ?? 'standard', erledigt: null })) : []),
          ...zugestellt.filter((o) => o.praxis === p.id && p.tourId === t.id).map((o) => ({ orderId: o.id, orderNo: o.nr ?? '–', behandlung: o.behandlung ?? '–', tempo: o.tempo ?? 'standard', erledigt: o.am })),
        ],
        abholungen: abholungen
          .filter(({ a }) => a.tourId === t.id && a.practiceId === p.id)
          // verspätete Abholungen nur am nächsten Tourtag, nicht an jedem künftigen
          .filter(({ a }) => a.status === 'erledigt' || a.plannedDate === datum || naechster)
          .map(({ a, nr }) => ({
            id: a.id,
            notiz: a.note,
            orderNo: nr,
            geplant: a.plannedDate,
            gewuenscht: a.desiredDate,
            erledigt: a.status === 'erledigt' ? a.doneAt : null,
            verspaetet: a.status === 'eingeplant' && Boolean(a.plannedDate && a.plannedDate < datum),
          })),
      }))
      .filter((s) => s.lieferungen.length || s.abholungen.length);
    return { tour: { id: t.id, name: t.name, fahrer, fahrerId: t.driverId, tage: t.weekdays }, stopps };
  });
}

/** Lieferbereite Arbeiten, deren Ordination keine (aktive) Tour hat: Büro entscheidet (Tour zuordnen, Abholung, Versand). */
export async function ohneTour() {
  return db()
    .select({ orderId: orders.id, orderNo: orders.orderNo, praxis: practices.name, praxisId: practices.id, behandlung: workTypes.name })
    .from(orders)
    .innerJoin(practices, eq(practices.id, orders.practiceId))
    .leftJoin(tours, eq(tours.id, practices.tourId))
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .where(and(eq(orders.status, 'versendet'), eq(orders.deliveryKind, 'fertigung'), or(isNull(practices.tourId), eq(tours.isActive, false))))
    .orderBy(asc(practices.name), asc(orders.orderNo));
}

/** Offene Abholwünsche (noch keiner Tour zugeordnet), mit Vorschlag: Tour der Ordination, erster Tourtag ab Wunschtermin. */
export async function offeneAbholungen() {
  const heute = heuteIso();
  const zeilen = await db()
    .select({ a: pickupRequests, praxis: practices.name, tourId: practices.tourId, tage: tours.weekdays, tourAktiv: tours.isActive, nr: orders.orderNo })
    .from(pickupRequests)
    .innerJoin(practices, eq(practices.id, pickupRequests.practiceId))
    .leftJoin(tours, eq(tours.id, practices.tourId))
    .leftJoin(orders, eq(orders.id, pickupRequests.orderId))
    .where(eq(pickupRequests.status, 'offen'))
    .orderBy(asc(pickupRequests.desiredDate));
  return zeilen.map(({ a, praxis, tourId, tage, tourAktiv, nr }) => {
    const ab = a.desiredDate > heute ? a.desiredDate : heute;
    return {
      id: a.id,
      praxis,
      notiz: a.note,
      orderNo: nr,
      gewuenscht: a.desiredDate,
      vorschlag: tourId && tourAktiv && tage ? { tourId, datum: naechsterTourTag(tage, ab) } : null,
    };
  });
}
