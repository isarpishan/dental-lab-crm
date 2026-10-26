import 'server-only';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { invoiceDispatches, invoices, jobs, practices, practiceUsers } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { config, istProduktion } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { belegDateiname, belegTitel } from './beleg';
import { rechnungMail } from './mail';
import type { AusstellerStand, Empfaenger } from './rechnung';

/**
 * فرستادن Rechnung و Gutschrift با ایمیل (Spec فاز ۲، قدم ۳): PDF پیوست، به «E-Mail für Rechnungen» یا
 * ایمیل خود Ordination. ایمیل در صف `email_mit_anhang` می‌رود (worker فایل را هنگام ارسال با sha256 چک
 * می‌کند) و هر ارسال در `invoice_dispatches` ثبت می‌شود؛ وضعیتش از همان کار صف خوانده می‌شود.
 */
type StaffAkteur = { kind: 'staff'; id: string; label: string };

/** گیرندهٔ فاکتورهای یک Ordination: «E-Mail für Rechnungen»، وگرنه ایمیل خود Ordination. */
export const rechnungsAdresse = (p: { billingEmail: string | null; email: string | null }) => p.billingEmail?.trim() || p.email?.trim() || null;

const portal = (pfad: string) => `${istProduktion ? 'https' : 'http'}://${config().PORTAL_HOST}${pfad}`;

/** لینک «Rechnungen» در پورتال، فقط وقتی کسی در Ordination واقعاً می‌تواند آن را باز کند (Praxis-Admin فعال) */
export async function rechnungenLink(praxis: { id: string; isActive: boolean }): Promise<string | null> {
  if (!praxis.isActive) return null;
  const [admin] = await db()
    .select({ id: practiceUsers.id })
    .from(practiceUsers)
    .where(and(eq(practiceUsers.practiceId, praxis.id), eq(practiceUsers.role, 'praxis_admin'), eq(practiceUsers.isActive, true), isNotNull(practiceUsers.passwordHash)))
    .limit(1);
  return admin ? portal('/rechnungen') : null;
}

export async function versenden(rechnungId: string, akteur: StaffAkteur, ip: string | null): Promise<{ an: string; nummer: string }> {
  const [z] = await db().select({ r: invoices, praxis: practices }).from(invoices).innerJoin(practices, eq(practices.id, invoices.practiceId)).where(eq(invoices.id, rechnungId)).limit(1);
  if (!z) throw new AppError('Rechnung nicht gefunden.');
  const { r, praxis } = z;
  const an = rechnungsAdresse(praxis);
  if (!an) throw new AppError(`Für ${praxis.name} ist keine E-Mail-Adresse hinterlegt. Bitte in den Stammdaten der Ordination »E-Mail für Rechnungen« eintragen.`);

  const [bezug] = r.bezugId ? await db().select({ nummer: invoices.nummer, am: invoices.ausgestelltAm }).from(invoices).where(eq(invoices.id, r.bezugId)).limit(1) : [];
  const aussteller = r.aussteller as AusstellerStand;
  const mail = rechnungMail({
    titel: belegTitel(r),
    nummer: r.nummer,
    am: r.ausgestelltAm,
    summeCent: r.summeCent,
    faelligAm: r.faelligAm,
    zeitraum: r.zeitraumVon && r.zeitraumBis ? [r.zeitraumVon, r.zeitraumBis] : null,
    bezug: bezug ?? null,
    ordination: (r.empfaenger as Empfaenger).name,
    aussteller: { name: aussteller.name, iban: aussteller.iban, bic: aussteller.bic },
    portalLink: await rechnungenLink(praxis),
  });

  await db().transaction(async (tx) => {
    // دو کلیک پشت‌سرهم: فقط یک ایمیل
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`versand:${r.id}`}))`);
    const [laeuft] = await tx
      .select({ id: invoiceDispatches.id })
      .from(invoiceDispatches)
      .innerJoin(jobs, eq(jobs.id, invoiceDispatches.jobId))
      .where(and(eq(invoiceDispatches.invoiceId, r.id), inArray(jobs.status, ['wartend', 'laufend'])))
      .limit(1);
    if (laeuft) throw new AppError(`${r.nummer} wird gerade gesendet.`);
    const [job] = await tx
      .insert(jobs)
      .values({
        type: 'email_mit_anhang',
        payload: { an, betreff: mail.betreff, text: mail.text, html: mail.html, anhaenge: [{ key: r.storageKey, dateiname: belegDateiname(r), sha256: r.sha256 }] },
      })
      .returning({ id: jobs.id });
    await tx.insert(invoiceDispatches).values({ invoiceId: r.id, an, jobId: job.id, angefordertVon: akteur.id, angefordertVonLabel: akteur.label });
  });
  await logAudit({ aktion: 'rechnung_versendet', akteur, ziel: { typ: 'rechnung', id: r.id }, details: { nummer: r.nummer, an }, ip });
  return { an, nummer: r.nummer };
}

export type Versand = {
  an: string;
  am: Date;
  von: string;
  status: 'wartend' | 'gesendet' | 'fehler';
  gesendetAm: Date | null;
  fehler: string | null;
};

/** همهٔ ارسال‌های این سندها، تازه‌ترین اول. */
export async function versandVon(rechnungIds: string[]): Promise<Map<string, Versand[]>> {
  const aus = new Map<string, Versand[]>();
  if (!rechnungIds.length) return aus;
  const zeilen = await db()
    .select({ d: invoiceDispatches, status: jobs.status, fertig: jobs.finishedAt, fehler: jobs.error })
    .from(invoiceDispatches)
    .leftJoin(jobs, eq(jobs.id, invoiceDispatches.jobId))
    .where(inArray(invoiceDispatches.invoiceId, rechnungIds))
    .orderBy(desc(invoiceDispatches.angefordertAm));
  for (const z of zeilen) {
    const status: Versand['status'] = z.status === 'fertig' ? 'gesendet' : z.status === 'fehler' ? 'fehler' : 'wartend';
    const liste = aus.get(z.d.invoiceId) ?? [];
    liste.push({ an: z.d.an, am: z.d.angefordertAm, von: z.d.angefordertVonLabel, status, gesendetAm: status === 'gesendet' ? z.fertig : null, fehler: status === 'fehler' ? z.fehler : null });
    aus.set(z.d.invoiceId, liste);
  }
  return aus;
}
