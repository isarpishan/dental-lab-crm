import type { Metadata } from 'next';
import { KennzahlLeiste } from '@/components/abrechnung/Kennzahlen';
import { NeueBuchung, PrivatTabelle } from '@/components/privat/Privat';
import { ReiterLeiste } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { BelegeHochladen, ZuPruefen } from '@/app/intern/(app)/abrechnung/ausgaben/Ausgaben';
import { centText } from '@/lib/abrechnung/geld';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { eingangListe } from '@/lib/ausgaben/eingang';
import { monatTitel } from '@/lib/ausgaben/text';
import { fixkostenNachziehen } from '@/lib/fixkosten/vorlagen';
import { heuteIso } from '@/lib/format';
import { kiStand } from '@/lib/ki/einstellungen';
import { allePrivat } from '@/lib/privat/buchungen';
import { zaehltImErgebnis } from '@/lib/privat/text';

export const metadata: Metadata = { title: 'Privat · Buchungen · Digital Dental Lab' };

const TABS = ['liste', 'pruefen'] as const;
type Tab = (typeof TABS)[number];

/**
 * «Buchungen» Privat (Spec فاز ۵، قدم ۲): نوار عددها (هم‌زمان تب)، «Beleg hochladen» (همان Eingang با `bereich=privat`؛
 * Claude می‌خواند) و «+ Neue Buchung». فهرست ماه‌به‌ماه؛ «Zu prüfen» همان کامپوننت Ausgaben با Belegهای Privat.
 */
export default async function PrivatBuchungen({ searchParams }: { searchParams: Promise<{ tab?: string; jahr?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'privat.verwalten')) {
    return (
      <Seitenkopf eyebrow="Privat" titel="Kein Zugriff.">
        Diesen Bereich sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  const heute = heuteIso();
  await fixkostenNachziehen();
  const [alle, eingang, ki, { tab: t, jahr: j }] = await Promise.all([allePrivat(), eingangListe('privat'), kiStand(), searchParams]);
  const tab: Tab = TABS.includes(t as Tab) ? (t as Tab) : 'liste';
  const jahre = [...new Set([heute.slice(0, 4), ...alle.map((b) => b.datum.slice(0, 4))])].sort().reverse();
  const jahr = j && jahre.includes(j) ? j : heute.slice(0, 4);
  const imJahr = alle.filter((b) => b.datum.startsWith(jahr));
  // verliehenes Geld und Rückzahlungen zählen nicht als Ausgabe oder Einnahme
  const summe = (art: 'ausgabe' | 'einnahme', xs = imJahr) => xs.filter((b) => b.art === art && zaehltImErgebnis(b.kategorie)).reduce((s, b) => s + b.betragCent, 0);
  const imMonat = alle.filter((b) => b.datum.startsWith(heute.slice(0, 7)));

  return (
    <>
      <Seitenkopf eyebrow="Privat" titel="Buchungen" kompakt info="Private Einnahmen und Ausgaben. Belege liest die KI wie bei den Ausgaben des Labors; gespeichert wird erst mit »Übernehmen«." />

      <div className="-mt-4 mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <BelegeHochladen kiAktiv={ki.gesetzt} bereich="privat" />
        <NeueBuchung heute={heute} />
      </div>

      <KennzahlLeiste
        label="Bereiche der Buchungen"
        aktiv={tab}
        eintraege={[
          { tab: 'liste', titel: `Ausgaben ${jahr}`, wert: centText(summe('ausgabe')), zusatz: `${imJahr.length} ${imJahr.length === 1 ? 'Buchung' : 'Buchungen'}` },
          { titel: `Einnahmen ${jahr}`, wert: centText(summe('einnahme')), zusatz: 'Gehalt, Entnahmen und mehr' },
          { titel: monatTitel(heute.slice(0, 7)), wert: centText(summe('ausgabe', imMonat)), zusatz: 'ausgegeben' },
          {
            tab: 'pruefen',
            titel: 'Zu prüfen',
            wert: eingang.length ? <span className="text-rose">{eingang.length}</span> : '0',
            zusatz: eingang.length ? 'Beleg bestätigen' : ki.gesetzt ? 'KI liest Belege' : 'KI aus',
          },
        ]}
      />

      <section aria-label={tab === 'liste' ? 'Buchungen nach Monat' : 'Belege zu prüfen'} className="pt-10">
        {tab === 'liste' ? (
          <>
            {jahre.length > 1 ? (
              <div className="mb-6">
                <ReiterLeiste klein label="Jahr" reiter={jahre.map((x) => ({ key: x, href: `?jahr=${x}`, aktiv: x === jahr, inhalt: x }))} />
              </div>
            ) : null}
            <PrivatTabelle zeilen={imJahr} alle={alle} heute={heute} leer={`Für ${jahr} gibt es noch keine Buchungen.`} />
          </>
        ) : (
          <>
            <p className="mb-2 max-w-[680px] text-[13px] text-muted">
              Private Belege, noch nicht gebucht. Ein Klick zeigt Beleg und Formular; erst »Übernehmen« speichert. Gehört ein Beleg doch zum Labor, oben »DDL-Labor« wählen.
            </p>
            <ZuPruefen zeilen={eingang} heute={heute} kiAktiv={ki.gesetzt} />
          </>
        )}
      </section>
    </>
  );
}
