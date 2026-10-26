import { and, eq, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { db } from '@/db/client';
import { designRevisions, orderFiles } from '@/db/schema';
import { ipVon, jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { entschluesseln } from '@/lib/crypto';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { auftragFuer } from '@/lib/orders/entwurf';
import { lesen } from '@/lib/storage';
import { zipErstellen } from '@/lib/zip';

/**
 * Alle Dateien einer Design-Version als ein ZIP («Dateien herunterladen»). Die Ordination erst
 * nach der Freigabe dieser Version (Sperre im Server, Spec G); das Labor jederzeit.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('auftraege.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const auftrag = await auftragFuer(b, (await params).id);
  const version = Number(req.nextUrl.searchParams.get('version'));
  if (!auftrag || !Number.isInteger(version) || version < 1) return jsonFehler(404, 'Design nicht gefunden.');
  const [rev] = await db()
    .select({ status: designRevisions.status })
    .from(designRevisions)
    .where(and(eq(designRevisions.orderId, auftrag.id), eq(designRevisions.revision, version)))
    .limit(1);
  if (!rev) return jsonFehler(404, 'Design nicht gefunden.');
  if (b.seite === 'praxis' && rev.status !== 'freigegeben') return jsonFehler(403, 'Der Download wird mit Ihrer Freigabe freigeschaltet.');

  const dateien = await db()
    .select()
    .from(orderFiles)
    .where(and(eq(orderFiles.orderId, auftrag.id), eq(orderFiles.kind, 'design'), eq(orderFiles.designRevision, version), isNull(orderFiles.deletedAt)));
  if (!dateien.length) return jsonFehler(404, 'Design nicht gefunden.');

  for (const f of dateien) {
    await zugriffProtokollieren({ akteur: b, aktion: 'herunterladen', patientIds: auftrag.patientId ? [auftrag.patientId] : [], orderId: auftrag.id, fileId: f.id, ip: ipVon(req) });
  }
  const zip = zipErstellen(dateien.map((f) => ({ name: entschluesseln(f.filenameEnc), groesse: f.size, oeffnen: () => lesen(f.storageKey) })));
  const name = `${auftrag.orderNo ?? 'Auftrag'}_Design_V${version}.zip`;
  return new Response(Readable.toWeb(zip) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
