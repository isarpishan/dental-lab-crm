import Link from 'next/link';
import { KennzahlLeiste } from '@/components/abrechnung/Kennzahlen';
import { ReiterBereich, ReiterLeiste } from '@/components/ui/ReiterLeiste';
import { centText } from '@/lib/abrechnung/geld';
import { monatTitel } from '@/lib/ausgaben/text';
import { monatVerschieben, veraenderung, type Kategorieanteil, type Monatszahlen, type Uebersicht } from '@/lib/finanzen/uebersicht';

const prozentF = new Intl.NumberFormat('de-AT', { style: 'percent', maximumFractionDigits: 0 });
const aenderungF = new Intl.NumberFormat('de-AT', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' });
const punkteF = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 0, signDisplay: 'exceptZero' });

const MONAT_KURZ = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const monatKurz = (m: string) => MONAT_KURZ[Number(m.slice(5, 7)) - 1];

export const UEBERSICHT_TABS = ['verlauf', 'kategorien'] as const;
export type UebersichtTab = (typeof UEBERSICHT_TABS)[number];

function vormonatText(jetzt: number, vorher: number) {
  const v = veraenderung(jetzt, vorher);
  return v == null ? 'Vormonat ohne Betrag' : `${aenderungF.format(v)} zum Vormonat`;
}

/**
 * «Übersicht» یک Bereich (Spec فاز ۵، قدم ۱؛ بعداً برای «Privat» هم): ماه با «‹ ›»، چهار عدد اصلی بیرون از تب‌ها،
 * و تب‌های «Verlauf» (۶ ماه، ستون‌ها با div و جدول همان عددها) و «Kategorien» (میله‌های افقی مثل داشبورد).
 * رنگ فقط جایی که معنا دارد: Überschuss منفی rose. بدون گرادیان و سایه.
 */
