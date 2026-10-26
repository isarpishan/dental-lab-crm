import 'server-only';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { scanZugaenge, staffUsers } from '@/db/schema';
import { darf } from '@/lib/auth/roles';
import { sha256, zufallsToken } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { schluesselAusKopf } from './scan-text';

/**
 * «Handy-Scanner»: کلید هر دستگاه برای `api/ausgaben/scan` (Kurzbefehl آیفون). کلید فقط یک کار می‌کند: فرستادن
 * Beleg به «Zu prüfen». با آن هیچ چیزی خوانده نمی‌شود. مثل نشست‌ها فقط sha256 آن در دیتابیس است و کلید فقط
 * همان لحظهٔ ساختن یک بار نشان داده می‌شود. پیشوند `ddls_` فقط برای شناختن کلید است.
 */
const PRAEFIX = 'ddls_';

export async function zugangAnlegen(name: string, userId: string) {
  const schluessel = `${PRAEFIX}${zufallsToken()}`;
  const [neu] = await db().insert(scanZugaenge).values({ name, tokenHash: sha256(schluessel), staffUserId: userId }).returning({ id: scanZugaenge.id });
  return { id: neu.id, schluessel };
}

/** Kopfzeile `Authorization` → Zugang und Mitarbeiter, oder null (gesperrt, Benutzer inaktiv, ohne Recht). */
export async function zugangPruefen(kopf: string | null) {
  const schluessel = schluesselAusKopf(kopf);
  if (!schluessel) return null;
  const [z] = await db()
    .select({ id: scanZugaenge.id, name: scanZugaenge.name, userId: staffUsers.id, userName: staffUsers.name, rolle: staffUsers.role })
    .from(scanZugaenge)
    .innerJoin(staffUsers, eq(staffUsers.id, scanZugaenge.staffUserId))
    .where(and(eq(scanZugaenge.tokenHash, sha256(schluessel)), isNull(scanZugaenge.revokedAt), eq(staffUsers.isActive, true)))
    .limit(1);
  if (!z || !darf(z.rolle, 'ausgaben.verwalten')) return null;
  await db().update(scanZugaenge).set({ lastUsedAt: new Date() }).where(eq(scanZugaenge.id, z.id));
  return z;
}

export async function zugangSperren(id: string) {
  const [z] = await db()
    .update(scanZugaenge)
    .set({ revokedAt: new Date() })
    .where(and(eq(scanZugaenge.id, id), isNull(scanZugaenge.revokedAt)))
    .returning({ id: scanZugaenge.id, name: scanZugaenge.name });
  if (!z) throw new AppError('Dieser Zugang ist schon gesperrt.');
  return z;
}

/** Gesperrten Zugang aus der Liste entfernen (aktive erst sperren). Der Vorgang bleibt im Protokoll. */
export async function zugangEntfernen(id: string) {
  const [z] = await db()
    .delete(scanZugaenge)
    .where(and(eq(scanZugaenge.id, id), isNotNull(scanZugaenge.revokedAt)))
    .returning({ id: scanZugaenge.id, name: scanZugaenge.name });
  if (!z) throw new AppError('Nur gesperrte Zugänge lassen sich entfernen.');
  return z;
}

/** Aktive Zugänge zuerst, dann die gesperrten (zur Nachvollziehbarkeit). */
export async function zugangListe() {
  return db()
    .select({
      id: scanZugaenge.id,
      name: scanZugaenge.name,
      von: staffUsers.name,
      angelegt: scanZugaenge.createdAt,
      zuletzt: scanZugaenge.lastUsedAt,
      gesperrt: scanZugaenge.revokedAt,
    })
    .from(scanZugaenge)
    .innerJoin(staffUsers, eq(staffUsers.id, scanZugaenge.staffUserId))
    .orderBy(desc(isNull(scanZugaenge.revokedAt)), desc(scanZugaenge.createdAt));
}
