import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DateiAktionen } from '@/components/auftrag/AuftragBedienung';
import { AuftragsTabelle } from '@/components/auftrag/Listen';
import { MitAnzahl, ReiterBereich, ReiterLeiste, reiterWahl } from '@/components/ui/ReiterLeiste';
import { db } from '@/db/client';
import { patients } from '@/db/schema';
import { bearbeiterPortal } from '@/lib/auth/bearbeiter';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { ABLAGE_NAMEN, groesseText } from '@/lib/dateien/regeln';
import { datum } from '@/lib/format';
import { patientAnzeigen } from '@/lib/orders/entwurf';
import { auftragsListe, dateienDesPatienten, filterAus } from '@/lib/orders/listen';
import { auftragFuerPatient } from '../../auftraege/actions';

export const metadata: Metadata = { title: 'Patient · Digital Dental Lab' };

/** یک بیمار: سفارش‌ها و «Alle Dateien des Patienten» (همهٔ اسکن‌ها در همهٔ سفارش‌ها). */
export default async function Patient({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await praxisNutzerOderAnmelden();
  const b = (await bearbeiterPortal())!;
  if (b.seite !== 'praxis') notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = await db().select({ id: patients.id, angelegt: patients.createdAt }).from(patients).where(and(eq(patients.id, id), eq(patients.practiceId, b.practiceId))).limit(1);
  if (!p) notFound();
  const ip = (await anfrageInfo()).ip;
  const [patient, auftraege, dateien] = await Promise.all([
    patientAnzeigen(b, p.id, null, ip),
    auftragsListe(b, { ...filterAus({}), patient: p.id }, ip),
    dateienDesPatienten(b, p.id),
  ]);
  if (!patient) notFound();
  const tab = reiterWahl((await searchParams).tab, ['auftraege', 'dateien'] as const);

  return (
    <>
      <div className="pb-14 pt-16 max-[640px]:pt-10">
        <p className="eyebrow">Patient · {patient.code}</p>
        <h1 className="mt-5 text-[clamp(40px,5vw,72px)] font-light leading-[0.98]">{patient.name}</h1>
        <p className="mt-6 text-[17px] font-light text-paragraph">
          {patient.geburtsdatum ? `Geboren am ${patient.geburtsdatum} · ` : ''}Angelegt am {datum(p.angelegt)}
        </p>
        <form action={auftragFuerPatient.bind(null, p.id)} className="mt-8">
          <button type="submit" className="rounded-[30px] bg-button px-[26px] py-[17px] text-[16px] text-button-ink transition-[filter] duration-[180ms] hover:brightness-105">
            Neuer Auftrag für diesen Patienten
          </button>
        </form>
      </div>

      <ReiterLeiste
        label="Bereiche des Patienten"
        reiter={[
          { key: 'auftraege', href: '?tab=auftraege', aktiv: tab === 'auftraege', inhalt: <MitAnzahl name="Aufträge" anzahl={auftraege.zeilen.length} /> },
          { key: 'dateien', href: '?tab=dateien', aktiv: tab === 'dateien', inhalt: <MitAnzahl name="Alle Dateien" anzahl={dateien.length} /> },
        ]}
      />

      {tab === 'auftraege' ? (
      <ReiterBereich titel="Aufträge">
        <AuftragsTabelle zeilen={auftraege.zeilen} seite="praxis" leer="Noch keine Aufträge für diesen Patienten." />
      </ReiterBereich>
    ) : null}

      {tab === 'dateien' ? (
      <ReiterBereich titel="Alle Dateien" hinweis="Alles, was Sie für diesen Patienten geschickt haben, über alle Aufträge.">
        {dateien.length ? (
          <ul className="border-t border-line text-[15px]">
            {dateien.map(({ datei, auftrag, am }) => (
              <li key={datei.id} className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-line py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                <span className="min-w-0">
                  <span className="block truncate font-light" title={datei.name}>
                    {datei.name} <span className="text-[13px] text-muted">· {groesseText(datei.groesse)}</span>
                  </span>
                  <span className="block text-[13px] text-muted">
                    {ABLAGE_NAMEN[datei.platz]} ·{' '}
                    {auftrag.nr ? (
                      <Link href={`/auftraege/${auftrag.id}?tab=dateien`} className="border-b border-line hover:border-current hover:text-white">
                        {auftrag.nr} {auftrag.behandlung}
                      </Link>
                    ) : (
                      'Entwurf'
                    )}{' '}
                    · {datum(am)}
                  </span>
                </span>
                <span className="flex items-center gap-4 self-center">
                  <DateiAktionen id={datei.id} name={datei.name} groesse={datei.groesse} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-light text-muted">Noch keine Dateien.</p>
        )}
      </ReiterBereich>
    ) : null}
    </>
  );
}
