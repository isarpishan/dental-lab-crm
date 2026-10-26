import type { Metadata } from 'next';
import { FixkostenSeite } from '@/components/fixkosten/FixkostenSeite';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';

export const metadata: Metadata = { title: 'Fixkosten · Digital Dental Lab' };

/** «Fixkosten» des Labors (Spec فاز ۵، قدم ۳؛ فقط Inhaber، مثل «Ausgaben»). */
export default async function DdlFixkosten() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten')) {
    return (
      <Seitenkopf eyebrow="Fixkosten" titel="Kein Zugriff.">
        Die Fixkosten sieht nur der Inhaber.
      </Seitenkopf>
    );
  }
  return <FixkostenSeite bereich="ddl" />;
}
