import 'server-only';
import { and, eq, notInArray, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { complaints, documents, invoiceLines, orderFiles, orderMaterials, orders, orderStatusHistory, orderSteps, practices } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { darf } from '@/lib/auth/roles';
import { AppError } from '@/lib/errors';
import { loeschen } from '@/lib/storage';
import type { Status } from './status';

/**
 * «Auftrag löschen» (خواستهٔ کاربر، ۲۶ اکتبر ۲۰۲۶؛ فقط Inhaber): سفارشی که اشتباهی ثبت شده و رویش کاری نشده، کامل پاک
 * می‌شود (با فایل‌ها، پیام‌ها و تاریخچه)، تا فهرست شلوغ نشود. فقط وقتی هیچ ردی از کار نیست: هرگز به Design-Freigabe یا
 * تولید نرسیده، بدون مرحلهٔ تولید، Charge، Lieferschein/Konformitätserklärung، Rechnung و Reklamation، و Neuanfertigung
 * نیست. هر چیز دیگری فقط «Stornieren». شمارهٔ سفارش دوباره داده نمی‌شود؛ در Protokoll می‌ماند.
 */

/** Status, aus denen gelöscht werden darf; und alle Status, die der Auftrag je gehabt haben darf */
const LOESCHBAR: readonly Status[] = ['eingereicht', 'rueckfrage', 'in_planung', 'storniert'];
const NUR_ANFANG = ['entwurf', 'eingereicht', 'rueckfrage', 'in_planung', 'storniert'];

const akteurVon = (b: Bearbeiter) => ({ kind: b.kind, id: b.id, label: b.label });

type Leser = Pick<ReturnType<typeof db>, 'select'>;

/** null = darf gelöscht werden; sonst der Grund, warum nicht (für die Anzeige) */
export async function loeschSperre(q: Leser, o: { id: string; status: string; remakeOfId: string | null }): Promise<string | null> {
  if (!LOESCHBAR.includes(o.status as Status)) return 'Der Auftrag ist schon weiter als in der Planung. Bitte stornieren.';
  if (o.remakeOfId) return 'Dieser Auftrag ist eine Neuanfertigung aus einer Reklamation.';
  const zahl = sql<number>`count(*)::int`;
  const [[verlauf], [schritte], [chargen], [dokumente], [rechnung], [reklamation]] = await Promise.all([
    q.select({ n: zahl }).from(orderStatusHistory).where(and(eq(orderStatusHistory.orderId, o.id), notInArray(orderStatusHistory.status, NUR_ANFANG))),
    q.select({ n: zahl }).from(orderSteps).where(eq(orderSteps.orderId, o.id)),
    q.select({ n: zahl }).from(orderMaterials).where(eq(orderMaterials.orderId, o.id)),
    q.select({ n: zahl }).from(documents).where(eq(documents.orderId, o.id)),
    q.select({ n: zahl }).from(invoiceLines).where(eq(invoiceLines.orderId, o.id)),
    q.select({ n: zahl }).from(complaints).where(or(eq(complaints.orderId, o.id), eq(complaints.newOrderId, o.id))),
  ]);
  if (verlauf.n) return 'Der Auftrag war schon in Design oder Produktion. Bitte stornieren.';
  if (schritte.n || chargen.n) return 'Am Auftrag wurde schon gearbeitet. Bitte stornieren.';
  if (dokumente.n) return 'Zum Auftrag gibt es schon Lieferschein oder Konformitätserklärung.';
  if (rechnung.n) return 'Der Auftrag ist schon in einer Rechnung.';
  if (reklamation.n) return 'Zum Auftrag gibt es eine Reklamation.';
  return null;
}

export async function auftragLoeschen(b: Bearbeiter, orderId: string, ip: string | null): Promise<{ orderNo: string | null }> {
  if (b.seite !== 'labor' || !darf(b.rolle, 'auftraege.loeschen')) throw new AppError('Aufträge löschen darf nur der Inhaber.');
  const weg = await db().transaction(async (tx) => {
    const [o] = await tx
      .select({ id: orders.id, status: orders.status, orderNo: orders.orderNo, remakeOfId: orders.remakeOfId, practiceId: orders.practiceId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update');
    if (!o) throw new AppError('Diesen Auftrag gibt es nicht mehr.');
    const [p] = await tx.select({ name: practices.name }).from(practices).where(eq(practices.id, o.practiceId));
    if (o.status === 'entwurf') throw new AppError('Ein Entwurf wird über »Entwurf verwerfen« gelöscht.');
    const sperre = await loeschSperre(tx, o);
    if (sperre) throw new AppError(sperre);
    const dateien = await tx.select({ key: orderFiles.storageKey }).from(orderFiles).where(eq(orderFiles.orderId, o.id));
    // Zähne, Verlauf, Dateien, Nachrichten, Positionen … hängen mit »on delete cascade« am Auftrag
    await tx.delete(orders).where(eq(orders.id, o.id));
    return { ...o, praxis: p?.name ?? null, dateien: dateien.map((d) => d.key) };
  });
  // der Auftrag ist schon weg; eine Datei, die sich nicht löschen lässt, darf das nicht mehr aufhalten
  for (const key of weg.dateien) await loeschen(key).catch((e) => console.error('Datei des gelöschten Auftrags nicht entfernt:', key, e));
  await logAudit({
    aktion: 'auftrag_geloescht',
    akteur: akteurVon(b),
    ziel: { typ: 'auftrag', id: weg.id },
    details: { auftrag: weg.orderNo, praxis: weg.praxis, status: weg.status, dateien: weg.dateien.length },
    ip,
  });
  return { orderNo: weg.orderNo };
}
