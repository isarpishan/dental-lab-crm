import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProduktionsBereich } from '@/components/produktion/ProduktionsBereich';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { TempoTag } from '@/components/ui/Tag';
import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { auftragIdVonNummer, produktionsStand } from '@/lib/produktion/stand';
import { erledigt, zustaendig } from '../../auftraege/produktion-actions';

export const metadata: Metadata = { title: 'Schritt erledigt · Digital Dental Lab' };

/**
 * صفحهٔ «Schritt erledigt» (Spec فاز ۱، بخش H): QR روی Laufzettel به `crm.<domain>/s/A-2026-0042`
 * می‌رود. روی تبلت لابراتوار با نشست کارکنان؛ فقط کد بیمار، هرگز نام.
 */
export default async function SchrittSeite({ params }: { params: Promise<{ nr: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  const b = await bearbeiterIntern('auftraege.sehen');
  if (!b) return <Seitenkopf eyebrow="Produktion" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  const { nr } = await params;
  const id = await auftragIdVonNummer(decodeURIComponent(nr));
  const stand = id ? await produktionsStand(id) : null;
  if (!stand) notFound();
  const k = stand.kopf;
  const produzieren = darf(user.role, 'produktion.bearbeiten');

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="pb-10 pt-12 max-[640px]:pt-8">
        <p className="eyebrow">Laufzettel · {k.orderNo}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
          <h1 className="text-[clamp(32px,5vw,56px)] font-light leading-[1]">
            {k.behandlung}
            {k.zaehne ? <span className="text-muted"> · {k.zaehne}</span> : null}
          </h1>
          <TempoTag tempo={k.tempo} />
        </div>
        <p className="mt-4 text-[17px] font-light text-paragraph">
          {[k.patientCode, k.praxis, k.farbe ? `Farbe ${k.farbe}` : null, k.termin].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="border-t border-line pt-10">
        <ProduktionsBereich
          stand={stand}
          erledigt={produzieren ? erledigt : undefined}
          zustaendig={produzieren ? zustaendig : undefined}
          auftragsLink={`/auftraege/${stand.orderId}`}
          laufzettel={false}
        />
      </div>
      <p className="mt-14 border-t border-line pt-6">
        <Link href={`/auftraege/${stand.orderId}`} className="border-b border-current pb-1 text-[13px] text-muted hover:text-white">
          Zur Auftragsseite
        </Link>
      </p>
    </div>
  );
}
