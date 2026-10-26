import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterLeiste } from '@/components/auftrag/FilterLeiste';
import { KalenderRaster } from '@/components/touren/KalenderAnsicht';
import { ReiterLeiste } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices, workTypes } from '@/db/schema';
import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { heuteIso } from '@/lib/format';
import { kalender } from '@/lib/touren/kalender';
import { istIsoDatum, monatsRaster, monatTitel, monatVerschieben, plusTage, tagKurz, wocheVon } from '@/lib/touren/plan';

export const metadata: Metadata = { title: 'Kalender · Digital Dental Lab' };

type Params = Record<string, string | string[] | undefined>;
const text = (p: Params, k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '');

/** تقویم Liefertermin، Abholung و روزهای تور (Spec فاز ۱، بخش I). ماه یا هفته، با فیلتر Ordination و Behandlung. */
export default async function Kalender({ searchParams }: { searchParams: Promise<Params> }) {
  const b = await bearbeiterIntern('auftraege.sehen');
  if (!b) return <Seitenkopf eyebrow="Kalender" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  const p = await searchParams;
  const heute = heuteIso();
  const datum = istIsoDatum(text(p, 'datum')) ? text(p, 'datum') : heute;
  const woche = text(p, 'ansicht') === 'woche';
  const filter = { ordination: text(p, 'ordination'), behandlung: text(p, 'behandlung') };
  const wochen = woche ? [wocheVon(datum)] : monatsRaster(datum);
  const von = wochen[0][0];
  const bis = wochen[wochen.length - 1][6];

  const [tage, praxen, behandlungen] = await Promise.all([
    kalender(von, bis, filter),
    db().select({ id: practices.id, name: practices.name }).from(practices).where(eq(practices.isActive, true)).orderBy(asc(practices.name)),
    db().select({ key: workTypes.key, name: workTypes.name }).from(workTypes).where(eq(workTypes.isActive, true)).orderBy(asc(workTypes.position)),
  ]);

  const link = (werte: Record<string, string>) => {
    const q = new URLSearchParams({ ...(woche ? { ansicht: 'woche' } : {}), ...(filter.ordination ? { ordination: filter.ordination } : {}), ...(filter.behandlung ? { behandlung: filter.behandlung } : {}), datum, ...werte });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return `/kalender?${q.toString()}`;
  };
  const zurueck = woche ? plusTage(datum, -7) : monatVerschieben(datum, -1);
  const vor = woche ? plusTage(datum, 7) : monatVerschieben(datum, 1);
  const titel = woche ? `${tagKurz(von)} – ${tagKurz(bis)}${bis.slice(0, 4)}` : monatTitel(datum);

  return (
    <>
      <Seitenkopf eyebrow="04 / Kalender" titel="Kalender." info="Liefertermine, Abholungen und Tourtage. Ohne Liefertermin gilt der Wunschtermin der Ordination." />
      <FilterLeiste
        ziel="/kalender"
        werte={filter}
        versteckt={{ datum, ...(woche ? { ansicht: 'woche' } : {}) }}
        auswahl={[
          { name: 'ordination', label: 'Ordination', optionen: [{ wert: '', label: 'Alle Ordinationen' }, ...praxen.map((x) => ({ wert: x.id, label: x.name }))] },
          { name: 'behandlung', label: 'Behandlung', optionen: [{ wert: '', label: 'Alle Behandlungen' }, ...behandlungen.map((w) => ({ wert: w.key, label: w.name }))] },
        ]}
      />
      <div className="mt-10 flex flex-wrap items-end justify-between gap-x-10 gap-y-5 pb-6">
        <h2 className="text-[clamp(26px,3vw,40px)] font-light leading-none">{titel}</h2>
        <nav aria-label="Zeitraum" className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link href={link({ datum: zurueck })} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
            ← {woche ? 'Vorige Woche' : 'Voriger Monat'}
          </Link>
          <Link href={link({ datum: heute })} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
            Heute
          </Link>
          <Link href={link({ datum: vor })} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
            {woche ? 'Nächste Woche' : 'Nächster Monat'} →
          </Link>
          <ReiterLeiste
            klein
            ohneNav
            label="Ansicht"
            reiter={[
              { key: 'monat', href: link({ ansicht: '' }), aktiv: !woche, inhalt: 'Monat' },
              { key: 'woche', href: link({ ansicht: 'woche' }), aktiv: woche, inhalt: 'Woche' },
            ]}
          />
        </nav>
      </div>
      <KalenderRaster
        wochen={wochen}
        tage={tage}
        heute={heute}
        monat={woche ? null : datum.slice(0, 7)}
        ausfuehrlich={woche}
        wocheLink={(d) => link({ ansicht: 'woche', datum: d })}
      />
      <p className="mt-6 text-[13px] text-muted">
        <span className="text-rose-light">Rot</span>: Termin vorbei, noch nicht geliefert · durchgestrichen: geliefert<span className="hidden md:inline"> · grau hinterlegt: Wochenende</span>
      </p>
    </>
  );
}
