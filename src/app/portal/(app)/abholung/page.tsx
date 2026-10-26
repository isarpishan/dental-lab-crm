import type { Metadata } from 'next';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { datumZeit, heuteIso } from '@/lib/format';
import { plusTage, tageText, tagKurz } from '@/lib/touren/plan';
import { abholungenDerPraxis, auftraegeFuerAbholung, tourDerPraxis } from '@/lib/touren/portal';
import { AbholungFormular, ZurueckziehenKnopf } from './Formulare';

export const metadata: Metadata = { title: 'Abholung · Digital Dental Lab' };

/** «Abholung anfordern» (Spec فاز ۱، بخش I): Wunschtag, optional der Auftrag, Notiz; darunter die eigenen Abholungen. */
export default async function Abholung({ searchParams }: { searchParams: Promise<{ auftrag?: string }> }) {
  const { praxis } = await praxisNutzerOderAnmelden();
  const [{ auftrag }, liste, tour, auftraege] = await Promise.all([searchParams, abholungenDerPraxis(praxis.id), tourDerPraxis(praxis.id), auftraegeFuerAbholung(praxis.id)]);
  const heute = heuteIso();
  const vorwahl = auftraege.some((a) => a.id === auftrag) ? auftrag! : '';

  return (
    <>
      <Seitenkopf eyebrow="Abholung" titel="Abholung anfordern." info={`Wir holen bei Ihnen ab, zum Beispiel eine Einprobe.${tour.tage.length ? ` Unsere Tour kommt zu Ihnen: ${tageText(tour.tage)}.` : ''}`} />
      <AbholungFormular
        vorschlag={tour.vorschlag}
        min={heute}
        max={plusTage(heute, 60)}
        auftrag={vorwahl}
        auftraege={auftraege.map((a) => ({ id: a.id, label: `${a.nr} · ${a.behandlung ?? '–'} · ${a.status ?? ''}` }))}
      />

      <section aria-label="Ihre Abholungen" className="mt-16 border-t border-line pt-10">
        <h2 className="mb-6 text-[clamp(23px,2.6vw,38px)] font-light leading-[1.05]">Ihre Abholungen</h2>
        {liste.length ? (
          <ul className="border-t border-line">
            {liste.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-line py-4">
                <div className="min-w-0">
                  <p className={`text-[17px] font-light ${a.status === 'erledigt' ? 'text-muted' : ''}`}>
                    {a.status === 'erledigt' && a.erledigt
                      ? `Abgeholt am ${datumZeit(a.erledigt)}`
                      : a.status === 'eingeplant' && a.geplant
                        ? `Eingeplant: ${tagKurz(a.geplant)}`
                        : `Angefragt für ${tagKurz(a.gewuenscht)} · wird eingeplant`}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">{[a.orderNo, a.notiz].filter(Boolean).join(' · ') || 'Ohne Notiz'}</p>
                </div>
                {a.status !== 'erledigt' ? <ZurueckziehenKnopf id={a.id} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] text-muted">Noch keine Abholung angefordert.</p>
        )}
      </section>
    </>
  );
}
