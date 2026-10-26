import { renderToBuffer } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { db } from '@/db/client';
import { practiceAgreements } from '@/db/schema';
import { jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';
import { VereinbarungPdf } from '@/lib/pdf/vereinbarung';

/**
 * Vereinbarung پذیرفته‌شده به‌صورت PDF: Ordination فقط مال خودش (`practice_id` از نشست)، لابراتوار با
 * «stammdaten.sehen». دادهٔ بیمار ندارد، پس Data-Access-Log لازم نیست. «inline» برای چاپ یا ذخیره.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await bearbeiterFuerHost('stammdaten.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return jsonFehler(404, 'Nicht gefunden.');
  const [a] = await db().select().from(practiceAgreements).where(eq(practiceAgreements.id, id)).limit(1);
  if (!a || (b.seite === 'praxis' && a.practiceId !== b.practiceId)) return jsonFehler(404, 'Nicht gefunden.');

  const pdf = await renderToBuffer(createElement(VereinbarungPdf, { a }) as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Vereinbarung_Version_${a.version}.pdf"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
