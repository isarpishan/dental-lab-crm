import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AuftragFormular } from '@/components/auftrag/AuftragFormular';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices } from '@/db/schema';
import { bearbeiterPortal } from '@/lib/auth/bearbeiter';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { config } from '@/lib/config';
import { heuteIso } from '@/lib/format';
import { auswahlKatalogAusDb } from '@/lib/katalog/aus-datenbank';
import { behandlerVon, entwurfLaden } from '@/lib/orders/entwurf';
import { absenden, anlegen, dateiEntfernen, patientFestlegen, speichern, suchen, verwerfen } from '../actions';

export const metadata: Metadata = { title: 'Neuer Auftrag · Digital Dental Lab' };

/** «Neuer Auftrag» در پورتال؛ با `?entwurf=…` ادامهٔ یک Entwurf. */
export default async function NeuerAuftrag({ searchParams }: { searchParams: Promise<{ entwurf?: string }> }) {
  const { praxis } = await praxisNutzerOderAnmelden();
  const b = (await bearbeiterPortal())!;
  const { entwurf } = await searchParams;
  const geladen = entwurf ? await entwurfLaden(b, entwurf, (await anfrageInfo()).ip) : null;
  if (entwurf && !geladen) notFound();
  if (geladen?.abgeschickt) redirect(`/auftraege/${geladen.id}`);

  const [katalog, behandler, [p]] = await Promise.all([
    auswahlKatalogAusDb(),
    behandlerVon(praxis.id),
    db().select({ lieferart: practices.defaultDeliveryKind }).from(practices).where(eq(practices.id, praxis.id)).limit(1),
  ]);

  return (
    <>
      <Seitenkopf eyebrow={`Portal · ${praxis.name}`} titel="Neuer Auftrag." />
      <AuftragFormular
        katalog={katalog}
        aktionen={{ suchen, anlegen, patientFestlegen, speichern, dateiEntfernen, absenden, verwerfen }}
        start={{
          entwurfId: geladen?.id ?? null,
          daten: geladen?.daten ?? null,
          patient: geladen?.patient ?? null,
          dateien: geladen?.dateien ?? [],
          behandler,
          standardLieferart: p?.lieferart ?? null,
          ordinationId: null,
          maxBytes: config().UPLOAD_MAX_MB * 1024 * 1024,
          heute: heuteIso(),
        }}
      />
    </>
  );
}