export function UebersichtAnsicht({
  u,
  aktuellerMonat,
  tab,
  kategorienJahr,
  kategorieName,
  pfad,
  leer,
  privat = false,
}: {
  u: Uebersicht;
  aktuellerMonat: string;
  tab: UebersichtTab;
  kategorienJahr: boolean;
  kategorieName: (k: string) => string;
  /** نشانی همین صفحه، برای لینک‌های ماه و تب */
  pfad: string;
  /** راهنمای حالت خالی (لینک‌ها) */
  leer: React.ReactNode;
  /** Privat: «Gespart» و «Sparquote» به‌جای «Überschuss»، بدون «fakturiert» */
  privat?: boolean;
}) {
  const UEBERSCHUSS = privat ? 'Gespart' : 'Überschuss';
  const QUOTE = privat ? 'Sparquote' : 'Überschussquote';
  const m = u.monat;
  const v = u.vormonat;
  const link = (q: { monat?: string; tab?: string; k?: string }) => {
    const p = new URLSearchParams();
    const monat = q.monat ?? m.monat;
    if (monat !== aktuellerMonat) p.set('monat', monat);
    if ((q.tab ?? tab) !== 'verlauf') p.set('tab', q.tab ?? tab);
    if (q.k) p.set('k', q.k);
    const s = p.toString();
    return s ? `${pfad}?${s}` : pfad;
  };
  const naechster = monatVerschieben(m.monat, 1);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <nav aria-label="Monat" className="-ml-3 flex items-center">
          <Link href={link({ monat: monatVerschieben(m.monat, -1) })} scroll={false} className="flex size-11 items-center justify-center text-[30px] leading-none text-rose transition-colors duration-[180ms] hover:text-white" aria-label="Vormonat">
            ‹
          </Link>
          <span className="min-w-[160px] text-center text-[22px] font-light" aria-live="polite">
            {monatTitel(m.monat)}
          </span>
          {naechster <= aktuellerMonat ? (
            <Link href={link({ monat: naechster })} scroll={false} className="flex size-11 items-center justify-center text-[30px] leading-none text-rose transition-colors duration-[180ms] hover:text-white" aria-label="Nächster Monat">
              ›
            </Link>
          ) : (
            <span aria-hidden className="flex size-11 items-center justify-center text-[30px] leading-none text-line-strong">
              ›
            </span>
          )}
        </nav>
        {m.monat !== aktuellerMonat ? (
          <Link href={link({ monat: aktuellerMonat })} scroll={false} className="text-[13px] text-rose-light hover:text-white">
            Zum aktuellen Monat
          </Link>
        ) : null}
        <p className="text-[13px] text-muted">
          {u.jahr.monat} bis {monatTitel(m.monat).split(' ')[0]}: Einnahmen <Betrag cent={u.jahr.einnahmenCent} /> · Ausgaben <Betrag cent={u.jahr.ausgabenCent} /> · {UEBERSCHUSS}{' '}
          <Betrag cent={u.jahr.ueberschussCent} farbig />
        </p>
      </div>

      <KennzahlLeiste
        label={`Zahlen ${monatTitel(m.monat)}`}
        aktiv=""
        eintraege={[
          {
            titel: 'Einnahmen',
            wert: centText(m.einnahmenCent),
            zusatz: (
              <>
                {vormonatText(m.einnahmenCent, v.einnahmenCent)}
                {privat ? null : <span className="block">fakturiert {centText(m.fakturiertCent)}</span>}
              </>
            ),
          },
          { titel: 'Ausgaben', wert: centText(m.ausgabenCent), zusatz: vormonatText(m.ausgabenCent, v.ausgabenCent) },
          {
            titel: UEBERSCHUSS,
            wert: <Betrag cent={m.ueberschussCent} farbig />,
            // درصد وقتی علامت عوض می‌شود بی‌معناست ← فرق به یورو
            zusatz: `${m.ueberschussCent - v.ueberschussCent > 0 ? '+' : ''}${centText(m.ueberschussCent - v.ueberschussCent)} zum Vormonat`,
          },
          {
            titel: QUOTE,
            wert: m.quote == null ? '–' : <span className={m.quote < 0 ? 'text-rose' : undefined}>{prozentF.format(m.quote)}</span>,
            zusatz: m.quote == null ? 'ohne Einnahmen' : v.quote == null ? 'Vormonat ohne Einnahmen' : `${punkteF.format(Math.round((m.quote - v.quote) * 100))} Prozentpunkte zum Vormonat`,
          },
        ]}
      />

      {u.leer ? (
        <section aria-label="Noch keine Zahlen" className="border-b border-line py-10">
          <p className="text-[20px] font-light">Noch keine Zahlen für {monatTitel(m.monat)}.</p>
          <div className="mt-3 max-w-[680px] text-[14px] text-paragraph">{leer}</div>
        </section>
      ) : (
        <>
          <div className="mt-12">
            <ReiterLeiste
              label="Bereiche der Übersicht"
              reiter={[
                { key: 'verlauf', href: link({ tab: 'verlauf' }), aktiv: tab === 'verlauf', inhalt: 'Verlauf' },
                { key: 'kategorien', href: link({ tab: 'kategorien' }), aktiv: tab === 'kategorien', inhalt: 'Kategorien' },
              ]}
            />
          </div>

          {tab === 'verlauf' ? (
            <ReiterBereich
              titel="Verlauf"
              hinweis={privat ? 'Einnahmen und Ausgaben der letzten sechs Monate.' : 'Einnahmen und Ausgaben der letzten sechs Monate. Einnahmen sind eingegangene Zahlungen, Ausgaben nach »Bezahlt am«.'}
            >
              <Verlauf monate={u.verlauf} ueberschuss={UEBERSCHUSS} />
            </ReiterBereich>
          ) : (
            <ReiterBereich titel="Kategorien" hinweis="Wofür das Geld ausgegeben wurde.">
              <div className="mb-8">
                <ReiterLeiste
                  klein
                  label="Zeitraum"
                  reiter={[
                    { key: 'monat', href: link({ tab: 'kategorien' }), aktiv: !kategorienJahr, inhalt: monatTitel(m.monat) },
                    { key: 'jahr', href: link({ tab: 'kategorien', k: 'jahr' }), aktiv: kategorienJahr, inhalt: `${u.jahr.monat} bis ${monatTitel(m.monat).split(' ')[0]}` },
                  ]}
                />
              </div>
              <Kategorien anteile={kategorienJahr ? u.kategorienJahr : u.kategorienMonat} name={kategorieName} />
            </ReiterBereich>
          )}
        </>
      )}
    </>
  );
}

function Betrag({ cent, farbig = false }: { cent: number; farbig?: boolean }) {
  return <span className={`tabular-nums ${farbig && cent < 0 ? 'text-rose' : ''}`}>{centText(cent)}</span>;
}

const SPALTEN = 'grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 sm:grid-cols-[minmax(0,1fr)_140px_140px_140px]';

