import 'server-only';
import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { designRevisions, messageFiles, orderFeedback, orderFiles, orderMessages, orders, workTypes } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { entschluesseln } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { aenderungSchema, aenderungText } from './aenderung';
import { auftragFuer, DESIGN_STATUS, type DateiInfo } from './entwurf';
import { statusWechseln, type Status } from './status';

/**
 * Design-Freigabe (Spec فاز ۱، بخش G):
 * ۱. لابراتوار فایل‌های طرح را بالا می‌برد و «Zur Freigabe senden» می‌زند ← نسخهٔ تازه، وضعیت «design_freigabe».
 * ۲. Ordination طرح را در 3D می‌بیند و یا «Freigeben & herunterladen» (نام، زمان سرور، IP؛ فقط یک بار)،
 *    یا «Änderung anfordern» (پیام «aenderung» با شمارهٔ نسخه ← «in_ueberarbeitung»).
 * ۳. دانلود فایل طرح تا Freigabe در سرور قفل است (`designDownloadErlaubt`).
 * Behandlungهای بدون Freigabe: نسخه خودکار «freigegeben» و سفارش مستقیم جلو می‌رود.
 */

export type RevisionsStatus = 'offen' | 'freigegeben' | 'aenderung' | 'ersetzt';
export const REVISIONS_NAMEN: Record<RevisionsStatus, string> = {
  offen: 'Zur Freigabe',
  freigegeben: 'Freigegeben',
  aenderung: 'Änderung angefordert',
  ersetzt: 'Ersetzt',
};

export type DesignVersion = {
  id: string;
  revision: number;
  status: RevisionsStatus;
  notiz: string | null;
  hochgeladen: Date;
  entschieden: { am: Date; name: string | null } | null;
  aenderung: string | null;
  dateien: DateiInfo[];
};

export type DesignStand = {
  aktuell: DesignVersion | null;
  frueher: DesignVersion[];
  /** im Labor hochgeladen, noch nicht gesendet */
  ausstehend: DateiInfo[];
};

const akteurVon = (b: Bearbeiter) => ({ kind: b.kind, id: b.id, label: b.label });

/** Versionen und Dateien des Designs. Die Ordination bekommt keine ausstehenden (noch nicht gesendeten) Dateien. */
export async function designVon(b: Bearbeiter, orderId: string): Promise<DesignStand> {
  const [versionen, dateien] = await Promise.all([
    db()
      .select({ r: designRevisions, aenderung: orderMessages.body })
      .from(designRevisions)
      .leftJoin(orderMessages, eq(orderMessages.id, designRevisions.changeMessageId))
      .where(eq(designRevisions.orderId, orderId))
      .orderBy(desc(designRevisions.revision)),
    db()
      .select()
      .from(orderFiles)
      .where(and(eq(orderFiles.orderId, orderId), eq(orderFiles.kind, 'design'), isNull(orderFiles.deletedAt))),
  ]);
  const info = (f: typeof orderFiles.$inferSelect): DateiInfo => ({ id: f.id, platz: 'design', name: entschluesseln(f.filenameEnc), groesse: f.size });
  const liste = versionen.map(({ r, aenderung }) => ({
    id: r.id,
    revision: r.revision,
    status: r.status,
    notiz: r.note,
    hochgeladen: r.uploadedAt,
    entschieden: r.decidedAt ? { am: r.decidedAt, name: r.decidedName } : null,
    aenderung,
    dateien: dateien.filter((f) => f.designRevision === r.revision).map(info),
  }));
  return {
    aktuell: liste[0] ?? null,
    frueher: liste.slice(1),
    ausstehend: b.seite === 'labor' ? dateien.filter((f) => f.designRevision === null).map(info) : [],
  };
}

/**
 * Darf die Ordination diese Design-Datei laden? `ansicht` (3D-Vorschau): jede gesendete Datei der
 * neuesten Version. Herunterladen: nur nach der Freigabe dieser Version.
 */
