import type { Metadata } from 'next';
import { AuftragAssistent } from '@/components/auftrag/AuftragAssistent';
import { SiteHeader } from '@/components/ui/SiteHeader';
import { auswahlKatalogAusDb } from '@/lib/katalog/aus-datenbank';
import { beispielZustand } from './beispiele';

export const metadata: Metadata = { title: 'Vorschau · Digital Dental Lab' };

export default async function VorschauSeite({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parameter = await searchParams;
  const start = beispielZustand(parameter.beispiel, parameter.offen);
  return (
    <>
      <SiteHeader nav={[{ href: '/', label: 'Übersicht' }, { href: '/vorschau', label: 'Vorschau' }]} />
      <main id="inhalt" className="page pb-28">
        <div className="pb-14 pt-20 max-[640px]:pt-12">
          <p className="eyebrow">Vorschau · Neuer Auftrag</p>
          <h1 className="mt-5 max-w-[980px] text-[clamp(44px,6vw,88px)] font-light leading-[0.96]">Schritt für Schritt.</h1>
          <p className="mt-8 max-w-[640px] text-[18px] font-light leading-relaxed text-paragraph">
            Zuerst die Behandlung, dann die Zähne, dann die Details. Jede Frage erscheint erst, wenn die vorige beantwortet ist. Gespeichert wird noch nichts.
          </p>
        </div>
        <AuftragAssistent katalog={await auswahlKatalogAusDb()} start={start} />
      </main>
      <footer className="border-t border-line">
        <div className="page flex flex-wrap justify-between gap-4 py-8 text-[11px] text-muted">
          <span>DIGITAL DENTAL LAB · LOKALE VORSCHAU</span>
          <span>Nicht veröffentlicht</span>
        </div>
      </footer>
    </>
  );
}
