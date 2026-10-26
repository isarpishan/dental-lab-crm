import type { Metadata } from 'next';
import Link from 'next/link';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { centText } from '@/lib/abrechnung/geld';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { fixkostenNachziehen } from '@/lib/fixkosten/vorlagen';
import { isoDatumText } from '@/lib/format';
import { steuerSeite } from '@/lib/steuer/einstellungen';
import type { SteuerVorschau } from '@/lib/steuer/rechnen';
import type { Jahreswerte } from '@/lib/steuer/werte';

export const metadata: Metadata = { title: 'Steuer · Digital Dental Lab' };

const prozent = new Intl.NumberFormat('de-AT', { style: 'percent', maximumFractionDigits: 0 });

/**
 * «Steuer- und SVS-Vorschau» (Spec فاز ۵، قدم ۵؛ فقط Inhaber): چقدر از Gewinn DDL برای Einkommensteuer و Nachzahlung
 * SVS کنار گذاشته شود. محاسبه در `lib/steuer/rechnen.ts`، عددهای قانونی در `lib/steuer/werte.ts`. همیشه با برچسب
 * «Schätzung – keine Steuerberatung» و راه حساب گام‌به‌گام، تا با Steuerberater مقایسه شود.
 */
export default async function Steuer() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten')) {
    return (
      <Seitenkopf eyebrow="Steuer" titel="Kein Zugriff.">
        Die Steuer-Vorschau sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  await fixkostenNachziehen();
  const s = await steuerSeite();
  const v = s.vorschau;

  return (
    <>
      <Seitenkopf
        eyebrow="Abrechnung"
        titel={`Steuer ${s.jahr}`}
        kompakt
        info="Wie viel vom Gewinn des Labors für Einkommensteuer und die spätere Nachzahlung an die SVS zur Seite gelegt werden sollte. Gerechnet mit den Werten des Jahres und Ihren Angaben unter Einstellungen → Steuer."
      >
        <span className="inline-block border border-rose px-2.5 py-1 text-[12px] text-rose">Schätzung – keine Steuerberatung</span>
      </Seitenkopf>

      {!v ? (
        <section aria-label="Noch keine Angaben" className="border-y border-line py-10">
          <p className="text-[20px] font-light">Für die Vorschau fehlen noch ein paar Angaben.</p>
          <p className="mt-3 max-w-[680px] text-[14px] text-paragraph">
            Beginn der Selbständigkeit, das Gehalt aus dem Lohnzettel und, falls schon da, die Vorschreibung der SVS.{' '}
            <Link href="/einstellungen/steuer" className="text-rose-light hover:text-white">
              Angaben eintragen
            </Link>
          </p>
        </section>
      ) : (
        <Vorschau v={v} w={s.werte} ausVorjahr={s.ausVorjahr} werteGeschaetzt={s.werteGeschaetzt} />
      )}
    </>
  );
}

type Posten = { text: string; wert: number; zusatz?: string; art?: 'minus' | 'summe' | 'ergebnis' };

