import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthRahmen } from '@/components/auth/AuthRahmen';
import { praxisSitzung } from '@/lib/auth/sessions';
import { PortalAnmeldeFormular } from './Formular';

export const metadata: Metadata = { title: 'Anmelden · Portal · Digital Dental Lab' };

export default async function PortalAnmelden({ searchParams }: { searchParams: Promise<{ weiter?: string }> }) {
  if (await praxisSitzung()) redirect('/');
  const { weiter } = await searchParams;
  return (
    <AuthRahmen eyebrow="Portal für Ordinationen" titel="Anmelden.">
      <PortalAnmeldeFormular weiter={weiter} />
      <p className="mt-12 border-t border-line pt-6 text-[15px] font-light leading-relaxed text-muted">
        Noch kein Zugang? Schreiben Sie uns an{' '}
        <a href="mailto:lab@drpishan.at" className="border-b border-rose text-white">
          lab@drpishan.at
        </a>
        . Passwort vergessen? Wir senden Ihnen gern einen neuen Link.
      </p>
    </AuthRahmen>
  );
}
