'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { practices, practiceUsers } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { sichererPfad } from '@/lib/auth/guard';
import { attrappePruefen, passwortPruefen } from '@/lib/auth/passwords';
import { versuchErlaubt, versucheZuruecksetzen } from '@/lib/auth/rate-limit';
import { anfrageInfo, sitzungAnlegen } from '@/lib/auth/sessions';

export type FormZustand = { fehler?: string } | null;

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Bitte geben Sie eine gültige E-Mail-Adresse ein.'),
  passwort: z.string().min(1, 'Bitte geben Sie Ihr Passwort ein.'),
  weiter: z.string().optional(),
});

/**
 * ورود Ordinationها: ایمیل و رمز (2FA برای پورتال اختیاری است و بعداً در تنظیمات
 * پورتال روشن می‌شود). همان محدودیت تلاش کارکنان: ۵ بار در ۱۵ دقیقه.
 */
export async function portalAnmelden(_: FormZustand, form: FormData): Promise<FormZustand> {
  const r = schema.safeParse(Object.fromEntries(form));
  if (!r.success) return { fehler: r.error.issues[0].message };
  const { email, passwort, weiter } = r.data;
  const { ip } = await anfrageInfo();

  const erlaubt = (await versuchErlaubt(`portal-anmeldung:${email}`, 5, 900)) && (await versuchErlaubt(`portal-anmeldung-ip:${ip ?? '-'}`, 30, 900));
  if (!erlaubt) return { fehler: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' };

  const [z1] = await db()
    .select({ u: practiceUsers, praxisAktiv: practices.isActive })
    .from(practiceUsers)
    .innerJoin(practices, eq(practices.id, practiceUsers.practiceId))
    .where(eq(practiceUsers.email, email))
    .limit(1);
  const u = z1?.u;
  const ok = u?.passwordHash && u.isActive && z1.praxisAktiv ? await passwortPruefen(passwort, u.passwordHash) : await attrappePruefen(passwort);
  if (!u || !ok) {
    await logAudit({ aktion: 'anmeldung_fehlgeschlagen', akteur: { kind: 'system', label: email }, details: { bereich: 'portal' }, ip });
    return { fehler: 'E-Mail-Adresse oder Passwort ist nicht korrekt.' };
  }
  if (u.totpEnabled) {
    // تا صفحهٔ تنظیمات 2FA پورتال ساخته نشده، هیچ حسابی این را روشن ندارد
    return { fehler: 'Die Zwei-Faktor-Anmeldung für das Portal ist noch nicht verfügbar. Bitte wenden Sie sich an lab@drpishan.at.' };
  }

  await versucheZuruecksetzen(`portal-anmeldung:${email}`);
  await sitzungAnlegen('practice', u.id);
  await db().update(practiceUsers).set({ lastLoginAt: new Date() }).where(eq(practiceUsers.id, u.id));
  await logAudit({ aktion: 'anmeldung', akteur: { kind: 'practice', id: u.id, label: u.name }, ip });
  redirect(sichererPfad(weiter));
}