/** kleine Tabelle in einem Kasten: Bezeichnung links, Betrag rechts; Summen mit stärkerer Linie */
function Tabelle({ titel, posten }: { titel: string; posten: Posten[] }) {
  return (
    <section aria-label={titel} className="rounded-[12px] border border-panel-line bg-soft px-5 py-4">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted">{titel}</h2>
      <table className="w-full text-[14px]">
        <tbody>
          {posten.map((p) => {
            const summe = p.art === 'summe' || p.art === 'ergebnis';
            return (
              <tr key={p.text} className={summe ? 'border-t border-line-strong' : 'border-t border-line first:border-t-0'}>
                <th scope="row" className={`py-2 pr-4 text-left align-baseline ${summe ? 'font-normal text-white' : 'font-light text-paragraph'}`}>
                  {p.text}
                  {p.zusatz ? <span className="block text-[12px] font-light text-muted">{p.zusatz}</span> : null}
                </th>
                <td
                  className={`whitespace-nowrap py-2 text-right align-baseline tabular-nums ${p.art === 'ergebnis' ? 'text-[20px] font-light text-rose' : summe ? 'text-white' : 'font-light text-paragraph'} ${
                    p.wert < 0 && p.art !== 'minus' ? 'text-rose' : ''
                  }`}
                >
                  {p.art === 'minus' ? `– ${centText(p.wert)}` : centText(p.wert)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Vorschau({ v, w, ausVorjahr, werteGeschaetzt }: { v: SteuerVorschau; w: Jahreswerte; ausVorjahr: boolean; werteGeschaetzt: boolean }) {
  const satz = (x: number) => `${(x * 100).toLocaleString('de-AT', { maximumFractionDigits: 2 })} %`;
  const gutschrift = v.ruecklageCent < 0;
  const ergebnis: Posten[] = gutschrift
    ? [{ text: 'Voraussichtlich zurück', wert: -v.ruecklageCent, art: 'ergebnis', zusatz: 'Verlust senkt die Lohnsteuer' }]
    : [
        { text: 'Zurücklegen pro Monat', wert: v.ruecklageMonatCent, art: 'ergebnis', zusatz: `${v.monateSelbstaendig} ${v.monateSelbstaendig === 1 ? 'Monat' : 'Monate'} selbständig in ${v.jahr}` },
        { text: 'Einkommensteuer zusätzlich', wert: v.estOffenCent },
        { text: 'SVS-Nachzahlung später', wert: v.svsNachCent },
        { text: 'Zurücklegen gesamt', wert: Math.max(0, v.ruecklageCent), art: 'summe', zusatz: v.ruecklageQuote != null ? `${prozent.format(v.ruecklageQuote)} vom Gewinn` : undefined },
      ];
  const est: Posten[] = [
    { text: `Gewinn bis heute`, wert: v.gewinnBisHeuteCent },
    {
      text: v.gewinnQuelle === 'schaetzung' ? 'Gewinn im Jahr (Schätzung)' : 'Gewinn im Jahr (hochgerechnet)',
      wert: v.gewinnJahrCent,
      zusatz: v.gewinnQuelle === 'schaetzung' ? undefined : `${v.monateBisher} von ${v.monateSelbstaendig} Monaten vorbei`,
    },
    { text: v.svsQuelle === 'mindest' ? 'SVS laufend (Mindestbeiträge)' : 'SVS laufend (laut SVS-Brief)', wert: v.svsLaufendCent, art: 'minus' },
    { text: `Gewinnfreibetrag ${satz(w.gewinnfreibetrag.satz)}`, wert: v.gewinnfreibetragCent, art: 'minus' },
    { text: 'Steuerpflichtiger Gewinn', wert: v.gewinnSteuerlichCent, art: 'summe' },
    { text: 'Gehalt im Jahr (steuerpflichtig)', wert: v.gehaltJahrCent },
    { text: 'Steuer nur auf das Gehalt', wert: v.steuerOhneCent },
    { text: 'Steuer auf Gehalt und Gewinn', wert: v.steuerMitCent },
    { text: 'Einkommensteuer zusätzlich', wert: v.estMehrCent, art: 'summe' },
    ...(v.estMehrCent !== v.estOffenCent ? [{ text: 'nach ESt-Vorauszahlungen', wert: v.estOffenCent, art: 'summe' as const }] : []),
  ];
  const svs: Posten[] = [
    { text: 'Endgültige Beitragsgrundlage', wert: v.beitragsgrundlageCent },
    { text: `Pensionsversicherung ${satz(w.svs.pv)}`, wert: v.pvNachCent },
    { text: `Krankenversicherung ${satz(w.svs.kv)}`, wert: v.kvNachCent, zusatz: v.gruendungsjahr <= 2 ? `im ${v.gruendungsjahr}. Jahr fix` : undefined },
    { text: 'SVS-Nachzahlung später', wert: v.svsNachCent, art: 'summe' },
  ];

  return (
    <>
      {ausVorjahr || werteGeschaetzt ? (
        <ul className="mb-6 space-y-1 text-[13px] text-rose">
          {ausVorjahr ? (
            <li>
              Gerechnet mit Ihren Angaben aus {v.jahr - 1}.{' '}
              <Link href="/einstellungen/steuer" className="border-b border-current">
                Für {v.jahr} bestätigen
              </Link>
            </li>
          ) : null}
          {werteGeschaetzt ? <li>Für {v.jahr} sind die gesetzlichen Werte noch nicht hinterlegt; gerechnet mit denen des Vorjahres.</li> : null}
        </ul>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Tabelle titel="Ergebnis" posten={ergebnis} />
        <Tabelle titel="Einkommensteuer" posten={est} />
        <Tabelle titel="Sozialversicherung (SVS)" posten={svs} />
      </div>

      <div className="mt-6 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Link href="/einstellungen/steuer" className="border-b border-current pb-0.5 text-[13px] text-muted hover:text-white">
          Angaben ändern ↗
        </Link>
        <details className="basis-full sm:basis-auto">
          <summary className="cursor-pointer list-none text-[13px] text-rose-light hover:text-white">So wird gerechnet …</summary>
          <ul className="mt-3 max-w-[760px] list-disc space-y-1.5 pl-5 text-[13px] text-muted">
            <li>Gewinn = eingegangene Zahlungen minus Ausgaben (wie in der Übersicht). Früh im Jahr ist die Hochrechnung ungenau; unter »Angaben ändern« lässt sich der erwartete Gewinn eintragen.</li>
            <li>Einkommensteuer zusätzlich = Steuer auf Gehalt und Gewinn minus Steuer nur auf das Gehalt (die ist über die Lohnsteuer schon bezahlt). Urlaubs- und Weihnachtsgeld bleiben außen vor.</li>
            <li>
              Gewinnfreibetrag: {satz(w.gewinnfreibetrag.satz)} des Gewinns bis {centText(w.gewinnfreibetrag.bis * 100)}, ohne Investition. SVS-Beiträge mindern den Gewinn.
            </li>
            <li>
              SVS: Als Neugründer zahlen Sie zunächst die Mindestbeiträge. Liegt der Gewinn höher, wird die Pensionsversicherung nachverrechnet, sobald der Steuerbescheid für {v.jahr} da
              ist (oft ein bis zwei Jahre später). Die Krankenversicherung ist in den ersten beiden Jahren fix. Grundlage: Einkünfte laut Steuerbescheid plus bezahlte Pensions- und
              Krankenversicherung.
            </li>
            <li>Neben einer Anstellung kann auf Antrag eine andere Berechnung gelten (Mehrfachversicherung). Das bitte mit der Steuerberatung klären.</li>
            <li>
              Werte {w.jahr}: Steuerstufen § 33 EStG, SVS {satz(w.svs.pv)} / {satz(w.svs.kv)} / {satz(w.svs.sv)}, Mindestgrundlage {centText(Math.round(w.svs.mindestMonat * 100))} im Monat. Stand{' '}
              {isoDatumText(w.stand)}.
            </li>
          </ul>
        </details>
      </div>
    </>
  );
}
