import { and, asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuftragFormular } from '@/components/auftrag/AuftragFormular';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices } from '@/db/schema';
import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { anfrageInfo } from '@/lib/auth/sessions';
import { config } from '@/lib/config';
import { heuteIso } from '@/lib/format';
import { auswahlKatalogAusDb } from '@/lib/katalog/aus-datenbank';
import { behandlerVon, entwurfLaden } from '@/lib/orders/entwurf';
import { absenden, anlegen, dateiEntfernen, patientFestlegen, speichern, suchen, verwerfen } from '../actions';

export const metadata: Metadata = { title: 'Neuer Auftrag · Digital Dental Lab' };

/**
 * سفارش تلفنی: همان فرم پورتال، برای یک Ordination. اول Ordination انتخاب می‌شود
 * (`?ordination=…`)، یا یک Entwurf ادامه پیدا می‌کند (`?entwurf=…`).
 */
export default async function NeuerAuftragIntern({ searchParams }: { searchParams: Promise<{ ordination?: string; entwurf?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'auftraege.anlegen')) {
    return <Seitenkopf eyebrow="Aufträge" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  }
  const b = (await bearbeiterIntern('auftraege.anlegen'))!;
  const { ordination, entwurf } = await searchParams;

  const geladen = entwurf ? await entwurfLaden(b, entwurf, (await anfrageInfo()).ip) : null;
  if (entwurf && !geladen) notFound();
  if (geladen?.abgeschickt) redirect(`/auftraege/${geladen.id}`);
  const practiceId = geladen?.practiceId ?? (ordination && /^[0-9a-f-]{36}$/.test(ordination) ? ordination : null);

  const [p] = practiceId
    ? await db()
        .select()
        .from(practices)
        .where(and(eq(practices.id, practiceId), eq(practices.isActive, true)))
        .limit(1)
    : [];

  if (!p) {
    const liste = await db().select().from(practices).where(eq(practices.isActive, true)).orderBy(asc(practices.name));
    return (
      <>
        <Seitenkopf eyebrow="Aufträge · Neuer Auftrag" titel="Für welche Ordination?" info="Zum Beispiel für einen Auftrag, der telefonisch kommt. Das Formular ist dasselbe wie im Portal." />
        <ul className="border-t border-line">
          {liste.map((x) => (
            <li key={x.id} className="border-b border-line">
              <Link href={`/auftraege/neu?ordination=${x.id}`} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 py-5">
                <span className="min-w-0">
                  <span className="block text-[20px] font-light group-hover:text-white">{x.name}</span>
                  <span className="text-[13px] text-muted">
                    {x.customerNo}
                    {x.city ? ` · ${x.city}` : ''}
                    {x.isDemo ? ' · Demo' : ''}
                  </span>
                </span>
                <span aria-hidden className="text-rose transition-transform duration-[180ms] group-hover:translate-x-1">
                  ↗
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const [katalog, behandler] = await Promise.all([auswahlKatalogAusDb(), behandlerVon(p.id)]);
  return (
    <>
      <Seitenkopf eyebrow={`Neuer Auftrag · ${p.customerNo}`} titel={p.name} />
      <AuftragFormular
        katalog={katalog}
        aktionen={{ suchen, anlegen, patientFestlegen, speichern, dateiEntfernen, absenden, verwerfen }}
        start={{
          entwurfId: geladen?.id ?? null,
          daten: geladen?.daten ?? null,
          patient: geladen?.patient ?? null,
          dateien: geladen?.dateien ?? [],
          behandler,
          standardLieferart: p.defaultDeliveryKind,
          ordinationId: p.id,
          maxBytes: config().UPLOAD_MAX_MB * 1024 * 1024,
          heute: heuteIso(),
        }}
      />
    </>
  );
}
