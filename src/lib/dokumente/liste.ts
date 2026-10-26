import 'server-only';
import { asc, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { documents, type DokumentArt } from '@/db/schema';

/** Dokumente der Aufträge für Seitenleiste, Produktion und Portal (ohne Inhalt; Download über `api/dokumente/[id]`). */

export const DOKUMENT_NAMEN: Record<DokumentArt, string> = { konformitaet: 'Konformitätserklärung', lieferschein: 'Lieferschein' };

export type DokumentInfo = { id: string; art: DokumentArt; name: string; nr: string; am: Date };

/** Dokumente eines oder mehrerer Aufträge, Konformitätserklärung zuerst. */
export async function dokumenteVon(orderIds: string[]): Promise<Map<string, DokumentInfo[]>> {
  const aus = new Map<string, DokumentInfo[]>();
  if (!orderIds.length) return aus;
  const zeilen = await db()
    .select({ id: documents.id, orderId: documents.orderId, art: documents.kind, nr: documents.docNo, am: documents.issuedAt })
    .from(documents)
    .where(inArray(documents.orderId, orderIds))
    .orderBy(asc(documents.issuedAt), asc(documents.kind));
  for (const z of zeilen) aus.set(z.orderId, [...(aus.get(z.orderId) ?? []), { id: z.id, art: z.art, name: DOKUMENT_NAMEN[z.art], nr: z.nr, am: z.am }]);
  return aus;
}
