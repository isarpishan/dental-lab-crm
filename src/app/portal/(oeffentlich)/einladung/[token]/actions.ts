'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { db } from '@/db/client';
import { oneTimeTokens, practiceUsers } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { einladungFinden } from '@/lib/auth/einladung';
import { passwortHash, passwortRegelVerletzt } from '@/lib/auth/passwords';
import { versuchErlaubt } from '@/lib/auth/rate-limit';
import { alleSitzungenBeenden, anfrageInfo, sitzungAnlegen } from '@/lib/auth/sessions';

export type FormZustand = { fehler?: string } | null;

const schema = z.object({ token: z.string().min(20), passwort: z.string(), passwort2: z.string() });

/** رمز تازه برای Portal-Zugang. لینک مصرف می‌شود و کاربر مستقیم وارد پورتال می‌شود. */
export async function portalZugangEinrichten(_: FormZustand, form: FormData): Promise<FormZustand> {
  const r = schema.safeParse(Object.fromEntries(form));
  if (!r.success) return { fehler: 'Bitte füllen Sie alle Felder aus.' };
  const { token, passwort, passwort2 } = r.data;

  const regel = passwortRegelVerletzt(passwort);
  if (regel) return { fehler: regel };
  if (passwort !== passwort2) return { fehler: 'Die beiden Passwörter stimmen nicht überein.' };

  const einladung = await einladungFinden(token);
  if (!einladung || einladung.userKind !== 'practice') return { fehler: 'Dieser Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.' };
  if (!(await versuchErlaubt(`einrichtung:${einladung.id}`, 10, 900))) return { fehler: 'Zu viele Versuche. Bitte warten Sie 15 Minuten.' };

  const hash = await passwortHash(passwort);
  const nutzer = await db().transaction(async (tx) => {
    // شرط usedAt: با دو کلیک هم‌زمان، لینک فقط یک بار مصرف می‌شود
    const [t] = await tx
      .update(oneTimeTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(oneTimeTokens.id, einladung.id), isNull(oneTimeTokens.usedAt)))
      .returning({ id: oneTimeTokens.id });
    if (!t) return null;
    const [u] = await tx
      .update(practiceUsers)
      .set({ passwordHash: hash, lastLoginAt: new Date() })
      .where(and(eq(practiceUsers.id, einladung.userId), eq(practiceUsers.isActive, true)))
      .returning();
    return u ?? null;
  });
  if (!nutzer) return { fehler: 'Dieser Link wurde bereits verwendet oder der Zugang ist gesperrt.' };

  const { ip } = await anfrageInfo();
  await alleSitzungenBeenden('practice', nutzer.id);
  await sitzungAnlegen('practice', nutzer.id);
  await logAudit({ aktion: 'zugang_eingerichtet', akteur: { kind: 'practice', id: nutzer.id, label: nutzer.name }, ip });
  redirect('/');
}
