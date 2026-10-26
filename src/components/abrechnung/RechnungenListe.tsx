import { belegTitel } from '@/lib/abrechnung/beleg';
import { centText } from '@/lib/abrechnung/geld';
import type { Mahnung } from '@/lib/abrechnung/mahnung-daten';
import { MAHNSTUFE_NAMEN } from '@/lib/abrechnung/mahnwesen';
import { ZAHLUNGSART_NAMEN } from '@/lib/abrechnung/offen';
import type { RechnungsZeile } from '@/lib/abrechnung/rechnung';
import type { Versand } from '@/lib/abrechnung/versand';
import type { Ergebnis } from '@/lib/aktion';
import { datum, datumZeit, isoDatumText } from '@/lib/format';
import { TabellenKopf } from './Kennzahlen';
import { MahnungNochmal, RechnungAktionen, ZahlungLoeschen } from './RechnungAktionen';
import { ZahlstandText } from './Zahlstand';

type Aktion = (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
const SPALTEN = 'lg:grid-cols-[130px_minmax(0,1fr)_minmax(0,1.4fr)_130px]';

function VersandZeile({ versand }: { versand: Versand[] }) {
  const v = versand[0];
  if (!v) return null;
  const text =
    v.status === 'gesendet'
      ? `Per E-Mail gesendet am ${datumZeit(v.gesendetAm)} an ${v.an}`
      : v.status === 'wartend'
        ? `E-Mail an ${v.an} wird gesendet …`
        : `E-Mail an ${v.an} nicht gesendet: ${v.fehler ?? 'unbekannter Fehler'}`;
  return (
    <p className={`mt-2 text-[13px] ${v.status === 'fehler' ? 'text-rose' : 'text-muted'}`}>
      {text}
      {versand.length > 1 ? ` · insgesamt ${versand.length}-mal` : ''}
    </p>
  );
}

function mahnStatus(m: Mahnung): string {
  if (m.status === 'gesendet') return `per E-Mail gesendet am ${datumZeit(m.gesendetAm)} an ${m.an}`;
  if (m.status === 'wartend') return `wird an ${m.an} gesendet …`;
  if (m.status === 'fehler') return `nicht gesendet: ${m.fehler ?? 'unbekannter Fehler'}`;
  return 'nicht per E-Mail gesendet';
}

/**
 * Rechnungها و Gutschriftهای یک Ordination (تازه‌ترین اول) با PDF، وضعیت پرداخت، پرداخت‌ها، ارسال با
 * ایمیل و کارهای Büro (Spec فاز ۲، قدم‌های ۲ و ۳)، به شکل جدول با سرستون. بدون `aktionen` فقط نمایش.
 */
export function RechnungenListe({
  rechnungen,
  heute,
  an,
  stammdaten,
  aktionen,
}: {
  rechnungen: RechnungsZeile[];
  heute: string;
  an: string | null;
  stammdaten: string;
  aktionen?: {
    gutschrift: Aktion;
    senden: Aktion;
    zahlung: Aktion;
    zahlungLoeschen: Aktion;
    mahnen: Aktion;
    mahnungNochmal: Aktion;
  };
}) {
  return (
    <>
      <TabellenKopf spalten={SPALTEN} namen={['Nummer', 'Beleg', 'Stand', { text: 'Betrag', rechts: true }]} />
      <ul className="border-t border-line lg:border-t-0" aria-label="Rechnungen und Gutschriften">
        {rechnungen.map((r) => {
          const storniert = r.gutschriften.find((g) => g.storno);
          const teilGutschriften = r.gutschriften.filter((g) => !g.storno);
          return (
            <li key={r.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 border-b border-line py-4 ${SPALTEN}`}>
              <a href={`/api/rechnungen/${r.id}`} target="_blank" rel="noopener" className="text-[17px] font-light hover:text-rose" title="PDF öffnen">
                {r.nummer}
              </a>
              <p className="col-span-2 row-start-2 text-[13px] text-muted lg:col-span-1 lg:row-start-auto">
                {belegTitel(r)} vom {datum(r.ausgestelltAm)}
                {r.zeitraumVon && r.zeitraumBis ? (
                  <span className="block">
                    {r.zeitraumVon === r.zeitraumBis ? `Leistung ${isoDatumText(r.zeitraumVon)}` : `${isoDatumText(r.zeitraumVon)} – ${isoDatumText(r.zeitraumBis)}`}
                  </span>
                ) : null}
              </p>
              <p className="col-span-2 text-[13px] lg:col-span-1">
                {r.stand ? (
                  <>
                    <ZahlstandText stand={r.stand} faelligAm={r.faelligAm} letzteZahlung={r.zahlungen.at(-1)?.am ?? null} storniertMit={storniert?.nummer} />
                    {teilGutschriften.length ? (
                      <span className="text-muted"> · Gutschrift {teilGutschriften.map((g) => `${g.nummer} (${centText(g.summeCent)})`).join(', ')}</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted">
                    zu {r.bezugNummer}
                    {r.grund ? ` · ${r.grund}` : ''}
                  </span>
                )}
              </p>
              <p className={`col-start-2 row-start-1 text-right text-[17px] font-light lg:col-start-auto lg:row-start-auto ${storniert ? 'text-muted line-through' : ''}`}>
                {centText(r.summeCent)}
              </p>
              {/* زیر ردیف: پرداخت‌ها، نامه‌ها، ارسال و کارها، از ستون «Beleg» تا آخر */}
              <div className="col-span-2 min-w-0 empty:hidden lg:col-span-3 lg:col-start-2">
                {r.zahlungen.length ? (
                  <ul className="mt-2 max-w-[680px] border-t border-line" aria-label={`Zahlungen zu ${r.nummer}`}>
                    {r.zahlungen.map((z) => (
                      <li key={z.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-2 text-[13px]">
                        <span>
                          Zahlung {centText(z.betragCent)}
                          <span className="text-muted">
                            {' '}
                            · {isoDatumText(z.am)} · {ZAHLUNGSART_NAMEN[z.art]}
                            {z.notiz ? ` · ${z.notiz}` : ''}
                          </span>
                        </span>
                        {aktionen ? <ZahlungLoeschen zahlungId={z.id} titel={`Zahlung vom ${isoDatumText(z.am)}`} aktion={aktionen.zahlungLoeschen} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {r.mahnungen.length ? (
                  <ul className="mt-2 max-w-[680px] border-t border-line" aria-label={`Mahnungen zu ${r.nummer}`}>
                    {r.mahnungen.map((m, i) => {
                      const offen = m.status === 'fehler' || m.status === 'offen';
                      // فقط آخرین نامه دوباره فرستادنی است؛ نامهٔ قدیمی‌تر بعد از مرحلهٔ بعدی معنا ندارد
                      const letzte = i === r.mahnungen.length - 1;
                      return (
                        <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line py-2 text-[13px]">
                          <span className="min-w-0">
                            <a href={`/api/mahnungen/${m.id}`} target="_blank" rel="noopener" className="hover:text-rose">
                              {MAHNSTUFE_NAMEN[m.stufe]}
                            </a>
                            <span className={offen ? 'text-rose' : 'text-muted'}>
                              {' '}
                              · {datum(m.am)} · Frist {isoDatumText(m.frist)} · {mahnStatus(m)}
                            </span>
                          </span>
                          {aktionen && offen && letzte ? (
                            <MahnungNochmal mahnungId={m.id} titel={`${MAHNSTUFE_NAMEN[m.stufe]} zu ${r.nummer}`} aktion={aktionen.mahnungNochmal} />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <VersandZeile versand={r.versand} />
                {/* فرم بازشده تمام عرض را می‌گیرد: فرم چپ و Vorschau راست */}
                {aktionen && !storniert ? (
                  <div className="mt-3 min-w-0">
                    <RechnungAktionen
                      rechnungId={r.id}
                      nummer={r.nummer}
                      istRechnung={r.art === 'rechnung'}
                      stornierbar={!r.gutschriften.length}
                      // مثل `gutschreiben`: سقف، مبلغی است که هنوز Gutschrift نخورده (پرداخت‌ها مهم نیستند؛ بعد از پرداخت ← Guthaben)
                      gutschreibbar={r.summeCent + r.gutschriften.reduce((s, g) => s + g.summeCent, 0) > 0}
                      offenCent={r.stand?.offenCent ?? null}
                      heute={heute}
                      an={an}
                      stammdaten={stammdaten}
                      gesendet={r.versand.some((v) => v.status === 'gesendet')}
                      mahnStufe={r.mahnStufe}
                      aktionen={aktionen}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
