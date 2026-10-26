import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { VereinbarungLesen } from '@/components/vereinbarung/VereinbarungLesen';
import { praxisSitzungOderAnmelden } from '@/lib/auth/guard';
import { aktuellerInhalt } from '@/lib/vereinbarung/annahme';
import { pruefsumme } from '@/lib/vereinbarung/text';
import { vereinbarungAnnehmen } from './actions';

export const metadata: Metadata = { title: 'Vereinbarung · Portal · Digital Dental Lab', robots: { index: false } };

/** پیش از اولین استفاده از پورتال (و بعد از هر نسخهٔ تازه): خواندن و پذیرش Vereinbarung. */
export default async function Vereinbarung() {
  const s = await praxisSitzungOderAnmelden();
  if (s.vereinbarung) redirect('/');
  const inhalt = await aktuellerInhalt(s.praxis.id);
  return (
    <>
      <Seitenkopf eyebrow="Portal · Vereinbarung" titel="Bevor es losgeht." info={`Für ${s.praxis.name} schließen wir eine Vereinbarung über den Umgang mit Patientendaten und die Nutzung des Portals. Bitte lesen Sie sie bis zum Ende. Nach der Annahme ist das Portal sofort freigeschaltet.`} />
      <VereinbarungLesen inhalt={inhalt} sha256={pruefsumme(inhalt)} admin={s.user.role === 'praxis_admin'} praxis={s.praxis.name} aktion={vereinbarungAnnehmen} />
    </>
  );
}