export async function designDownloadErlaubt(f: { orderId: string; designRevision: number | null }, ansicht: boolean): Promise<boolean> {
  if (f.designRevision === null) return false;
  const [r] = await db()
    .select({ status: designRevisions.status, revision: designRevisions.revision })
    .from(designRevisions)
    .where(and(eq(designRevisions.orderId, f.orderId), eq(designRevisions.revision, f.designRevision)))
    .limit(1);
  if (!r) return false;
  if (r.status === 'freigegeben') return true;
  if (!ansicht) return false;
  const [neueste] = await db().select({ n: max(designRevisions.revision) }).from(designRevisions).where(eq(designRevisions.orderId, f.orderId));
  return r.status !== 'ersetzt' && neueste?.n === r.revision;
}

async function umstaendeVon(o: typeof orders.$inferSelect) {
  const [wt] = o.workTypeKey ? await db().select({ freigabe: workTypes.needsFreigabe }).from(workTypes).where(eq(workTypes.key, o.workTypeKey)).limit(1) : [];
  return { lieferart: o.deliveryKind, freigabeNoetig: wt?.freigabe ?? true };
}

/* ── Labor: Design senden ─────────────────────────────────────── */

export async function designSenden(b: Bearbeiter, orderId: string, notizRoh: unknown, ip: string | null) {
  if (b.seite !== 'labor') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const notiz = typeof notizRoh === 'string' ? notizRoh.trim().slice(0, 2000) : '';
  const o = await auftragFuer(b, orderId);
  if (!o || o.status === 'entwurf') throw new AppError('Auftrag nicht gefunden.');
  if (!DESIGN_STATUS.includes(o.status)) throw new AppError('In diesem Status kann kein Design gesendet werden.');
  const umstaende = await umstaendeVon(o);

  const n = await db().transaction(async (tx) => {
    const ausstehend = await tx
      .select({ id: orderFiles.id })
      .from(orderFiles)
      .where(and(eq(orderFiles.orderId, o.id), eq(orderFiles.kind, 'design'), isNull(orderFiles.designRevision), isNull(orderFiles.deletedAt)));
    if (!ausstehend.length) throw new AppError('Bitte zuerst die Design-Dateien hochladen.');
    const [{ letzte }] = await tx.select({ letzte: max(designRevisions.revision) }).from(designRevisions).where(eq(designRevisions.orderId, o.id));
    const revision = (letzte ?? 0) + 1;
    const jetzt = new Date();
    // eine noch offene Version wird durch die neue ersetzt
    await tx
      .update(designRevisions)
      .set({ status: 'ersetzt' })
      .where(and(eq(designRevisions.orderId, o.id), eq(designRevisions.status, 'offen')));
    await tx.insert(designRevisions).values({
      orderId: o.id,
      revision,
      note: notiz || null,
      uploadedBy: b.id,
      uploadedAt: jetzt,
      ...(umstaende.freigabeNoetig ? {} : { status: 'freigegeben' as const, decidedAt: jetzt, decidedName: 'ohne Freigabe (Behandlung)' }),
    });
    await tx
      .update(orderFiles)
      .set({ designRevision: revision })
      .where(inArray(orderFiles.id, ausstehend.map((f) => f.id)));
    if (notiz) await tx.insert(orderMessages).values({ orderId: o.id, authorKind: 'labor', authorId: b.id, kind: 'nachricht', body: notiz, designRevision: revision, createdAt: jetzt });

    let status = o.status as Status;
    const akteur = { kind: b.kind, id: b.id };
    if (status === 'eingereicht') {
      await statusWechseln(tx, { orderId: o.id, von: 'eingereicht', nach: 'in_planung', wer: 'labor', akteur, umstaende });
      status = 'in_planung';
    }
    if (status === 'design_freigabe') {
      await tx.insert(orderMessages).values({ orderId: o.id, authorKind: 'system', kind: 'ereignis', body: `Design Version ${revision} hochgeladen (ersetzt Version ${revision - 1})`, designRevision: revision });
      await tx.update(orders).set({ updatedAt: jetzt }).where(eq(orders.id, o.id));
    } else if (umstaende.freigabeNoetig) {
      await statusWechseln(tx, { orderId: o.id, von: status, nach: 'design_freigabe', wer: 'labor', akteur, umstaende, ereignis: `Design Version ${revision} zur Freigabe bereit` });
    } else {
      const nach = umstaende.lieferart === 'design' ? 'freigegeben' : 'in_produktion';
      await statusWechseln(tx, { orderId: o.id, von: status, nach, wer: 'labor', akteur, umstaende, ereignis: `Design Version ${revision} fertig`, felder: { approvedAt: jetzt } });
    }
    return revision;
  });
  await logAudit({ aktion: 'design_hochgeladen', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, version: n }, ip });
}

