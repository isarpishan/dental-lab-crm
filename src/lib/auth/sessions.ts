import 'server-only';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { db } from '@/db/client';
import { practiceAgreements, practices, practiceUsers, sessions, staffUsers, type UserArt } from '@/db/schema';
import { istProduktion } from '@/lib/config';
import { sha256, zufallsToken } from '@/lib/crypto';
import { VEREINBARUNG_VERSION } from '@/lib/vereinbarung/text';

/**
 * نشست‌ها در دیتابیس (نه کوکی امضاشدهٔ بی‌حالت مثل آرکان)، تا غیرفعال‌کردن
 * کاربر یعنی بستن فوری همهٔ نشست‌هایش. کوکی فقط یک توکن تصادفی است و در
 * دیتابیس فقط hash آن. هر host کوکی جدای خودش را دارد (بدون Domain).
 */
export const COOKIE: Record<UserArt, string> = { staff: 'ddl_intern', practice: 'ddl_portal' };
const DAUER_MS: Record<UserArt, number> = { staff: 12 * 3600_000, practice: 30 * 24 * 3600_000 };

export async function anfrageInfo() {
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;
  return { ip, userAgent: h.get('user-agent')?.slice(0, 300) ?? null };
}

export async function sitzungAnlegen(kind: UserArt, userId: string) {
  const token = zufallsToken();
  const ablauf = new Date(Date.now() + DAUER_MS[kind]);
  const { ip, userAgent } = await anfrageInfo();
  await db().insert(sessions).values({ tokenHash: sha256(token), userKind: kind, userId, expiresAt: ablauf, ip, userAgent });
  (await cookies()).set(COOKIE[kind], token, {
    httpOnly: true,
    secure: istProduktion,
    sameSite: 'lax',
    path: '/',
    expires: ablauf,
  });
}

export type StaffSitzung = { sitzungId: string; user: typeof staffUsers.$inferSelect };

/** نشست فعلی کارکنان، یا null. در هر درخواست فقط یک بار از دیتابیس خوانده می‌شود. */
export const aktuellerMitarbeiter = cache(async (): Promise<StaffSitzung | null> => {
  const token = (await cookies()).get(COOKIE.staff)?.value;
  if (!token) return null;
  const [zeile] = await db()
    .select({ sitzungId: sessions.id, user: staffUsers })
    .from(sessions)
    .innerJoin(staffUsers, eq(staffUsers.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        eq(sessions.userKind, 'staff'),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(staffUsers.isActive, true),
      ),
    )
    .limit(1);
  return zeile ?? null;
});

export type PraxisSitzung = {
  sitzungId: string;
  user: typeof practiceUsers.$inferSelect;
  praxis: Pick<typeof practices.$inferSelect, 'id' | 'name' | 'customerNo'>;
  /** Ordination نسخهٔ فعلی Vereinbarung را پذیرفته است (`lib/vereinbarung/`). */
  vereinbarung: boolean;
};

/**
 * نشست فعلی پورتال، **حتی اگر Ordination هنوز Vereinbarung را نپذیرفته باشد**. فقط برای صفحهٔ
 * Vereinbarung، خروج و صفحهٔ ورود؛ بقیه‌جا `aktuellerPraxisNutzer`. Ordination هم باید فعال باشد:
 * با غیرفعال‌کردن Ordination، همهٔ کاربرانش فوراً بیرون می‌افتند. `praxis.id` تنها منبع
 * `practice_id` در پورتال است (CLAUDE.md، قانون ۳)، نه ورودی فرم.
 */
export const praxisSitzung = cache(async (): Promise<PraxisSitzung | null> => {
  const token = (await cookies()).get(COOKIE.practice)?.value;
  if (!token) return null;
  const [zeile] = await db()
    .select({
      sitzungId: sessions.id,
      user: practiceUsers,
      praxis: { id: practices.id, name: practices.name, customerNo: practices.customerNo },
      vereinbarung: sql<boolean>`exists (select 1 from ${practiceAgreements} where ${practiceAgreements.practiceId} = ${practices.id} and ${practiceAgreements.version} = ${VEREINBARUNG_VERSION})`,
    })
    .from(sessions)
    .innerJoin(practiceUsers, eq(practiceUsers.id, sessions.userId))
    .innerJoin(practices, eq(practices.id, practiceUsers.practiceId))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        eq(sessions.userKind, 'practice'),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(practiceUsers.isActive, true),
        eq(practices.isActive, true),
      ),
    )
    .limit(1);
  return zeile ?? null;
});

/**
 * نشست پورتال برای همه‌جا (صفحه‌ها، server actionها، route handlerها با `bearbeiterPortal`): تا
 * Ordination نسخهٔ فعلی Vereinbarung را نپذیرفته، null است. پس هیچ سفارش، آپلود یا دانلودی پیش از
 * پذیرش ممکن نیست، حتی اگر کسی مستقیم سراغ API برود.
 */
export const aktuellerPraxisNutzer = cache(async (): Promise<PraxisSitzung | null> => {
  const s = await praxisSitzung();
  return s?.vereinbarung ? s : null;
});

export async function sitzungBeenden(kind: UserArt) {
  const jar = await cookies();
  const token = jar.get(COOKIE[kind])?.value;
  if (token) {
    await db().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
  }
  jar.delete(COOKIE[kind]);
}

/** همهٔ نشست‌های یک کاربر را فوراً می‌بندد (غیرفعال‌سازی، تغییر رمز). */
export async function alleSitzungenBeenden(kind: UserArt, userId: string) {
  await db()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userKind, kind), eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
