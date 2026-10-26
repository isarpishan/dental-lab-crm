import type { Metadata } from 'next';
import { EinstellungenFormular } from '@/components/benachrichtigungen/EinstellungenFormular';
import { MitAnzahl, ReiterBereich, ReiterLeiste, reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { einstellungenVon, empfaengerVon } from '@/lib/benachrichtigungen/einstellungen';
import { datumZeit } from '@/lib/format';
import { aktuelleAnnahme } from '@/lib/vereinbarung/annahme';
import { benachrichtigungenSpeichern } from './actions';

export const metadata: Metadata = { title: 'Einstellungen · Digital Dental Lab' };

/** تنظیمات Ordination در پورتال: اعلان‌های ایمیلی (Spec فاز ۱، بخش M) و Vereinbarung پذیرفته‌شده. */
export default async function Einstellungen({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, praxis } = await praxisNutzerOderAnmelden();
  const [werte, empfaenger, annahme] = await Promise.all([einstellungenVon(praxis.id), empfaengerVon(praxis.id), aktuelleAnnahme(praxis.id)]);
  const admin = user.role === 'praxis_admin';
  const TABS = annahme ? (['benachrichtigungen', 'empfaenger', 'vereinbarung'] as const) : (['benachrichtigungen', 'empfaenger'] as const);
  const tab = reiterWahl<string>((await searchParams).tab, TABS);
  const namen: Record<string, React.ReactNode> = { benachrichtigungen: 'Benachrichtigungen', empfaenger: <MitAnzahl name="Empfänger" anzahl={empfaenger.length} />, vereinbarung: 'Vereinbarung' };

  return (
    <>
      <Seitenkopf eyebrow="Einstellungen" titel="E-Mail-Benachrichtigungen." info={`Welche E-Mails ${praxis.name} von uns bekommt. Patientennamen und Nachrichtentexte stehen nie in einer E-Mail, nur Auftragsnummer und Patienten-ID.`} />

      <ReiterLeiste label="Abschnitte" reiter={TABS.map((x) => ({ key: x, href: `?tab=${x}`, aktiv: x === tab, inhalt: namen[x] }))} />

      {tab === 'benachrichtigungen' ? (
      <ReiterBereich
        titel="Benachrichtigungen"
        hinweis={admin ? 'Gilt für die ganze Ordination.' : 'Gilt für die ganze Ordination. Ändern kann sie nur ein Praxis-Admin.'}
      >
        <EinstellungenFormular werte={werte} aktion={benachrichtigungenSpeichern} bearbeitbar={admin} />
      </ReiterBereich>
    ) : null}

      {tab === 'empfaenger' ? (
      <ReiterBereich titel="Empfänger" hinweis="Alle aktiven Portal-Zugänge Ihrer Ordination. Neue Zugänge richtet Digital Dental Lab für Sie ein.">
        <ul className="max-w-[760px] border-t border-line" aria-label="Empfänger">
          {empfaenger.map((e) => (
            <li key={e.email} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4">
              <span className="text-[17px] font-light">{e.name}</span>
              <span className="min-w-0 break-all text-[13px] text-muted">{e.email}</span>
            </li>
          ))}
        </ul>
      </ReiterBereich>
    ) : null}

      {tab === 'vereinbarung' && annahme ? (
        <ReiterBereich titel="Vereinbarung" hinweis="Datenschutz und Portalnutzung. Die angenommene Fassung bleibt unverändert erhalten.">
          <div className="max-w-[760px] border-t border-line">
            <p className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-4">
              <span className="text-[17px] font-light">Version {annahme.version}</span>
              <span className="text-[13px] text-muted">
                angenommen am {datumZeit(annahme.acceptedAt)} von {annahme.acceptedByName}
              </span>
            </p>
          </div>
          <a href={`/api/vereinbarung/${annahme.id}`} target="_blank" rel="noopener" className="mt-6 inline-block border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
            Als PDF öffnen ↗
          </a>
        </ReiterBereich>
      ) : null}
    </>
  );
}
