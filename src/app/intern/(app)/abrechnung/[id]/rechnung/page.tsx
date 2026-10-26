import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AusstellenFormular } from '@/components/abrechnung/AusstellenFormular';
import { PdfVorschau } from '@/components/abrechnung/PdfVorschau';
import { NEBEN_RASTER, NEBEN_VORSCHAU } from '@/components/abrechnung/vorschau-raster';
import { RechnungsZeilen } from '@/components/abrechnung/RechnungsZeilen';
import { Meldung } from '@/components/ui/Formular';
import { SectionRow } from '@/components/ui/SectionRow';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices } from '@/db/schema';
import { monatName } from '@/lib/abrechnung/leistung';
import { entwurf, type Auswahl } from '@/lib/abrechnung/rechnung';
import { ibanFormat } from '@/lib/abrechnung/rechnungsdaten';
import { rechnungsAdresse } from '@/lib/abrechnung/versand';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { isoDatumText } from '@/lib/format';
import { rechnungAusstellen } from '../../actions';

export const metadata: Metadata = { title: 'Rechnung · Digital Dental Lab' };

/**
 * پیش‌نمایش Rechnung پیش از صدور (Spec فاز ۲، قدم ۲): Sammelrechnung یک ماه (`?monat=2026-09`) یا
 * Einzelrechnung یک سفارش (`?auftrag=<id>`). مثل «Einstellungen»: داده‌ها، پوزیشن‌ها و «Ausstellen» چپ، خود
 * PDF با مُهر «VORSCHAU» راست (مثل arkan-crm). تا قیمتی کم یا داده‌ای در «Einstellungen» ناقص است، صدور بسته است.
 */
