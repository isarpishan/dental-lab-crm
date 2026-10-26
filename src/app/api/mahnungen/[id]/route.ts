import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { dunningLetters, invoices } from '@/db/schema';
import { mahnungDateiname } from '@/lib/abrechnung/mahnung';
import type { Mahnstufe } from '@/lib/abrechnung/mahnwesen';
import { jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { ganzLesen } from '@/lib/storage';

/**
 * Zahlungserinnerung یا Mahnung به‌صورت PDF (Spec فاز ۲، قدم ۴)، با همان قاعدهٔ Rechnung: لابراتوار با
 * «abrechnung.sehen»، در پورتال فقط Praxis-Admin و فقط نامه‌های Ordination خودش. sha256 پیش از تحویل.
 * نامه کد بیمار ندارد، پس Data-Access-Log لازم نیست.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('abrechnung.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return jsonFehler(404, 'Nicht gefunden.');
  const [z] = await db().select({ m: dunningLetters, nummer: invoices.nummer }).from(dunningLetters).innerJoin(invoices, eq(invoices.id, dunningLetters.invoiceId)).where(eq(dunningLetters.id, id)).limit(1);
  if (!z || (b.seite === 'praxis' && (b.praxisRolle !== 'praxis_admin' || z.m.practiceId !== b.practiceId))) return jsonFehler(404, 'Nicht gefunden.');
  const inhalt = await ganzLesen(z.m.storageKey).catch(() => null);
  if (!inhalt || createHash('sha256').update(inhalt).digest('hex') !== z.m.sha256) {
    console.error(`Mahnung zu ${z.nummer}: Datei fehlt oder wurde verändert (sha256)`);
    return jsonFehler(500, 'Das Schreiben ist beschädigt. Bitte melden Sie sich beim Labor.');
  }
  return new Response(new Uint8Array(inhalt), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(inhalt.length),
      'Content-Disposition': `inline; filename="${mahnungDateiname(z.m.stufe as Mahnstufe, z.nummer)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
