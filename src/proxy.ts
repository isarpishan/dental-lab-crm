import { NextResponse, type NextRequest } from 'next/server';

/**
 * دروازهٔ هر درخواست (در Next 16 جانشین middleware).
 * 1. از روی host تصمیم می‌گیرد کدام برنامه است: `crm.` = داخلی، `portal.` = Ordinationها.
 *    آدرس‌ها برای کاربر تمیز می‌مانند (/benutzer)، داخلش به /intern/… یا /portal/… می‌رود.
 * 2. بدون کوکی نشست، به /anmelden می‌فرستد. این فقط یک چک سریع است؛ چک واقعی
 *    نشست و نقش در هر صفحه و هر server action انجام می‌شود (docs: proxy.md).
 */
const OEFFENTLICH = ['/anmelden', '/einladung'];
const COOKIE = { intern: 'ddl_intern', portal: 'ddl_portal' } as const;
const PFAD_KOPF = 'x-ddl-pfad';

/**
 * host واقعی درخواست. Next بعد از `redirect()` در یک server action، صفحهٔ مقصد را با
 * یک درخواست داخلی می‌سازد که host آن `localhost:<port>` است و host اصلی فقط در
 * `x-forwarded-host` می‌آید. اگر host یکی از دو آدرس ما بود همان، وگرنه x-forwarded-host.
 * (جعل این سربرگ دسترسی تازه‌ای نمی‌دهد: هر بخش فقط با کوکی خودش باز می‌شود.)
 */
function hostVon(req: NextRequest): string | null {
  const host = req.headers.get('host');
  if (host === process.env.PORTAL_HOST || host === process.env.CRM_HOST) return host;
  return req.headers.get('x-forwarded-host') ?? host;
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const bereich = hostVon(req) === process.env.PORTAL_HOST ? 'portal' : 'intern';

  // مسیرهای داخلی هرگز مستقیم از بیرون
  if (pathname.startsWith('/intern') || pathname.startsWith('/portal')) {
    return new NextResponse('Nicht gefunden', { status: 404 });
  }
  // پیش‌نمایش فقط برای ساختن روی Mac است؛ روی سرور وجود ندارد (قیمت‌ها فقط برای Ordinationهای واردشده)
  if (pathname === '/vorschau' || pathname.startsWith('/vorschau/')) {
    return process.env.NODE_ENV === 'production' ? new NextResponse('Nicht gefunden', { status: 404 }) : NextResponse.next();
  }

  const oeffentlich = OEFFENTLICH.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!oeffentlich && !req.cookies.has(COOKIE[bereich])) {
    const ziel = new URL('/anmelden', req.url);
    if (pathname !== '/') ziel.searchParams.set('weiter', pathname);
    return NextResponse.redirect(ziel);
  }
  // آدرس اصلی برای صفحه‌ها: اگر نشست وسط کار تمام شده باشد، بعد از ورود همین‌جا برمی‌گردد (مثلاً QR روی Laufzettel)
  const kopf = new Headers(req.headers);
  kopf.set(PFAD_KOPF, `${pathname}${search}`.slice(0, 500));
  return NextResponse.rewrite(new URL(`/${bereich}${pathname}${search}`, req.url), { request: { headers: kopf } });
}

/**
 * `api/` از proxy نمی‌گذرد: proxy بدنهٔ درخواست را در حافظه نگه می‌دارد (حداکثر 10MB؛
 * docs: proxyClientMaxBodySize)، ولی اسکن‌ها تا `UPLOAD_MAX_MB` بزرگ‌اند. route handlerهای
 * `api/` نشست و host را خودشان چک می‌کنند (`lib/auth/bearbeiter.ts`).
 */
export const config = {
  matcher: ['/((?!_next/|api/|bilder/|ddl-mark\\.png|favicon\\.ico).*)'],
};
