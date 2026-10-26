'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { oneTimeTokens, staffUsers } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { einladungFinden } from '@/lib/auth/einladung';
import { passwortHash, passwortRegelVerletzt } from '@/lib/auth/passwords';
import { versuchErlaubt } from '@/lib/auth/rate-limit';
import { alleSitzungenBeenden, anfrageInfo, sitzungAnlegen } from '@/lib/auth/sessions';
import { totpPruefen } from '@/lib/auth/totp';
import { entschluesseln } from '@/lib/crypto';

export type FormZustand = { fehler?: string } | null;

const schema = z.object({
  token: z.string().min(20),
  passwort: z.string(),
  passwort2: z.string(),
  code: z.string().trim().regex(/^\d{6}$/, 'Bitte geben Sie den 6-stelligen Code aus der App ein.'),
});

/** رمز تازه + تأیید 2FA. بعد از آن، لینک مصرف شده و کاربر مستقیم وارد می‌شود. */
export async function zugangEinrichten(_: FormZustand, form: FormData): Promise<FormZustand> {
  const r = schema.safeParse(Object.fromEntries(form));
  if (!r.success) return { fehler: r.error.issues[0].message };
  const { token, passwort, passwort2, code } = r.data;

  const regel = passwortRegelVerletzt(passwort);
  if (regel) return { fehler: regel };
  if (passwort !== passwort2) return { fehler: 'Die beiden Passwörter stimmen nicht überein.' };

  const einladung = await einladungFinden(token);
  if (!einladung || einladung.userKind !== 'staff') return { fehler: 'Dieser Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.' };
  if (!(await versuchErlaubt(`einrichtung:${einladung.id}`, 10, 900))) return { fehler: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' };

  const [u] = await db().select().from(staffUsers).where(eq(staffUsers.id, einladung.userId)).limit(1);
  if (!u?.totpSecretEnc) return { fehler: 'Bitte laden Sie die Seite neu und scannen Sie den QR-Code erneut.' };
  if (!totpPruefen(entschluesseln(u.totpSecretEnc), code)) {
    return { fehler: 'Der Code ist nicht korrekt. Prüfen Sie, ob Sie den QR-Code dieser Seite gescannt haben, und nehmen Sie den aktuellen Code.' };
  }

  const hash = await passwortHash(passwort);
  const verbraucht = await db().transaction(async (tx) => {
    // شرط usedAt: با دو کلیک هم‌زمان، لینک فقط یک بار مصرف می‌شود
    const [t] = await tx
      .update(oneTimeTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(oneTimeTokens.id, einladung.id), isNull(oneTimeTokens.usedAt)))
      .returning({ id: oneTimeTokens.id });
    if (!t) return false;
    await tx.update(staffUsers).set({ passwordHash: hash, totpEnabled: true, isActive: true, lastLoginAt: new Date() }).where(eq(staffUsers.id, u.id));
    return true;
  });
  if (!verbraucht) return { fehler: 'Dieser Link wurde bereits verwendet.' };

  const { ip } = await anfrageInfo();
  await alleSitzungenBeenden('staff', u.id);
  await sitzungAnlegen('staff', u.id);
  await logAudit({ aktion: 'zugang_eingerichtet', akteur: { kind: 'staff', id: u.id, label: u.name }, ip });
  redirect('/');
}
