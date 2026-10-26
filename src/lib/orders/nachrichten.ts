import 'server-only';
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { messageFiles, messageReads, orderFiles, orderMessages, orders, practiceUsers, staffUsers } from '@/db/schema';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { entschluesseln } from '@/lib/crypto';
import { nachrichtGemeldet } from '@/lib/benachrichtigungen/einreihen';
import { AppError } from '@/lib/errors';
import { auftragFuer } from './entwurf';

/**
 * تب «Kommunikation» (Spec فاز ۱، بخش F): گفت‌وگوی هر سفارش با پیوست، اتفاق‌های سیستم
 * (`ereignis`)، و یادداشت‌های «intern» لابراتوار. **پیام intern در هیچ کوئری پورتال نیست**:
 * فیلتر در خود کوئری است، نه در نمایش (CLAUDE.md، قانون ۳).
 */

export type Anhang = { id: string; name: string; groesse: number };
export type Nachricht = {
  id: string;
  art: 'nachricht' | 'aenderung' | 'reklamation' | 'ereignis';
  von: 'praxis' | 'labor' | 'system';
  autor: string;
  text: string;
  intern: boolean;
  am: Date;
  anhaenge: Anhang[];
  eigene: boolean;
  /** Design-Version, auf die sich die Nachricht bezieht (Änderungswunsch, Notiz zum Design) */
  version: number | null;
};

/** پیام‌هایی که این طرف می‌تواند ببیند. */
function sichtbarFuer(b: Bearbeiter) {
  return b.seite === 'praxis' ? eq(orderMessages.isInternal, false) : undefined;
}

/** پیام‌های «طرف دیگر» که برای این کاربر تازه حساب می‌شوند (نه اتفاق‌های سیستم). */
function vonDerAnderenSeite(b: Bearbeiter) {
  return and(eq(orderMessages.authorKind, b.seite === 'praxis' ? 'labor' : 'praxis'), ne(orderMessages.kind, 'ereignis'), sichtbarFuer(b));
}

export async function nachrichtenVon(b: Bearbeiter, orderId: string): Promise<Nachricht[]> {
  const zeilen = await db()
    .select({
      m: orderMessages,
      praxisName: practiceUsers.name,
      laborName: staffUsers.name,
    })
    .from(orderMessages)
    .leftJoin(practiceUsers, and(eq(orderMessages.authorKind, 'praxis'), eq(practiceUsers.id, orderMessages.authorId)))
    .leftJoin(staffUsers, and(eq(orderMessages.authorKind, 'labor'), eq(staffUsers.id, orderMessages.authorId)))
    .where(and(eq(orderMessages.orderId, orderId), sichtbarFuer(b)))
    .orderBy(asc(orderMessages.createdAt));
  const ids = zeilen.map((z) => z.m.id);
  const anhaenge = ids.length
    ? await db()
        .select({ messageId: messageFiles.messageId, id: orderFiles.id, name: orderFiles.filenameEnc, groesse: orderFiles.size })
        .from(messageFiles)
        .innerJoin(orderFiles, eq(orderFiles.id, messageFiles.fileId))
        .where(and(inArray(messageFiles.messageId, ids), isNull(orderFiles.deletedAt)))
    : [];
  return zeilen.map(({ m, praxisName, laborName }) => ({
    id: m.id,
    art: m.kind,
    von: m.authorKind,
    // die Ordination sieht »Digital Dental Lab«, intern den Namen
    autor: m.authorKind === 'system' ? 'System' : m.authorKind === 'praxis' ? (praxisName ?? 'Ordination') : b.seite === 'praxis' ? 'Digital Dental Lab' : (laborName ?? 'Labor'),
    text: m.body,
    intern: m.isInternal,
    am: m.createdAt,
    anhaenge: anhaenge.filter((a) => a.messageId === m.id).map((a) => ({ id: a.id, name: entschluesseln(a.name), groesse: a.groesse })),
    eigene: m.authorKind === b.seite && m.authorId === b.id,
    version: m.designRevision,
  }));
}

