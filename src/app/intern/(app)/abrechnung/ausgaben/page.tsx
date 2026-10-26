import type { Metadata } from 'next';
import { ExportFormular } from '@/components/abrechnung/ExportFormular';
import { KennzahlLeiste } from '@/components/abrechnung/Kennzahlen';
import { ReiterLeiste } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { centText } from '@/lib/abrechnung/geld';
import { zeitraumVorlagen } from '@/lib/abrechnung/zeitraum';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { alleAusgaben } from '@/lib/ausgaben/ausgaben';
import { eingangListe } from '@/lib/ausgaben/eingang';
import { monatTitel } from '@/lib/ausgaben/text';
import { heuteIso } from '@/lib/format';
import { kiStand } from '@/lib/ki/einstellungen';
import { fixkostenNachziehen, offeneLaeufe } from '@/lib/fixkosten/vorlagen';
import { AusgabenTabelle, BelegeHochladen, FixkostenFaellig, NeueAusgabe, ZuPruefen } from './Ausgaben';

export const metadata: Metadata = { title: 'Ausgaben · Digital Dental Lab' };

const TABS = ['liste', 'pruefen', 'ohne', 'export'] as const;
type Tab = (typeof TABS)[number];

/**
 * «Ausgaben» (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶؛ فقط Inhaber): هزینه‌های لابراتوار از روی Rechnungها، برای
 * Einnahmen-Ausgaben-Rechnung. بالا نوار عددها (هم‌زمان تب): سال انتخاب‌شده، این ماه، «Zu prüfen»، بدون Beleg،
 * Export (ZIP با Excel و همهٔ Belegها برای Steuerberatung). جدول ماه به ماه بر اساس «Bezahlt am»؛ کلیک روی هر
 * ردیف پنجرهٔ Beleg و فرم تغییر را باز می‌کند. قدم ۲: «Beleg hochladen» ← Claude می‌خواند ← «Zu prüfen» ←
 * «Übernehmen» (`lib/ausgaben/eingang.ts`).
 */
export default async function Ausgaben({ searchParams }: { searchParams: Promise<{ tab?: string; jahr?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten')) {
    return (
      <Seitenkopf eyebrow="Ausgaben" titel="Kein Zugriff.">
        Die Ausgaben sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  const heute = heuteIso();
  await fixkostenNachziehen();
  const [alle, eingang, laeufe, ki, { tab: t, jahr: j }] = await Promise.all([alleAusgaben(), eingangListe(), offeneLaeufe(), kiStand(), searchParams]);
  const zuPruefen = eingang.length + laeufe.length;
  const tab: Tab = TABS.includes(t as Tab) ? (t as Tab) : 'liste';
  const jahre = [...new Set([heute.slice(0, 4), ...alle.map((a) => a.bezahltAm.slice(0, 4))])].sort().reverse();
  const jahr = j && jahre.includes(j) ? j : heute.slice(0, 4);
  const imJahr = alle.filter((a) => a.bezahltAm.startsWith(jahr));
  const imMonat = alle.filter((a) => a.bezahltAm.startsWith(heute.slice(0, 7)));
  const ohneBeleg = alle.filter((a) => !a.beleg);
  const summe = (xs: typeof alle) => xs.reduce((s, a) => s + a.bruttoCent, 0);
  const vorlagen = zeitraumVorlagen(heute);

  return (
    <>
      <Seitenkopf eyebrow="Abrechnung" titel="Ausgaben" kompakt info="Jede Ausgabe mit Rechnung und Beleg. DDL ist unecht steuerbefreit (§ 6 Abs. 1 Z 20 UStG): keine Vorsteuer, als Ausgabe zählt der Bruttobetrag." />

      <div className="-mt-4 mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <BelegeHochladen kiAktiv={ki.gesetzt} />
        <NeueAusgabe heute={heute} />
      </div>

      <KennzahlLeiste
        label="Bereiche der Ausgaben"
        aktiv={tab}
        eintraege={[
          {
            tab: 'liste',
            titel: `Ausgaben ${jahr}`,
            wert: centText(summe(imJahr)),
            zusatz: `${imJahr.length} ${imJahr.length === 1 ? 'Rechnung' : 'Rechnungen'}`,
          },
          {
            titel: monatTitel(heute.slice(0, 7)),
            wert: centText(summe(imMonat)),
            zusatz: `${imMonat.length} ${imMonat.length === 1 ? 'Rechnung' : 'Rechnungen'}`,
          },
          {
            tab: 'pruefen',
            titel: 'Zu prüfen',
            wert: zuPruefen ? <span className="text-rose">{zuPruefen}</span> : '0',
            zusatz: zuPruefen ? (laeufe.length && !eingang.length ? 'Fixkosten bestätigen' : 'Beleg bestätigen') : ki.gesetzt ? 'KI liest Belege' : 'KI aus',
          },
          {
            tab: 'ohne',
            titel: 'Ohne Beleg',
            wert: ohneBeleg.length ? <span className="text-rose">{ohneBeleg.length}</span> : '0',
            zusatz: ohneBeleg.length ? 'Beleg nachreichen' : 'Alle Belege da',
          },
          { tab: 'export', titel: 'Export', wert: 'ZIP', zusatz: 'Excel und Belege' },
        ]}
      />

      <section aria-label={TITEL[tab]} className="pt-10">
        {tab === 'liste' ? (
          <>
            {jahre.length > 1 ? (
              <div className="mb-6">
                <ReiterLeiste klein label="Jahr" reiter={jahre.map((x) => ({ key: String(x), href: `?jahr=${x}`, aktiv: x === jahr, inhalt: x }))} />
              </div>
            ) : null}
            <AusgabenTabelle zeilen={imJahr} alle={alle} heute={heute} leer={`Für ${jahr} sind noch keine Ausgaben erfasst.`} />
          </>
        ) : null}

        {tab === 'pruefen' ? (
          <>
            <p className="mb-2 max-w-[680px] text-[13px] text-muted">
              Hochgeladene Belege, noch keine Ausgaben. Ein Klick zeigt Beleg und Formular; erst »Übernehmen« speichert die Ausgabe.
            </p>
            <FixkostenFaellig laeufe={laeufe} heute={heute} />
            <ZuPruefen zeilen={eingang} heute={heute} kiAktiv={ki.gesetzt} />
          </>
        ) : null}

        {tab === 'ohne' ? (
          <>
            <p className="mb-2 text-[13px] text-muted">Ausgaben ohne Foto oder PDF der Rechnung. Ein Klick öffnet die Ausgabe; dort den Beleg wählen.</p>
            <AusgabenTabelle zeilen={ohneBeleg} alle={alle} heute={heute} leer="Alle Ausgaben haben einen Beleg." />
          </>
        ) : null}

        {tab === 'export' ? (
          <>
            <p className="mb-8 max-w-[680px] text-[13px] text-muted">
              Alle Ausgaben eines Zeitraums (nach »Bezahlt am«) als ZIP: eine Excel-Liste und jeder Beleg als eigene Datei, im Namen Datum, Lieferant und Nummer. Nichts muss
              ausgedruckt werden.
            </p>
            <ExportFormular von={vorlagen[0].von} bis={vorlagen[0].bis} vorlagen={vorlagen} ziel="/api/ausgaben/export" knopf="ZIP herunterladen" />
          </>
        ) : null}
      </section>
    </>
  );
}

const TITEL: Record<Tab, string> = {
  liste: 'Ausgaben nach Monat',
  pruefen: 'Belege zu prüfen',
  ohne: 'Ausgaben ohne Beleg',
  export: 'Export für die Steuerberatung',
};
