import type { NextRequest } from 'next/server';
import { gleicherUrsprung, ipVon, jsonFehler } from '@/lib/anfrage';
import { logAudit } from '@/lib/audit';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { eingangHochladen, eingangLesen } from '@/lib/ausgaben/eingang';
import { AppError } from '@/lib/errors';

/**
 * Beleg nach »Zu prüfen« hochladen und gleich von Claude lesen lassen (nur Inhaber, nur intern). Body = Datei, Name in
 * `?name=`. Das Lesen dauert einige Sekunden; der Browser lädt mehrere Belege nacheinander hoch und zeigt den Stand.
 */
export async function POST(req: NextRequest) {
  if (!gleicherUrsprung(req)) return jsonFehler(403, 'Ungültige Anfrage.');
  // `?bereich=privat`: unter »Privat« hochgeladen (Spec فاز ۵، قدم ۲)
  const bereich = req.nextUrl.searchParams.get('bereich') === 'privat' ? 'privat' : null;
  const b = await bearbeiterFuerHost(bereich ? 'privat.verwalten' : 'ausgaben.verwalten');
  if (!b || b.seite !== 'labor') return jsonFehler(401, 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  const laenge = Number(req.headers.get('content-length'));
  try {
    const e = await eingangHochladen(
      { name: req.nextUrl.searchParams.get('name'), laenge: req.headers.has('content-length') && Number.isFinite(laenge) ? laenge : null, inhalt: req.body },
      { id: b.id, label: b.label },
      bereich,
    );
    await logAudit({
      aktion: 'beleg_eingang',
      akteur: { kind: 'staff', id: b.id, label: b.label },
      ziel: { typ: 'beleg_eingang', id: e.id },
      details: { datei: e.belegName, typ: e.belegTyp, groesse: e.belegGroesse, bereich: bereich ?? 'ddl' },
      ip: ipVon(req),
    });
    const r = await eingangLesen(e.id);
    return Response.json(
      { id: e.id, status: r.status, fehler: r.fehler, lieferant: r.vorschlag?.lieferant ?? null, brutto: r.vorschlag?.brutto ?? null, waehrung: r.vorschlag?.waehrung ?? null },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof AppError) return jsonFehler(400, e.message);
    throw e;
  }
}
