import 'server-only';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { jobs, portalAnfragen, practices, practiceUsers, settings } from '@/db/schema';
import type { AbrufStand } from './anfragen';

/**
 * خواندن درخواست‌های پورتال برای CRM (صفحهٔ «Ordinationen»، Übersicht، منو)، و ثبت رسیدگی. هر درخواست
 * باز با آن‌چه از قبل با همان ایمیل هست: Ordination (ایمیل یا «E-Mail für Rechnungen») یا Portal-Zugang.
 */
export type OffeneAnfrage = {
  id: string;
  eingegangenAm: Date;
  vorname: string;
  nachname: string;
  email: string;
  telefon: string | null;
  ordination: { id: string; name: string } | null;
  zugang: { ordinationId: string; ordination: string } | null;
};

export async function offeneAnfragen(): Promise<OffeneAnfrage[]> {
  const zeilen = await db().select().from(portalAnfragen).where(eq(portalAnfragen.status, 'neu')).orderBy(desc(portalAnfragen.eingegangenAm));
  if (!zeilen.length) return [];
  const emails = [...new Set(zeilen.map((z) => z.email.toLowerCase()))];
  const [praxen, zugaenge] = await Promise.all([
    db()
      .select({ id: practices.id, name: practices.name, email: practices.email, billingEmail: practices.billingEmail })
      .from(practices)
      .where(and(eq(practices.isDemo, false), or(inArray(sql`lower(${practices.email})`, emails), inArray(sql`lower(${practices.billingEmail})`, emails)))),
    db()
      .select({ email: practiceUsers.email, ordinationId: practices.id, ordination: practices.name })
      .from(practiceUsers)
      .innerJoin(practices, eq(practices.id, practiceUsers.practiceId))
      .where(inArray(sql`lower(${practiceUsers.email})`, emails)),
  ]);
  return zeilen.map((z) => {
    const e = z.email.toLowerCase();
    const p = praxen.find((x) => x.email?.toLowerCase() === e || x.billingEmail?.toLowerCase() === e);
    const u = zugaenge.find((x) => x.email.toLowerCase() === e);
    return {
      id: z.id,
      eingegangenAm: z.eingegangenAm,
      vorname: z.vorname,
      nachname: z.nachname,
      email: z.email,
      telefon: z.telefon,
      ordination: p ? { id: p.id, name: p.name } : null,
      zugang: u ? { ordinationId: u.ordinationId, ordination: u.ordination } : null,
    };
  });
}

/** برای منو و Übersicht */
export async function offeneAnfragenZahl(): Promise<number> {
  const [z] = await db().select({ n: sql<number>`count(*)::int` }).from(portalAnfragen).where(eq(portalAnfragen.status, 'neu'));
  return z?.n ?? 0;
}

export async function abrufStand(): Promise<AbrufStand | null> {
  const [z] = await db().select({ value: settings.value }).from(settings).where(eq(settings.key, 'website_abruf')).limit(1);
  return (z?.value as AbrufStand | undefined) ?? null;
}

/** Ordinationهای فعال برای انتخاب در «Einladen»، واقعی‌ها اول */
export async function ordinationenFuerEinladung() {
  return db().select({ id: practices.id, name: practices.name, kundennummer: practices.customerNo }).from(practices).where(eq(practices.isActive, true)).orderBy(asc(practices.isDemo), asc(practices.name));
}

type Akteur = { id: string; label: string };

/**
 * درخواست(ها) را می‌بندد و وضعیت را برای سایت در صف می‌گذارد (صفحهٔ Evaluation): «eingeladen» ← contacted،
 * «erledigt» ← closed. با `email`: همهٔ درخواست‌های باز همان آدرس (مثلاً بعد از Einladung از صفحهٔ Ordination).
 */
export async function anfragenAbschliessen(
  wahl: { id: string } | { email: string },
  status: 'eingeladen' | 'erledigt',
  akteur: Akteur,
  practiceUserId: string | null = null,
): Promise<{ id: string; email: string }[]> {
  return db().transaction(async (tx) => {
    const geschlossen = await tx
      .update(portalAnfragen)
      .set({ status, erledigtAm: new Date(), erledigtVon: akteur.id, erledigtVonLabel: akteur.label, practiceUserId })
      .where(and(eq(portalAnfragen.status, 'neu'), 'id' in wahl ? eq(portalAnfragen.id, wahl.id) : eq(sql`lower(${portalAnfragen.email})`, wahl.email.toLowerCase())))
      .returning({ id: portalAnfragen.id, email: portalAnfragen.email });
    if (geschlossen.length) {
      await tx.insert(jobs).values(geschlossen.map((g) => ({ type: 'website_anfrage_status', payload: { id: g.id, status: status === 'eingeladen' ? 'contacted' : 'closed' }, maxAttempts: 8 })));
    }
    return geschlossen;
  });
}

/** «Jetzt abrufen»: یک کار صف، اگر همین الان یکی منتظر نیست */
export async function abrufAnstossen() {
  const [wartet] = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, 'website_anfragen_abrufen'), inArray(jobs.status, ['wartend', 'laufend'])))
    .limit(1);
  if (!wartet) await db().insert(jobs).values({ type: 'website_anfragen_abrufen', payload: {}, maxAttempts: 1 });
}
