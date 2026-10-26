import { headers } from 'next/headers';
import { jsonFehler } from '@/lib/anfrage';
import { aktuellerMitarbeiter, aktuellerPraxisNutzer } from '@/lib/auth/sessions';
import { behandlungsBild } from '@/lib/katalog/verwaltung';

/**
 * عکسی که Inhaber برای یک Behandlung بالا گذاشته (`lib/katalog/verwaltung.ts`). برای هر کسی که وارد
 * شده است (کارکنان یا Ordination)، چون همان کاشی‌های فرم سفارش است و دادهٔ بیمار ندارد. فقط فایلی
 * که الان عکس یک Behandlung است تحویل داده می‌شود. هر عکس تازه uuid تازه دارد، پس cache طولانی بی‌خطر است.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const portal = (await headers()).get('host') === process.env.PORTAL_HOST;
  const angemeldet = portal ? await aktuellerPraxisNutzer() : await aktuellerMitarbeiter();
  if (!angemeldet) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const bild = await behandlungsBild((await params).id);
  if (!bild) return jsonFehler(404, 'Bild nicht gefunden.');
  return new Response(new Uint8Array(bild.inhalt), {
    headers: {
      'Content-Type': bild.typ,
      'Content-Length': String(bild.inhalt.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
