import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { documents } from '@/db/schema';
import { ipVon, jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { DOKUMENT_NAMEN } from '@/lib/dokumente/liste';
import { auftragFuer } from '@/lib/orders/entwurf';
import { ganzLesen } from '@/lib/storage';

/**
 * Lieferschein oder Konformitätserklärung (Spec فاز ۱، بخش K): لابراتوار هر سند را، Ordination فقط
 * اسناد سفارش‌های خودش (`auftragFuer` با `practice_id` از نشست). پیش از تحویل sha256 فایل با مقدار
 * لحظهٔ صدور مقایسه می‌شود؛ اگر فرق داشت، فایل تحویل داده نمی‌شود. هر بار در Data-Access-Log، چون
 * سند کد بیمار دارد. «inline»: در مرورگر باز می‌شود تا مستقیم چاپ شود.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('auftraege.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return jsonFehler(404, 'Dokument nicht gefunden.');
  const [d] = await db().select().from(documents).where(eq(documents.id, id)).limit(1);
  const auftrag = d ? await auftragFuer(b, d.orderId) : null;
  if (!d || !auftrag) return jsonFehler(404, 'Dokument nicht gefunden.');

  const inhalt = await ganzLesen(d.storageKey).catch(() => null);
  if (!inhalt || createHash('sha256').update(inhalt).digest('hex') !== d.sha256) {
    console.error(`Dokument ${d.docNo}: Datei fehlt oder wurde verändert (sha256)`);
    return jsonFehler(500, 'Das Dokument ist beschädigt. Bitte melden Sie sich beim Labor.');
  }
  await zugriffProtokollieren({ akteur: b, aktion: 'herunterladen', patientIds: auftrag.patientId ? [auftrag.patientId] : [], orderId: auftrag.id, ip: ipVon(req) });
  const name = `${DOKUMENT_NAMEN[d.kind].replace(/ä/g, 'ae')}_${d.docNo}.pdf`;
  return new Response(new Uint8Array(inhalt), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(inhalt.length),
      'Content-Disposition': `inline; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
