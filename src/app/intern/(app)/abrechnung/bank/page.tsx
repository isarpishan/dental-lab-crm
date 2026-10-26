import type { Metadata } from 'next';
import Link from 'next/link';
import { KennzahlLeiste } from '@/components/abrechnung/Kennzahlen';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { centText } from '@/lib/abrechnung/geld';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { bankDaten } from '@/lib/bank/auszuege';
import { fixkostenNachziehen } from '@/lib/fixkosten/vorlagen';
import { heuteIso, isoDatumText } from '@/lib/format';
import { kiStand } from '@/lib/ki/einstellungen';
import { AuszugHochladen, AuszugListe, SichereUebernehmen, UmsatzListe } from './Bank';

export const metadata: Metadata = { title: 'Bank · Digital Dental Lab' };

const TABS = ['klaeren', 'beleg', 'erledigt', 'auszuege'] as const;
type Tab = (typeof TABS)[number];

/**
 * «Bank» (Spec فاز ۵، قدم ۴؛ فقط Inhaber، حساب مخلوط شخصی و لابراتوار است): Kontoauszug PDF ← Claude ← هر ردیف
 * با پیشنهاد (Rechnung، Ausgabe، Privat، Beleg fehlt، Ignorieren). هیچ‌چیز بدون تأیید ثبت نمی‌شود.
 */
export default async function Bank({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten')) {
    return (
      <Seitenkopf eyebrow="Bank" titel="Kein Zugriff.">
        Die Bank sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  await fixkostenNachziehen();
  const heute = heuteIso();
  const [d, ki, { tab: t }] = await Promise.all([bankDaten(), kiStand(), searchParams]);
  const tab: Tab = TABS.includes(t as Tab) ? (t as Tab) : 'klaeren';
  const sicher = d.klaeren.filter((z) => z.vorschlag?.sicher).length;
  const problem = d.auszuege.some((a) => a.status === 'fehler' || a.luecke);

  return (
    <>
      <Seitenkopf
        eyebrow="Abrechnung"
        titel="Bank"
        kompakt
        info="Kontoauszüge der BAWAG als PDF oder die Umsätze als CSV (Export im eBanking). Die KI schlägt für jede Zeile vor, wohin sie gehört; gespeichert wird erst, wenn Sie übernehmen. Ein PDF-Auszug zählt nur, wenn alle Zeilen zusammen den neuen Kontostand ergeben. Zeilen, die schon da sind, kommen nicht doppelt."
      />
      <div className="-mt-4 mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <AuszugHochladen kiAktiv={ki.gesetzt} />
        {ki.gesetzt ? null : (
          <span className="text-[13px] text-rose">
            Die KI ist aus.{' '}
            <Link href="/einstellungen/ki" className="border-b border-current">
              Einstellungen → KI
            </Link>
          </span>
        )}
      </div>

      <KennzahlLeiste
        label="Bereiche der Bank"
        aktiv={tab}
        eintraege={[
          {
            tab: 'klaeren',
            titel: 'Zu klären',
            wert: d.klaeren.length ? <span className="text-rose">{d.klaeren.length}</span> : '0',
            zusatz: d.klaeren.length ? (sicher ? `${sicher} sichere Vorschläge` : 'bitte zuordnen') : 'alles zugeordnet',
          },
          {
            tab: 'beleg',
            titel: 'Beleg fehlt',
            wert: d.belegFehlt.length ? <span className="text-rose">{d.belegFehlt.length}</span> : '0',
            zusatz: d.belegFehlt.length ? `${centText(-d.belegFehlt.reduce((s, z) => s + z.betragCent, 0))} ohne Ausgabe` : 'alle Labor-Zahlungen erfasst',
          },
          { tab: 'erledigt', titel: 'Zugeordnet', wert: String(d.erledigt.length), zusatz: 'Zeilen' },
          {
            tab: 'auszuege',
            titel: 'Kontostand',
            wert: d.kontostand ? centText(d.kontostand.cent) : '–',
            zusatz: problem ? (
              <span className="text-rose">Kontoauszug prüfen</span>
            ) : d.kontostand ? (
              `laut Auszug vom ${isoDatumText(d.kontostand.datum)}`
            ) : (
              'noch kein Auszug'
            ),
          },
        ]}
      />

      <section aria-label={TITEL[tab]} className="pt-10">
        {tab === 'klaeren' ? (
          <>
            <p className="mb-6 max-w-[760px] text-[13px] text-muted">
              Jede Zeile mit dem Vorschlag der KI. »Übernehmen« bucht ihn, »Ändern …« zeigt alle Möglichkeiten. Privat wird zur Privat-Buchung, Labor-Eingänge zur Zahlung einer Rechnung.
            </p>
            <SichereUebernehmen anzahl={sicher} />
            <UmsatzListe zeilen={d.klaeren} modus="klaeren" rechnungen={d.rechnungen} ausgaben={d.ausgaben} heute={heute} leer="Nichts zu klären. Neue Zeilen kommen mit dem nächsten Kontoauszug." />
          </>
        ) : null}
        {tab === 'beleg' ? (
          <>
            <p className="mb-6 max-w-[760px] text-[13px] text-muted">
              Zahlungen des Labors ohne erfasste Ausgabe. Kommt der Beleg später (hochladen unter Ausgaben), erscheint hier »Verbinden«; sonst direkt »Als Ausgabe erfassen«.
            </p>
            <UmsatzListe zeilen={d.belegFehlt} modus="beleg" rechnungen={d.rechnungen} ausgaben={d.ausgaben} heute={heute} leer="Keine Zahlung des Labors ohne Beleg." />
          </>
        ) : null}
        {tab === 'erledigt' ? (
          <UmsatzListe zeilen={d.erledigt} modus="erledigt" rechnungen={d.rechnungen} ausgaben={d.ausgaben} heute={heute} leer="Noch nichts zugeordnet." />
        ) : null}
        {tab === 'auszuege' ? <AuszugListe auszuege={d.auszuege} kiAktiv={ki.gesetzt} /> : null}
      </section>
    </>
  );
}

const TITEL: Record<Tab, string> = {
  klaeren: 'Bankzeilen zu klären',
  beleg: 'Zahlungen ohne Beleg',
  erledigt: 'Zugeordnete Bankzeilen',
  auszuege: 'Kontoauszüge',
};
