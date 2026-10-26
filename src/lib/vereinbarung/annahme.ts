import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobs, practiceAgreements, practices } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { PraxisSitzung } from '@/lib/auth/sessions';
import { istProduktion, config } from '@/lib/config';
import { ausstellerLaden } from '@/lib/dokumente/aussteller';
import { vereinbarungBestaetigungMail } from '@/lib/email/vorlagen';
import { AppError } from '@/lib/errors';
import { datumZeit } from '@/lib/format';
import { adresseZeile, pruefsumme, VEREINBARUNG_VERSION, vereinbarungInhalt, type VereinbarungInhalt } from './text';

export type Annahme = typeof practiceAgreements.$inferSelect;

/**
 * متن نسخهٔ فعلی برای یک Ordination: DDL از تنظیم `aussteller` (همان صادرکنندهٔ اسناد)، Ordination از
 * Stammdaten خودش. اگر نام یا نشانی عوض شود، متن و sha256 هم عوض می‌شوند؛ پذیرش قبلی دست نمی‌خورد.
 */
export async function aktuellerInhalt(practiceId: string): Promise<VereinbarungInhalt> {
  const [a, [p]] = await Promise.all([
    ausstellerLaden(),
    db().select({ name: practices.name, street: practices.street, zip: practices.zip, city: practices.city }).from(practices).where(eq(practices.id, practiceId)).limit(1),
  ]);
  if (!p) throw new AppError('Ordination nicht gefunden.');
  return vereinbarungInhalt(
    { name: a.name, zusatz: a.zusatz, adresse: adresseZeile([a.strasse, a.ort, a.land]) },
    { name: p.name, adresse: adresseZeile([p.street, [p.zip, p.city].filter(Boolean).join(' ')]) },
  );
}

/** پذیرش نسخهٔ فعلی، یا null. */
export async function aktuelleAnnahme(practiceId: string): Promise<Annahme | null> {
  const [a] = await db()
    .select()
    .from(practiceAgreements)
    .where(and(eq(practiceAgreements.practiceId, practiceId), eq(practiceAgreements.version, VEREINBARUNG_VERSION)))
    .limit(1);
  return a ?? null;
}

/** همهٔ پذیرش‌های یک Ordination، تازه‌ترین اول (برای CRM). */
export async function annahmenVon(practiceId: string): Promise<Annahme[]> {
  return db().select().from(practiceAgreements).where(eq(practiceAgreements.practiceId, practiceId)).orderBy(desc(practiceAgreements.acceptedAt));
}

const portalLink = (pfad: string) => `${istProduktion ? 'https' : 'http'}://${config().PORTAL_HOST}${pfad}`;

/**
 * پذیرش در پورتال (فقط Praxis-Admin). `sha256` همان متنی است که صفحه نشان داد: اگر در این فاصله
 * متن عوض شده باشد (نسخهٔ تازه یا Stammdaten تازه)، رد می‌شود تا کسی چیزی را نپذیرد که ندیده.
 * پذیرش و ایمیل تأیید در یک تراکنش؛ قفل جلوی دو پذیرش هم‌زمان را می‌گیرد.
 */
export async function annehmen(s: PraxisSitzung, gesehen: { version: string; sha256: string }, info: { ip: string | null; userAgent: string | null }) {
  if (s.user.role !== 'praxis_admin') throw new AppError('Die Vereinbarung kann nur ein Praxis-Admin Ihrer Ordination annehmen.');
  if (gesehen.version !== VEREINBARUNG_VERSION) throw new AppError('Die Vereinbarung wurde inzwischen aktualisiert. Bitte lesen Sie die neue Fassung.');
  const inhalt = await aktuellerInhalt(s.praxis.id);
  const summe = pruefsumme(inhalt);
  if (gesehen.sha256 !== summe) throw new AppError('Die Vereinbarung wurde inzwischen aktualisiert. Bitte lesen Sie die neue Fassung.');

  const [praxis] = await db().select({ email: practices.email }).from(practices).where(eq(practices.id, s.praxis.id)).limit(1);
  const angelegt = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`vereinbarung:${s.praxis.id}`}))`);
    const [schon] = await tx
      .select({ id: practiceAgreements.id })
      .from(practiceAgreements)
      .where(and(eq(practiceAgreements.practiceId, s.praxis.id), eq(practiceAgreements.version, VEREINBARUNG_VERSION)))
      .limit(1);
    if (schon) return null;
    const [neu] = await tx
      .insert(practiceAgreements)
      .values({
        practiceId: s.praxis.id,
        version: VEREINBARUNG_VERSION,
        inhalt,
        sha256: summe,
        acceptedById: s.user.id,
        acceptedByName: s.user.name,
        acceptedByEmail: s.user.email,
        ip: info.ip,
        userAgent: info.userAgent,
      })
      .returning();
    const empfaenger = [...new Set([s.user.email, praxis?.email?.trim().toLowerCase()].filter((e): e is string => Boolean(e)))];
    for (const an of empfaenger) {
      const m = vereinbarungBestaetigungMail({
        name: an === s.user.email ? s.user.name : s.praxis.name,
        ordination: s.praxis.name,
        version: VEREINBARUNG_VERSION,
        am: datumZeit(neu.acceptedAt),
        von: `${s.user.name} (${s.user.email})`,
        link: portalLink('/einstellungen'),
      });
      await tx.insert(jobs).values({ type: 'email_senden', payload: { an, betreff: m.betreff, text: m.text, html: m.html } });
    }
    return neu;
  });
  if (!angelegt) return;
  await logAudit({
    aktion: 'vereinbarung_angenommen',
    akteur: { kind: 'practice', id: s.user.id, label: s.user.name },
    ziel: { typ: 'practice', id: s.praxis.id },
    details: { version: VEREINBARUNG_VERSION, sha256: summe },
    ip: info.ip,
  });
}
