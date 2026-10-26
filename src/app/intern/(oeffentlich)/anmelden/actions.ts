'use server';

import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { staffUsers } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { sichererPfad } from '@/lib/auth/guard';
import { attrappePruefen, passwortPruefen } from '@/lib/auth/passwords';
import { versuchErlaubt, versucheZuruecksetzen } from '@/lib/auth/rate-limit';
import { anfrageInfo, sitzungAnlegen } from '@/lib/auth/sessions';
import { totpPruefen } from '@/lib/auth/totp';
import { istProduktion } from '@/lib/config';
import { entschluesseln, signaturPruefen, signieren } from '@/lib/crypto';

export type FormZustand = { fehler?: string } | null;

const ZWEITER_SCHRITT = 'ddl_2fa';
const ZWEITER_SCHRITT_MS = 5 * 60_000;

const anmeldeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Bitte geben Sie eine gültige E-Mail-Adresse ein.'),
  passwort: z.string().min(1, 'Bitte geben Sie Ihr Passwort ein.'),
  weiter: z.string().optional(),
});

/** قدم ۱: ایمیل و رمز. اگر درست بود، کوکی کوتاه‌مدت امضاشده برای قدم ۲ (کد 2FA). */
export async function anmelden(_: FormZustand, form: FormData): Promise<FormZustand> {
  const r = anmeldeSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { fehler: r.error.issues[0].message };
  const { email, passwort, weiter } = r.data;
  const { ip } = await anfrageInfo();

  const erlaubt = (await versuchErlaubt(`anmeldung:${email}`, 5, 900)) && (await versuchErlaubt(`anmeldung-ip:${ip ?? '-'}`, 30, 900));
  if (!erlaubt) return { fehler: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' };

  const [u] = await db().select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
  const ok = u?.passwordHash && u.isActive ? await passwortPruefen(passwort, u.passwordHash) : await attrappePruefen(passwort);
  if (!u || !ok) {
    await logAudit({ aktion: 'anmeldung_fehlgeschlagen', akteur: { kind: 'system', label: email }, ip });
    return { fehler: 'E-Mail-Adresse oder Passwort ist nicht korrekt.' };
  }
  if (!u.totpEnabled || !u.totpSecretEnc) {
    return { fehler: 'Die Zwei-Faktor-Anmeldung ist für dieses Konto noch nicht eingerichtet. Bitte wenden Sie sich an den Inhaber.' };
  }

  (await cookies()).set(ZWEITER_SCHRITT, signieren(`${u.id}|${Date.now() + ZWEITER_SCHRITT_MS}|${sichererPfad(weiter)}`), {
    httpOnly: true,
    secure: istProduktion,
    sameSite: 'lax',
    path: '/',
    maxAge: ZWEITER_SCHRITT_MS / 1000,
  });
  redirect('/anmelden/code');
}

const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Bitte geben Sie den 6-stelligen Code ein.') });

/** قدم ۲: کد شش‌رقمی اپ Authenticator. */
export async function codePruefen(_: FormZustand, form: FormData): Promise<FormZustand> {
  const jar = await cookies();
  const daten = signaturPruefen(jar.get(ZWEITER_SCHRITT)?.value ?? '');
  const [userId, ablauf, weiter] = daten?.split('|') ?? [];
  if (!userId || Number(ablauf) < Date.now()) {
    jar.delete(ZWEITER_SCHRITT);
    redirect('/anmelden?abgelaufen=1');
  }

  const r = codeSchema.safeParse(Object.fromEntries(form));
  if (!r.success) return { fehler: r.error.issues[0].message };
  const { ip } = await anfrageInfo();
  if (!(await versuchErlaubt(`code:${userId}`, 5, 900))) return { fehler: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' };

  const [u] = await db().select().from(staffUsers).where(eq(staffUsers.id, userId)).limit(1);
  if (!u?.isActive || !u.totpSecretEnc || !totpPruefen(entschluesseln(u.totpSecretEnc), r.data.code)) {
    await logAudit({ aktion: 'anmeldung_fehlgeschlagen', akteur: { kind: 'system', label: u?.email ?? userId }, details: { schritt: 'code' }, ip });
    return { fehler: 'Der Code ist nicht korrekt. Bitte nehmen Sie den aktuellen Code aus Ihrer App.' };
  }

  jar.delete(ZWEITER_SCHRITT);
  await versucheZuruecksetzen(`anmeldung:${u.email}`);
  await versucheZuruecksetzen(`code:${u.id}`);
  await sitzungAnlegen('staff', u.id);
  await db().update(staffUsers).set({ lastLoginAt: new Date() }).where(eq(staffUsers.id, u.id));
  await logAudit({ aktion: 'anmeldung', akteur: { kind: 'staff', id: u.id, label: u.name }, ip });
  redirect(sichererPfad(weiter));
}
