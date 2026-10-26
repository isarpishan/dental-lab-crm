import type { Metadata } from 'next';
import Link from 'next/link';
import { UEBERSICHT_TABS, UebersichtAnsicht } from '@/components/finanzen/UebersichtAnsicht';
import { reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { KATEGORIE_NAMEN, type AusgabeKategorie } from '@/lib/ausgaben/text';
import { ddlUebersicht } from '@/lib/finanzen/daten';
import { fixkostenNachziehen } from '@/lib/fixkosten/vorlagen';
import { monatWahl } from '@/lib/finanzen/uebersicht';
import { centText } from '@/lib/abrechnung/geld';
import { heuteIso } from '@/lib/format';
import { steuerSeite } from '@/lib/steuer/einstellungen';

export const metadata: Metadata = { title: 'Übersicht · Digital Dental Lab' };

/**
 * «Übersicht» پول DDL (Spec فاز ۵، قدم ۱؛ فقط Inhaber، مثل «Ausgaben»): Einnahmen، Ausgaben، Überschuss و Quote هر ماه،
 * «Jahr bis …»، Verlauf شش ماه و Ausgaben بر اساس Kategorie. همه از دادهٔ موجود؛ چیزی اینجا ثبت نمی‌شود.
 */
export default async function UebersichtSeite({ searchParams }: { searchParams: Promise<{ monat?: string; tab?: string; k?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten')) {
    return (
      <Seitenkopf eyebrow="Übersicht" titel="Kein Zugriff.">
        Die Übersicht sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  const { monat: m, tab: t, k } = await searchParams;
  const aktuell = heuteIso().slice(0, 7);
  const monat = monatWahl(m, aktuell);
  await fixkostenNachziehen();
  const [u, steuer] = await Promise.all([ddlUebersicht(monat), steuerSeite()]);
  const v = steuer.vorschau;

  return (
    <>
      <Seitenkopf
        eyebrow="Abrechnung"
        titel="Übersicht"
        kompakt
        info="Einnahmen sind eingegangene Zahlungen (Zuflussprinzip), Ausgaben zählen nach »Bezahlt am«, brutto. »Fakturiert« sind ausgestellte Rechnungen abzüglich Gutschriften im selben Monat."
      />
      {/* Rücklage für Steuer und SVS (Spec فاز ۵، قدم ۵): ein Satz mit Link, Details unter »Steuer« */}
      <Link
        href={v ? '/abrechnung/steuer' : '/einstellungen/steuer'}
        className="group -mt-4 mb-8 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 border-y border-line py-4 transition-colors duration-[180ms] hover:bg-white/[0.02]"
      >
        <span className="text-[15px]">
          {v ? (
            v.ruecklageCent > 0 ? (
              <>
                Für Steuer und SVS zurücklegen: <span className="text-rose">{centText(v.ruecklageMonatCent)}</span> im Monat
                <span className="text-[13px] text-muted"> · Schätzung für {steuer.jahr}</span>
              </>
            ) : v.gewinnJahrCent === 0 ? (
              <>Noch kein Gewinn {steuer.jahr}: Die Steuer-Vorschau rechnet, sobald Zahlungen und Ausgaben da sind.</>
            ) : (
              <>Für {steuer.jahr} ist voraussichtlich keine Steuer-Rücklage nötig.</>
            )
          ) : (
            <>Wie viel für Steuer und SVS zurücklegen? Angaben eintragen</>
          )}
        </span>
        <span className="text-[13px] text-rose transition-transform duration-[180ms] group-hover:translate-x-1">{v ? 'Steuer ↗' : 'Einstellungen ↗'}</span>
      </Link>
      <UebersichtAnsicht
        u={u}
        aktuellerMonat={aktuell}
        tab={reiterWahl(t, UEBERSICHT_TABS)}
        kategorienJahr={k === 'jahr'}
        kategorieName={(x) => KATEGORIE_NAMEN[x as AusgabeKategorie] ?? x}
        pfad="/abrechnung/uebersicht"
        leer={
          <>
            Sobald Zahlungen gebucht oder Ausgaben erfasst sind, stehen sie hier.{' '}
            <Link href="/abrechnung/ausgaben" className="text-rose-light hover:text-white">
              Beleg hochladen
            </Link>{' '}
            ·{' '}
            <Link href="/abrechnung?tab=offen" className="text-rose-light hover:text-white">
              Offene Rechnungen
            </Link>
          </>
        }
      />
    </>
  );
}
