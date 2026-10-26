import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { complaints, messageFiles, orderFiles, orderMessages, orders, orderTeeth, workTypes } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { darf } from '@/lib/auth/roles';
import { benachrichtigen } from '@/lib/benachrichtigungen/einreihen';
import { AppError, istDoppelt } from '@/lib/errors';
import { heuteIso } from '@/lib/format';
import { auftragsnummer, belegnummer, naechsteNummer } from '@/lib/nummern';
import { auftragFuer } from '@/lib/orders/entwurf';
import { statusWechseln } from '@/lib/orders/status';
import { kopieren, loeschen } from '@/lib/storage';
import { entscheidungSchema, entscheidungText, gewaehrleistung, meldungSchema, meldungText, reklamierbar } from './regeln';

/**
 * Reklamation (Spec فاز ۱، بخش J): ثبت توسط Ordination یا Büro، و تصمیم Büro. وضعیت سفارش اصلی
 * عوض نمی‌شود؛ Reklamation کنار سفارش است. Neuanfertigung یک سفارش تازه است که از اول راه
 * («Eingereicht») با همان Behandlung، config، دندان‌ها و اسکن‌ها شروع می‌شود؛ اگر اسکن تازه لازم
 * باشد، لابراتوار مثل همیشه «Rückfrage» می‌فرستد.
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
const akteurVon = (b: Bearbeiter) => ({ kind: b.kind, id: b.id, label: b.label });
const jahrWien = () => Number(heuteIso().slice(0, 4));

export async function reklamationMelden(b: Bearbeiter, orderId: string, roh: unknown, ip: string | null): Promise<{ nr: string }> {
  if (b.seite === 'labor' && !darf(b.rolle, 'auftraege.bearbeiten')) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const r = meldungSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const o = await auftragFuer(b, orderId);
  if (!o || !o.orderNo) throw new AppError('Auftrag nicht gefunden.');
  if (!reklamierbar(o.status, o.deliveryKind)) throw new AppError('Eine Reklamation ist möglich, sobald die fertige Arbeit geliefert ist.');

  const [[wt], zaehne] = await Promise.all([
    db().select({ monate: workTypes.warrantyMonths }).from(workTypes).where(eq(workTypes.key, o.workTypeKey!)).limit(1),
    db().select({ fdi: orderTeeth.fdi }).from(orderTeeth).where(eq(orderTeeth.orderId, o.id)),
  ]);
  if (r.data.zaehne.some((z1) => !zaehne.some((t) => t.fdi === z1))) throw new AppError('Bitte nur Zähne dieses Auftrags wählen.');
  const { dateiIds } = r.data;
  const anhaenge = dateiIds.length
    ? await db()
        .select({ id: orderFiles.id })
        .from(orderFiles)
        .leftJoin(messageFiles, eq(messageFiles.fileId, orderFiles.id))
        .where(and(inArray(orderFiles.id, dateiIds), eq(orderFiles.orderId, o.id), eq(orderFiles.slot, 'nachricht'), eq(orderFiles.uploadedById, b.id), isNull(messageFiles.fileId)))
    : [];
  if (anhaenge.length !== dateiIds.length) throw new AppError('Ein Foto konnte nicht zugeordnet werden. Bitte erneut hochladen.');

  const garantie = gewaehrleistung(o.deliveredAt ? heuteIso(o.deliveredAt) : null, wt?.monate ?? 24, heuteIso());
  let nr: string;
  try {
    nr = await db().transaction(async (tx) => {
      const jahr = jahrWien();
      const nummer = belegnummer('RK', jahr, await naechsteNummer(tx, 'reklamation', jahr));
      const jetzt = new Date();
      const [m] = await tx
        .insert(orderMessages)
        .values({ orderId: o.id, authorKind: b.seite, authorId: b.id, kind: 'reklamation', body: meldungText(nummer, r.data), createdAt: jetzt })
        .returning({ id: orderMessages.id });
      if (anhaenge.length) await tx.insert(messageFiles).values(anhaenge.map((a) => ({ messageId: m.id, fileId: a.id })));
      await tx.insert(complaints).values({
        complaintNo: nummer,
        orderId: o.id,
        practiceId: o.practiceId,
        reportedByKind: b.kind,
        reportedById: b.id,
        reason: r.data.grund,
        description: r.data.text,
        messageId: m.id,
        warrantyUntil: garantie.bis,
        warrantyValid: garantie.gueltig,
        createdAt: jetzt,
      });
      return nummer;
    });
  } catch (e) {
    // nur eine offene Reklamation je Auftrag (Index `complaints_order_offen_uq`)
    if (istDoppelt(e)) throw new AppError('Für diesen Auftrag ist bereits eine Reklamation in Prüfung.');
    throw e;
  }
  await logAudit({
    aktion: 'reklamation_gemeldet',
    akteur: akteurVon(b),
    ziel: { typ: 'auftrag', id: o.id },
    details: { auftrag: o.orderNo, reklamation: nr, grund: r.data.grund, gewaehrleistung: garantie.gueltig },
    ip,
  });
  return { nr };
}

const idSchema = z.uuid();

async function reklamationLaden(id: unknown) {
  if (!idSchema.safeParse(id).success) throw new AppError('Reklamation nicht gefunden.');
  const [z1] = await db()
    .select({ c: complaints, o: orders })
    .from(complaints)
    .innerJoin(orders, eq(orders.id, complaints.orderId))
    .where(eq(complaints.id, id as string))
    .limit(1);
  if (!z1) throw new AppError('Reklamation nicht gefunden.');
  return z1;
}

/**
 * Neuanfertigung: ein neuer Auftrag mit denselben Angaben und Kopien der Scans der Ordination
 * (eigene Dateien, damit Löschen oder Ändern am alten Auftrag den neuen nicht berührt).
 */
