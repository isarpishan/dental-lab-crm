import type { NextRequest } from 'next/server';
import { gleicherUrsprung, jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { AppError } from '@/lib/errors';
import { entwurfSpeichern } from '@/lib/orders/entwurf';

/**
 * ذخیرهٔ Entwurf هنگام بستن صفحه: مرورگر این درخواست را با `keepalive` حتی بعد از بسته
 * شدن صفحه کامل می‌فرستد (server action در آن لحظه قطع می‌شود). همان بررسی‌های
 * `entwurfSpeichern`؛ حداکثر ۶۴ KB (حد مرورگر برای keepalive).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!gleicherUrsprung(req)) return jsonFehler(403, 'Ungültige Anfrage.');
  const b = await bearbeiterFuerHost('auftraege.anlegen');
  if (!b) return jsonFehler(401, 'Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  const text = await req.text();
  if (text.length > 64 * 1024) return jsonFehler(413, 'Der Entwurf ist zu groß.');
  let daten: unknown;
  try {
    daten = JSON.parse(text);
  } catch {
    return jsonFehler(400, 'Ungültige Anfrage.');
  }
  try {
    await entwurfSpeichern(b, (await params).id, daten);
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof AppError) return jsonFehler(409, e.message);
    throw e;
  }
}
