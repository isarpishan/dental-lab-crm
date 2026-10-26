import { AbgeholtKnopf, ZustellenKnopf } from '@/components/touren/TourBedienung';
import { TempoTag } from '@/components/ui/Tag';
import { isoDatumText } from '@/lib/format';
import { tageText } from '@/lib/touren/plan';
import type { TourTag } from '@/lib/touren/tag';

/**
 * توقف‌های یک روز، به ترتیب مسیر (Spec فاز ۱، بخش I). همین در صفحهٔ Touren (Büro) و «Meine Tour» (راننده).
 * فقط Ordination، نشانی، شمارهٔ سفارش و Behandlung؛ هیچ دادهٔ بیمار.
 */

type Aktionen = {
  zugestellt: (praxisId: string, orderIds: string[]) => Promise<{ fehler?: string }>;
  abgeholt: (id: string) => Promise<{ fehler?: string }>;
};

const uhrzeit = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });

export function Tagesplan({ plan, aktionen, tourTitel = true }: { plan: TourTag[]; aktionen?: Aktionen; tourTitel?: boolean }) {
  return (
    <div className="space-y-14">
      {plan.map(({ tour, stopps }) => (
        <section key={tour.id} aria-label={tour.name}>
          {tourTitel ? (
            <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-line pb-4">
              <h3 className="text-[clamp(24px,2.6vw,34px)] font-light leading-tight">{tour.name}</h3>
              <p className="text-[13px] text-muted">
                {tour.fahrer ? `Fahrer: ${tour.fahrer}` : 'Fahrer noch offen'} · {tageText(tour.tage)} · {stopps.length} {stopps.length === 1 ? 'Stopp' : 'Stopps'}
              </p>
            </div>
          ) : null}
          {stopps.length ? (
            <ol>
              {stopps.map((s, i) => {
                const offen = s.lieferungen.filter((l) => !l.erledigt);
                const fertig = !offen.length && s.abholungen.every((a) => a.erledigt);
                const karte = s.praxis.adresse ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.praxis.adresse)}` : null;
                return (
                  <li
                    key={s.praxis.id}
                    aria-label={`Stopp ${i + 1}: ${s.praxis.name}`}
                    className={`grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 gap-y-4 border-b border-line py-6 lg:grid-cols-[32px_minmax(0,0.85fr)_minmax(0,1.15fr)] ${fertig ? 'opacity-60' : ''}`}
                  >
                    <span className={`pt-1.5 text-[11px] ${fertig ? 'text-muted' : 'text-rose'}`}>{String(i + 1).padStart(2, '0')}</span>
                    <div className="min-w-0">
                      <p className="text-[20px] font-light leading-snug">{s.praxis.name}</p>
                      {s.praxis.adresse ? <p className="mt-1 text-[15px] text-paragraph">{s.praxis.adresse}</p> : null}
                      <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted">
                        {karte ? (
                          <a href={karte} target="_blank" rel="noopener noreferrer" className="border-b border-current hover:text-white">
                            Karte öffnen
                          </a>
                        ) : null}
                        {s.praxis.telefon ? (
                          <a href={`tel:${s.praxis.telefon.replace(/[^+\d]/g, '')}`} className="border-b border-current hover:text-white">
                            {s.praxis.telefon}
                          </a>
                        ) : null}
                      </p>
                      {s.praxis.hinweise ? <p className="mt-2 text-[13px] text-paragraph">Hinweis: {s.praxis.hinweise}</p> : null}
                    </div>
                    <div className="col-start-2 min-w-0 space-y-5 lg:col-start-auto">
                      {s.lieferungen.length ? (
                        <div className="space-y-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Zustellen</p>
                          <ul className="space-y-1.5">
                            {s.lieferungen.map((l) => (
                              <li key={l.orderId} className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] ${l.erledigt ? 'text-muted' : ''}`}>
                                <span>{l.orderNo}</span>
                                <span className="text-muted">· {l.behandlung}</span>
                                <TempoTag tempo={l.tempo} />
                                {l.erledigt ? <span className="text-[13px]">zugestellt {uhrzeit.format(l.erledigt)}</span> : null}
                              </li>
                            ))}
                          </ul>
                          {offen.length && aktionen ? <ZustellenKnopf praxisId={s.praxis.id} praxis={s.praxis.name} orderIds={offen.map((l) => l.orderId)} aktion={aktionen.zugestellt} /> : null}
                        </div>
                      ) : null}
                      {s.abholungen.length ? (
                        <div className="space-y-3">
                          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Abholen</p>
                          <ul className="space-y-3">
                            {s.abholungen.map((a) => (
                              <li key={a.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] ${a.erledigt ? 'text-muted' : ''}`}>
                                <span className="min-w-0">
                                  {a.notiz ?? 'Abholung'}
                                  {a.orderNo ? <span className="text-muted"> · zu {a.orderNo}</span> : null}
                                  {a.verspaetet && a.geplant ? <span className="text-rose-light"> · geplant für {isoDatumText(a.geplant)}</span> : null}
                                </span>
                                {a.erledigt ? (
                                  <span className="text-[13px]">abgeholt {uhrzeit.format(a.erledigt)}</span>
                                ) : aktionen ? (
                                  <AbgeholtKnopf id={a.id} aktion={aktionen.abgeholt} />
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="border-b border-line py-6 text-[15px] text-muted">An diesem Tag keine Stopps auf dieser Tour.</p>
          )}
        </section>
      ))}
    </div>
  );
}