export default async function RechnungVorschau({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ monat?: string; auftrag?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'abrechnung.bearbeiten')) {
    return <Seitenkopf eyebrow="Abrechnung" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  }
  const [{ id }, { monat, auftrag }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const auswahl: Auswahl | null =
    monat && /^\d{4}-(0[1-9]|1[0-2])$/.test(monat) ? { monat } : auftrag && /^[0-9a-f-]{36}$/.test(auftrag) ? { orderId: auftrag } : null;
  if (!auswahl) notFound();
  const [e, [adresse]] = await Promise.all([entwurf(id, auswahl), db().select({ email: practices.email, billingEmail: practices.billingEmail }).from(practices).where(eq(practices.id, id)).limit(1)]);
  if (!e || !adresse) notFound();
  const gesperrt = !e.faelle.length || e.ohnePreis.length > 0 || e.fehlt.length > 0;
  const titel = 'monat' in auswahl ? `Sammelrechnung ${monatName(auswahl.monat)}.` : `Einzelrechnung ${e.faelle[0]?.orderNo ?? ''}.`;

  return (
    <>
      <Seitenkopf eyebrow={`Rechnung · ${e.empfaenger.kundennummer}`} titel={titel} info={`Vorschau für ${e.empfaenger.name}. Die Rechnungsnummer wird beim Ausstellen vergeben.`} />

      {e.fehlt.length || e.ohnePreis.length || !e.faelle.length || e.monatLaeuft ? (
        <div className="mb-12 grid max-w-[760px] gap-4">
          {e.fehlt.length ? (
            <Meldung art="fehler">
              Bitte zuerst in den{' '}
              {darf(user.role, 'einstellungen.verwalten') ? (
                <Link href="/einstellungen" className="underline underline-offset-4">
                  Einstellungen
                </Link>
              ) : (
                'Einstellungen (Inhaber)'
              )}{' '}
              ergänzen: {e.fehlt.join(', ')}.
            </Meldung>
          ) : null}
          {e.ohnePreis.length ? (
            <Meldung art="fehler">
              Noch ohne Preis:{' '}
              {e.ohnePreis.map((f, i) => (
                <span key={f.orderId}>
                  {i ? ', ' : ''}
                  <Link href={`/auftraege/${f.orderId}?tab=abrechnung`} className="underline underline-offset-4">
                    {f.orderNo}
                  </Link>
                </span>
              ))}
              . Bitte die Positionen ergänzen.
            </Meldung>
          ) : null}
          {!e.faelle.length ? <Meldung art="fehler">Nichts zu verrechnen: diese Arbeiten stehen schon auf einer Rechnung oder sind noch nicht fertig.</Meldung> : null}
          {e.monatLaeuft && e.faelle.length ? (
            <p className="text-[15px] font-light text-muted">Hinweis: Der Monat läuft noch. Spätere Arbeiten dieses Monats kommen dann auf eine weitere Rechnung.</p>
          ) : null}
        </div>
      ) : null}

      <div className={e.faelle.length ? NEBEN_RASTER : undefined}>
        <div className="min-w-0">
          <SectionRow index="01" title="Angaben" lead="So stehen sie auf der Rechnung.">
            <dl className="grid max-w-[760px] gap-x-10 border-t border-line sm:grid-cols-2">
              {(
                [
                  ['Rechnung an', [e.empfaenger.name, ...e.empfaenger.zeilen].join(', ')],
                  ['Aussteller', [e.aussteller.name, e.aussteller.strasse, `${e.aussteller.ort}`].join(', ')],
                  ['Rechnungsdatum', isoDatumText(e.datum)],
                  [e.zeitraum[0] === e.zeitraum[1] ? 'Leistungsdatum' : 'Leistungszeitraum', e.zeitraum[0] === e.zeitraum[1] ? isoDatumText(e.zeitraum[0]) : `${isoDatumText(e.zeitraum[0])} – ${isoDatumText(e.zeitraum[1])}`],
                  ['Fällig am', `${isoDatumText(e.faellig)} (${e.aussteller.zahlungszielTage} Tage)`],
                  ['Zahlung auf', e.aussteller.iban ? `IBAN ${ibanFormat(e.aussteller.iban)}` : '–'],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="border-b border-line py-4">
                  <dt className="text-[13px] text-muted">{k}</dt>
                  <dd className="mt-1 text-[15px] font-light">{v}</dd>
                </div>
              ))}
            </dl>
          </SectionRow>

          <SectionRow index="02" title="Positionen" lead={`${e.faelle.length} ${e.faelle.length === 1 ? 'Auftrag' : 'Aufträge'}. Ändern über den Tab »Abrechnung« des Auftrags.`}>
            {e.zeilen.length ? <RechnungsZeilen zeilen={e.zeilen} summeCent={e.summeCent} hinweis={e.aussteller.hinweis} /> : <p className="text-[15px] font-light text-muted">Keine Positionen.</p>}
          </SectionRow>

          <SectionRow index="03" title="Ausstellen" lead="Vergibt die nächste Rechnungsnummer und legt das PDF unveränderlich ab.">
            <AusstellenFormular
              practiceId={id}
              monat={'monat' in auswahl ? auswahl.monat : undefined}
              orderId={'orderId' in auswahl ? auswahl.orderId : undefined}
              gesperrt={gesperrt}
              an={rechnungsAdresse(adresse)}
              stammdaten={`/ordinationen/${id}`}
              aktion={rechnungAusstellen}
            />
          </SectionRow>
        </div>
        {e.faelle.length ? (
          <aside className={NEBEN_VORSCHAU} aria-label="Vorschau der Rechnung">
            <PdfVorschau
              src={`/api/abrechnung/vorschau?${new URLSearchParams({ art: 'rechnung', ordination: id, ...('monat' in auswahl ? { monat: auswahl.monat } : { auftrag: auswahl.orderId }) })}`}
              titel={`Vorschau: ${titel}`}
              hinweis="So wird die Rechnung aussehen"
            />
          </aside>
        ) : null}
      </div>

      <p className="mt-6 border-t border-line pt-8">
        <Link href={`/abrechnung/${id}`} className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
          Zurück zum Konto
        </Link>
      </p>
    </>
  );
}
