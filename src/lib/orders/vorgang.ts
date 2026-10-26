import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { orderFiles, orderMessages, orders, orderStatusHistory, patients, workTypes } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { entschluesseln } from '@/lib/crypto';
import { ABLAGE_NAMEN, istAblage } from '@/lib/dateien/regeln';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { AppError } from '@/lib/errors';
import { DATEI_NAMEN, type DateiPlatz } from './form-schema';
import { auftragFuer } from './entwurf';
import { istStatus, statusWechseln, uebergangErlaubt, type Status } from './status';

/**
 * کارهایی روی سفارش ارسال‌شده در قدم ۶ (Spec فاز ۱، بخش F): «Auftrag stornieren»،
 * «Daten nachreichen» و «Name anzeigen» در پنل داخلی. Freigabe و Änderungswunsch در قدم ۷.
 */

const akteurVon = (b: Bearbeiter) => ({ kind: b.kind, id: b.id, label: b.label });

async function gesendetOderFehler(b: Bearbeiter, orderId: string) {
  const o = await auftragFuer(b, orderId);
  if (!o || o.status === 'entwurf') throw new AppError('Auftrag nicht gefunden.');
  const [wt] = o.workTypeKey ? await db().select({ freigabe: workTypes.needsFreigabe, pflicht: workTypes.requiredFiles }).from(workTypes).where(eq(workTypes.key, o.workTypeKey)).limit(1) : [];
  return { o, umstaende: { lieferart: o.deliveryKind, freigabeNoetig: wt?.freigabe ?? true }, pflicht: (wt?.pflicht ?? []) as DateiPlatz[] };
}

const grundSchema = z.string().trim().min(3, 'Bitte kurz den Grund angeben.').max(500, 'Der Grund ist zu lang.');

/** Storno: Ordination bis zur Planung, das Labor bis zur Lieferung (Tabelle in `status.ts`). */
export async function stornieren(b: Bearbeiter, orderId: string, grundRoh: unknown, ip: string | null) {
  const grund = grundSchema.safeParse(grundRoh);
  if (!grund.success) throw new AppError(grund.error.issues[0].message);
  const { o, umstaende } = await gesendetOderFehler(b, orderId);
  if (!uebergangErlaubt(o.status as Status, 'storniert', b.seite, umstaende)) {
    throw new AppError(b.seite === 'praxis' ? 'Der Auftrag ist schon in Produktion. Bitte schreiben Sie uns eine Nachricht.' : 'Dieser Auftrag kann nicht mehr storniert werden.');
  }
  await db().transaction((tx) =>
    statusWechseln(tx, {
      orderId: o.id,
      von: o.status as Status,
      nach: 'storniert',
      wer: b.seite,
      akteur: { kind: b.kind, id: b.id },
      umstaende,
      felder: { canceledAt: new Date(), cancelReason: grund.data },
      ereignis: `Auftrag storniert (${b.seite === 'praxis' ? 'von der Ordination' : 'vom Labor'}): ${grund.data}`,
    }),
  );
  await logAudit({ aktion: 'auftrag_storniert', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, grund: grund.data }, ip });
}

/** وضعیت پیش از آخرین Rückfrage؛ اگر سفارش مستقیم با Rückfrage آمد: «eingereicht». */
async function statusVorRueckfrage(orderId: string): Promise<Status> {
  const verlauf = await db().select({ status: orderStatusHistory.status }).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, orderId)).orderBy(asc(orderStatusHistory.at));
  const i = verlauf.map((v) => v.status).lastIndexOf('rueckfrage');
  const davor = i > 0 ? verlauf[i - 1].status : null;
  return davor && istStatus(davor) && davor !== 'entwurf' && uebergangErlaubt('rueckfrage', davor, 'labor', { lieferart: null, freigabeNoetig: true }) ? davor : 'eingereicht';
}

/**
 * «Daten nachreichen»: Dateien, die seit der Rückfrage hochgeladen wurden, und/oder eine Antwort.
 * Danach geht der Auftrag dorthin zurück, wo er vor der Rückfrage war.
 */
