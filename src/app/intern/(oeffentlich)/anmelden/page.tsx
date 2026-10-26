import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthRahmen } from '@/components/auth/AuthRahmen';
import { Meldung } from '@/components/ui/Formular';
import { aktuellerMitarbeiter } from '@/lib/auth/sessions';
import { AnmeldeFormular } from './Formulare';

export const metadata: Metadata = { title: 'Anmelden · Digital Dental Lab' };

export default async function Anmelden({ searchParams }: { searchParams: Promise<{ weiter?: string; abgelaufen?: string }> }) {
  if (await aktuellerMitarbeiter()) redirect('/');
  const { weiter, abgelaufen } = await searchParams;
  return (
    <AuthRahmen eyebrow="Intern · Anmeldung" titel="Anmelden.">
      {abgelaufen ? (
        <div className="mb-8">
          <Meldung art="fehler">Die Anmeldung hat zu lange gedauert. Bitte erneut anmelden.</Meldung>
        </div>
      ) : null}
      <AnmeldeFormular weiter={weiter} />
    </AuthRahmen>
  );
}
