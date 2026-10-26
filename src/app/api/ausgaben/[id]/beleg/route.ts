import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { gleicherUrsprung, ipVon, jsonFehler } from '@/lib/anfrage';
import { logAudit } from '@/lib/audit';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { belegLaden, belegSpeichern } from '@/lib/ausgaben/ausgaben';
import { AppError } from '@/lib/errors';

/**
 * Beleg einer Ausgabe (nur Inhaber, nur intern). POST: Body ist die Datei selbst (nicht multipart), damit auch große
 * Handyfotos direkt auf die Platte gehen; Name in `?name=`. GET: Beleg im Browser ansehen. Der Typ wurde beim
 * Hochladen aus den Bytes bestimmt (nur PDF und Bilder). Bilder zusätzlich mit `sandbox`; bei PDFs nicht, weil Chrome
 * ein PDF in einer Sandbox gar nicht anzeigt (der eigene PDF-Betrachter des Browsers führt ohnehin kein Skript der Seite aus).
 */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function inhaber() {
  const b = await bearbeiterFuerHost('ausgaben.verwalten');
  return b?.seite === 'labor' ? b : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!gleicherUrsprung(req)) return jsonFehler(403, 'Ungültige Anfrage.');
  const b = await inhaber();
  if (!b) return jsonFehler(401, 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  const id = (await params).id;
  if (!uuid.test(id)) return jsonFehler(404, 'Nicht gefunden.');
  const laenge = Number(req.headers.get('content-length'));
  try {
    const beleg = await belegSpeichern(id, {
      name: req.nextUrl.searchParams.get('name'),
      laenge: req.headers.has('content-length') && Number.isFinite(laenge) ? laenge : null,
      inhalt: req.body,
    });
    await logAudit({
      aktion: 'ausgabe_beleg',
      akteur: { kind: 'staff', id: b.id, label: b.label },
      ziel: { typ: 'ausgabe', id },
      details: { lieferant: beleg.lieferant, rechnungsnummer: beleg.rechnungsnummer, datei: beleg.name, typ: beleg.typ, groesse: beleg.groesse },
      ip: ipVon(req),
    });
    return Response.json({ name: beleg.name }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return jsonFehler(400, e.message);
    throw e;
  }
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await inhaber())) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const id = (await params).id;
  const beleg = uuid.test(id) ? await belegLaden(id) : null;
  if (!beleg) return jsonFehler(404, 'Kein Beleg vorhanden.');
  return new Response(Readable.toWeb(beleg.oeffnen()) as ReadableStream, {
    headers: {
      'Content-Type': beleg.typ,
      'Content-Length': String(beleg.groesse),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(beleg.name)}`,
      ...(beleg.typ === 'application/pdf' ? {} : { 'Content-Security-Policy': 'sandbox' }),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
