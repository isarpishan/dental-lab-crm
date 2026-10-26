import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { auszugDatei } from '@/lib/bank/auszuege';

/** Kontoauszug ansehen (PDF) oder Umsatzliste laden (CSV); nur Inhaber, nur intern. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('ausgaben.verwalten');
  if (b?.seite !== 'labor') return jsonFehler(401, 'Bitte melden Sie sich an.');
  const id = (await params).id;
  const d = uuid.test(id) ? await auszugDatei(id) : null;
  if (!d) return jsonFehler(404, 'Nicht gefunden.');
  const csv = /\.csv$/i.test(d.name);
  return new Response(Readable.toWeb(d.oeffnen()) as ReadableStream, {
    headers: {
      'Content-Type': csv ? 'text/csv' : 'application/pdf',
      'Content-Length': String(d.groesse),
      'Content-Disposition': `${csv ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
