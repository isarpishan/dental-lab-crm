import type { Metadata } from 'next';
import { AuthRahmen } from '@/components/auth/AuthRahmen';
import { CodeFormular } from '../Formulare';

export const metadata: Metadata = { title: 'Code bestätigen · Digital Dental Lab' };

export default function Code() {
  return (
    <AuthRahmen eyebrow="Intern · Zwei-Faktor-Anmeldung" titel="Code bestätigen.">
      <p className="mb-10 text-[17px] font-light leading-relaxed text-paragraph">
        Öffnen Sie Ihre Authenticator-App und geben Sie den aktuellen 6-stelligen Code für «Digital Dental Lab» ein.
      </p>
      <CodeFormular />
    </AuthRahmen>
  );
}
