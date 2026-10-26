import type { NextRequest } from 'next/server';
import { buchhaltungsExport } from '@/lib/abrechnung/export';
import { zeitraumFehler } from '@/lib/abrechnung/zeitraum';
import { ipVon, jsonFehler } from '@/lib/anfrage';
import { logAudit } from '@/lib/audit';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';

/**
 * خروجی Excel برای Steuerberater (Spec فاز ۲، قدم ۵): `?von=YYYY-MM-DD&bis=YYYY-MM-DD`. فقط لابراتوار با
 * «abrechnung.sehen». هر خروجی در audit (دوره و تعداد)، چون داده‌های همهٔ Ordinationها را بیرون می‌برد.
 */
export async function GET(req: NextRequest) {
  const b = await bearbeiterFuerHost('abrechnung.sehen');
  if (!b) return jsonFehler(401, 'Bitte melden Sie sich an.');
  if (b.seite !== 'labor') return jsonFehler(404, 'Nicht gefunden.');
  const von = req.nextUrl.searchParams.get('von') ?? '';
  const bis = req.nextUrl.searchParams.get('bis') ?? '';
  const fehler = zeitraumFehler(von, bis);
  if (fehler) return jsonFehler(400, fehler);

  const e = await buchhaltungsExport({ von, bis }, b.label);
  await logAudit({ aktion: 'buchhaltung_exportiert', akteur: { kind: 'staff', id: b.id, label: b.label }, details: { von, bis, ...e.zahlen }, ip: ipVon(req) });
  return new Response(new Uint8Array(e.inhalt), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Length': String(e.inhalt.length),
      'Content-Disposition': `attachment; filename="${e.dateiname}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
