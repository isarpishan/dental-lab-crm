import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KennzahlLeiste } from '@/components/abrechnung/Kennzahlen';
import { OffeneMonate } from '@/components/abrechnung/OffeneMonate';
import { RechnungenListe } from '@/components/abrechnung/RechnungenListe';
import { Meldung } from '@/components/ui/Formular';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices } from '@/db/schema';
import { konto } from '@/lib/abrechnung/daten';
import { centText, summeOderNull } from '@/lib/abrechnung/geld';
import { saldoAus } from '@/lib/abrechnung/offen';
import { rechnungenVon } from '@/lib/abrechnung/rechnung';
import { rechnungsAdresse } from '@/lib/abrechnung/versand';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { heuteIso } from '@/lib/format';
import { gutschriftAusstellen, mahnungErstellen, mahnungNochmalSenden, rechnungSenden, zahlungErfassen, zahlungLoeschen } from '../actions';

export const metadata: Metadata = { title: 'Konto · Digital Dental Lab' };

const TABS = ['arbeiten', 'rechnungen'] as const;
type Tab = (typeof TABS)[number];

/**
 * «Konto» یک Ordination (Spec فاز ۲، بخش 6a): بالا نوار عددها (کارهای فاکتورنشده، Saldo، در جریان، نوع
 * Abrechnung) که دو خانهٔ اولش تب‌اند: کارهای فاکتورنشده ماه‌به‌ماه، و Rechnungها با پرداخت و ارسال (قدم ۳).
 * تب پیش‌فرض: بعد از صدور یا وقتی کاری باز نیست «Rechnungen»، وگرنه «Noch nicht verrechnet».
 */