async function neuanfertigungAnlegen(tx: Tx, b: Bearbeiter, o: typeof orders.$inferSelect, nr: string, kostenlos: boolean, kopien: string[]) {
  const [wt] = await tx.select({ freigabe: workTypes.needsFreigabe }).from(workTypes).where(eq(workTypes.key, o.workTypeKey!)).limit(1);
  const snapshot = (o.priceSnapshot ?? {}) as Record<string, unknown>;
  const [neu] = await tx
    .insert(orders)
    .values({
      practiceId: o.practiceId,
      dentistId: o.dentistId,
      patientId: o.patientId,
      workTypeKey: o.workTypeKey,
      deliveryKind: 'fertigung',
      config: o.config,
      treatmentPlan: o.treatmentPlan,
      shade: o.shade,
      tempo: 'standard',
      priceSnapshot: { ...snapshot, zuschlag: null, neuanfertigung: { reklamation: nr, kostenlos } },
      source: 'labor',
      remakeOfId: o.id,
      createdByKind: 'staff',
      createdById: b.id,
    })
    .returning({ id: orders.id });
  const jahr = jahrWien();
  const orderNo = auftragsnummer(jahr, await naechsteNummer(tx, 'auftrag', jahr));
  await statusWechseln(tx, {
    orderId: neu.id,
    von: 'entwurf',
    nach: 'eingereicht',
    wer: 'labor',
    akteur: { kind: 'staff', id: b.id },
    umstaende: { lieferart: 'fertigung', freigabeNoetig: wt?.freigabe ?? true },
    felder: { orderNo, submittedAt: new Date() },
    ereignis: `Neuanfertigung zu Auftrag ${o.orderNo} (Reklamation ${nr})`,
    // Ordination شمارهٔ تازه را از ایمیل «Reklamation entschieden» می‌گیرد
    benachrichtigen: false,
  });
  const zaehne = await tx.select().from(orderTeeth).where(eq(orderTeeth.orderId, o.id));
  if (zaehne.length) await tx.insert(orderTeeth).values(zaehne.map((z1) => ({ ...z1, orderId: neu.id })));
  const scans = await tx
    .select()
    .from(orderFiles)
    .where(and(eq(orderFiles.orderId, o.id), eq(orderFiles.origin, 'praxis'), isNull(orderFiles.deletedAt)));
  for (const f of scans.filter((x) => x.slot !== 'nachricht')) {
    const key = await kopieren(f.storageKey);
    kopien.push(key);
    const { id: _alt, orderId: _auftrag, storageKey: _key, createdAt: _am, ...rest } = f;
    await tx.insert(orderFiles).values({ ...rest, orderId: neu.id, storageKey: key });
  }
  return { id: neu.id, orderNo };
}

