import { asc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { dentists, practices, practiceUsers } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { datumZeit } from '@/lib/format';
import { websiteVerbindung } from '@/lib/website/anfragen';
import { abrufStand, offeneAnfragen, ordinationenFuerEinladung } from '@/lib/website/anfragen-daten';
import { AnfragenBereich } from './Anfragen';

export const metadata: Metadata = { title: 'Ordinationen · Digital Dental Lab' };

export default async function Ordinationen() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'stammdaten.sehen')) {
    return <Seitenkopf eyebrow="Ordinationen" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  }

  const behandler = db()
    .select({ practiceId: dentists.practiceId, anzahl: sql<number>`count(*)::int`.as('anzahl_behandler') })
    .from(dentists)
    .where(eq(dentists.isActive, true))
    .groupBy(dentists.practiceId)
    .as('b');
  const zugaenge = db()
    .select({ practiceId: practiceUsers.practiceId, anzahl: sql<number>`count(*)::int`.as('anzahl_zugaenge') })
    .from(practiceUsers)
    .where(eq(practiceUsers.isActive, true))
    .groupBy(practiceUsers.practiceId)
    .as('z');
  const liste = await db()
    .select({
      p: practices,
      behandler: sql<number>`coalesce(${behandler.anzahl}, 0)`,
      zugaenge: sql<number>`coalesce(${zugaenge.anzahl}, 0)`,
    })
    .from(practices)
    .leftJoin(behandler, eq(behandler.practiceId, practices.id))
    .leftJoin(zugaenge, eq(zugaenge.practiceId, practices.id))
    .orderBy(asc(practices.isDemo), asc(practices.name));
  // Anfragen von der Website (»Praxisportal-Zugang«): nur wer einladen darf
  const bearbeiten = darf(user.role, 'stammdaten.bearbeiten');
  const [anfragen, ordinationenWahl, stand] = bearbeiten ? await Promise.all([offeneAnfragen(), ordinationenFuerEinladung(), abrufStand()]) : [[], [], null];
  const standText = stand
    ? stand.ok
      ? `Zuletzt von der Website abgerufen: ${datumZeit(new Date(stand.am))}.`
      : `Abruf von der Website fehlgeschlagen (${datumZeit(new Date(stand.am))}): ${stand.fehler ?? 'unbekannter Fehler'}`
    : websiteVerbindung()
      ? 'Noch nicht von der Website abgerufen.'
      : 'Noch nicht mit der Website verbunden (auf dem Server: ddl website).';
  const standFehler = Boolean(stand && !stand.ok);

  return (
    <>
      <Seitenkopf eyebrow="08 / Ordinationen" titel="Ordinationen." info="Ihre Kunden mit Adresse, Abrechnung, Behandlern und Portal-Zugängen." />

      {bearbeiten ? (
        <AnfragenBereich
          anfragen={anfragen.map(({ eingegangenAm, ...a }) => ({ ...a, eingegangen: datumZeit(eingegangenAm) }))}
          ordinationen={ordinationenWahl}
          stand={standText}
          standFehler={standFehler}
        />
      ) : null}

      {darf(user.role, 'stammdaten.bearbeiten') ? (
        <div className="mb-10">
          <Link href="/ordinationen/neu" className="inline-block rounded-[30px] bg-button px-[26px] py-[17px] text-button-ink transition-[filter] duration-[180ms] hover:brightness-105">
            Neue Ordination
          </Link>
        </div>
      ) : null}

      {liste.length ? (
        <ul className="border-t border-line" aria-label="Ordinationen">
          {liste.map(({ p, behandler: b, zugaenge: z }) => (
            <li key={p.id} className="border-b border-line">
              <Link
                href={`/ordinationen/${p.id}`}
                className="group grid gap-x-8 gap-y-2 py-6 lg:grid-cols-[90px_minmax(220px,1fr)_minmax(140px,0.6fr)_minmax(220px,0.9fr)_auto] lg:items-center"
              >
                <span className="text-[13px] text-rose">{p.customerNo}</span>
                <span>
                  <span className="block text-[23px] font-light leading-snug">{p.name}</span>
                  <span className="mt-1 flex flex-wrap gap-2">
                    {p.isDemo ? <span className="border border-line px-2 py-0.5 text-[11px] text-muted">Demo</span> : null}
                    {!p.isActive ? <span className="border border-line px-2 py-0.5 text-[11px] text-muted">Deaktiviert</span> : null}
                  </span>
                </span>
                <span className="text-[15px] font-light text-muted">{[p.zip, p.city].filter(Boolean).join(' ') || '–'}</span>
                <span className="text-[13px] text-muted">
                  {p.billingMode === 'sammel' ? 'Sammelrechnung' : 'Einzelrechnung'} · {b} Behandler · {z}{' '}
                  {z === 1 ? 'Portal-Zugang' : 'Portal-Zugänge'}
                </span>
                <span className="hidden text-[22px] text-rose transition-transform duration-[180ms] group-hover:translate-x-1 lg:block" aria-hidden>
                  ↗
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line pt-6 text-[17px] font-light text-muted">Noch keine Ordination angelegt.</p>
      )}
    </>
  );
}
