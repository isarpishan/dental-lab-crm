import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { tours } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { OrdinationFormular } from '../Formulare';

export const metadata: Metadata = { title: 'Neue Ordination · Digital Dental Lab' };

/** `?email=…&telefon=…`: aus einer Anfrage der Website (»Neue Ordination ↗«) vorausgefüllt */
export default async function NeueOrdination({ searchParams }: { searchParams: Promise<{ email?: string; telefon?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  const q = await searchParams;
  if (!darf(user.role, 'stammdaten.bearbeiten')) {
    return <Seitenkopf eyebrow="Ordinationen" titel="Kein Zugriff.">Neue Ordinationen legen Inhaber und Büro an.</Seitenkopf>;
  }
  const touren = await db().select({ id: tours.id, name: tours.name }).from(tours).where(eq(tours.isActive, true)).orderBy(asc(tours.name));
  return (
    <>
      <Seitenkopf eyebrow="08 / Ordinationen" titel="Neue Ordination." info="Die Kundennummer wird automatisch vergeben. Behandler und Portal-Zugänge fügen Sie im nächsten Schritt hinzu." />
      <div className="border-t border-line pt-10">
        <OrdinationFormular touren={touren} vorgabe={{ email: q.email?.slice(0, 254), phone: q.telefon?.slice(0, 40) }} />
      </div>
      <p className="mt-10">
        <Link href="/ordinationen" className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
          Zurück zur Liste
        </Link>
      </p>
    </>
  );
}
