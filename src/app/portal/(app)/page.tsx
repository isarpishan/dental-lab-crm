import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterLeiste } from '@/components/auftrag/FilterLeiste';
import { AuftragsTabelle, PatientenTabelle } from '@/components/auftrag/Listen';
import { ReiterLeiste } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { bearbeiterPortal } from '@/lib/auth/bearbeiter';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { auswahlKatalogAusDb } from '@/lib/katalog/aus-datenbank';
import { auftragsListe, filterAus, patientenListe } from '@/lib/orders/listen';
import { filterOptionen } from '@/lib/orders/listen-optionen';

export const metadata: Metadata = { title: 'Portal · Digital Dental Lab' };

/**
 * صفحهٔ اصلی پورتال (Spec فاز ۱، بخش E): دو تب «Aufträge» و «Patienten»، «Neuer Auftrag» و
 * «Neuer Patient»، Suche، فیلترها و Sortierung، و نوار «Ihre Aktion erforderlich».
 */
export default async function PortalStart({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, praxis } = await praxisNutzerOderAnmelden();
  const b = (await bearbeiterPortal())!;
  if (b.seite !== 'praxis') return null;
  const ip = (await anfrageInfo()).ip;
  const sp = await searchParams;
  const patienten = sp.ansicht === 'patienten';
  const f = filterAus(sp);

  const [katalog, auftraege, patientenZeilen] = await Promise.all([
    auswahlKatalogAusDb(),
    auftragsListe(b, patienten ? { ...f, suche: '', status: '', behandlung: '' } : f, ip, patienten ? 0 : 100),
    patienten ? patientenListe(b, f.suche, ip) : Promise.resolve([]),
  ]);
  const vorname = user.name.split(' ')[0];
  const gefiltert = Boolean(f.suche || f.behandlung || f.status);

  return (
    <>
      <Seitenkopf eyebrow={`Portal · ${praxis.name}`} titel={`Guten Tag, ${vorname}.`}>
        <span className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link href="/auftraege/neu" className="inline-block rounded-[30px] bg-button px-[26px] py-[17px] text-[16px] text-button-ink transition-[filter] duration-[180ms] hover:brightness-105">
            Neuer Auftrag
          </Link>
          <Link href="/patienten/neu" className="border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10">
            Neuer Patient
          </Link>
        </span>
      </Seitenkopf>

      {auftraege.aktion ? (
        <Link
          href="/?status=aktion"
          className="group mb-10 flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-rose px-5 py-4 transition-colors duration-[180ms] hover:bg-rose/5"
        >
          <span className="text-[17px] font-light">
            Ihre Aktion erforderlich <span className="text-rose">({auftraege.aktion})</span>
          </span>
          <span className="text-[13px] text-muted group-hover:text-white">Anzeigen ↗</span>
        </Link>
      ) : null}

      <div className="mb-8">
        <ReiterLeiste
          label="Ansicht"
          reiter={[
            { key: 'auftraege', href: '/', aktiv: !patienten, inhalt: 'Aufträge' },
            { key: 'patienten', href: '/?ansicht=patienten', aktiv: patienten, inhalt: 'Patienten' },
          ]}
        />
      </div>

      {patienten ? (
        <>
          <FilterLeiste ziel="/" werte={{ suche: f.suche }} versteckt={{ ansicht: 'patienten' }} suchePlatzhalter="Name oder Patienten-ID" auswahl={[]} />
          <div className="mt-8">
            <PatientenTabelle zeilen={patientenZeilen} leer={f.suche ? 'Kein Patient gefunden.' : 'Noch keine Patienten. Sie werden mit dem ersten Auftrag angelegt.'} />
          </div>
        </>
      ) : (
        <>
          <FilterLeiste
            ziel="/"
            werte={{ ...f }}
            suchePlatzhalter="Patient, Patienten-ID, Auftragsnummer"
            auswahl={filterOptionen(katalog.behandlungen, 'praxis')}
          />
          <div className="mt-8">
            <AuftragsTabelle
              zeilen={auftraege.zeilen}
              seite="praxis"
              leer={gefiltert ? 'Keine Aufträge für diese Auswahl.' : 'Noch keine Aufträge. Mit »Neuer Auftrag« senden Sie den ersten.'}
            />
            {auftraege.gesamt > auftraege.zeilen.length ? (
              <p className="pt-5 text-[13px] text-muted">
                {auftraege.zeilen.length} von {auftraege.gesamt} angezeigt. Bitte die Suche oder einen Filter verwenden.
              </p>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}
