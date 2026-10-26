import { asc, desc } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { workTypes } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { bildUrl } from '@/lib/katalog/auswahl';
import { formularUebersicht } from '@/lib/katalog/neu';
import { formSchemaSchema } from '@/lib/orders/form-schema';
import { NeueBehandlung, type Vorlage } from './NeueBehandlung';
import { PreisFormular, type PreisZeile } from './PreisFormular';

export const metadata: Metadata = { title: 'Preise · Digital Dental Lab' };

export default async function Preise() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'preise.bearbeiten')) {
    return <Seitenkopf eyebrow="Preise" titel="Kein Zugriff.">Preise ändert nur der Inhaber.</Seitenkopf>;
  }
  const zeilen = await db().select().from(workTypes).orderBy(desc(workTypes.isActive), asc(workTypes.position));
  const daten: PreisZeile[] = zeilen.map((w) => ({
    key: w.key,
    name: w.name,
    bild: bildUrl(w.imageKey),
    isActive: w.isActive,
    turnaroundLabel: w.turnaroundLabel,
    design: w.deliveryOptions.design ?? null,
    fertigung: w.deliveryOptions.fertigung ?? null,
    express: { an: w.expressAvailable, ...w.expressSurcharge },
    sameDay: { an: w.sameDayAvailable, ...w.sameDaySurcharge },
  }));
  const vorlagen: Vorlage[] = [...zeilen]
    .sort((a, b) => a.name.localeCompare(b.name, 'de-AT'))
    .map((w) => ({
      key: w.key,
      name: w.name,
      ...formularUebersicht(formSchemaSchema.parse(w.formSchema), w.requiredFiles),
      einheit: (w.deliveryOptions.fertigung ?? w.deliveryOptions.design)?.einheit ?? 'Fall',
    }));

  return (
    <>
      <Seitenkopf eyebrow="09 / Preise" titel="Preise." info="Was Ordinationen im Auftragsformular sehen: Standard, Express < 24 Stunden und Same-Day, jede Stufe mit eigenem Zuschlag. Ein leeres Feld heißt »Preis auf Anfrage« beziehungsweise »Zuschlag nach Prüfung«. Alle Beträge netto, steuerfrei gemäß § 6 Abs. 1 Z 20 UStG." />
      <p className="-mt-6 mb-10">
        <Link href="/vorschau" className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
          Im Auftragsformular ansehen ↗
        </Link>
      </p>
      <PreisFormular aktiv={daten.filter((d) => d.isActive)} aus={daten.filter((d) => !d.isActive)} />
      <section aria-label="Neue Behandlung" className="mt-16 border-t border-line pt-12">
        <h2 className="text-[clamp(23px,2.6vw,38px)] font-light leading-[1.05]">Neue Behandlung</h2>
        <p className="mb-8 mt-3 max-w-[620px] text-[15px] font-light text-muted">
          Für Arbeiten, die das Labor neu anbietet. Sie erscheinen im Auftragsformular der Ordinationen, sobald sie eingeschaltet sind.
        </p>
        <NeueBehandlung vorlagen={vorlagen} />
      </section>
    </>
  );
}