export async function datenNachreichen(b: Bearbeiter, orderId: string, textRoh: unknown, ip: string | null) {
  const text = typeof textRoh === 'string' ? textRoh.trim().slice(0, 5000) : '';
  const { o, umstaende, pflicht } = await gesendetOderFehler(b, orderId);
  if (o.status !== 'rueckfrage') throw new AppError('Für diesen Auftrag fehlen keine Daten.');

  const [seit] = await db()
    .select({ at: orderStatusHistory.at })
    .from(orderStatusHistory)
    .where(and(eq(orderStatusHistory.orderId, o.id), eq(orderStatusHistory.status, 'rueckfrage')))
    .orderBy(asc(orderStatusHistory.at))
    .then((z) => z.slice(-1));
  const alle = await db()
    .select({ slot: orderFiles.slot, am: orderFiles.createdAt })
    .from(orderFiles)
    .where(and(eq(orderFiles.orderId, o.id), isNull(orderFiles.deletedAt)));
  const neu = alle.filter((f) => !seit || f.am > seit.at);
  const fehlend = pflicht.filter((p) => !alle.some((f) => f.slot === p));
  if (!neu.length && !text) throw new AppError('Bitte laden Sie die fehlenden Dateien hoch oder schreiben Sie eine Antwort.');
  if (fehlend.length && !text) {
    throw new AppError(`Es fehlen noch: ${fehlend.map((p) => DATEI_NAMEN[p]).join(', ')}. Bitte hochladen oder in der Antwort erklären.`);
  }

  const nach = await statusVorRueckfrage(o.id);
  const plaetze = [...new Set(neu.flatMap((f) => (f.slot && istAblage(f.slot) && f.slot !== 'nachricht' ? [ABLAGE_NAMEN[f.slot]] : [])))];
  await db().transaction(async (tx) => {
    if (text) await tx.insert(orderMessages).values({ orderId: o.id, authorKind: b.seite, authorId: b.id, kind: 'nachricht', body: text });
    await statusWechseln(tx, {
      orderId: o.id,
      von: 'rueckfrage',
      nach,
      wer: b.seite,
      akteur: { kind: b.kind, id: b.id },
      umstaende,
      ereignis: plaetze.length ? `Daten nachgereicht: ${plaetze.join(', ')}` : 'Rückfrage beantwortet',
    });
  });
  await logAudit({ aktion: 'daten_nachgereicht', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, dateien: neu.length, status: nach }, ip });
}

/** «Name anzeigen» im Labor: nur auf Klick, jedes Mal im Data-Access-Log. */
export async function patientenNameZeigen(b: Bearbeiter, orderId: string, ip: string | null): Promise<string> {
  const o = await auftragFuer(b, orderId);
  if (!o?.patientId) throw new AppError('Patient nicht gefunden.');
  const [p] = await db().select().from(patients).where(eq(patients.id, o.patientId)).limit(1);
  if (!p) throw new AppError('Patient nicht gefunden.');
  await zugriffProtokollieren({ akteur: b, aktion: 'entschluesseln', patientIds: [p.id], orderId: o.id, ip });
  const geburt = p.birthDateEnc ? entschluesseln(p.birthDateEnc).split('-').reverse().join('.') : null;
  return `${entschluesseln(p.firstNameEnc)} ${entschluesseln(p.lastNameEnc)}${geburt ? ` · geb. ${geburt}` : ''}`;
}


/* ── Labor: Status, Rückfrage, Liefertermin (Schritt 7) ─────────── */

/**
 * Einfache Schritte des Labors, ohne eigene Eingabe. Seit Schritt 8 laufen Planung, Produktion,
 * Einprobe, Fertig, Versand und Lieferung über die Produktionsschritte (`lib/produktion/vorgang.ts`);
 * hier bleibt nur »Abschließen«. Design senden, Rückfrage und Storno haben eigene Formulare.
 */
