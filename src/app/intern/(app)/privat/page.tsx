import type { Metadata } from 'next';
import Link from 'next/link';
import { UEBERSICHT_TABS, UebersichtAnsicht } from '@/components/finanzen/UebersichtAnsicht';
import { reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { monatWahl } from '@/lib/finanzen/uebersicht';
import { fixkostenNachziehen } from '@/lib/fixkosten/vorlagen';
import { heuteIso } from '@/lib/format';
import { privatUebersicht } from '@/lib/privat/buchungen';
import { PRIVAT_KATEGORIE_NAMEN, type PrivatKategorie } from '@/lib/privat/text';

export const metadata: Metadata = { title: 'Privat · Digital Dental Lab' };

/** «Übersicht» پول شخصی (Spec فاز ۵، قدم ۲): همان نمای DDL با «Gespart» و «Sparquote». */
export default async function PrivatUebersicht({ searchParams }: { searchParams: Promise<{ monat?: string; tab?: string; k?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'privat.verwalten')) {
    return (
      <Seitenkopf eyebrow="Privat" titel="Kein Zugriff.">
        Diesen Bereich sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  const { monat: m, tab: t, k } = await searchParams;
  const aktuell = heuteIso().slice(0, 7);
  const monat = monatWahl(m, aktuell);
  await fixkostenNachziehen();
  const u = await privatUebersicht(monat);

  return (
    <>
      <Seitenkopf eyebrow="Privat" titel="Übersicht" kompakt info="Privates Geld, getrennt von der Buchhaltung des Labors: nichts davon kommt in Rechnungen, Ausgaben oder den Export für die Steuerberatung." />
      <UebersichtAnsicht
        u={u}
        aktuellerMonat={aktuell}
        tab={reiterWahl(t, UEBERSICHT_TABS)}
        kategorienJahr={k === 'jahr'}
        kategorieName={(x) => PRIVAT_KATEGORIE_NAMEN[x as PrivatKategorie] ?? x}
        pfad="/privat"
        privat
        leer={
          <>
            Sobald Einnahmen oder Ausgaben gebucht sind, stehen sie hier.{' '}
            <Link href="/privat/buchungen" className="text-rose-light hover:text-white">
              Erste Buchung erfassen
            </Link>
          </>
        }
      />
    </>
  );
}
