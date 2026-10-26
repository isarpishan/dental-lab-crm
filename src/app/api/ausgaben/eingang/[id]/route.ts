import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { eingangDatei } from '@/lib/ausgaben/eingang';
import { lesen } from '@/lib/storage';

/** Beleg unter »Zu prüfen« ansehen (nur Inhaber). Wie `api/ausgaben/[id]/beleg`: Bilder mit `sandbox`, PDFs ohne. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('ausgaben.verwalten');
  if (!b || b.seite !== 'labor') return jsonFehler(401, 'Bitte melden Sie sich an.');
  const id = (await params).id;
  const d = uuid.test(id) ? await eingangDatei(id) : null;
  if (!d) return jsonFehler(404, 'Nicht gefunden.');
  return new Response(Readable.toWeb(lesen(d.key)) as ReadableStream, {
    headers: {
      'Content-Type': d.typ,
      'Content-Length': String(d.groesse),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      // PDF: im Fenster »Zu prüfen« neben dem Formular (iframe nur von derselben Seite)
      ...(d.typ === 'application/pdf' ? { 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'" } : { 'Content-Security-Policy': 'sandbox' }),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
