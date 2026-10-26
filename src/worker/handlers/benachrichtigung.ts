import { and, count, desc, eq, gt, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  BENACHRICHTIGUNGEN,
  complaints,
  designRevisions,
  jobs,
  messageReads,
  notificationPrefs,
  orderMessages,
  orders,
  patients,
  practices,
  practiceUsers,
  workTypes,
} from '@/db/schema';
import { benachrichtigungMail, type MailDaten } from '@/lib/benachrichtigungen/texte';
import { config, istProduktion } from '@/lib/config';
import { AppError } from '@/lib/errors';

/**
 * یک اتفاق ← یک `email_senden` برای هر گیرنده (Spec فاز ۱، بخش M). همه‌چیز در لحظهٔ ارسال
 * خوانده می‌شود: تنظیمات Ordination، کاربران فعال پورتال، و برای «Neue Nachricht» اینکه هر
 * کاربر پیام‌ها را هنوز نخوانده باشد. ⚠️ نام بیمار اینجا اصلاً خوانده نمی‌شود.
 */

const payload = z.object({
  ereignis: z.enum(BENACHRICHTIGUNGEN),
  orderId: z.string().uuid(),
  nach: z.string().optional(),
  complaintId: z.string().uuid().optional(),
});

const portal = (pfad: string) => `${istProduktion ? 'https' : 'http'}://${config().PORTAL_HOST}${pfad}`;

async function ungelesenFuer(orderId: string, userId: string): Promise<number> {
  const [z1] = await db()
    .select({ n: count() })
    .from(orderMessages)
    .leftJoin(messageReads, and(eq(messageReads.orderId, orderMessages.orderId), eq(messageReads.readerKind, 'practice'), eq(messageReads.readerId, userId)))
    .where(
      and(
        eq(orderMessages.orderId, orderId),
        eq(orderMessages.authorKind, 'labor'),
        ne(orderMessages.kind, 'ereignis'),
        eq(orderMessages.isInternal, false),
        or(isNull(messageReads.lastReadAt), gt(orderMessages.createdAt, messageReads.lastReadAt)),
      ),
    );
  return z1?.n ?? 0;
}

export async function benachrichtigungSenden(roh: unknown) {
  const r = payload.safeParse(roh);
  if (!r.success) throw new AppError(`Ungültige Benachrichtigung: ${r.error.issues[0]?.message}`);
  const p = r.data;

  const [a] = await db()
    .select({ o: orders, praxis: practices.name, praxisAktiv: practices.isActive, code: patients.code, behandlung: workTypes.name })
    .from(orders)
    .innerJoin(practices, eq(practices.id, orders.practiceId))
    .leftJoin(patients, eq(patients.id, orders.patientId))
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .where(eq(orders.id, p.orderId))
    .limit(1);
  // سفارش در این فاصله پاک شده (مثلاً دادهٔ آزمایشی): چیزی برای فرستادن نیست
  if (!a?.o.orderNo) return { uebersprungen: 'Auftrag nicht gefunden' };
  if (!a.praxisAktiv) return { uebersprungen: 'Ordination deaktiviert' };

  const [pref] = await db()
    .select({ an: notificationPrefs.emailEnabled })
    .from(notificationPrefs)
    .where(and(eq(notificationPrefs.practiceId, a.o.practiceId), eq(notificationPrefs.eventKey, p.ereignis)))
    .limit(1);
  if (pref && !pref.an) return { uebersprungen: 'Von der Ordination abgeschaltet' };

  const empfaenger = await db()
    .select({ id: practiceUsers.id, name: practiceUsers.name, email: practiceUsers.email })
    .from(practiceUsers)
    .where(and(eq(practiceUsers.practiceId, a.o.practiceId), eq(practiceUsers.isActive, true), isNotNull(practiceUsers.passwordHash)));
  if (!empfaenger.length) return { uebersprungen: 'Kein aktiver Portal-Zugang' };

  const basis: Omit<MailDaten, 'an'> = {
    ereignis: p.ereignis,
    orderNo: a.o.orderNo,
    patientCode: a.code,
    behandlung: a.behandlung,
    lieferart: a.o.deliveryKind,
    ordination: a.praxis,
    link: portal(`/auftraege/${a.o.id}`),
    einstellungenLink: portal('/einstellungen'),
    tempo: a.o.tempo,
    nachreichen: p.ereignis === 'auftrag_eingegangen' && p.nach === 'rueckfrage',
    ohneFreigabe: p.ereignis === 'design_freigabe' && p.nach === 'freigegeben',
  };
  if (p.ereignis === 'design_freigabe') {
    const [rev] = await db().select({ nr: designRevisions.revision }).from(designRevisions).where(eq(designRevisions.orderId, a.o.id)).orderBy(desc(designRevisions.revision)).limit(1);
    basis.version = rev?.nr ?? null;
  }
  if (p.ereignis === 'reklamation_entschieden') {
    if (!p.complaintId) throw new AppError('Reklamation fehlt.');
    const [c] = await db()
      .select({ nr: complaints.complaintNo, entscheidung: complaints.decision, kostenlos: complaints.freeOfCharge, neu: orders.orderNo })
      .from(complaints)
      .leftJoin(orders, eq(orders.id, complaints.newOrderId))
      .where(eq(complaints.id, p.complaintId))
      .limit(1);
    if (!c || c.entscheidung === 'offen') return { uebersprungen: 'Reklamation nicht entschieden' };
    basis.reklamation = { nr: c.nr, entscheidung: c.entscheidung, kostenlos: c.kostenlos, neuerAuftrag: c.neu };
  }

  const mails: (typeof jobs.$inferInsert)[] = [];
  for (const u of empfaenger) {
    let ungelesen: number | undefined;
    if (p.ereignis === 'neue_nachricht') {
      ungelesen = await ungelesenFuer(a.o.id, u.id);
      // در پورتال خوانده شده: ایمیل لازم نیست
      if (!ungelesen) continue;
    }
    const m = benachrichtigungMail({ ...basis, an: u.name, ungelesen });
    mails.push({ type: 'email_senden', payload: { an: u.email, betreff: m.betreff, text: m.text, html: m.html } });
  }
  if (mails.length) await db().insert(jobs).values(mails);
  return { ereignis: p.ereignis, empfaenger: mails.length };
}
