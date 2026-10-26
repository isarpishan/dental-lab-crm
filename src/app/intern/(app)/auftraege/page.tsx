import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterLeiste } from '@/components/auftrag/FilterLeiste';
import { AuftragsTabelle } from '@/components/auftrag/Listen';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices } from '@/db/schema';
import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { auswahlKatalogAusDb } from '@/lib/katalog/aus-datenbank';
import { auftragsListe, filterAus } from '@/lib/orders/listen';
import { filterOptionen } from '@/lib/orders/listen-optionen';

export const metadata: Metadata = { title: 'Aufträge · Digital Dental Lab' };

/** همهٔ سفارش‌ها برای لابراتوار (Spec فاز ۱، بخش E): با ستون و فیلتر «Ordination»، فقط Patienten-ID. */
export default async function AuftraegeIntern({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await mitarbeiterOderAnmelden();
  const b = await bearbeiterIntern('auftraege.sehen');
  if (!b) return <Seitenkopf eyebrow="Aufträge" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  const f = filterAus(await searchParams);
  const [katalog, liste, praxen] = await Promise.all([
    auswahlKatalogAusDb(),
    auftragsListe(b, f, null, 200),
    db().select({ id: practices.id, name: practices.name }).from(practices).where(eq(practices.isActive, true)).orderBy(asc(practices.name)),
  ]);
  return (
    <>
      <Seitenkopf eyebrow="02 / Aufträge" titel="Aufträge." info="Alle eingegangenen Aufträge, nur mit Patienten-ID.">
        {darf(user.role, 'auftraege.anlegen') ? (
          <span className="block">
            <Link href="/auftraege/neu" className="border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10">
              Neuer Auftrag
            </Link>
          </span>
        ) : null}
      </Seitenkopf>
      <FilterLeiste
        ziel="/auftraege"
        werte={{ ...f }}
        suchePlatzhalter="Auftragsnummer, Patienten-ID, Ordination"
        auswahl={[
          { name: 'ordination', label: 'Ordination', optionen: [{ wert: '', label: 'Alle Ordinationen' }, ...praxen.map((p) => ({ wert: p.id, label: p.name }))] },
          ...filterOptionen(katalog.behandlungen, 'labor'),
        ]}
      />
      <div className="mt-8">
        <AuftragsTabelle zeilen={liste.zeilen} seite="labor" leer="Keine Aufträge für diese Auswahl." />
        {liste.gesamt > liste.zeilen.length ? (
          <p className="pt-5 text-[13px] text-muted">
            {liste.zeilen.length} von {liste.gesamt} angezeigt. Bitte die Suche oder einen Filter verwenden.
          </p>
        ) : null}
      </div>
    </>
  );
}
