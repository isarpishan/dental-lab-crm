import type { Metadata } from 'next';
import { NeuerPatientSeite } from '@/components/auftrag/PatientWahl';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { anlegen } from '../../auftraege/actions';

export const metadata: Metadata = { title: 'Neuer Patient · Digital Dental Lab' };

export default async function NeuerPatient() {
  const { praxis } = await praxisNutzerOderAnmelden();
  return (
    <>
      <Seitenkopf eyebrow={`Portal · ${praxis.name}`} titel="Neuer Patient." info="Patienten werden auch direkt im Auftragsformular angelegt. Hier können Sie sie schon vorab erfassen." />
      <div className="border-t border-line pt-2">
        <NeuerPatientSeite anlegen={anlegen} />
      </div>
    </>
  );
}