export default async function Konto({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    ausgestellt?: string;
    versand?: string;
    tab?: string;
  }>;
}) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'abrechnung.sehen')) {
    return (
      <Seitenkopf eyebrow="Abrechnung" titel="Kein Zugriff.">
        Diese Seite ist für Ihre Rolle nicht freigegeben.
      </Seitenkopf>
    );
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = await db()
    .select({
      id: practices.id,
      name: practices.name,
      customerNo: practices.customerNo,
      billingMode: practices.billingMode,
      email: practices.email,
      billingEmail: practices.billingEmail,
    })
    .from(practices)
    .where(eq(practices.id, id))
    .limit(1);
  if (!p) notFound();
  const heute = heuteIso();
  const [k, rechnungen, { ausgestellt, versand, tab: t }] = await Promise.all([konto(id), rechnungenVon(id, heute), searchParams]);
  const anzahl = k.gruppen.reduce((s, g) => s + g.faelle.length, 0);
  const bearbeiten = darf(user.role, 'abrechnung.bearbeiten');
  const neu = ausgestellt ? rechnungen.find((r) => r.nummer === ausgestellt) : undefined;
  const an = rechnungsAdresse(p);
  const saldo = saldoAus(rechnungen.flatMap((r) => (r.stand ? [{ stand: r.stand, faelligAm: r.faelligAm }] : [])));

  const tab: Tab = TABS.includes(t as Tab) ? (t as Tab) : ausgestellt || !anzahl ? 'rechnungen' : 'arbeiten';

  return (
    <>
      <Seitenkopf eyebrow={`Konto · ${p.customerNo}`} titel={p.name} kompakt>
        {an ? `Rechnungen gehen per E-Mail an ${an}.` : 'Für Rechnungen per E-Mail fehlt eine Adresse.'}{' '}
        <Link href={`/ordinationen/${p.id}`} className="underline underline-offset-4 hover:text-white">
          {an ? 'Stammdaten ändern' : 'In den Stammdaten eintragen'}
        </Link>
        <span className="mx-3">·</span>
        <Link href="/abrechnung" className="underline underline-offset-4 hover:text-white">
          Alle Ordinationen
        </Link>
      </Seitenkopf>

      {neu ? (
        <div className="mb-10 max-w-[680px]">
          <Meldung art="erfolg">
            Rechnung {neu.nummer} über {centText(neu.summeCent)} ausgestellt.{' '}
            {neu.versand[0] ? `Die E-Mail an ${neu.versand[0].an} wird gesendet. ` : versand === 'fehler' ? 'Nicht per E-Mail gesendet, bitte unten erneut versuchen. ' : ''}
            <a href={`/api/rechnungen/${neu.id}`} target="_blank" rel="noopener" className="underline underline-offset-4">
              PDF öffnen
            </a>
          </Meldung>
        </div>
      ) : null}

      <KennzahlLeiste
        label="Bereiche des Kontos"
        aktiv={tab}
        eintraege={[
          {
            tab: 'arbeiten',
            titel: 'Noch nicht verrechnet',
            wert: anzahl ? (summeOderNull(k.cent, k.ohnePreis, anzahl) == null ? '–' : centText(k.cent)) : centText(0),
            zusatz: anzahl ? (
              <>
                {anzahl} {anzahl === 1 ? 'Auftrag' : 'Aufträge'}
                {k.ohnePreis ? <span className="text-rose"> · {k.ohnePreis} noch ohne Preis</span> : null}
              </>
            ) : (
              'Nichts offen'
            ),
          },
          {
            tab: 'rechnungen',
            titel: 'Rechnungen',
            wert: centText(Math.abs(saldo.offenCent)),
            zusatz: !rechnungen.length ? (
              'Noch keine Rechnungen'
            ) : saldo.offenCent === 0 ? (
              'Alles bezahlt. Nichts offen.'
            ) : saldo.offenCent < 0 ? (
              'Guthaben der Ordination'
            ) : (
              <>
                offen aus {saldo.offeneRechnungen} {saldo.offeneRechnungen === 1 ? 'Rechnung' : 'Rechnungen'}
                {saldo.ueberfaelligCent > 0 ? <span className="block text-rose">davon {centText(saldo.ueberfaelligCent)} überfällig</span> : null}
              </>
            ),
          },
          {
            titel: 'In Arbeit',
            wert: String(k.inArbeit),
            zusatz: k.inArbeit ? 'kommen mit Freigabe oder Übergabe dazu' : 'keine Aufträge',
          },
          {
            titel: 'Abrechnung',
            wert: p.billingMode === 'sammel' ? 'Sammel' : 'Einzel',
            zusatz: p.billingMode === 'sammel' ? 'eine Rechnung pro Monat' : 'eine Rechnung pro Auftrag',
          },
        ]}
      />

      {tab === 'arbeiten' ? (
        <section aria-label="Noch nicht verrechnet" className="pt-10">
          <p className="mb-8 text-[13px] text-muted">
            Fertig gelieferte Arbeiten und freigegebene Designs, die noch auf keiner Rechnung stehen. Beträge netto, nach Leistungsdatum.
          </p>
          {anzahl ? (
            <OffeneMonate gruppen={k.gruppen} practiceId={bearbeiten ? p.id : undefined} einzeln={p.billingMode === 'einzel'} />
          ) : (
            <p className="text-[15px] font-light text-muted">Nichts offen.</p>
          )}
          {k.inArbeit ? (
            <p className="mt-8 text-[13px] text-muted">
              {k.inArbeit} {k.inArbeit === 1 ? 'Auftrag ist' : 'Aufträge sind'} noch in Arbeit und {k.inArbeit === 1 ? 'kommt' : 'kommen'} mit der Freigabe oder Übergabe dazu.
            </p>
          ) : null}
        </section>
      ) : (
        <section aria-label="Rechnungen" className="pt-10">
          <p className="mb-8 text-[13px] text-muted">
            Ausgestellte Rechnungen und Gutschriften mit Zahlungen, die neueste zuerst. Rechnungen lassen sich nicht ändern, nur mit einer Gutschrift oder Stornorechnung
            korrigieren.
          </p>
          {rechnungen.length ? (
            <RechnungenListe
              rechnungen={rechnungen}
              heute={heute}
              an={an}
              stammdaten={`/ordinationen/${p.id}`}
              aktionen={
                bearbeiten
                  ? {
                      gutschrift: gutschriftAusstellen,
                      senden: rechnungSenden,
                      zahlung: zahlungErfassen,
                      zahlungLoeschen,
                      mahnen: mahnungErstellen,
                      mahnungNochmal: mahnungNochmalSenden,
                    }
                  : undefined
              }
            />
          ) : (
            <p className="text-[15px] font-light text-muted">Noch keine Rechnungen.</p>
          )}
        </section>
      )}
    </>
  );
}
