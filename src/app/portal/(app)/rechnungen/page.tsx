import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { SaldoZeile, ZahlstandText } from '@/components/abrechnung/Zahlstand';
import { SectionRow } from '@/components/ui/SectionRow';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { practices } from '@/db/schema';
import { belegTitel } from '@/lib/abrechnung/beleg';
import { centText } from '@/lib/abrechnung/geld';
import { MAHNSTUFE_NAMEN } from '@/lib/abrechnung/mahnwesen';
import { saldoAus } from '@/lib/abrechnung/offen';
import { rechnungenVon, rechnungsdatenLaden } from '@/lib/abrechnung/rechnung';
import { ibanFormat } from '@/lib/abrechnung/rechnungsdaten';
import { rechnungsAdresse } from '@/lib/abrechnung/versand';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { datum, heuteIso, isoDatumText } from '@/lib/format';

export const metadata: Metadata = { title: 'Rechnungen · Digital Dental Lab' };

/**
 * «Rechnungen» در پورتال (Spec فاز ۲، بخش 6a، قدم ۳): همهٔ Rechnungها و Gutschriftهای همین Ordination با
 * PDF و وضعیت پرداخت. فقط Praxis-Admin؛ `practice_id` همیشه از نشست (CLAUDE.md، قانون ۳). یادداشت‌های
 * داخلی پرداخت و ارسال اینجا نشان داده نمی‌شوند.
 */
export default async function Rechnungen() {
  const { user, praxis } = await praxisNutzerOderAnmelden();
  if (user.role !== 'praxis_admin') {
    return (
      <Seitenkopf eyebrow="Rechnungen" titel="Kein Zugriff.">
        Rechnungen sehen nur Praxis-Admins Ihrer Ordination.
      </Seitenkopf>
    );
  }
  const heute = heuteIso();
  const [rechnungen, { aussteller, daten }, [adresse]] = await Promise.all([
    rechnungenVon(praxis.id, heute),
    rechnungsdatenLaden(),
    db().select({ email: practices.email, billingEmail: practices.billingEmail }).from(practices).where(eq(practices.id, praxis.id)).limit(1),
  ]);
  const saldo = saldoAus(rechnungen.flatMap((r) => (r.stand ? [{ stand: r.stand, faelligAm: r.faelligAm }] : [])));
  const an = adresse ? rechnungsAdresse(adresse) : null;

  return (
    <>
      <Seitenkopf eyebrow="Rechnungen" titel="Rechnungen und Gutschriften." info={`Alle Rechnungen von Digital Dental Lab an ${praxis.name}, als PDF zum Öffnen und Drucken.${an ? ` Jede Rechnung schicken wir zusätzlich per E-Mail an ${an}.` : ''}`} />

      <SectionRow index="01" title="Offener Betrag" lead="Summe der noch nicht bezahlten Rechnungen und Gutschriften.">
        <SaldoZeile saldo={saldo} praxis />
        {saldo.offenCent > 0 && daten.iban ? (
          <dl className="grid max-w-[760px] border-t border-line text-[15px] sm:grid-cols-[180px_minmax(0,1fr)]">
            {[
              ['Empfänger', aussteller.name],
              ['IBAN', ibanFormat(daten.iban)],
              ...(daten.bic ? [['BIC', daten.bic]] : []),
              ['Verwendungszweck', 'die Rechnungsnummer'],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="border-b border-line pt-4 text-[13px] text-muted sm:py-4">{k}</dt>
                <dd className="min-w-0 break-words border-b border-line pb-4 font-light sm:py-4">{v}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </SectionRow>

      <SectionRow index="02" title="Rechnungen" lead="Neueste zuerst. Ein Klick auf die Nummer öffnet das PDF.">
        {rechnungen.length ? (
          <ul aria-label="Rechnungen und Gutschriften" className="border-t border-line">
            {rechnungen.map((r) => {
              const storniert = r.gutschriften.find((g) => g.storno);
              return (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8 gap-y-1 border-b border-line py-5">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <a href={`/api/rechnungen/${r.id}`} target="_blank" rel="noopener" className="text-[18px] font-light hover:text-rose">
                        {r.nummer}
                      </a>
                      <span className="text-[13px] text-muted">
                        {belegTitel(r)} vom {datum(r.ausgestelltAm)}
                        {r.zeitraumVon && r.zeitraumBis
                          ? ` · ${r.zeitraumVon === r.zeitraumBis ? `Leistung ${isoDatumText(r.zeitraumVon)}` : `${isoDatumText(r.zeitraumVon)} – ${isoDatumText(r.zeitraumBis)}`}`
                          : ''}
                      </span>
                    </p>
                    <p className="mt-1 text-[13px]">
                      {r.stand ? (
                        <>
                          <ZahlstandText stand={r.stand} faelligAm={r.faelligAm} letzteZahlung={r.zahlungen.at(-1)?.am ?? null} storniertMit={storniert?.nummer} />
                          {r.mahnungen.length && r.stand.offenCent > 0 ? (
                            <span className="text-muted">
                              {' '}
                              ·{' '}
                              <a href={`/api/mahnungen/${r.mahnungen.at(-1)!.id}`} target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-white">
                                {MAHNSTUFE_NAMEN[r.mahnungen.at(-1)!.stufe]} vom {datum(r.mahnungen.at(-1)!.am)}
                              </a>
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted">
                          zu {r.bezugNummer}
                          {r.grund ? ` · ${r.grund}` : ''}
                        </span>
                      )}
                    </p>
                  </div>
                  <p className={`text-right text-[18px] font-light ${storniert ? 'text-muted line-through' : ''}`}>{centText(r.summeCent)}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[15px] font-light text-muted">Noch keine Rechnungen.</p>
        )}
      </SectionRow>
    </>
  );
}
