import type { Metadata } from 'next';
import Link from 'next/link';
import { ExportFormular } from '@/components/abrechnung/ExportFormular';
import { KennzahlLeiste, TabellenKopf } from '@/components/abrechnung/Kennzahlen';
import { MahnungenListe } from '@/components/abrechnung/MahnungenListe';
import { OffeneRechnungenListe } from '@/components/abrechnung/OffeneRechnungenListe';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { offenePosten, offeneRechnungen, uebersicht } from '@/lib/abrechnung/daten';
import { centText, summeOderNull } from '@/lib/abrechnung/geld';
import { monatName } from '@/lib/abrechnung/leistung';
import { faelligeMahnungen } from '@/lib/abrechnung/mahnung';
import { zeitraumVorlagen } from '@/lib/abrechnung/zeitraum';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { heuteIso } from '@/lib/format';
import { mahnungenErstellen, mahnungErstellen, zahlungErfassen } from './actions';

export const metadata: Metadata = { title: 'Abrechnung · Digital Dental Lab' };

const TABS = ['verrechnen', 'offen', 'mahnungen', 'export'] as const;
type Tab = (typeof TABS)[number];

// ستون‌های جدول‌ها (دسکتاپ)؛ سرستون‌ها همان grid را دارند
const SPALTEN_VERRECHNEN = 'lg:grid-cols-[minmax(0,1.5fr)_140px_minmax(0,1.6fr)_150px_16px]';
const ZEILE = 'group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 py-4';
const PFEIL = 'hidden text-rose transition-transform duration-[180ms] group-hover:translate-x-1 lg:block';

/**
 * صفحهٔ کلی «Abrechnung» برای Büro (Spec فاز ۲، بخش 6a). بالا نوار عددها که هم‌زمان تب است: کارهای
 * فاکتورنشده، Rechnungهای باز (قدم ۳)، Mahnungهای رسیده (قدم ۴) و خروجی Excel برای Steuerberater (قدم ۵).
 * هر تب یک جدول فشرده است و هر ردیف به «Konto» همان Ordination می‌رود.
 */
