import 'server-only';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { BENACHRICHTIGUNGEN, notificationPrefs, practiceUsers, type Benachrichtigung } from '@/db/schema';
import { logAudit, type Akteur } from '@/lib/audit';
import { mitStandard } from './regeln';

/**
 * تنظیمات اعلان هر Ordination (Spec فاز ۱، بخش M): کدام ایمیل‌ها برود. یک بار برای کل
 * Ordination، و ایمیل به همهٔ کاربران فعال پورتال آن می‌رود. در پورتال فقط Praxis-Admin
 * تغییرش می‌دهد؛ در پنل داخلی کسی که `stammdaten.bearbeiten` دارد (مثلاً وقتی Ordination زنگ می‌زند).
 */

export type Einstellungen = Record<Benachrichtigung, boolean>;

export async function einstellungenVon(practiceId: string): Promise<Einstellungen> {
  const zeilen = await db()
    .select({ eventKey: notificationPrefs.eventKey, emailEnabled: notificationPrefs.emailEnabled })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.practiceId, practiceId));
  return mitStandard(zeilen, BENACHRICHTIGUNGEN);
}

/** کسانی که الان ایمیل می‌گیرند: کاربران فعال پورتال که رمزشان را ساخته‌اند. */
export async function empfaengerVon(practiceId: string) {
  return db()
    .select({ name: practiceUsers.name, email: practiceUsers.email })
    .from(practiceUsers)
    .where(and(eq(practiceUsers.practiceId, practiceId), eq(practiceUsers.isActive, true), isNotNull(practiceUsers.passwordHash)))
    .orderBy(asc(practiceUsers.name));
}

/** از فرم: هر رویداد تیک‌خورده «روشن» است، بقیه «خاموش». */
export function ausFormular(form: FormData): Einstellungen {
  const an = new Set(form.getAll('an').map(String));
  return Object.fromEntries(BENACHRICHTIGUNGEN.map((k) => [k, an.has(k)])) as Einstellungen;
}

/** فقط تغییرها ذخیره و ثبت می‌شوند. برمی‌گرداند چند رویداد عوض شد. */
export async function einstellungenSpeichern(practiceId: string, neu: Einstellungen, akteur: Akteur, ip: string | null): Promise<number> {
  const alt = await einstellungenVon(practiceId);
  const geaendert = BENACHRICHTIGUNGEN.filter((k) => alt[k] !== neu[k]);
  if (!geaendert.length) return 0;
  const jetzt = new Date();
  await db()
    .insert(notificationPrefs)
    .values(geaendert.map((k) => ({ practiceId, eventKey: k, emailEnabled: neu[k], updatedAt: jetzt })))
    .onConflictDoUpdate({
      target: [notificationPrefs.practiceId, notificationPrefs.eventKey],
      set: { emailEnabled: sql`excluded.email_enabled`, updatedAt: jetzt },
    });
  await logAudit({
    aktion: 'benachrichtigungen_geaendert',
    akteur,
    ziel: { typ: 'practice', id: practiceId },
    details: Object.fromEntries(geaendert.map((k) => [k, { von: alt[k], zu: neu[k] }])),
    ip,
  });
  return geaendert.length;
}
