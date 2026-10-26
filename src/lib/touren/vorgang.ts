import 'server-only';
import { and, asc, eq, inArray, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { STAFF_ROLLEN, orderMessages, orders, orderSteps, pickupRequests, practices, staffUsers, tours, workTypes } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { darf } from '@/lib/auth/roles';
import { AppError } from '@/lib/errors';
import { heuteIso } from '@/lib/format';
import { statusWechseln } from '@/lib/orders/status';
import { istIsoDatum, plusTage, tageText, tagKurz, wochentag } from './plan';

/**
 * کارهای تور (Spec فاز ۱، بخش I): «Zugestellt»، «Abgeholt»، «Einplanen»، درخواست Abholung از پورتال،
 * و ساختن و ویرایش تورها. راننده فقط توقف‌های تورهای خودش را تمام می‌کند؛ Büro هر تور را.
 */

const akteurVon = (b: Bearbeiter) => ({ kind: b.kind, id: b.id, label: b.label });
const uuid = (v: unknown, fehler: string) => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/.test(v)) throw new AppError(fehler);
  return v;
};

/** Büro darf jede Tour; Fahrer nur die eigene. */
async function tourRecht(b: Bearbeiter, tourId: string | null) {
  if (b.seite !== 'labor') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  if (darf(b.rolle, 'touren.bearbeiten')) return;
  if (!tourId || !darf(b.rolle, 'touren.sehen')) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const [t] = await db().select({ fahrer: tours.driverId }).from(tours).where(eq(tours.id, tourId)).limit(1);
  if (t?.fahrer !== b.id) throw new AppError('Dieser Stopp gehört nicht zu Ihrer Tour.');
}

/** «Zugestellt»: alle genannten Arbeiten einer Ordination → »Geliefert« (Übergabe erledigt). */
export async function zustellen(b: Bearbeiter, praxisIdRoh: unknown, orderIdsRoh: unknown, ip: string | null): Promise<number> {
  const praxisId = uuid(praxisIdRoh, 'Ordination nicht gefunden.');
  const ids = z.array(z.uuid()).min(1).max(30).safeParse(orderIdsRoh);
  if (!ids.success) throw new AppError('Keine Arbeit gewählt.');
  const [p] = await db().select({ tourId: practices.tourId }).from(practices).where(eq(practices.id, praxisId)).limit(1);
  if (!p) throw new AppError('Ordination nicht gefunden.');
  await tourRecht(b, p.tourId);

  const zeilen = await db()
    .select({ o: orders, freigabe: workTypes.needsFreigabe })
    .from(orders)
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .where(and(inArray(orders.id, ids.data), eq(orders.practiceId, praxisId)));
  const offen = zeilen.filter(({ o }) => o.status === 'versendet');
  if (!offen.length) throw new AppError('Schon zugestellt. Bitte laden Sie die Seite neu.');
  const jetzt = new Date();
  await db().transaction(async (tx) => {
    for (const { o, freigabe } of offen) {
      await statusWechseln(tx, {
        orderId: o.id,
        von: 'versendet',
        nach: 'geliefert',
        wer: 'labor',
        akteur: { kind: 'staff', id: b.id },
        umstaende: { lieferart: o.deliveryKind, freigabeNoetig: freigabe ?? true },
        felder: { deliveredAt: jetzt },
        ereignis: 'Zugestellt',
      });
      await tx
        .insert(orderSteps)
        .values({ orderId: o.id, stepKey: 'uebergabe', doneAt: jetzt, doneBy: b.id })
        .onConflictDoUpdate({ target: [orderSteps.orderId, orderSteps.stepKey], set: { doneAt: jetzt, doneBy: b.id } });
    }
  });
  for (const { o } of offen) {
    await logAudit({ aktion: 'auftrag_zugestellt', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo }, ip });
  }
  return offen.length;
}

