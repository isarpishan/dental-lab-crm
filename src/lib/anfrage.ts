import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * کمک‌های route handlerها (که از `proxy.ts` نمی‌گذرند، تا فایل‌های بزرگ در حافظه
 * نمانند؛ docs: proxyClientMaxBodySize).
 */

/** درخواست‌های تغییردهنده فقط از همان سایت (Spec فاز ۱، «چک Origin در route handlerها»). */
export function gleicherUrsprung(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  return Boolean(origin && host && (origin === `http://${host}` || origin === `https://${host}`));
}

export function ipVon(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
}

export const jsonFehler = (status: number, fehler: string) => Response.json({ fehler }, { status, headers: { 'Cache-Control': 'no-store' } });
