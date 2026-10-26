import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { oneTimeTokens, type UserArt } from '@/db/schema';
import { config, istProduktion } from '@/lib/config';
import { sha256, zufallsToken } from '@/lib/crypto';

/**
 * لینک یک‌بارمصرف برای ساختن رمز و 2FA. لینک قبلی همان کاربر با ساختن لینک
 * تازه باطل می‌شود. در دیتابیس فقط hash توکن است.
 */
export const EINLADUNG_STUNDEN = 72;

export async function einladungErstellen(kind: UserArt, userId: string): Promise<string> {
  const d = db();
  await d
    .update(oneTimeTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(oneTimeTokens.userKind, kind), eq(oneTimeTokens.userId, userId), isNull(oneTimeTokens.usedAt)));
  const token = zufallsToken();
  await d.insert(oneTimeTokens).values({
    tokenHash: sha256(token),
    purpose: 'einladung',
    userKind: kind,
    userId,
    expiresAt: new Date(Date.now() + EINLADUNG_STUNDEN * 3600_000),
  });
  return token;
}

export async function einladungFinden(token: string) {
  const [zeile] = await db()
    .select()
    .from(oneTimeTokens)
    .where(and(eq(oneTimeTokens.tokenHash, sha256(token)), isNull(oneTimeTokens.usedAt), gt(oneTimeTokens.expiresAt, new Date())))
    .limit(1);
  return zeile ?? null;
}

export function einladungsLink(kind: UserArt, token: string): string {
  const host = kind === 'staff' ? config().CRM_HOST : config().PORTAL_HOST;
  return `${istProduktion ? 'https' : 'http'}://${host}/einladung/${token}`;
}
