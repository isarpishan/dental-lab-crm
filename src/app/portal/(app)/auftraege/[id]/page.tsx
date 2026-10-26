import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AuftragSeite, TABS, type Tab } from '@/components/auftrag/AuftragSeite';
import { bearbeiterPortal } from '@/lib/auth/bearbeiter';
import { praxisNutzerOderAnmelden } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { config } from '@/lib/config';
import { heuteIso } from '@/lib/format';
import { auftragDetail } from '@/lib/orders/detail';
import { alsGelesenMarkieren } from '@/lib/orders/nachrichten';
import { aenderung, dateiEntfernen, feedback, freigeben, nachreichen, nachricht, reklamation, stornieren } from '../actions';

export const metadata: Metadata = { title: 'Auftrag · Digital Dental Lab' };

export default async function Auftrag({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { user } = await praxisNutzerOderAnmelden();
  const b = (await bearbeiterPortal())!;
  const [{ id }, { tab: t }] = await Promise.all([params, searchParams]);
  const d = await auftragDetail(b, id, (await anfrageInfo()).ip);
  if (!d) notFound();
  if ('entwurf' in d) redirect(`/auftraege/neu?entwurf=${id}`);
  const tab: Tab = t && t in TABS ? (t as Tab) : 'status';
  if (tab === 'kommunikation') await alsGelesenMarkieren(b, d.id);
  return (
    <AuftragSeite
      d={d}
      seite="praxis"
      tab={tab}
      aktionen={{ nachricht, stornieren, nachreichen, dateiEntfernen, freigeben, aenderung, feedback, reklamation }}
      maxBytes={config().UPLOAD_MAX_MB * 1024 * 1024}
      nutzerName={user.name}
      heute={heuteIso()}
    />
  );
}
