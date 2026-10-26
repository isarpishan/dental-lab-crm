import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import type { NextRequest } from 'next/server';
import { ipVon, jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { auftragFuer } from '@/lib/orders/entwurf';
import { LaufzettelPdf } from '@/lib/pdf/laufzettel';
import { laufzettelDaten } from '@/lib/produktion/laufzettel';

/**
 * Laufzettel als PDF (Spec فاز ۱، بخش H): فقط لابراتوار، فقط کد بیمار. باز شدن در مرورگر (`inline`)
 * تا مستقیم چاپ شود. هر بار در Data-Access-Log («herunterladen»).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('auftraege.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  // der Laufzettel ist eine interne Unterlage
  if (b.seite !== 'labor') return jsonFehler(404, 'Nicht gefunden.');
  const auftrag = await auftragFuer(b, (await params).id);
  const d = auftrag && auftrag.status !== 'entwurf' ? await laufzettelDaten(auftrag.id) : null;
  if (!auftrag || !d) return jsonFehler(404, 'Auftrag nicht gefunden.');

  await zugriffProtokollieren({ akteur: b, aktion: 'herunterladen', patientIds: auftrag.patientId ? [auftrag.patientId] : [], orderId: auftrag.id, ip: ipVon(req) });
  const pdf = await renderToBuffer(createElement(LaufzettelPdf, { d, gedruckt: new Date() }) as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Laufzettel_${d.orderNo}.pdf"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
