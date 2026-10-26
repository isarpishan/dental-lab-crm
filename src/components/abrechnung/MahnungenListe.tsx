'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { TabellenKopf } from './Kennzahlen';
import { centText } from '@/lib/abrechnung/geld';
import type { FaelligeMahnung } from '@/lib/abrechnung/mahnung';
import { MAHNSTUFE_NAMEN } from '@/lib/abrechnung/mahnwesen';
import type { Ergebnis } from '@/lib/aktion';
import { isoDatumText } from '@/lib/format';

type Aktion = (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
const SPALTEN = 'lg:grid-cols-[minmax(0,1.4fr)_170px_120px_minmax(0,1.2fr)_170px]';

function Rueckmeldung({ z }: { z: Ergebnis }) {
  if (z?.fehler) return <Meldung art="fehler">{z.fehler}</Meldung>;
  if (z?.erfolg) return <Meldung art="erfolg">{z.erfolg}</Meldung>;
  return null;
}

/**
 * Zahlungserinnerungen و Mahnungهای رسیده (Spec فاز ۲، قدم ۴) به شکل جدول: هر ردیف با «Vorschau» و «Senden»، و
 * «Alle senden» بالای جدول. پیام بالای فهرست می‌ماند، چون ردیف فرستاده‌شده بعد از تازه شدن صفحه از فهرست بیرون می‌رود.
 */
export function MahnungenListe({ eintraege, einzeln, alle }: { eintraege: FaelligeMahnung[]; einzeln: Aktion; alle: Aktion }) {
  const [z, senden, laeuft] = useFormAktion(einzeln, null);
  const [za, sendenAlle, laeuftAlle] = useFormAktion(alle, null);
  const beschaeftigt = laeuft || laeuftAlle;
  return (
    <div>
      <div className="mb-6 grid max-w-[680px] gap-3 empty:hidden" aria-live="polite">
        <Rueckmeldung z={z} />
        <Rueckmeldung z={za} />
      </div>
      {eintraege.length ? (
        <>
          {eintraege.length > 1 ? (
            <form onSubmit={sendenAlle} className="mb-8" aria-label="Alle fälligen Mahnungen senden">
              {eintraege.map((e) => (
                <input key={e.rechnungId} type="hidden" name="rechnungId" value={e.rechnungId} />
              ))}
              <Button type="submit" disabled={beschaeftigt}>
                {laeuftAlle ? 'Wird gesendet …' : `Alle ${eintraege.length} senden`}
              </Button>
            </form>
          ) : null}
          <TabellenKopf spalten={SPALTEN} namen={['Ordination · Rechnung', 'Fällig seit', { text: 'Offen', rechts: true }, 'Stufe', '']} />
          <ul aria-label="Fällige Mahnungen" className="border-t border-line lg:border-t-0">
            {eintraege.map((e) => (
              <li key={e.rechnungId} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1.5 border-b border-line py-4 ${SPALTEN}`}>
                <div className="min-w-0">
                  <Link href={`/abrechnung/${e.practiceId}`} className="block truncate text-[17px] font-light hover:text-rose">
                    {e.praxis}
                  </Link>
                  <p className="text-[13px] text-muted">
                    {e.nummer}
                    <span className="lg:hidden">
                      {' '}
                      · fällig seit {isoDatumText(e.faelligAm)} ({e.tageUeber} Tage) · offen {centText(e.offenCent)}
                    </span>
                  </p>
                </div>
                <p className="hidden text-[13px] text-paragraph lg:block">
                  {isoDatumText(e.faelligAm)} <span className="text-muted">({e.tageUeber} Tage)</span>
                </p>
                <p className="hidden text-right text-[15px] font-light lg:block">{centText(e.offenCent)}</p>
                <p className="col-span-2 min-w-0 text-[13px] lg:col-span-1">
                  <span className={e.stufe === 1 ? '' : 'text-rose'}>{MAHNSTUFE_NAMEN[e.stufe]}</span>
                  <span className="block truncate text-muted" title={e.an ?? undefined}>
                    {e.an ? `an ${e.an}` : 'ohne E-Mail-Adresse: nur als PDF'}
                  </span>
                </p>
                <div className="col-start-2 row-start-1 flex items-baseline justify-end gap-5 lg:col-start-auto lg:row-start-auto">
                  {/* das Schreiben vor dem Senden ansehen, mit Aufdruck «VORSCHAU» */}
                  <a
                    href={`/api/abrechnung/vorschau?art=mahnung&rechnung=${e.rechnungId}`}
                    target="_blank"
                    rel="noopener"
                    className="border-b border-current pb-0.5 text-[13px] text-muted hover:text-white"
                    aria-label={`Vorschau: ${MAHNSTUFE_NAMEN[e.stufe]} zu ${e.nummer}`}
                  >
                    Vorschau
                  </a>
                  <form onSubmit={senden} aria-label={`${MAHNSTUFE_NAMEN[e.stufe]} zu ${e.nummer}`}>
                    <input type="hidden" name="rechnungId" value={e.rechnungId} />
                    <Button type="submit" variant="secondary" disabled={beschaeftigt}>
                      {e.an ? 'Senden' : 'Erstellen'}
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[15px] font-light text-muted">Keine Mahnung fällig.</p>
      )}
    </div>
  );
}
