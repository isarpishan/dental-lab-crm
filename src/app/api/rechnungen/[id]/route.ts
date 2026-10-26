import { createHash } from 'node:crypto';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { invoiceLines, invoices, orders } from '@/db/schema';
import { belegDateiname } from '@/lib/abrechnung/beleg';
import { ipVon, jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { ganzLesen } from '@/lib/storage';

/**
 * Rechnung یا Gutschrift به‌صورت PDF (Spec فاز ۲، قدم‌های ۲ و ۳): لابراتوار با «abrechnung.sehen»، و در
 * پورتال فقط Praxis-Admin و فقط سندهای Ordination خودش (`practice_id` از نشست؛ بقیه «nicht gefunden»).
 * پیش از تحویل sha256 فایل با مقدار لحظهٔ صدور مقایسه می‌شود. هر دانلود در Data-Access-Log، چون سند
 * کد بیمار دارد. «inline» برای چاپ.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('abrechnung.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return jsonFehler(404, 'Nicht gefunden.');
  const [r] = await db().select().from(invoices).where(eq(invoices.id, id)).limit(1);
  if (!r || (b.seite === 'praxis' && (b.praxisRolle !== 'praxis_admin' || r.practiceId !== b.practiceId))) return jsonFehler(404, 'Nicht gefunden.');
  const inhalt = await ganzLesen(r.storageKey).catch(() => null);
  if (!inhalt || createHash('sha256').update(inhalt).digest('hex') !== r.sha256) {
    console.error(`Rechnung ${r.nummer}: Datei fehlt oder wurde verändert (sha256)`);
    return jsonFehler(500, b.seite === 'labor' ? 'Die Rechnung ist beschädigt. Bitte aus der Sicherung wiederherstellen.' : 'Die Rechnung ist beschädigt. Bitte melden Sie sich beim Labor.');
  }
  const patienten = await db()
    .selectDistinct({ id: orders.patientId })
    .from(invoiceLines)
    .innerJoin(orders, eq(orders.id, invoiceLines.orderId))
    .where(and(eq(invoiceLines.invoiceId, r.id), isNotNull(orders.patientId)));
  await zugriffProtokollieren({ akteur: b, aktion: 'herunterladen', patientIds: patienten.flatMap((p) => (p.id ? [p.id] : [])), ip: ipVon(req) });
  return new Response(new Uint8Array(inhalt), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(inhalt.length),
      'Content-Disposition': `inline; filename="${belegDateiname(r)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
