import type { NextRequest } from 'next/server';
import { gleicherUrsprung, jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { dateiHinzufuegen } from '@/lib/orders/entwurf';

/**
 * آپلود یک فایل در سفارش (Entwurf، Daten nachreichen، پیوست پیام): بدنهٔ درخواست خود فایل
 * است (نه multipart)، تا مستقیم روی دیسک برود و مرورگر پیشرفت را نشان دهد. جای فایل و نامش در query.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!gleicherUrsprung(req)) return jsonFehler(403, 'Ungültige Anfrage.');
  // intern: wer Aufträge bearbeitet (Inhaber, Büro, Technik), auch für Anhänge an Nachrichten
  const b = await bearbeiterFuerHost('auftraege.bearbeiten');
  if (!b) return jsonFehler(401, 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  const laenge = Number(req.headers.get('content-length'));
  const r = await dateiHinzufuegen(b, {
    orderId: (await params).id,
    platz: req.nextUrl.searchParams.get('platz'),
    name: req.nextUrl.searchParams.get('name'),
    laenge: Number.isFinite(laenge) && req.headers.has('content-length') ? laenge : null,
    inhalt: req.body,
  });
  return r.ok ? Response.json(r.datei, { status: 201 }) : jsonFehler(r.status, r.fehler);
}
