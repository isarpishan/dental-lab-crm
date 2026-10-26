import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FilterLeiste } from '@/components/auftrag/FilterLeiste';
import { garantieText } from '@/components/reklamation/ReklamationsBereich';
import { MitAnzahl, ReiterBereich, ReiterLeiste, reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { Tag } from '@/components/ui/Tag';
import { db } from '@/db/client';
import { practices, workTypes } from '@/db/schema';
import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { datum } from '@/lib/format';
import { reklamationsFilterAus, reklamationsListe, reklamationsStatistik, STATUS_FILTER } from '@/lib/reklamationen/liste';
import { GRUND_NAMEN } from '@/lib/reklamationen/regeln';

export const metadata: Metadata = { title: 'Reklamationen · Digital Dental Lab' };

const prozent = new Intl.NumberFormat('de-AT', { style: 'percent', maximumFractionDigits: 1 });

/**
 * Reklamationen (Spec فاز ۱، بخش J): فهرست با فیلتر، و تعداد برای هر Ordination و هر Behandlung
 * در برابر کارهای تحویل‌شده. تصمیم در صفحهٔ خود سفارش (تب Status). فقط کد بیمار.
 */
export default async function Reklamationen({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bearbeiterIntern('auftraege.sehen');
  if (!b) return <Seitenkopf eyebrow="Reklamationen" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  const sp = await searchParams;
  const f = reklamationsFilterAus(sp);
  const tab = reiterWahl(typeof sp.tab === 'string' ? sp.tab : undefined, ['liste', 'auswertung'] as const);
  // «Liste» behält die gewählten Filter
  const filterQuery = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (k !== 'tab' && typeof v === 'string' && v ? [[k, v]] : []))).toString();
  const [liste, statistik, praxen, behandlungen] = await Promise.all([
    reklamationsListe(f),
    reklamationsStatistik(),
    db().select({ id: practices.id, name: practices.name }).from(practices).orderBy(asc(practices.name)),
    db().select({ key: workTypes.key, name: workTypes.name }).from(workTypes).where(eq(workTypes.isActive, true)).orderBy(asc(workTypes.position)),
  ]);
  const max = Math.max(1, ...statistik.praxen.map((p) => p.anzahl), ...statistik.behandlungen.map((w) => w.anzahl));

  return (
    <>
      <Seitenkopf eyebrow="06 / Reklamationen" titel="Reklamationen." info="Von Ordinationen gemeldet oder im Labor erfasst. Offen heißt: noch zu entscheiden, oder die Reparatur ist noch nicht zurück. Entschieden wird auf der Seite des Auftrags." />
      <ReiterLeiste
        label="Bereiche der Reklamationen"
        reiter={[
          { key: 'liste', href: filterQuery ? `?${filterQuery}` : '/reklamationen', aktiv: tab === 'liste', inhalt: <MitAnzahl name="Liste" anzahl={liste.length} /> },
          { key: 'auswertung', href: '?tab=auswertung', aktiv: tab === 'auswertung', inhalt: 'Auswertung' },
        ]}
      />

      {tab === 'liste' ? (
        <ReiterBereich titel="Liste">
      <FilterLeiste
        ziel="/reklamationen"
        werte={{ ...f }}
        suchePlatzhalter="RK-, Auftragsnummer, Patienten-ID"
        auswahl={[
          { name: 'status', label: 'Status', optionen: STATUS_FILTER },
          { name: 'ordination', label: 'Ordination', optionen: [{ wert: '', label: 'Alle Ordinationen' }, ...praxen.map((p) => ({ wert: p.id, label: p.name }))] },
          { name: 'behandlung', label: 'Behandlung', optionen: [{ wert: '', label: 'Alle Behandlungen' }, ...behandlungen.map((w) => ({ wert: w.key, label: w.name }))] },
          { name: 'grund', label: 'Grund', optionen: [{ wert: '', label: 'Alle Gründe' }, ...Object.entries(GRUND_NAMEN).map(([wert, label]) => ({ wert, label }))] },
        ]}
      />

      <div className="mt-8">
        {liste.length ? (
          <ul className="border-t border-line" aria-label="Reklamationen">
            {liste.map((r) => (
              <li key={r.id} className="border-b border-line">
                <Link
                  href={`/auftraege/${r.orderId}`}
                  className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-4 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1fr)_150px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[17px] font-light group-hover:text-white">
                      {r.nr} <span className="text-[13px] text-muted">· {datum(r.am)}</span>
                    </span>
                    <span className="block truncate text-[13px] text-muted">
                      {r.grund}
                      {r.vonLabor ? ' · im Labor erfasst' : ''}
                    </span>
                  </span>
                  <span className="col-start-1 min-w-0 text-[13px] text-muted md:col-start-auto">
                    <span className="block truncate text-[15px] text-white">
                      {r.orderNo} · {r.patientCode ?? '–'}
                    </span>
                    <span className="block truncate">
                      {r.behandlung} · {r.praxis}
                    </span>
                  </span>
                  <span className={`col-start-1 text-[13px] md:col-start-auto ${r.garantie.gueltig ? 'text-muted' : 'text-rose-light'}`}>
                    {garantieText(r)}
                    {r.neuerAuftrag ? <span className="block text-muted">Neu: {r.neuerAuftrag.nr}</span> : null}
                  </span>
                  <span className="col-start-2 row-span-3 row-start-1 flex items-center justify-end gap-3 md:col-start-auto md:row-span-1">
                    <Tag ton={r.offen ? 'rose' : 'neutral'}>{r.entscheidungLabel}</Tag>
                    <span aria-hidden className="text-rose transition-transform duration-[180ms] group-hover:translate-x-1">
                      ↗
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-line pt-6 font-light text-muted">{f.status === '' ? 'Keine offenen Reklamationen.' : 'Keine Reklamationen für diese Auswahl.'}</p>
        )}
      </div>
        </ReiterBereich>
      ) : null}

      {tab === 'auswertung' ? (
        <ReiterBereich titel="Auswertung" hinweis="Reklamationen seit Beginn. Dahinter: wie viele der gelieferten fertigen Arbeiten reklamiert wurden.">
          <div className="grid gap-x-16 gap-y-12 xl:grid-cols-2">
      {[
        { index: '02', titel: 'Nach Ordination', zeilen: statistik.praxen.map((p) => ({ ...p, key: p.id })) },
        { index: '03', titel: 'Nach Behandlung', zeilen: statistik.behandlungen },
      ].map((s) => (
        <section key={s.index} aria-label={s.titel}>
          <h2 className="mb-6 text-[clamp(22px,2.2vw,30px)] font-light">{s.titel}</h2>
          {s.zeilen.length ? (
            <ul className="space-y-2.5">
              {s.zeilen.map((z) => (
                <li key={z.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 text-[14px] sm:grid-cols-[minmax(110px,190px)_minmax(0,1fr)_auto]">
                  <span className="truncate text-muted">{z.name}</span>
                  <span className="col-span-2 row-start-2 h-2 bg-white/[0.04] sm:col-span-1 sm:row-start-auto">
                    <span className="block h-2 bg-white/70" style={{ width: `${(z.anzahl / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">
                    {z.anzahl}
                    <span className="text-muted">
                      {' '}· {z.arbeiten} von {z.geliefert} Arbeiten{z.geliefert ? ` (${prozent.format(z.arbeiten / z.geliefert)})` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-light text-muted">Noch keine Reklamationen.</p>
          )}
        </section>
      ))}
          </div>
        </ReiterBereich>
      ) : null}
    </>
  );
}
