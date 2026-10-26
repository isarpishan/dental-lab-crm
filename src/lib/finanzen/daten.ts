import 'server-only';
import { and, gte, isNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { expenses, invoices, payments } from '@/db/schema';
import { heuteIso } from '@/lib/format';
import { datenAb, datenVor, uebersichtBerechnen, type Uebersicht } from './uebersicht';

/**
 * دادهٔ «Übersicht» DDL (Spec فاز ۵، قدم ۱) فقط از جدول‌های موجود، بدون ثبت دوباره:
 * پرداخت‌ها (`payments`)، Rechnung و Gutschrift (`invoices`) و Ausgaben حذف‌نشده (`expenses`).
 * فقط بازهٔ لازم خوانده می‌شود (`datenAb` تا پیش از `datenVor`). جمع‌ها در `uebersicht.ts`.
 */
export async function ddlUebersicht(monat: string): Promise<Uebersicht> {
  const von = datenAb(monat);
  const vor = datenVor(monat);
  // ausgestellt_am یک لحظه است؛ یک روز حاشیه برای اختلاف وقت وین، بعد دقیق با تاریخ وین
  const vonZeit = new Date(`${von}T00:00:00Z`);
  vonZeit.setUTCDate(vonZeit.getUTCDate() - 1);
  const vorZeit = new Date(`${vor}T00:00:00Z`);
  vorZeit.setUTCDate(vorZeit.getUTCDate() + 1);

  const [zahlungen, rechnungen, ausgaben] = await Promise.all([
    db()
      .select({ datum: payments.eingegangenAm, cent: payments.betragCent })
      .from(payments)
      .where(and(gte(payments.eingegangenAm, von), lt(payments.eingegangenAm, vor))),
    db()
      .select({ am: invoices.ausgestelltAm, cent: invoices.summeCent })
      .from(invoices)
      .where(and(gte(invoices.ausgestelltAm, vonZeit), lt(invoices.ausgestelltAm, vorZeit))),
    db()
      .select({ datum: expenses.bezahltAm, cent: expenses.bruttoCent, kategorie: expenses.kategorie })
      .from(expenses)
      .where(and(isNull(expenses.geloeschtAm), gte(expenses.bezahltAm, von), lt(expenses.bezahltAm, vor))),
  ]);

  const imBereich = (datum: string) => datum >= von && datum < vor;
  return uebersichtBerechnen(monat, {
    einnahmen: zahlungen,
    fakturiert: rechnungen.map((r) => ({ datum: heuteIso(r.am), cent: r.cent })).filter((r) => imBereich(r.datum)),
    ausgaben,
  });
}
