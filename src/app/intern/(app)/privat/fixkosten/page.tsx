import type { Metadata } from 'next';
import { FixkostenSeite } from '@/components/fixkosten/FixkostenSeite';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Privat · Fixkosten · Digital Dental Lab' };

/** «Fixkosten» Privat (Spec فاز ۵، قدم ۳): werden am Fälligkeitstag automatisch gebucht. */
export default async function PrivatFixkosten() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'privat.verwalten')) {
    return (
      <Seitenkopf eyebrow="Privat" titel="Kein Zugriff.">
        Diesen Bereich sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  return <FixkostenSeite bereich="privat" />;
}