export const LABOR_SCHRITTE: Partial<Record<Status, string>> = {
  abgeschlossen: 'Abschließen',
};

export async function laborSchritt(b: Bearbeiter, orderId: string, nachRoh: unknown, ip: string | null) {
  if (b.seite !== 'labor') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  if (typeof nachRoh !== 'string' || !istStatus(nachRoh) || !(nachRoh in LABOR_SCHRITTE)) throw new AppError('Unbekannter Schritt.');
  const nach = nachRoh;
  const { o, umstaende } = await gesendetOderFehler(b, orderId);
  if (!uebergangErlaubt(o.status as Status, nach, 'labor', umstaende)) throw new AppError('Dieser Schritt ist für diesen Auftrag gerade nicht möglich.');
  await db().transaction((tx) =>
    statusWechseln(tx, {
      orderId: o.id,
      von: o.status as Status,
      nach,
      wer: 'labor',
      akteur: { kind: b.kind, id: b.id },
      umstaende,
    }),
  );
  await logAudit({ aktion: 'status_geaendert', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, von: o.status, nach }, ip });
}

const rueckfrageSchema = z.object({
  text: z.string().trim().min(3, 'Bitte die Rückfrage kurz beschreiben.').max(5000, 'Der Text ist zu lang.'),
  fehlend: z.array(z.string()).max(10),
});

/** «Rückfrage stellen»: vor der Produktion; die Frage geht als Nachricht an die Ordination. */
export async function rueckfrageStellen(b: Bearbeiter, orderId: string, roh: unknown, ip: string | null) {
  if (b.seite !== 'labor') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const r = rueckfrageSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { o, umstaende } = await gesendetOderFehler(b, orderId);
  if (!uebergangErlaubt(o.status as Status, 'rueckfrage', 'labor', umstaende)) throw new AppError('Eine Rückfrage ist in diesem Status nicht möglich.');
  const fehlend = r.data.fehlend.filter((p): p is DateiPlatz => p in DATEI_NAMEN).map((p) => DATEI_NAMEN[p]);
  const text = fehlend.length ? `${r.data.text}\n\nBitte nachreichen: ${fehlend.join(', ')}` : r.data.text;
  await db().transaction(async (tx) => {
    await tx.insert(orderMessages).values({ orderId: o.id, authorKind: 'labor', authorId: b.id, kind: 'nachricht', body: text });
    await statusWechseln(tx, { orderId: o.id, von: o.status as Status, nach: 'rueckfrage', wer: 'labor', akteur: { kind: b.kind, id: b.id }, umstaende, ereignis: 'Rückfrage vom Labor' });
  });
  await logAudit({ aktion: 'rueckfrage_gestellt', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo }, ip });
}

/** Liefertermin (vom Labor zugesagt); die Ordination sieht ihn in Liste und Auftrag. */
export async function lieferterminSetzen(b: Bearbeiter, orderId: string, datumRoh: unknown, ip: string | null) {
  if (b.seite !== 'labor') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const datum = typeof datumRoh === 'string' && datumRoh ? datumRoh : null;
  if (datum && (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(datum)))) throw new AppError('Bitte ein gültiges Datum angeben.');
  const { o } = await gesendetOderFehler(b, orderId);
  if (['storniert', 'abgeschlossen', 'geliefert'].includes(o.status)) throw new AppError('Für diesen Auftrag ist kein Liefertermin mehr nötig.');
  await db().transaction(async (tx) => {
    await tx.update(orders).set({ dueDate: datum, updatedAt: new Date() }).where(eq(orders.id, o.id));
    await tx.insert(orderMessages).values({
      orderId: o.id,
      authorKind: 'system',
      kind: 'ereignis',
      body: datum ? `Liefertermin: ${datum.split('-').reverse().join('.')}` : 'Liefertermin entfernt',
    });
  });
  await logAudit({ aktion: 'liefertermin_geaendert', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, von: o.dueDate, zu: datum }, ip });
}