export default async function Abrechnung({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'abrechnung.sehen')) {
    return (
      <Seitenkopf eyebrow="Abrechnung" titel="Kein Zugriff.">
        Diese Seite ist für Ihre Rolle nicht freigegeben.
      </Seitenkopf>
    );
  }
  const heute = heuteIso();
  const bearbeiten = darf(user.role, 'abrechnung.bearbeiten');
  const [zeilen, posten, rechnungen, mahnungen, { tab: t }] = await Promise.all([uebersicht(), offenePosten(heute), offeneRechnungen(heute), faelligeMahnungen(heute), searchParams]);
  const tab: Tab = TABS.includes(t as Tab) ? (t as Tab) : 'verrechnen';
  const gesamt = zeilen.reduce((s, z) => s + z.cent, 0);
  const ohnePreis = zeilen.reduce((s, z) => s + z.ohnePreis, 0);
  const offen = posten.reduce((s, p) => s + Math.max(p.offenCent, 0), 0);
  const ueberfaellig = posten.reduce((s, p) => s + p.ueberfaelligCent, 0);
  const guthaben = posten.filter((p) => p.offenCent < 0);
  const vorlagen = zeitraumVorlagen(heute);

  return (
    <>
      <Seitenkopf eyebrow="Abrechnung" titel="Abrechnung" kompakt info="Beträge netto. Ordinationen mit Sammelrechnung werden einmal im Monat verrechnet." />

      <KennzahlLeiste
        label="Bereiche der Abrechnung"
        aktiv={tab}
        eintraege={[
          {
            tab: 'verrechnen',
            titel: 'Noch nicht verrechnet',
            wert: centText(gesamt),
            zusatz: zeilen.length ? (
              <>
                bei {zeilen.length} {zeilen.length === 1 ? 'Ordination' : 'Ordinationen'}
                {ohnePreis ? <span className="text-rose"> · {ohnePreis} ohne Preis</span> : null}
              </>
            ) : (
              'Alles verrechnet'
            ),
          },
          {
            tab: 'offen',
            titel: 'Offene Rechnungen',
            wert: centText(offen),
            zusatz: ueberfaellig > 0 ? <span className="text-rose">davon {centText(ueberfaellig)} überfällig</span> : posten.length ? 'nichts überfällig' : 'Alles bezahlt',
          },
          {
            tab: 'mahnungen',
            titel: 'Mahnungen',
            wert: mahnungen.length ? <span className="text-rose">{mahnungen.length}</span> : '0',
            zusatz: mahnungen.length ? 'zum Senden fällig' : 'Keine fällig',
          },
          {
            tab: 'export',
            titel: 'Export',
            wert: 'Excel',
            zusatz: 'für die Steuerberatung',
          },
        ]}
      />

      <section aria-label={TITEL[tab]} className="pt-10">
        {tab === 'verrechnen' ? (
          zeilen.length ? (
            <>
              <p className="mb-6 text-[13px] text-muted">Arbeiten mit Leistungsdatum, die noch auf keiner Rechnung stehen, nach Ordination. Größter Betrag zuerst.</p>
              <TabellenKopf spalten={SPALTEN_VERRECHNEN} namen={['Ordination', 'Abrechnung', 'Aufträge', { text: 'Betrag', rechts: true }, '']} />
              <ul aria-label="Ordinationen mit offenen Arbeiten" className="border-t border-line lg:border-t-0">
                {zeilen.map((z) => {
                  const art = z.billingMode === 'sammel' ? 'Sammelrechnung' : 'Einzelrechnung';
                  return (
                    <li key={z.id} className="border-b border-line">
                      <Link href={`/abrechnung/${z.id}`} className={`${ZEILE} ${SPALTEN_VERRECHNEN}`}>
                        <span className="min-w-0">
                          <span className="block truncate text-[17px] font-light group-hover:text-rose">{z.name}</span>
                          <span className="block text-[13px] text-muted">
                            {z.customerNo}
                            <span className="lg:hidden"> · {art}</span>
                          </span>
                        </span>
                        <span className="hidden text-[13px] text-paragraph lg:block">{art}</span>
                        <span className="col-span-2 row-start-2 text-[13px] text-muted lg:col-span-1 lg:row-start-auto">
                          {z.auftraege} {z.auftraege === 1 ? 'Auftrag' : 'Aufträge'} seit {monatName(z.aeltesterMonat)}
                          {z.frueher ? <span className="text-white"> · {z.frueher} aus Vormonaten</span> : null}
                          {z.ohnePreis ? <span className="text-rose"> · {z.ohnePreis} ohne Preis</span> : null}
                        </span>
                        <span className="col-start-2 row-start-1 text-right text-[17px] font-light lg:col-start-auto lg:row-start-auto">
                          {summeOderNull(z.cent, z.ohnePreis, z.auftraege) == null ? <span className="text-[15px] text-rose">Preise fehlen</span> : centText(z.cent)}
                        </span>
                        <span aria-hidden className={PFEIL}>
                          ↗
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-[15px] font-light text-muted">Alles verrechnet. Neue Arbeiten erscheinen hier nach der Freigabe oder Übergabe.</p>
          )
        ) : null}

        {tab === 'offen' ? (
          <>
            <p className="mb-6 max-w-[680px] text-[13px] text-muted">
              Was die Ordinationen noch zahlen müssen, je Rechnung. Ist das Geld am Konto, die Rechnungsnummer aus dem Verwendungszweck suchen und „Zahlung buchen“.
            </p>
            <OffeneRechnungenListe rechnungen={rechnungen} heute={heute} buchen={zahlungErfassen} darfBuchen={bearbeiten} />
            {guthaben.length ? (
              <p className="mt-8 text-[13px] text-muted">
                Guthaben:{' '}
                {guthaben.map((g, i) => (
                  <span key={g.id}>
                    {i ? ' · ' : ''}
                    <Link href={`/abrechnung/${g.id}`} className="underline underline-offset-4 hover:text-white">
                      {g.name}
                    </Link>{' '}
                    {centText(-g.offenCent)}
                  </span>
                ))}
              </p>
            ) : null}
          </>
        ) : null}

        {tab === 'mahnungen' ? (
          <>
            <p className="mb-6 text-[13px] text-muted">
              Rechnungen, bei denen die nächste Stufe fällig ist: Zahlungserinnerung, 1. Mahnung, 2. Mahnung. Nichts geht automatisch hinaus; die Tage stehen in den{' '}
              <Link href="/einstellungen" className="underline underline-offset-4 hover:text-white">
                Einstellungen
              </Link>
              .
            </p>
            {bearbeiten ? (
              <MahnungenListe eintraege={mahnungen} einzeln={mahnungErstellen} alle={mahnungenErstellen} />
            ) : (
              <p className="text-[15px] font-light text-muted">{mahnungen.length ? `${mahnungen.length} fällig.` : 'Keine Mahnung fällig.'}</p>
            )}
          </>
        ) : null}

        {tab === 'export' ? (
          <>
            <p className="mb-8 max-w-[680px] text-[13px] text-muted">
              Rechnungen, Gutschriften, Zahlungen und offene Posten eines Zeitraums als Excel-Datei. BMD und andere Programme lesen sie direkt.
            </p>
            <ExportFormular von={vorlagen[0].von} bis={vorlagen[0].bis} vorlagen={vorlagen} />
          </>
        ) : null}
      </section>
    </>
  );
}

const TITEL: Record<Tab, string> = {
  verrechnen: 'Noch nicht verrechnet',
  offen: 'Offene Rechnungen',
  mahnungen: 'Mahnungen',
  export: 'Export für die Steuerberatung',
};
