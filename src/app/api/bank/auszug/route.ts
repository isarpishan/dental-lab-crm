import type { NextRequest } from 'next/server';
import { gleicherUrsprung, ipVon, jsonFehler } from '@/lib/anfrage';
import { logAudit } from '@/lib/audit';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { auszugHochladen, auszugLesen } from '@/lib/bank/auszuege';
import { AppError } from '@/lib/errors';

/**
 * Kontoauszug (PDF) oder Umsatzliste (CSV) hochladen und gleich von Claude lesen lassen (Spec فاز ۵، قدم ۴؛ nur Inhaber, nur intern). Body =
 * Datei, Name in `?name=`. Das Lesen eines langen Auszugs dauert bis zu einer Minute.
 */
export async function POST(req: NextRequest) {
  if (!gleicherUrsprung(req)) return jsonFehler(403, 'Ungültige Anfrage.');
  const b = await bearbeiterFuerHost('ausgaben.verwalten');
  if (!b || b.seite !== 'labor') return jsonFehler(401, 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  const laenge = Number(req.headers.get('content-length'));
  try {
    const a = await auszugHochladen(
      { name: req.nextUrl.searchParams.get('name'), laenge: req.headers.has('content-length') && Number.isFinite(laenge) ? laenge : null, inhalt: req.body },
      b.label,
    );
    const akteur = { kind: 'staff' as const, id: b.id, label: b.label };
    await logAudit({ aktion: 'bank_auszug_hochgeladen', akteur, ziel: { typ: 'bank_auszug', id: a.id }, details: { datei: a.dateiName, groesse: a.dateiGroesse }, ip: ipVon(req) });
    const r = await auszugLesen(a.id);
    if (r.ok) await logAudit({ aktion: 'bank_auszug_gelesen', akteur, ziel: { typ: 'bank_auszug', id: a.id }, details: { nummer: r.nummer, datum: r.datum, neu: r.neu, schonDa: r.schonDa }, ip: ipVon(req) });
    return Response.json(r.ok ? { ok: true, neu: r.neu, schonDa: r.schonDa, nummer: r.nummer, datum: r.datum } : { ok: false, fehler: r.fehler }, { status: 201 });
  } catch (e) {
    if (e instanceof AppError) return jsonFehler(400, e.message);
    throw e;
  }
}
