import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { invoices, payments, type Zahlungsart } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { heuteIso } from '@/lib/format';
import { centText } from './geld';
import { zahlstand } from './offen';

/**
 * پرداخت‌های هر Rechnung (Spec فاز ۲، قدم ۳). Büro آن‌ها را از روی صورت‌حساب بانک ثبت می‌کند. با همان
 * قفل هر Ordination که صدور Rechnung و Gutschrift دارد، تا مبلغ باز در همان لحظه درست حساب شود.
 */
type StaffAkteur = { kind: 'staff'; id: string; label: string };

export async function zahlungErfassen(
  rechnungId: string,
  e: { betragCent: number; am: string; art: Zahlungsart; notiz: string | null },
  akteur: StaffAkteur,
  ip: string | null,
) {
  if (!Number.isInteger(e.betragCent) || e.betragCent <= 0) throw new AppError('Der Betrag muss größer als 0 sein.');
  if (e.am > heuteIso()) throw new AppError('Das Zahlungsdatum liegt in der Zukunft.');
  const neu = await db().transaction(async (tx) => {
    const [vorher] = await tx.select({ practiceId: invoices.practiceId }).from(invoices).where(eq(invoices.id, rechnungId)).limit(1);
    if (!vorher) throw new AppError('Rechnung nicht gefunden.');
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rechnung:${vorher.practiceId}`}))`);
    const [r] = await tx.select().from(invoices).where(eq(invoices.id, rechnungId)).limit(1);
    if (r.art !== 'rechnung') throw new AppError('Zahlungen gehören zu einer Rechnung, nicht zu einer Gutschrift.');
    const [g] = await tx
      .select({ cent: sql<number>`coalesce(sum(${invoices.summeCent}), 0)::int`, storno: sql<boolean>`coalesce(bool_or(${invoices.storno}), false)` })
      .from(invoices)
      .where(and(eq(invoices.bezugId, r.id), eq(invoices.art, 'gutschrift')));
    const [z] = await tx.select({ cent: sql<number>`coalesce(sum(${payments.betragCent}), 0)::int` }).from(payments).where(eq(payments.invoiceId, r.id));
    const stand = zahlstand({ summeCent: r.summeCent, gutschriftenCent: g.cent, gezahltCent: z.cent, storniert: g.storno, faelligAm: r.faelligAm }, heuteIso());
    if (stand.status === 'storniert') throw new AppError(`${r.nummer} ist storniert.`);
    if (stand.offenCent <= 0) throw new AppError(`Für ${r.nummer} ist nichts mehr offen.`);
    if (e.betragCent > stand.offenCent) throw new AppError(`Der Betrag ist höher als der offene Betrag von ${centText(stand.offenCent)}.`);
    const [p] = await tx
      .insert(payments)
      .values({ invoiceId: r.id, practiceId: r.practiceId, betragCent: e.betragCent, eingegangenAm: e.am, art: e.art, notiz: e.notiz, erfasstVon: akteur.id, erfasstVonLabel: akteur.label })
      .returning({ id: payments.id });
    return { id: p.id, nummer: r.nummer, restCent: stand.offenCent - e.betragCent };
  });
  await logAudit({ aktion: 'zahlung_erfasst', akteur, ziel: { typ: 'rechnung', id: rechnungId }, details: { nummer: neu.nummer, betragCent: e.betragCent, am: e.am, art: e.art }, ip });
  return neu;
}

/** Zahlung اشتباه ثبت‌شده؛ همهٔ داده‌هایش در audit می‌ماند. */
export async function zahlungLoeschen(zahlungId: string, akteur: StaffAkteur, ip: string | null) {
  const [z] = await db().select({ p: payments, nummer: invoices.nummer }).from(payments).innerJoin(invoices, eq(invoices.id, payments.invoiceId)).where(eq(payments.id, zahlungId)).limit(1);
  if (!z) throw new AppError('Diese Zahlung gibt es nicht mehr.');
  await db().delete(payments).where(eq(payments.id, zahlungId));
  await logAudit({
    aktion: 'zahlung_geloescht',
    akteur,
    ziel: { typ: 'rechnung', id: z.p.invoiceId },
    details: { nummer: z.nummer, betragCent: z.p.betragCent, am: z.p.eingegangenAm, art: z.p.art, notiz: z.p.notiz, erfasstVon: z.p.erfasstVonLabel },
    ip,
  });
  return { nummer: z.nummer };
}