/** «Abgeholt»: Abholung erledigt; hängt sie an einem Auftrag, erscheint es in dessen Kommunikation. */
export async function abgeholt(b: Bearbeiter, idRoh: unknown, ip: string | null) {
  const id = uuid(idRoh, 'Abholung nicht gefunden.');
  const [a] = await db().select().from(pickupRequests).where(eq(pickupRequests.id, id)).limit(1);
  if (!a) throw new AppError('Abholung nicht gefunden.');
  await tourRecht(b, a.tourId);
  const jetzt = new Date();
  await db().transaction(async (tx) => {
    const r = await tx
      .update(pickupRequests)
      .set({ status: 'erledigt', doneAt: jetzt, doneBy: b.id })
      .where(and(eq(pickupRequests.id, id), inArray(pickupRequests.status, ['offen', 'eingeplant'])))
      .returning({ id: pickupRequests.id });
    if (!r.length) throw new AppError('Schon erledigt. Bitte laden Sie die Seite neu.');
    if (a.orderId) {
      await tx.insert(orderMessages).values({ orderId: a.orderId, authorKind: 'system', kind: 'ereignis', body: 'Abgeholt', createdAt: jetzt });
      await tx.update(orders).set({ updatedAt: jetzt }).where(eq(orders.id, a.orderId));
    }
  });
  await logAudit({ aktion: 'abholung_erledigt', akteur: akteurVon(b), ziel: { typ: 'abholung', id }, details: { praxis: a.practiceId }, ip });
}

/** Büro: offene Abholung einer Tour an einem Tourtag zuordnen. */
export async function abholungEinplanen(b: Bearbeiter, idRoh: unknown, tourIdRoh: unknown, datum: unknown, ip: string | null) {
  if (b.seite !== 'labor' || !darf(b.rolle, 'touren.bearbeiten')) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const id = uuid(idRoh, 'Abholung nicht gefunden.');
  const tourId = uuid(tourIdRoh, 'Bitte eine Tour wählen.');
  if (!istIsoDatum(datum)) throw new AppError('Bitte ein gültiges Datum angeben.');
  if (datum < heuteIso()) throw new AppError('Das Datum liegt in der Vergangenheit.');
  const [t] = await db().select().from(tours).where(and(eq(tours.id, tourId), eq(tours.isActive, true))).limit(1);
  if (!t) throw new AppError('Diese Tour gibt es nicht mehr.');
  if (!t.weekdays.includes(wochentag(datum))) throw new AppError(`Die ${t.name} fährt ${tageText(t.weekdays)}, nicht am ${tagKurz(datum)}.`);
  const r = await db()
    .update(pickupRequests)
    .set({ status: 'eingeplant', tourId, plannedDate: datum })
    .where(and(eq(pickupRequests.id, id), inArray(pickupRequests.status, ['offen', 'eingeplant'])))
    .returning({ praxis: pickupRequests.practiceId });
  if (!r.length) throw new AppError('Diese Abholung ist schon erledigt.');
  await logAudit({ aktion: 'abholung_eingeplant', akteur: akteurVon(b), ziel: { typ: 'abholung', id }, details: { tour: t.name, datum }, ip });
}

/* ── Portal ──────────────────────────────────────────────────── */

const anforderung = z.object({
  datum: z.string().refine(istIsoDatum, 'Bitte ein gültiges Datum angeben.'),
  notiz: z.string().trim().max(500, 'Die Notiz ist zu lang.'),
  orderId: z.union([z.literal(''), z.uuid()]),
});

/**
 * «Abholung anfordern» (Ordination). Fährt die Tour der Ordination an diesem Tag, ist sie gleich
 * eingeplant; sonst plant das Büro. `practice_id` kommt immer aus der Sitzung.
 */
export async function abholungAnfordern(b: Bearbeiter, roh: unknown, ip: string | null): Promise<{ geplant: string | null }> {
  if (b.seite !== 'praxis') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const r = anforderung.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { datum, notiz, orderId } = r.data;
  const heute = heuteIso();
  if (datum < heute) throw new AppError('Das Datum liegt in der Vergangenheit.');
  if (datum > plusTage(heute, 60)) throw new AppError('Bitte ein Datum in den nächsten zwei Monaten wählen.');
  if (orderId) {
    const [o] = await db().select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.practiceId, b.practiceId), ne(orders.status, 'entwurf'))).limit(1);
    if (!o) throw new AppError('Auftrag nicht gefunden.');
  }
  const [t] = await db()
    .select({ id: tours.id, tage: tours.weekdays })
    .from(practices)
    .innerJoin(tours, eq(tours.id, practices.tourId))
    .where(and(eq(practices.id, b.practiceId), eq(tours.isActive, true)))
    .limit(1);
  const direkt = t && t.tage.includes(wochentag(datum));
  const [neu] = await db()
    .insert(pickupRequests)
    .values({
      practiceId: b.practiceId,
      orderId: orderId || null,
      desiredDate: datum,
      note: notiz || null,
      status: direkt ? 'eingeplant' : 'offen',
      tourId: direkt ? t.id : null,
      plannedDate: direkt ? datum : null,
      requestedByKind: 'practice',
      requestedById: b.id,
    })
    .returning({ id: pickupRequests.id });
  await logAudit({ aktion: 'abholung_angefordert', akteur: akteurVon(b), ziel: { typ: 'abholung', id: neu.id }, details: { datum, eingeplant: Boolean(direkt) }, ip });
  return { geplant: direkt ? datum : null };
}

