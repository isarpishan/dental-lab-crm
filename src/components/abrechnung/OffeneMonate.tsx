import Link from 'next/link';
import type { MonatsGruppe } from '@/lib/abrechnung/daten';
import { centText, summeOderNull } from '@/lib/abrechnung/geld';
import { monatName } from '@/lib/abrechnung/leistung';
import { datum } from '@/lib/format';

/**
 * کارهای فاکتورنشدهٔ یک Ordination، ماه‌به‌ماه (تازه‌ترین اول)، با جمع هر ماه. با `practiceId` (نقش
 * `abrechnung.bearbeiten`): لینک «Sammelrechnung erstellen» برای هر ماه، و برای Einzelrechnung هر سفارش.
 */
export function OffeneMonate({ gruppen, practiceId, einzeln = false }: { gruppen: MonatsGruppe[]; practiceId?: string; einzeln?: boolean }) {
  return (
    <div className="grid gap-12">
      {gruppen.map((g) => (
        <section key={g.monat} aria-label={monatName(g.monat)}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-white/60 pb-3">
            <h3 className="text-[20px] font-light">
              {monatName(g.monat)}
              {practiceId && !einzeln ? (
                <Link href={`/abrechnung/${practiceId}/rechnung?monat=${g.monat}`} className="ml-5 border-b border-current pb-1 text-[13px] text-muted hover:text-white">
                  Sammelrechnung erstellen ↗
                </Link>
              ) : null}
            </h3>
            <p className="text-[15px]">
              <span className="text-muted">
                {g.faelle.length} {g.faelle.length === 1 ? 'Auftrag' : 'Aufträge'} ·{' '}
              </span>
              {g.ohnePreis ? <span className="text-rose">{g.ohnePreis} ohne Preis · </span> : null}
              <span className="text-[18px] font-light">{summeOderNull(g.cent, g.ohnePreis, g.faelle.length) == null ? '–' : centText(g.cent)}</span>
            </p>
          </div>
          <ul>
            {g.faelle.map((f) => (
              <li key={f.orderId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 border-b border-line py-4 sm:grid-cols-[150px_minmax(0,1fr)_110px_auto] sm:items-baseline">
                <Link href={`/auftraege/${f.orderId}?tab=abrechnung`} className="text-[15px] hover:text-rose">
                  {f.orderNo ?? 'Auftrag'}
                </Link>
                <span className="text-right text-[15px] font-light sm:order-last">
                  {f.summe.preisFehlt ? <span className="text-rose">Preis fehlt</span> : centText(f.summe.cent)}
                </span>
                <span className="min-w-0 text-[15px] font-light text-paragraph">
                  {f.behandlung}
                  {f.gespeichert ? <span className="ml-2 text-[13px] text-muted">· angepasst</span> : null}
                </span>
                <span className="text-[13px] text-muted">
                  {datum(f.leistungsdatum)}
                  {practiceId && einzeln ? (
                    <Link href={`/abrechnung/${practiceId}/rechnung?auftrag=${f.orderId}`} className="ml-3 border-b border-current text-muted hover:text-white">
                      Einzelrechnung ↗
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
