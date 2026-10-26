import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AuftragSeite, TABS, type Tab } from '@/components/auftrag/AuftragSeite';
import { ProduktionsBereich } from '@/components/produktion/ProduktionsBereich';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { anfrageInfo } from '@/lib/auth/sessions';
import { config } from '@/lib/config';
import { datum, heuteIso } from '@/lib/format';
import { faelle, type Fall } from '@/lib/abrechnung/daten';
import { monatName } from '@/lib/abrechnung/leistung';
import { PositionenBereich } from '@/components/abrechnung/PositionenBereich';
import { positionenSpeichern, vorschlagWiederherstellen } from '../../abrechnung/actions';
import { auftragDetail } from '@/lib/orders/detail';
import { alsGelesenMarkieren } from '@/lib/orders/nachrichten';
import { produktionsStand } from '@/lib/produktion/stand';
import { erledigt, verschieben, zustaendig } from '../produktion-actions';
import {
  dateiEntfernen,
  designSenden,
  laborSchritt,
  liefertermin,
  nachreichen,
  nachricht,
  nameAnzeigen,
  reklamation,
  reklamationEntscheiden,
  reparaturErledigt,
  rueckfrage,
  loeschen,
  stornieren,
} from '../actions';

export const metadata: Metadata = { title: 'Auftrag · Digital Dental Lab' };

/** سطر بالای تب «Abrechnung»: کی و در کدام Sammelrechnung، یا چرا هنوز نه. */
function leistungText(f: Fall): string {
  if (f.status === 'storniert') return 'Storniert: wird nicht verrechnet.';
  if (f.rechnung) return `Verrechnet mit Rechnung ${f.rechnung.nummer} vom ${datum(f.rechnung.am)}. Korrektur nur über eine Gutschrift im Konto der Ordination.`;
  if (!f.leistungsdatum) return f.lieferart === 'design' ? 'Noch nicht verrechenbar: kommt mit der Freigabe des Designs dazu.' : 'Noch nicht verrechenbar: kommt mit der Übergabe dazu.';
  return `Leistungsdatum ${datum(f.leistungsdatum)} · gehört zur Abrechnung ${monatName(f.monat!)}.`;
}

export default async function AuftragIntern({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  const b = await bearbeiterIntern('auftraege.sehen');
  if (!b) return <Seitenkopf eyebrow="Aufträge" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  const [{ id }, { tab: t }] = await Promise.all([params, searchParams]);
  const d = await auftragDetail(b, id, (await anfrageInfo()).ip);
  if (!d) notFound();
  if ('entwurf' in d) redirect(`/auftraege/neu?entwurf=${id}`);
  const mitAbrechnung = darf(user.role, 'abrechnung.sehen');
  const tab: Tab = t && (t in TABS || (t === 'abrechnung' && mitAbrechnung)) ? (t as Tab) : 'status';
  if (tab === 'kommunikation') await alsGelesenMarkieren(b, d.id);
  // nur wer bearbeiten darf, schreibt und storniert
  const bearbeiten = darf(user.role, 'auftraege.bearbeiten');
  const produzieren = darf(user.role, 'produktion.bearbeiten');
  const stand = tab === 'status' ? await produktionsStand(d.id) : null;
  const [fall] = tab === 'abrechnung' ? await faelle({ orderIds: [d.id] }) : [];
  return (
    <AuftragSeite
      d={bearbeiten ? d : { ...d, laborSchritte: [], kann: Object.fromEntries(Object.keys(d.kann).map((k) => [k, false])) as typeof d.kann }}
      seite="labor"
      tab={tab}
      aktionen={{
        nachricht,
        stornieren,
        loeschen: darf(user.role, 'auftraege.loeschen') ? loeschen : undefined,
        nachreichen,
        dateiEntfernen,
        designSenden,
        laborSchritt,
        rueckfrage,
        liefertermin,
        reklamation,
        reklamationEntscheiden,
        reparaturErledigt,
        nameAnzeigen: darf(user.role, 'patientenname.sehen') ? nameAnzeigen : undefined,
      }}
      maxBytes={config().UPLOAD_MAX_MB * 1024 * 1024}
      nutzerName={user.name}
      heute={heuteIso()}
      mitAbrechnung={mitAbrechnung}
      abrechnung={
        fall ? (
          <PositionenBereich
            orderId={fall.orderId}
            positionen={fall.positionen}
            gespeichert={Boolean(fall.gespeichert)}
            leistung={leistungText(fall)}
            bearbeitbar={darf(user.role, 'abrechnung.bearbeiten') && fall.status !== 'storniert' && !fall.rechnung}
            einzelrechnung={
              darf(user.role, 'abrechnung.bearbeiten') && fall.leistungsdatum && !fall.rechnung ? `/abrechnung/${fall.practiceId}/rechnung?auftrag=${fall.orderId}` : undefined
            }
            speichern={positionenSpeichern}
            zuruecksetzen={vorschlagWiederherstellen}
          />
        ) : null
      }
      produktion={
        stand && stand.status !== 'storniert' ? (
          <ProduktionsBereich stand={stand} erledigt={produzieren ? erledigt : undefined} zustaendig={produzieren ? zustaendig : undefined} verschieben={produzieren ? verschieben : undefined} />
        ) : null
      }
    />
  );
}