function Verlauf({ monate, ueberschuss }: { monate: Monatszahlen[]; ueberschuss: string }) {
  const max = Math.max(1, ...monate.flatMap((x) => [x.einnahmenCent, x.ausgabenCent]));
  return (
    <>
      <div className="mb-4 flex gap-6 text-[13px] text-muted" aria-hidden>
        <span className="flex items-center gap-2">
          <span className="block size-2.5 bg-einnahme" /> Einnahmen
        </span>
        <span className="flex items-center gap-2">
          <span className="block size-2.5 bg-rose/70" /> Ausgaben
        </span>
      </div>
      {/* نمودار فقط برای چشم است؛ همان عددها در جدول زیرش هستند (صفحه‌خوان جدول را می‌خواند) */}
      <div aria-hidden className="grid h-[200px] grid-cols-6 items-end gap-3 border-b border-line sm:gap-6">
        {monate.map((x) => (
          <div key={x.monat} className="flex h-full items-end justify-center gap-1 sm:gap-1.5">
            <span className="block w-full max-w-[28px] bg-einnahme" style={{ height: `${(x.einnahmenCent / max) * 100}%` }} title={`Einnahmen ${centText(x.einnahmenCent)}`} />
            <span className="block w-full max-w-[28px] bg-rose/70" style={{ height: `${(x.ausgabenCent / max) * 100}%` }} title={`Ausgaben ${centText(x.ausgabenCent)}`} />
          </div>
        ))}
      </div>
      <div aria-hidden className="mt-2 grid grid-cols-6 gap-3 text-center text-[12px] text-muted sm:gap-6">
        {monate.map((x) => (
          <span key={x.monat}>{monatKurz(x.monat)}</span>
        ))}
      </div>

      <table className="mt-12 w-full text-[14px]">
        <caption className="sr-only">Einnahmen, Ausgaben und {ueberschuss} je Monat</caption>
        <thead className="hidden sm:table-header-group">
          <tr className={`${SPALTEN} border-b border-line pb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-muted`}>
            <th className="text-left font-medium">Monat</th>
            <th className="text-right font-medium">Einnahmen</th>
            <th className="text-right font-medium">Ausgaben</th>
            <th className="text-right font-medium">{ueberschuss}</th>
          </tr>
        </thead>
        <tbody>
          {[...monate].reverse().map((x) => (
            <tr key={x.monat} className={`${SPALTEN} border-b border-line py-3.5`}>
              <th scope="row" className="text-left font-normal">
                {monatTitel(x.monat)}
              </th>
              <td className="hidden text-right tabular-nums text-einnahme sm:block">{centText(x.einnahmenCent)}</td>
              <td className="hidden text-right tabular-nums text-muted sm:block">{centText(x.ausgabenCent)}</td>
              <td className="text-right">
                <Betrag cent={x.ueberschussCent} farbig />
                <span className="block text-[12px] text-muted sm:hidden">
                  <span className="text-einnahme">{centText(x.einnahmenCent)}</span> – {centText(x.ausgabenCent)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Kategorien({ anteile, name }: { anteile: Kategorieanteil[]; name: (k: string) => string }) {
  if (!anteile.length) return <p className="text-[14px] text-muted">In diesem Zeitraum gibt es keine Ausgaben.</p>;
  const max = anteile[0].cent;
  return (
    // jede zweite Zeile leicht hinterlegt, die Zeile unter der Maus deutlich: Name und Betrag bleiben zusammen (Wunsch des Inhabers)
    <ul className="-mx-3 max-w-[1040px]" aria-label="Ausgaben nach Kategorie">
      {anteile.map((a) => (
        <li
          key={a.kategorie ?? 'weitere'}
          className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-3 py-2 text-[14px] transition-colors odd:bg-white/[0.035] hover:bg-white/[0.09] sm:grid-cols-[minmax(150px,200px)_minmax(0,1fr)_110px_48px]"
        >
          <span className="truncate text-paragraph group-hover:text-white">{a.kategorie ? name(a.kategorie) : 'Weitere'}</span>
          <span className="order-last col-span-2 h-2 bg-white/[0.04] sm:order-none sm:col-span-1">
            <span className="block h-2 bg-white/70 transition-colors group-hover:bg-rose" style={{ width: `${(a.cent / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums group-hover:text-white">{centText(a.cent)}</span>
          <span className="hidden text-right text-muted tabular-nums group-hover:text-white sm:block">{prozentF.format(a.anteil)}</span>
        </li>
      ))}
    </ul>
  );
}
