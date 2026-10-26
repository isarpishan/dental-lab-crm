import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { fixkostenLaeufe, fixkostenVorlagen, privatBuchungen } from '@/db/schema';
import type { PrivatKategorie } from '@/lib/privat/text';
import { faelligkeiten } from './plan';

/**
 * اجرای «Fixkosten» (Spec فاز ۵، قدم ۳): برای هر Vorlage فعال، هر سررسید تا امروز که هنوز اجرا نشده. بدون
 * `server-only`، چون worker هم آن را صدا می‌زند (هر ساعت)؛ صفحه‌های Übersicht، Ausgaben، Privat و Fixkosten هم پیش از
 * خواندن داده یک بار صدا می‌زنند. دو اجرای هم‌زمان بی‌خطرند: `on conflict do nothing` روی (Vorlage، Periode)، و
 * Buchung Privat در همان تراکنشِ ردیف اجرا ساخته می‌شود.
 */
export async function fixkostenAusfuehren(heute: string): Promise<{ privat: number; ddl: number }> {
  const vorlagen = await db().select().from(fixkostenVorlagen).where(eq(fixkostenVorlagen.aktiv, true));
  let privat = 0;
  let ddlNeu = 0;
  for (const v of vorlagen) {
    const faellig = faelligkeiten({ ab: v.ab, tag: v.tag, rhythmus: v.rhythmus, bis: v.bis }, heute);
    if (!faellig.length) continue;
    const schon = new Set(
      (await db().select({ periode: fixkostenLaeufe.periode }).from(fixkostenLaeufe).where(eq(fixkostenLaeufe.vorlageId, v.id))).map((x) => x.periode),
    );
    for (const f of faellig) {
      if (schon.has(f.periode)) continue;
      await db().transaction(async (tx) => {
        const [lauf] = await tx
          .insert(fixkostenLaeufe)
          .values({ vorlageId: v.id, periode: f.periode, faelligAm: f.faelligAm, status: v.bereich === 'privat' ? 'gebucht' : 'offen' })
          .onConflictDoNothing()
          .returning({ id: fixkostenLaeufe.id });
        if (!lauf) return; // ein anderer Lauf war schneller
        if (v.bereich === 'ddl') {
          ddlNeu++;
          return;
        }
        const [b] = await tx
          .insert(privatBuchungen)
          .values({
            art: v.art,
            datum: f.faelligAm,
            betragCent: v.betragCent,
            kategorie: v.kategorie as PrivatKategorie,
            haendler: v.gegenpartei ?? v.titel,
            notiz: v.notiz ?? (v.gegenpartei ? v.titel : null),
            quelle: 'vorlage',
            erfasstVonLabel: 'Fixkosten',
          })
          .returning({ id: privatBuchungen.id });
        await tx.update(fixkostenLaeufe).set({ privatBuchungId: b.id, erledigtAm: sql`now()` }).where(and(eq(fixkostenLaeufe.id, lauf.id)));
        privat++;
      });
    }
  }
  return { privat, ddl: ddlNeu };
}