/* ── Ordination: Freigabe, Änderung, Feedback ─────────────────── */

const freigabeSchema = z.object({
  revisionId: z.uuid(),
  name: z.string().trim().min(2, 'Bitte Ihren Namen angeben.').max(120, 'Der Name ist zu lang.'),
  geprueft: z.literal(true, { error: 'Bitte bestätigen Sie, dass Sie das Design geprüft haben.' }),
});

/** Zieladresse für den Download nach der Freigabe: eine Datei direkt, mehrere als ZIP. */
async function downloadZiel(orderId: string, revision: number): Promise<string> {
  const dateien = await db()
    .select({ id: orderFiles.id })
    .from(orderFiles)
    .where(and(eq(orderFiles.orderId, orderId), eq(orderFiles.kind, 'design'), eq(orderFiles.designRevision, revision), isNull(orderFiles.deletedAt)));
  return dateien.length === 1 ? `/api/dateien/${dateien[0].id}` : `/api/auftraege/${orderId}/design?version=${revision}`;
}

/**
 * «Freigeben & herunterladen». Doppelklick: das zweite `UPDATE … WHERE status = 'offen'` ändert
 * nichts; dann gilt die erste Entscheidung und derselbe Download kommt zurück.
 */
export async function freigeben(b: Bearbeiter, orderId: string, roh: unknown, ip: string | null): Promise<{ download: string }> {
  if (b.seite !== 'praxis') throw new AppError('Die Freigabe gibt die Ordination.');
  const r = freigabeSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const o = await auftragFuer(b, orderId);
  if (!o) throw new AppError('Auftrag nicht gefunden.');
  const [rev] = await db()
    .select()
    .from(designRevisions)
    .where(and(eq(designRevisions.id, r.data.revisionId), eq(designRevisions.orderId, o.id)))
    .limit(1);
  if (!rev) throw new AppError('Design nicht gefunden.');
  if (rev.status === 'freigegeben') return { download: await downloadZiel(o.id, rev.revision) };
  if (rev.status !== 'offen' || o.status !== 'design_freigabe') throw new AppError('Diese Version kann nicht mehr freigegeben werden. Bitte laden Sie die Seite neu.');
  const umstaende = await umstaendeVon(o);

  const erledigt = await db().transaction(async (tx) => {
    const jetzt = new Date();
    const geaendert = await tx
      .update(designRevisions)
      .set({ status: 'freigegeben', decidedAt: jetzt, decidedBy: b.id, decidedName: r.data.name, decidedIp: ip })
      .where(and(eq(designRevisions.id, rev.id), eq(designRevisions.status, 'offen')))
      .returning({ id: designRevisions.id });
    if (!geaendert.length) return false;
    await statusWechseln(tx, {
      orderId: o.id,
      von: 'design_freigabe',
      nach: umstaende.lieferart === 'design' ? 'freigegeben' : 'in_produktion',
      wer: 'praxis',
      akteur: { kind: b.kind, id: b.id },
      umstaende,
      felder: { approvedAt: jetzt },
      ereignis: `Design Version ${rev.revision} freigegeben von ${r.data.name}`,
    });
    return true;
  });
  if (erledigt) {
    await logAudit({ aktion: 'design_freigegeben', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, version: rev.revision, name: r.data.name }, ip });
  }
  return { download: await downloadZiel(o.id, rev.revision) };
}

/**
 * «Änderung anfordern» (vor der Freigabe) oder «Überarbeitung anfordern» (»Nur Design« nach der
 * Freigabe). Ergebnis: Nachricht »Änderungswunsch · Version N« in der Kommunikation.
 */
