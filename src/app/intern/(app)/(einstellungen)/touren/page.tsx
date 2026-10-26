import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Tagesplan } from '@/components/touren/Tagesplan';
import { AbgeholtKnopf, EinplanenFormular, PraxisHinzufuegen, RouteKnopf, TourFormular } from '@/components/touren/TourBedienung';
import { MitAnzahl, ReiterBereich, ReiterLeiste, reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices, staffUsers, tours } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { heuteIso, isoDatumText } from '@/lib/format';
import { istIsoDatum, plusTage, tageText, tagLang } from '@/lib/touren/plan';
import { offeneAbholungen, ohneTour, tagesplan } from '@/lib/touren/tag';
import { FAHRER_ROLLEN } from '@/lib/touren/vorgang';
import { abgeholtMelden, einplanen, route, tourAendern, tourAnlegen, zugestellt } from './actions';

export const metadata: Metadata = { title: 'Touren · Digital Dental Lab' };

/** Touren und Tagesplan für das Büro (Spec فاز ۱، بخش I). */
export default async function Touren({ searchParams }: { searchParams: Promise<{ datum?: string; tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'touren.bearbeiten')) {
    return (
      <Seitenkopf eyebrow="Touren" titel="Kein Zugriff.">
        Touren plant das Büro.{' '}
        {darf(user.role, 'touren.sehen') ? (
          <Link href="/meine-tour" className="border-b border-current">
            Zu Ihrer Tour
          </Link>
        ) : null}
      </Seitenkopf>
    );
  }
  const heute = heuteIso();
  const { datum: d, tab: t } = await searchParams;
  const datum = istIsoDatum(d) ? d : heute;

  const [plan, offen, ohne, alleTouren, praxen, fahrer] = await Promise.all([
    tagesplan(datum),
    offeneAbholungen(),
    ohneTour(),
    db().select({ t: tours, fahrer: staffUsers.name }).from(tours).leftJoin(staffUsers, eq(staffUsers.id, tours.driverId)).orderBy(asc(tours.name)),
    db()
      .select({ id: practices.id, name: practices.name, tourId: practices.tourId, pos: practices.tourPosition, ort: practices.city })
      .from(practices)
      .where(eq(practices.isActive, true))
      .orderBy(asc(practices.tourPosition), asc(practices.name)),
    db()
      .select({ id: staffUsers.id, name: staffUsers.name })
      .from(staffUsers)
      .where(and(eq(staffUsers.isActive, true), inArray(staffUsers.role, FAHRER_ROLLEN)))
      .orderBy(asc(staffUsers.name)),
  ]);
  const aktiveTouren = alleTouren.filter(({ t }) => t.isActive).map(({ t }) => ({ id: t.id, name: t.name }));
  const tourName = new Map(alleTouren.map(({ t }) => [t.id, t.name]));
  const tagLink = (x: string) => `/touren?datum=${x}`;
  // Bereiche als Tabs (Wunsch, 25.10.2026); »Fertig, ohne Tour« nur, wenn es so etwas gibt
  const TABS = ohne.length ? (['tagesplan', 'abholung', 'ohne', 'touren'] as const) : (['tagesplan', 'abholung', 'touren'] as const);
  const tab = reiterWahl<string>(t, TABS);
  const namen: Record<string, React.ReactNode> = {
    tagesplan: 'Tagesplan',
    abholung: <MitAnzahl name="Abholwünsche" anzahl={offen.length} />,
    ohne: <MitAnzahl name="Fertig, ohne Tour" anzahl={ohne.length} />,
    touren: <MitAnzahl name="Touren" anzahl={alleTouren.length} />,
  };

  return (
    <>
      <Seitenkopf eyebrow="05 / Touren" titel="Touren." info="Jeden Tag stehen hier die Stopps jeder Tour, in der Reihenfolge der Route: fertige Arbeiten aus »Übergabe« und eingeplante Abholungen. Was nicht zugestellt wurde, rutscht automatisch auf den nächsten Tourtag." />

      <ReiterLeiste label="Bereiche der Touren" reiter={TABS.map((x) => ({ key: x, href: x === 'tagesplan' && datum !== heute ? `?datum=${datum}` : `?tab=${x}`, aktiv: x === tab, inhalt: namen[x] }))} />

      {tab === 'tagesplan' ? (
      <ReiterBereich titel="Tagesplan" hinweis={tagLang(datum)}>
        <nav aria-label="Tag" className="mb-8 flex flex-wrap gap-x-6 gap-y-3">
          <Link href={tagLink(plusTage(datum, -1))} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
            ← Vortag
          </Link>
          {datum !== heute ? (
            <Link href={tagLink(heute)} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
              Heute
            </Link>
          ) : null}
          <Link href={tagLink(plusTage(datum, 1))} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
            Nächster Tag →
          </Link>
        </nav>
        {plan.length ? (
          <Tagesplan plan={plan} aktionen={datum <= heute ? { zugestellt, abgeholt: abgeholtMelden } : undefined} />
        ) : (
          <p className="text-[17px] font-light text-muted">{alleTouren.length ? 'An diesem Tag fährt keine Tour.' : 'Noch keine Tour angelegt (Tab »Touren«).'}</p>
        )}
      </ReiterBereich>
    ) : null}

      {tab === 'abholung' ? (
      <ReiterBereich titel="Abholwünsche" hinweis="Von Ordinationen über das Portal. Fährt ihre Tour am Wunschtag, sind sie schon eingeplant.">
        {offen.length ? (
          <ul className="border-t border-line">
            {offen.map((a) => (
              <li key={a.id} aria-label={`Abholwunsch ${a.praxis}`} className="grid gap-x-10 gap-y-4 border-b border-line py-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div className="min-w-0">
                  <p className="text-[19px] font-light">{a.praxis}</p>
                  <p className="mt-1 text-[13px] text-muted">
                    Wunsch: {isoDatumText(a.gewuenscht)}
                    {a.orderNo ? ` · zu ${a.orderNo}` : ''}
                  </p>
                  {a.notiz ? <p className="mt-2 text-[15px] text-paragraph">„{a.notiz}“</p> : null}
                </div>
                <div className="space-y-4">
                  <EinplanenFormular id={a.id} touren={aktiveTouren} vorschlag={a.vorschlag} heute={heute} aktion={einplanen} />
                  <p className="text-[13px] text-muted">
                    Schon selbst abgeholt? <AbgeholtKnopf id={a.id} aktion={abgeholtMelden} beschriftung="Als abgeholt melden" />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted">Keine offenen Abholwünsche.</p>
        )}
      </ReiterBereich>
    ) : null}

      {tab === 'ohne' && ohne.length ? (
        <ReiterBereich titel="Fertig, ohne Tour" hinweis="Die Ordination hat keine Tour. Tour zuordnen, oder auf der Auftragsseite »Geliefert« melden (Abholung, Versand).">
          <ul className="border-t border-line">
            {ohne.map((o) => (
              <li key={o.orderId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4 text-[15px]">
                <Link href={`/auftraege/${o.orderId}`} className="hover:underline">
                  {o.orderNo} <span className="text-muted">· {o.behandlung}</span>
                </Link>
                <Link href={`/ordinationen/${o.praxisId}`} className="text-[13px] text-muted hover:text-white">
                  {o.praxis}
                </Link>
              </li>
            ))}
          </ul>
        </ReiterBereich>
      ) : null}

      {tab === 'touren' ? (
      <ReiterBereich titel="Touren" hinweis="Tage, Fahrer und die Reihenfolge der Ordinationen.">
        <div className="space-y-14">
          {alleTouren.map(({ t, fahrer: f }) => {
            const strecke = praxen.filter((p) => p.tourId === t.id);
            return (
              <section key={t.id} aria-label={`Tour ${t.name}`} className="space-y-6 border-t border-line pt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
                  <h3 className={`text-[24px] font-light ${t.isActive ? '' : 'text-muted'}`}>
                    {t.name}
                    {t.isActive ? '' : ' (pausiert)'}
                  </h3>
                  <p className="text-[13px] text-muted">
                    {tageText(t.weekdays)} · {f ? `Fahrer: ${f}` : 'Fahrer noch offen'}
                  </p>
                </div>
                {strecke.length ? (
                  <ol aria-label={`Route ${t.name}`}>
                    {strecke.map((p, i) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line py-2.5">
                        <span className="w-7 text-[11px] text-rose">{String(i + 1).padStart(2, '0')}</span>
                        <span className="min-w-0 flex-1 text-[15px]">
                          {p.name}
                          {p.ort ? <span className="text-muted"> · {p.ort}</span> : null}
                        </span>
                        <span className="flex items-center">
                          {i > 0 ? <RouteKnopf tourId={t.id} praxisId={p.id} was="hoch" label={`${p.name} früher anfahren`} beschriftung="↑" aktion={route} /> : null}
                          {i < strecke.length - 1 ? <RouteKnopf tourId={t.id} praxisId={p.id} was="runter" label={`${p.name} später anfahren`} beschriftung="↓" aktion={route} /> : null}
                          <RouteKnopf tourId={t.id} praxisId={p.id} was="weg" label={`${p.name} aus der Tour nehmen`} beschriftung="Entfernen" aktion={route} />
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[15px] text-muted">Noch keine Ordination in dieser Tour.</p>
                )}
                <PraxisHinzufuegen tourId={t.id} praxen={praxen.filter((p) => p.tourId !== t.id).map((p) => ({ id: p.id, name: p.name, tour: p.tourId ? (tourName.get(p.tourId) ?? null) : null }))} aktion={route} />
                <details>
                  <summary className="cursor-pointer text-[13px] text-muted hover:text-white">Tour bearbeiten</summary>
                  <div className="mt-6">
                    <TourFormular tour={{ id: t.id, name: t.name, tage: t.weekdays, fahrerId: t.driverId, aktiv: t.isActive }} fahrer={fahrer} aktion={tourAendern} />
                  </div>
                </details>
              </section>
            );
          })}
          <section aria-label="Neue Tour" className="border-t border-line pt-6">
            <h3 className="mb-6 text-[24px] font-light">Neue Tour</h3>
            <TourFormular fahrer={fahrer} aktion={tourAnlegen} />
          </section>
        </div>
      </ReiterBereich>
    ) : null}
    </>
  );
}