export async function alsGelesenMarkieren(b: Bearbeiter, orderId: string) {
  const jetzt = new Date();
  await db()
    .insert(messageReads)
    .values({ orderId, readerKind: b.kind, readerId: b.id, lastReadAt: jetzt })
    .onConflictDoUpdate({ target: [messageReads.orderId, messageReads.readerKind, messageReads.readerId], set: { lastReadAt: jetzt } });
}

/** تعداد پیام‌های خوانده‌نشده برای هر سفارش (فقط پیام‌های طرف دیگر). */
export async function ungelesen(b: Bearbeiter, orderIds: readonly string[]): Promise<Map<string, number>> {
  if (!orderIds.length) return new Map();
  const zeilen = await db()
    .select({ orderId: orderMessages.orderId, anzahl: sql<number>`count(*)::int` })
    .from(orderMessages)
    .leftJoin(
      messageReads,
      and(eq(messageReads.orderId, orderMessages.orderId), eq(messageReads.readerKind, b.kind), eq(messageReads.readerId, b.id)),
    )
    .where(
      and(
        inArray(orderMessages.orderId, [...orderIds]),
        vonDerAnderenSeite(b),
        or(isNull(messageReads.lastReadAt), gt(orderMessages.createdAt, messageReads.lastReadAt)),
      ),
    )
    .groupBy(orderMessages.orderId);
  return new Map(zeilen.map((z) => [z.orderId, z.anzahl]));
}

const eingabe = z.object({
  text: z.string().trim().max(5000, 'Die Nachricht ist zu lang.'),
  dateiIds: z.array(z.uuid()).max(20),
  intern: z.boolean(),
});

/** پیام تازه، با پیوست‌هایی که همین کاربر برای همین سفارش بالا برده و هنوز به پیامی وصل نیستند. */
export async function nachrichtSenden(b: Bearbeiter, orderId: string, roh: unknown): Promise<void> {
  const r = eingabe.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { text, dateiIds, intern } = r.data;
  if (intern && b.seite !== 'labor') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  if (!text && !dateiIds.length) throw new AppError('Bitte eine Nachricht schreiben oder eine Datei anhängen.');
  const o = await auftragFuer(b, orderId);
  if (!o || o.status === 'entwurf') throw new AppError('Auftrag nicht gefunden.');

  const dateien = dateiIds.length
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
            isNull(orderFiles.deletedAt),
            isNull(messageFiles.fileId),
          ),
        )
    : [];
  if (dateien.length !== dateiIds.length) throw new AppError('Ein Anhang konnte nicht zugeordnet werden. Bitte erneut hochladen.');

  const jetzt = new Date();
  await db().transaction(async (tx) => {
    const [m] = await tx
      .insert(orderMessages)
      .values({ orderId: o.id, authorKind: b.seite, authorId: b.id, kind: 'nachricht', body: text, isInternal: intern, createdAt: jetzt })
      .returning({ id: orderMessages.id });
    if (dateien.length) await tx.insert(messageFiles).values(dateien.map((d) => ({ messageId: m.id, fileId: d.id })));
    await tx.update(orders).set({ updatedAt: jetzt }).where(eq(orders.id, o.id));
    // ایمیل به Ordination (حداکثر یکی در ۱۵ دقیقه برای هر سفارش)؛ یادداشت intern هرگز
    if (b.seite === 'labor' && !intern) await nachrichtGemeldet(tx, o.id);
  });
  await alsGelesenMarkieren(b, o.id);
}

/**
 * آیا Ordination این فایل لابراتوار را می‌تواند بگیرد؟ فقط پیوست پیام غیر intern.
 * (طرح آزادشده بعد از Freigabe در قدم ۷ اضافه می‌شود.)
 */
export async function laborDateiFreiFuerPraxis(fileId: string): Promise<boolean> {
  const [x] = await db()
    .select({ id: messageFiles.fileId })
    .from(messageFiles)
    .innerJoin(orderMessages, eq(orderMessages.id, messageFiles.messageId))
    .where(and(eq(messageFiles.fileId, fileId), eq(orderMessages.isInternal, false)))
    .limit(1);
  return Boolean(x);
}
