import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { zeitraumFehler } from '@/lib/abrechnung/zeitraum';
import { ipVon, jsonFehler } from '@/lib/anfrage';
import { logAudit } from '@/lib/audit';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { ausgabenExport } from '@/lib/ausgaben/export';
import { zipErstellen } from '@/lib/zip';

/** Ausgaben für die Steuerberatung: ZIP mit Excel und Belegen, `?von=YYYY-MM-DD&bis=YYYY-MM-DD`. Nur Inhaber. */
export async function GET(req: NextRequest) {
  const b = await bearbeiterFuerHost('ausgaben.verwalten');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  if (b.seite !== 'labor') return jsonFehler(404, 'Nicht gefunden.');
  const von = req.nextUrl.searchParams.get('von') ?? '';
  const bis = req.nextUrl.searchParams.get('bis') ?? '';
  const fehler = zeitraumFehler(von, bis);
  if (fehler) return jsonFehler(400, fehler);

  const e = await ausgabenExport({ von, bis }, b.label);
  await logAudit({ aktion: 'ausgaben_exportiert', akteur: { kind: 'staff', id: b.id, label: b.label }, details: { von, bis, ...e.zahlen }, ip: ipVon(req) });
  return new Response(Readable.toWeb(zipErstellen(e.eintraege)) as ReadableStream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${e.dateiname}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
