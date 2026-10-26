import type { Metadata } from 'next';
import { SteuerFormular } from '@/components/einstellungen/SteuerFormular';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { heuteIso } from '@/lib/format';
import { steuerEingaben } from '@/lib/steuer/einstellungen';
import { steuerEinstellungenSpeichern } from './actions';

export const metadata: Metadata = { title: 'Steuer · Einstellungen · Digital Dental Lab' };

/** «Einstellungen → Steuer» (Spec فاز ۵، قدم ۵؛ فقط Inhaber): ورودی‌های تخمین Einkommensteuer و SVS، برای سال جاری. */
export default async function SteuerEinstellungen() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten')) {
    return <Seitenkopf eyebrow="Einstellungen" titel="Kein Zugriff.">Diese Seite ist nur für den Inhaber.</Seitenkopf>;
  }
  const jahr = Number(heuteIso().slice(0, 4));
  const { eingaben, ausVorjahr } = await steuerEingaben(jahr);
  return (
    <>
      <Seitenkopf
        eyebrow="Einstellungen"
        titel={`Steuer ${jahr}.`}
        info="Diese Angaben braucht die Vorschau unter Abrechnung → Steuer. Sie bleiben im System des Labors und gehen an niemanden. Die Vorschau ist eine Schätzung, keine Steuerberatung."
      />
      <SteuerFormular jahr={jahr} eingaben={eingaben} ausVorjahr={ausVorjahr} speichern={steuerEinstellungenSpeichern} />
    </>
  );
}
