import 'server-only';
import { and, asc, desc, eq, ne, notInArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { orders, pickupRequests, portalStatuses, practices, tours, workTypes } from '@/db/schema';
import { heuteIso } from '@/lib/format';
import { naechsterTourTag, plusTage } from './plan';

/**
 * پورتال: Abholungهای همین Ordination و روزهای تورش. `practiceId` همیشه از نشست می‌آید
 * (CLAUDE.md، قانون ۳).
 */

export type PortalAbholung = { id: string; status: 'offen' | 'eingeplant' | 'erledigt'; gewuenscht: string; geplant: string | null; erledigt: Date | null; notiz: string | null; orderNo: string | null };

export async function abholungenDerPraxis(practiceId: string): Promise<PortalAbholung[]> {
  const zeilen = await db()
    .select({ a: pickupRequests, nr: orders.orderNo })
    .from(pickupRequests)
    .leftJoin(orders, eq(orders.id, pickupRequests.orderId))
    .where(and(eq(pickupRequests.practiceId, practiceId), ne(pickupRequests.status, 'storniert')))
    .orderBy(desc(pickupRequests.createdAt))
    .limit(12);
  return zeilen.map(({ a, nr }) => ({
    id: a.id,
    status: a.status as PortalAbholung['status'],
    gewuenscht: a.desiredDate,
    geplant: a.plannedDate,
    erledigt: a.doneAt,
    notiz: a.note,
    orderNo: nr,
  }));
}

/** Tour der Ordination (falls aktiv) und der Vorschlag für den Abholtag: nächster Tourtag ab morgen. */
export async function tourDerPraxis(practiceId: string): Promise<{ tage: number[]; vorschlag: string }> {
  const [t] = await db()
    .select({ tage: tours.weekdays })
    .from(practices)
    .innerJoin(tours, eq(tours.id, practices.tourId))
    .where(and(eq(practices.id, practiceId), eq(tours.isActive, true)))
    .limit(1);
  const morgen = plusTage(heuteIso(), 1);
  return { tage: t?.tage ?? [], vorschlag: (t && naechsterTourTag(t.tage, morgen)) ?? morgen };
}

/** Aufträge, zu denen etwas abgeholt werden kann (z. B. Einprobe): offen, mit Status. */
export async function auftraegeFuerAbholung(practiceId: string) {
  return db()
    .select({ id: orders.id, nr: orders.orderNo, behandlung: workTypes.name, status: portalStatuses.label })
    .from(orders)
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .leftJoin(portalStatuses, eq(portalStatuses.key, orders.status))
    .where(and(eq(orders.practiceId, practiceId), notInArray(orders.status, ['entwurf', 'storniert', 'abgeschlossen'])))
    .orderBy(asc(orders.orderNo))
    .limit(60);
}

/** Für die Auftragsseite der Ordination: geplanter Tourtag der Lieferung (Status »Versendet«). */
export async function lieferTourTag(practiceId: string): Promise<string | null> {
  const [t] = await db()
    .select({ tage: tours.weekdays })
    .from(practices)
    .innerJoin(tours, eq(tours.id, practices.tourId))
    .where(and(eq(practices.id, practiceId), eq(tours.isActive, true)))
    .limit(1);
  return t ? naechsterTourTag(t.tage, heuteIso()) : null;
}