export async function reklamationEntscheiden(b: Bearbeiter, complaintId: unknown, roh: unknown, ip: string | null): Promise<{ neuerAuftrag: string | null }> {
  if (b.seite !== 'labor' || !darf(b.rolle, 'reklamationen.entscheiden')) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const r = entscheidungSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { c, o } = await reklamationLaden(complaintId);
  if (c.decision !== 'offen') throw new AppError('Diese Reklamation wurde bereits entschieden. Bitte laden Sie die Seite neu.');
  const e = r.data;
  const kostenlos = e.entscheidung === 'neuanfertigung' ? e.kostenlos : null;

  const kopien: string[] = [];
  let neu: { id: string; orderNo: string } | null = null;
  try {
    neu = await db().transaction(async (tx) => {
      const jetzt = new Date();
      const geaendert = await tx
        .update(complaints)
        .set({ decision: e.entscheidung, decisionNote: e.notiz || null, freeOfCharge: kostenlos, decidedAt: jetzt, decidedBy: b.id })
        .where(and(eq(complaints.id, c.id), eq(complaints.decision, 'offen')))
        .returning({ id: complaints.id });
      if (!geaendert.length) throw new AppError('Diese Reklamation wurde bereits entschieden. Bitte laden Sie die Seite neu.');
      const auftrag = e.entscheidung === 'neuanfertigung' ? await neuanfertigungAnlegen(tx, b, o, c.complaintNo, Boolean(kostenlos), kopien) : null;
      if (auftrag) await tx.update(complaints).set({ newOrderId: auftrag.id }).where(eq(complaints.id, c.id));
      await tx.insert(orderMessages).values({
        orderId: o.id,
        authorKind: 'labor',
        authorId: b.id,
        kind: 'reklamation',
        body: entscheidungText(c.complaintNo, e, auftrag?.orderNo ?? null),
        createdAt: jetzt,
      });
      await benachrichtigen(tx, { ereignis: 'reklamation_entschieden', orderId: o.id, complaintId: c.id });
      return auftrag;
    });
  } catch (err) {
    for (const k of kopien) await loeschen(k);
    throw err;
  }
  await logAudit({
    aktion: 'reklamation_entschieden',
    akteur: akteurVon(b),
    ziel: { typ: 'auftrag', id: o.id },
    details: { auftrag: o.orderNo, reklamation: c.complaintNo, entscheidung: e.entscheidung, ...(neu ? { neuerAuftrag: neu.orderNo, kostenlos } : {}) },
    ip,
  });
  return { neuerAuftrag: neu?.id ?? null };
}

/** Reparatur zurück bei der Ordination: die Reklamation ist erledigt. */
export async function reparaturErledigt(b: Bearbeiter, complaintId: unknown, ip: string | null) {
  if (b.seite !== 'labor' || !darf(b.rolle, 'reklamationen.entscheiden')) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const { c, o } = await reklamationLaden(complaintId);
  await db().transaction(async (tx) => {
    const jetzt = new Date();
    const geaendert = await tx
      .update(complaints)
      .set({ repairedAt: jetzt, repairedBy: b.id })
      .where(and(eq(complaints.id, c.id), eq(complaints.decision, 'reparatur'), isNull(complaints.repairedAt)))
      .returning({ id: complaints.id });
    if (!geaendert.length) throw new AppError('Diese Reparatur ist schon als erledigt eingetragen.');
    await tx.insert(orderMessages).values({ orderId: o.id, authorKind: 'system', kind: 'ereignis', body: `Reklamation ${c.complaintNo}: Reparatur erledigt`, createdAt: jetzt });
  });
  await logAudit({ aktion: 'reparatur_erledigt', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, reklamation: c.complaintNo }, ip });
}
