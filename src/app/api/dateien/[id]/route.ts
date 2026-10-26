import { and, eq, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { db } from '@/db/client';
import { orderFiles } from '@/db/schema';
import { ipVon, jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { entschluesseln } from '@/lib/crypto';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { auftragFuer } from '@/lib/orders/entwurf';
import { designDownloadErlaubt } from '@/lib/orders/design';
import { laborDateiFreiFuerPraxis } from '@/lib/orders/nachrichten';
import { lesen } from '@/lib/storage';

/**
 * دانلود فایل سفارش، فقط با چک دسترسی (Spec فاز ۱، «فایل‌ها»): Ordination فقط فایل‌های
 * سفارش‌های خودش را می‌گیرد، و از فایل‌های لابراتوار فقط پیوست پیام‌های غیر intern. هر دانلود
 * (و هر نمایش سه‌بعدی) در Data-Access-Log ثبت می‌شود. همیشه «attachment»، تا هیچ فایلی در
 * مرورگر باز و اجرا نشود.
 * (قفل دانلود طرح تا Freigabe در قدم ۷ همین‌جا اضافه می‌شود.)
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('auftraege.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return jsonFehler(404, 'Datei nicht gefunden.');
  const [f] = await db()
    .select()
    .from(orderFiles)
    .where(and(eq(orderFiles.id, id), isNull(orderFiles.deletedAt)))
    .limit(1);
  const auftrag = f ? await auftragFuer(b, f.orderId) : null;
  if (!f || !auftrag) return jsonFehler(404, 'Datei nicht gefunden.');
  // `?ansicht=1`: für die 3D-Vorschau geladen, nicht heruntergeladen
  const ansicht = req.nextUrl.searchParams.get('ansicht') === '1';
  if (b.seite === 'praxis' && f.kind === 'design') {
    // Design: Ansicht der aktuellen Version ja, Download erst nach der Freigabe (Spec G, Sperre im Server)
    if (f.designRevision === null) return jsonFehler(404, 'Datei nicht gefunden.');
    if (!(await designDownloadErlaubt(f, ansicht))) return jsonFehler(403, 'Der Download wird mit Ihrer Freigabe freigeschaltet.');
  } else if (b.seite === 'praxis' && f.origin === 'labor' && !(await laborDateiFreiFuerPraxis(f.id))) {
    // andere Dateien des Labors nur als Anhang einer nicht-internen Nachricht
    return jsonFehler(404, 'Datei nicht gefunden.');
  }
  await zugriffProtokollieren({
    akteur: b,
    aktion: ansicht ? 'ansehen' : 'herunterladen',
    patientIds: auftrag.patientId ? [auftrag.patientId] : [],
    orderId: auftrag.id,
    fileId: f.id,
    ip: ipVon(req),
  });
  const name = entschluesseln(f.filenameEnc);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(Readable.toWeb(lesen(f.storageKey)) as ReadableStream, {
    headers: {
      'Content-Type': f.mime,
      'Content-Length': String(f.size),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
