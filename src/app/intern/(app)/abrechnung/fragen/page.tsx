import type { Metadata } from 'next';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { kiStand } from '@/lib/ki/einstellungen';
import { FRAGEN_PRO_TAG } from '@/lib/fragen/werkzeuge';
import { Fragen } from './Fragen';

export const metadata: Metadata = { title: 'Fragen · Digital Dental Lab' };

/**
 * «Frag deine Zahlen» (Spec فاز ۵، قدم ۶؛ فقط Inhaber). Claude فقط پرسش‌های ثابت `lib/fragen/werkzeuge.ts` را صدا می‌زند؛
 * دیتابیس را نمی‌بیند و هیچ دادهٔ بیماری نمی‌گیرد.
 */
export default async function FragenSeite() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten') || !darf(user.role, 'privat.verwalten')) {
    return (
      <Seitenkopf eyebrow="Fragen" titel="Kein Zugriff.">
        Diese Seite ist nur für den Inhaber.
      </Seitenkopf>
    );
  }
  const ki = await kiStand();
  return (
    <>
      <Seitenkopf
        eyebrow="Abrechnung"
        titel="Frag deine Zahlen"
        kompakt
        info={`Fragen zum Geld des Labors und zum privaten Geld, auf Deutsch oder Persisch. Claude sieht keine Datenbank, sondern ruft nur feste Abfragen auf (Summen, Listen, offene Rechnungen, Steuer-Vorschau, Bank) und bekommt nie Daten von Patienten. Nichts wird gespeichert. Höchstens ${FRAGEN_PRO_TAG} Fragen am Tag.`}
      />
      <Fragen kiAktiv={ki.gesetzt} />
    </>
  );
}
