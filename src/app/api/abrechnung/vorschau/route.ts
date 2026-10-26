import type { NextRequest } from 'next/server';
import { centLesen } from '@/lib/abrechnung/geld';
import { mahnungVorschau } from '@/lib/abrechnung/mahnung';
import { gutschriftVorschau, rechnungVorschau } from '@/lib/abrechnung/rechnung';
import { musterVorschau } from '@/lib/abrechnung/vorschau';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';

/**
 * پیش‌نمایش اسناد Abrechnung به‌صورت PDF، پیش از صدور یا ذخیره (مثل بخش Vorschau در arkan-crm):
 * - `art=rechnung&ordination=…&monat=2026-09` یا `&auftrag=…`: Rechnung با شمارهٔ احتمالی
 * - `art=gutschrift&rechnungId=…&bezeichnung=…&betrag=…&grund=…` (با `storno=ja`: Stornorechnung)
 * - `art=mahnung&rechnung=…`: نامهٔ مرحله‌ای که الان رسیده
 * - `art=muster&…`: Musterrechnung با ورودی‌های «Einstellungen» (فقط Inhaber)
 * فقط لابراتوار؛ هیچ‌چیز ذخیره، شماره‌گذاری یا فرستاده نمی‌شود، پس GET است و در iframe همان صفحه
 * نشان داده می‌شود (CSP صفحه‌ها فقط iframe از همین آدرس را اجازه می‌دهد). روی PDF فقط Patienten-ID
 * می‌آید، نه نام بیمار، مثل صفحهٔ پیش‌نمایش؛ پس Data-Access-Log لازم نیست.
 */
const UUID = /^[0-9a-f-]{36}$/;
const text = (q: URLSearchParams, k: string, max = 300) => (q.get(k) ?? '').trim().slice(0, max);

function antwort(pdf: Buffer | null, fehlt: string) {
  if (!pdf) return new Response(fehlt, { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': 'inline; filename="Vorschau.pdf"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      // nur in Seiten derselben Adresse einbettbar
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const art = q.get('art');
  const b = await bearbeiterFuerHost(art === 'muster' ? 'einstellungen.verwalten' : 'abrechnung.bearbeiten');
  if (!b || b.seite !== 'labor') return new Response('Bitte melden Sie sich an.', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

  if (art === 'rechnung') {
    const ordination = q.get('ordination') ?? '';
    const monat = q.get('monat') ?? '';
    const auftrag = q.get('auftrag') ?? '';
    if (!UUID.test(ordination)) return antwort(null, 'Ordination nicht gefunden.');
    const auswahl = /^\d{4}-(0[1-9]|1[0-2])$/.test(monat) ? { monat } : UUID.test(auftrag) ? { orderId: auftrag } : null;
    if (!auswahl) return antwort(null, 'Nicht gefunden.');
    return antwort(await rechnungVorschau(ordination, auswahl), 'Keine Vorschau: es gibt nichts zu verrechnen.');
  }
  if (art === 'gutschrift') {
    const id = q.get('rechnungId') ?? '';
    if (!UUID.test(id)) return antwort(null, 'Rechnung nicht gefunden.');
    const grund = text(q, 'grund');
    if (q.get('storno') === 'ja') return antwort(await gutschriftVorschau(id, { storno: true, grund }), 'Rechnung nicht gefunden.');
    // noch unvollständige Eingabe: € 0,00 statt eines Fehlers, die Prüfung kommt beim Ausstellen
    const betrag = centLesen(q.get('betrag'));
    const betragCent = betrag.ok && betrag.wert && betrag.wert > 0 ? betrag.wert : 0;
    return antwort(await gutschriftVorschau(id, { storno: false, grund, zeilen: [{ bezeichnung: text(q, 'bezeichnung') || '–', betragCent }] }), 'Rechnung nicht gefunden.');
  }
  if (art === 'mahnung') {
    const id = q.get('rechnung') ?? '';
    if (!UUID.test(id)) return antwort(null, 'Rechnung nicht gefunden.');
    return antwort(await mahnungVorschau(id), 'Für diese Rechnung ist gerade keine Mahnung fällig.');
  }
  if (art === 'muster') return antwort(await musterVorschau(new URLSearchParams([...q].map(([k, v]) => [k, v.slice(0, 600)]))), '');
  return antwort(null, 'Nicht gefunden.');
}