export async function abholungZurueckziehen(b: Bearbeiter, idRoh: unknown, ip: string | null) {
  if (b.seite !== 'praxis') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const id = uuid(idRoh, 'Abholung nicht gefunden.');
  const r = await db()
    .update(pickupRequests)
    .set({ status: 'storniert' })
    .where(and(eq(pickupRequests.id, id), eq(pickupRequests.practiceId, b.practiceId), inArray(pickupRequests.status, ['offen', 'eingeplant'])))
    .returning({ id: pickupRequests.id });
  if (!r.length) throw new AppError('Diese Abholung kann nicht mehr zurückgezogen werden.');
  await logAudit({ aktion: 'abholung_zurueckgezogen', akteur: akteurVon(b), ziel: { typ: 'abholung', id }, ip });
}

/* ── Touren verwalten ────────────────────────────────────────── */

/** Wer eine Tour fahren kann: alle mit »Touren« (Inhaber, Büro, Fahrer). */
export const FAHRER_ROLLEN = STAFF_ROLLEN.filter((r) => darf(r, 'touren.sehen'));

export const tourSchema = z.object({
  name: z.string().trim().min(2, 'Bitte einen Namen für die Tour angeben.').max(60, 'Der Name ist zu lang.'),
  tage: z.array(z.coerce.number().int().min(1).max(7)).min(1, 'Bitte mindestens einen Tag wählen.'),
  fahrerId: z.union([z.literal(''), z.uuid()]),
  aktiv: z.boolean(),
});

export async function tourSpeichern(id: string | null, roh: unknown) {
  const r = tourSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { name, tage, fahrerId, aktiv } = r.data;
  if (fahrerId) {
    const [f] = await db()
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, fahrerId), eq(staffUsers.isActive, true), inArray(staffUsers.role, FAHRER_ROLLEN)))
      .limit(1);
    if (!f) throw new AppError('Diese Person kann keine Tour fahren.');
  }
  const werte = { name, weekdays: [...new Set(tage)].sort((a, b) => a - b), driverId: fahrerId || null, isActive: aktiv };
  if (id) {
    const [alt] = await db().select().from(tours).where(eq(tours.id, id)).limit(1);
    if (!alt) throw new AppError('Diese Tour gibt es nicht mehr.');
    await db().update(tours).set(werte).where(eq(tours.id, id));
    return { id, name, alt: { name: alt.name, tage: alt.weekdays, fahrer: alt.driverId, aktiv: alt.isActive }, neu: { name, tage: werte.weekdays, fahrer: werte.driverId, aktiv } };
  }
  const [neu] = await db().insert(tours).values(werte).returning({ id: tours.id });
  return { id: neu.id, name, alt: null, neu: { name, tage: werte.weekdays, fahrer: werte.driverId, aktiv } };
}

/** Ordination in eine Tour aufnehmen (ans Ende) oder herausnehmen (`tourId` leer). */
export async function praxisTourSetzen(praxisId: string, tourId: string | null) {
  if (tourId) {
    const [{ letzte }] = await db().select({ letzte: max(practices.tourPosition) }).from(practices).where(eq(practices.tourId, tourId));
    await db().update(practices).set({ tourId, tourPosition: (letzte ?? 0) + 1, updatedAt: new Date() }).where(eq(practices.id, praxisId));
  } else {
    await db().update(practices).set({ tourId: null, tourPosition: 0, updatedAt: new Date() }).where(eq(practices.id, praxisId));
  }
}

/** Reihenfolge in der Tour: eine Ordination nach oben oder unten. */
export async function praxisVerschieben(tourId: string, praxisId: string, richtung: 'hoch' | 'runter') {
  const liste = await db()
    .select({ id: practices.id })
    .from(practices)
    .where(eq(practices.tourId, tourId))
    .orderBy(asc(practices.tourPosition), asc(practices.name));
  const i = liste.findIndex((p) => p.id === praxisId);
  const j = richtung === 'hoch' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= liste.length) return;
  [liste[i], liste[j]] = [liste[j], liste[i]];
  await db().transaction(async (tx) => {
    for (const [pos, p] of liste.entries()) await tx.update(practices).set({ tourPosition: pos + 1 }).where(eq(practices.id, p.id));
  });
}