export async function aenderungAnfordern(b: Bearbeiter, orderId: string, revisionId: unknown, roh: unknown, ip: string | null) {
  if (b.seite !== 'praxis') throw new AppError('Änderungen fordert die Ordination an.');
  const r = aenderungSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const o = await auftragFuer(b, orderId);
  if (!o) throw new AppError('Auftrag nicht gefunden.');
  const [rev] =
    typeof revisionId === 'string' && z.uuid().safeParse(revisionId).success
      ? await db()
          .select()
          .from(designRevisions)
          .where(and(eq(designRevisions.id, revisionId), eq(designRevisions.orderId, o.id)))
          .limit(1)
      : [];
  if (!rev) throw new AppError('Design nicht gefunden.');
  const nachFreigabe = o.status === 'freigegeben' && o.deliveryKind === 'design' && rev.status === 'freigegeben';
  if (!(o.status === 'design_freigabe' && rev.status === 'offen') && !nachFreigabe) {
    throw new AppError('Für diese Version ist keine Änderung mehr möglich. Bitte laden Sie die Seite neu.');
  }
  const { dateiIds } = r.data;
  const anhaenge = dateiIds.length
    ? await db()
        .select({ id: orderFiles.id })
        .from(orderFiles)
        .leftJoin(messageFiles, eq(messageFiles.fileId, orderFiles.id))
        .where(
          and(
            inArray(orderFiles.id, dateiIds),
            eq(orderFiles.orderId, o.id),
            eq(orderFiles.slot, 'nachricht'),
            eq(orderFiles.uploadedById, b.id),
            isNull(messageFiles.fileId),
          ),
        )
    : [];
  if (anhaenge.length !== dateiIds.length) throw new AppError('Ein Anhang konnte nicht zugeordnet werden. Bitte erneut hochladen.');
  const umstaende = await umstaendeVon(o);

  await db().transaction(async (tx) => {
    const jetzt = new Date();
    const [m] = await tx
      .insert(orderMessages)
      .values({ orderId: o.id, authorKind: 'praxis', authorId: b.id, kind: 'aenderung', body: aenderungText(r.data), designRevision: rev.revision, createdAt: jetzt })
      .returning({ id: orderMessages.id });
    if (anhaenge.length) await tx.insert(messageFiles).values(anhaenge.map((a) => ({ messageId: m.id, fileId: a.id })));
    const geaendert = await tx
      .update(designRevisions)
      .set(nachFreigabe ? { changeMessageId: m.id } : { status: 'aenderung', decidedAt: jetzt, decidedBy: b.id, decidedName: b.label, decidedIp: ip, changeMessageId: m.id })
      .where(and(eq(designRevisions.id, rev.id), eq(designRevisions.status, rev.status)))
      .returning({ id: designRevisions.id });
    if (!geaendert.length) throw new AppError('Diese Version wurde inzwischen entschieden. Bitte laden Sie die Seite neu.');
    await statusWechseln(tx, {
      orderId: o.id,
      von: o.status as Status,
      nach: 'in_ueberarbeitung',
      wer: 'praxis',
      akteur: { kind: b.kind, id: b.id },
      umstaende,
      ereignis: `${nachFreigabe ? 'Überarbeitung' : 'Änderung'} angefordert (Version ${rev.revision})`,
    });
  });
  await logAudit({ aktion: 'aenderung_angefordert', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, version: rev.revision }, ip });
}

const feedbackSchema = z
  .object({ bewertung: z.enum(['up', 'down']), kommentar: z.string().trim().max(1000, 'Der Text ist zu lang.') })
  .refine((f) => f.bewertung === 'up' || f.kommentar.length >= 3, { message: 'Bitte sagen Sie uns kurz, was nicht gepasst hat.' });

/** «Wie gefällt Ihnen das Design?» – einmal pro Auftrag, nach der Freigabe. */
export async function feedbackGeben(b: Bearbeiter, orderId: string, roh: unknown) {
  if (b.seite !== 'praxis') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  const r = feedbackSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const o = await auftragFuer(b, orderId);
  if (!o || !o.approvedAt) throw new AppError('Feedback ist nach der Freigabe möglich.');
  await db()
    .insert(orderFeedback)
    .values({ orderId: o.id, rating: r.data.bewertung, comment: r.data.kommentar || null, createdBy: b.id })
    .onConflictDoNothing();
}

export async function feedbackVon(orderId: string) {
  const [f] = await db().select().from(orderFeedback).where(eq(orderFeedback.orderId, orderId)).limit(1);
  return f ? { bewertung: f.rating, kommentar: f.comment } : null;
}

