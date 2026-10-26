import Link from 'next/link';
import { AuftragLoeschen, DateiAktionen, DateienTab, NachrichtFormular, NameAnzeigen, Nachreichen, StornoFormular } from '@/components/auftrag/AuftragBedienung';
import { DesignDateienBereich, DesignKarteOrdination, LaborSteuerung, type DesignAktionen } from '@/components/auftrag/DesignBereich';
import { Fortschrittsbalken } from '@/components/auftrag/Fortschrittsbalken';
import { ReklamationsBereich, type ReklamationsAktionen } from '@/components/reklamation/ReklamationsBereich';
import { PreisKasten } from '@/components/auftrag/PreisKasten';
import { preisGross, preisKurz } from '@/lib/orders/preis';
import { ReiterLeiste } from '@/components/ui/ReiterLeiste';
import { Tag, TempoTag } from '@/components/ui/Tag';
import { Kieferbogen } from '@/components/zahnschema/Kieferbogen';
import { Zahnleiste } from '@/components/zahnschema/Zahnleiste';
import { groesseText } from '@/lib/dateien/regeln';
import { datum, datumZeit } from '@/lib/format';
import { TEMPO_KURZ } from '@/lib/katalog/tempo';
import { tagKurz } from '@/lib/touren/plan';
import type { ZahnAuswahl } from '@/lib/orders/bridge';
import { LIEFERART_NAMEN } from '@/lib/orders/assistent';
import type { AuftragDetail } from '@/lib/orders/detail';
import { DATEI_NAMEN } from '@/lib/orders/form-schema';
import type { ProthesenAuswahl } from '@/lib/orders/prothese';

/**
 * صفحهٔ هر سفارش (Spec فاز ۱، بخش F؛ نقشه در plan): ستون کناری همیشه دیده می‌شود، و چهار تب
 * «Status»، «Kommunikation»، «Dateien»، «Auftragsdetails». تب‌ها لینک‌اند (`?tab=`)، تا با
 * دکمهٔ «Zurück» مرورگر و بدون JavaScript هم کار کنند. همین صفحه در پورتال و پنل داخلی.
 */

type Ergebnis = Promise<{ fehler?: string }>;
export type SeitenAktionen = DesignAktionen &
  ReklamationsAktionen & {
  nachricht: (orderId: string, daten: { text: string; dateiIds: string[]; intern: boolean }) => Ergebnis;
  stornieren: (orderId: string, grund: string) => Ergebnis;
  /** nur im Labor für den Inhaber */
  loeschen?: (orderId: string) => Ergebnis;
  nachreichen: (orderId: string, antwort: string) => Ergebnis;
  dateiEntfernen: (id: string) => Ergebnis;
  nameAnzeigen?: (orderId: string) => Promise<{ name?: string; fehler?: string }>;
};

export const TABS = { status: 'Status', kommunikation: 'Kommunikation', dateien: 'Dateien', details: 'Auftragsdetails' } as const;
/** «Abrechnung» فقط در CRM و برای نقش‌های مجاز (Spec فاز ۲، قدم ۱)، پس جدا از TABS مشترک. */
export const ABRECHNUNG_TAB = 'Abrechnung';
export type Tab = keyof typeof TABS | 'abrechnung';
const tabName = (t: Tab) => (t === 'abrechnung' ? ABRECHNUNG_TAB : TABS[t]);

/** تیتر و متن تب «Status» برای Ordination (جدول Spec F). */
function statusText(d: AuftragDetail, seite: 'praxis' | 'labor'): { titel: string; text?: string } {
  const zeit = d.bearbeitungszeit ? `Bearbeitungszeit: ${d.bearbeitungszeit}.` : undefined;
  if (seite === 'labor') {
    const labor: Partial<Record<AuftragDetail['status'], string>> = {
      eingereicht: 'Neu eingegangen. Daten prüfen und mit dem Design beginnen.',
      rueckfrage: `Wartet auf die Ordination${d.fehlendeDateien.length ? `: ${d.fehlendeDateien.map((p) => DATEI_NAMEN[p]).join(', ')}` : ''}.`,
    };
    return { titel: `${d.statusLabel}.`, text: labor[d.status] };
  }
  switch (d.status) {
    case 'eingereicht':
      return { titel: 'Auftrag eingegangen.', text: ['Wir prüfen die Daten und beginnen mit dem Design.', zeit].filter(Boolean).join(' ') };
    case 'in_planung':
      return { titel: 'Wir arbeiten an Ihrem Design.', text: zeit };
    case 'rueckfrage':
      return {
        titel: 'Wir benötigen noch Informationen.',
        text: d.fehlendeDateien.length
          ? `Es fehlen noch: ${d.fehlendeDateien.map((p) => DATEI_NAMEN[p]).join(', ')}. Ohne vollständige Scans und Biss kann das Design nicht abschließend erstellt werden.`
          : 'Bitte beantworten Sie unsere Rückfrage in der Kommunikation oder reichen Sie Dateien nach.',
      };
    case 'design_freigabe':
      return { titel: 'Ihr Design ist bereit zur Prüfung.' };
    case 'in_ueberarbeitung':
      return { titel: 'Wir überarbeiten Ihr Design.' };
    case 'freigegeben':
      return { titel: 'Ihr Design ist bereit zum Drucken.' };
    case 'in_produktion':
    case 'einprobe':
    case 'fertig':
      return { titel: d.status === 'einprobe' ? 'Bereit zur Einprobe.' : d.status === 'fertig' ? 'Fertig.' : 'In Produktion.', text: d.termin ? `${d.termin}.` : undefined };
    case 'versendet':
      return { titel: 'Unterwegs zu Ihnen.', text: d.lieferTour ? `Lieferung mit unserer Tour voraussichtlich am ${tagKurz(d.lieferTour)}.` : undefined };
    case 'geliefert':
    case 'abgeschlossen':
      return { titel: 'Geliefert.', text: d.geliefertAm ? `Am ${datum(d.geliefertAm)}.` : undefined };
    case 'storniert':
      return { titel: 'Storniert.' };
    default:
      return { titel: `${d.statusLabel}.` };
  }
}

export function AuftragSeite({
  d,
  seite,
  tab,
  aktionen,
  maxBytes,
  nutzerName,
  heute,
  produktion,
  abrechnung,
  mitAbrechnung = false,
}: {
  d: AuftragDetail;
  seite: 'praxis' | 'labor';
  tab: Tab;
  aktionen: SeitenAktionen;
  maxBytes: number;
  nutzerName: string;
  heute: string;
  /** Labor: Abschnitt »Produktion« im Tab Status (Schritt erledigt, Zuständig, Laufzettel) */
  produktion?: React.ReactNode;
  /** لابراتوار با `abrechnung.sehen`: محتوای تب «Abrechnung» (فقط وقتی همان تب باز است) */
  abrechnung?: React.ReactNode;
  /** لابراتوار با `abrechnung.sehen`: تب «Abrechnung» نشان داده شود */
  mitAbrechnung?: boolean;
}) {
  const text = statusText(d, seite);
  return (
    <>
      <div className="pb-10 pt-14 max-[640px]:pt-10">
        <p className="eyebrow">Auftrag {d.orderNo}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="text-[clamp(36px,4.5vw,64px)] font-light leading-[1]">{d.behandlung.name}</h1>
          <Tag ton={d.aktionNoetig || (seite === 'labor' && d.ungelesen > 0) ? 'rose' : 'neutral'}>{d.statusLabel}</Tag>
          <TempoTag tempo={d.tempo} />
        </div>
      </div>

      {/* Handy und Tablet: kurz oben, die ganze Seitenleiste am Ende (Spec F: »Seitenleiste oben eingeklappt«) */}
      <Kurzinfo d={d} seite={seite} nameAnzeigen={aktionen.nameAnzeigen} />
      <div className="grid grid-cols-1 gap-x-16 gap-y-12 border-t border-line pt-10 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="order-last lg:order-none">
          <Seitenleiste d={d} seite={seite} nameAnzeigen={aktionen.nameAnzeigen} />
        </div>

        <div className="min-w-0">
          <ReiterLeiste
            label="Bereiche des Auftrags"
            reiter={[...(Object.keys(TABS) as Tab[]), ...(mitAbrechnung ? (['abrechnung'] as const) : [])].map((t) => ({
              key: t,
              href: `?tab=${t}`,
              aktiv: t === tab,
              inhalt: (
                <>
                  {tabName(t)}
                  {t === 'kommunikation' && d.ungelesen && tab !== 'kommunikation' ? (
                    <span className="ml-2 inline-grid h-5 min-w-5 place-items-center rounded-full bg-rose px-1.5 text-[11px] text-black">
                      {d.ungelesen}
                      <span className="sr-only"> ungelesen</span>
                    </span>
                  ) : null}
                  {t === 'dateien' && d.dateien.length ? <span className="ml-1.5 text-[13px] text-muted">({d.dateien.length})</span> : null}
                </>
              ),
            }))}
          />

          <section aria-label={tabName(tab)} className="pt-8">
            {tab === 'status' ? (
              <div className="space-y-12">
                <div>
                  <h2 className="text-[clamp(28px,3.2vw,46px)] font-light leading-[1.05]">{text.titel}</h2>
                  {text.text ? <p className="mt-4 max-w-[640px] text-[17px] font-light leading-relaxed text-paragraph">{text.text}</p> : null}
                  {d.storno ? (
                    <p className="mt-4 max-w-[640px] text-[15px] font-light text-muted">
                      {d.storno.am ? `Am ${datumZeit(d.storno.am)}` : ''}
                      {d.storno.grund ? ` · Grund: ${d.storno.grund}` : ''}
                    </p>
                  ) : null}
                </div>
                {d.rueckfrage ? (
                  <blockquote className="max-w-[760px] border-l-2 border-rose pl-5">
                    <p className="text-[13px] text-muted">{seite === 'praxis' ? 'Unsere Rückfrage' : 'Rückfrage an die Ordination'}</p>
                    <p className="mt-1 whitespace-pre-line text-[17px] font-light leading-relaxed">{d.rueckfrage}</p>
                  </blockquote>
                ) : null}
                <Fortschrittsbalken f={d.fortschritt} daten={d.etappenDatum} />
                {produktion ? <div className="border-t border-line pt-10">{produktion}</div> : null}
                {d.reklamationen.length || d.kann.reklamieren ? (
                  <ReklamationsBereich d={d} seite={seite} aktionen={aktionen} maxBytes={maxBytes} dateiEntfernen={aktionen.dateiEntfernen} />
                ) : null}
                {seite === 'praxis' ? (
                  <DesignKarteOrdination d={d} aktionen={aktionen} nutzerName={nutzerName} maxBytes={maxBytes} />
                ) : (
                  <LaborSteuerung d={d} aktionen={aktionen} maxBytes={maxBytes} heute={heute} />
                )}
                {seite === 'praxis' && d.kann.nachreichen ? (
                  <div className="rounded-[12px] border border-panel-line p-6 md:p-8">
                    <h3 className="text-[22px] font-light">Daten nachreichen</h3>
                    <p className="mb-6 mt-2 max-w-[620px] text-[15px] text-muted">Laden Sie die fehlenden Dateien hoch und/oder schreiben Sie eine Antwort. Danach arbeiten wir weiter.</p>
                    <Nachreichen
                      orderId={d.id}
                      pflicht={d.pflichtDateien}
                      dateien={d.dateien.filter((x) => x.platz !== 'nachricht')}
                      maxBytes={maxBytes}
                      nachreichen={aktionen.nachreichen}
                      dateiEntfernen={aktionen.dateiEntfernen}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
                  <Link
                    href="?tab=kommunikation"
                    scroll={false}
                    className="border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10"
                  >
                    Nachricht schreiben
                  </Link>
                  {seite === 'praxis' && d.status === 'einprobe' ? (
                    <Link href={`/abholung?auftrag=${d.id}`} className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
                      Abholung anfordern
                    </Link>
                  ) : null}
                  {d.kann.stornieren ? <StornoFormular orderId={d.id} stornieren={aktionen.stornieren} /> : null}
                </div>
              </div>
            ) : null}
            {tab === 'status' && d.kann.loeschen && aktionen.loeschen ? <AuftragLoeschen orderId={d.id} nr={d.orderNo} loeschen={aktionen.loeschen} /> : null}

            {tab === 'kommunikation' ? (
              <div className="space-y-10">
                <Verlauf d={d} seite={seite} />
                {d.kann.schreiben ? (
                  <NachrichtFormular orderId={d.id} labor={seite === 'labor'} maxBytes={maxBytes} senden={aktionen.nachricht} dateiEntfernen={aktionen.dateiEntfernen} />
                ) : null}
              </div>
            ) : null}

            {tab === 'dateien' ? (
              <div className="space-y-14">
                <div>
                  <h2 className="mb-6 text-[24px] font-light">{seite === 'praxis' ? 'Ihre Dateien' : 'Dateien'}</h2>
                  <DateienTab
                    orderId={d.id}
                    pflicht={d.pflichtDateien}
                    dateien={d.dateien}
                    maxBytes={maxBytes}
                    hochladen={d.kann.dateien}
                    dateiEntfernen={aktionen.dateiEntfernen}
                  />
                </div>
                <div className="border-t border-line pt-10">
                  <DesignDateienBereich d={d} seite={seite} />
                </div>
              </div>
            ) : null}

            {tab === 'details' ? <Details d={d} /> : null}
            {tab === 'abrechnung' ? abrechnung : null}
          </section>
        </div>
      </div>
    </>
  );
}

function Kurzinfo({ d, seite, nameAnzeigen }: { d: AuftragDetail; seite: 'praxis' | 'labor'; nameAnzeigen?: SeitenAktionen['nameAnzeigen'] }) {
  return (
    <div className="-mt-4 mb-8 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[14px] lg:hidden">
      {d.patient ? (
        <span>
          {d.patient.name ? <span className="text-[17px] font-light">{d.patient.name} </span> : null}
          <span className="text-muted">{d.patient.code}</span>
        </span>
      ) : null}
      {!d.patient?.name && nameAnzeigen ? <NameAnzeigen orderId={d.id} anzeigen={nameAnzeigen} /> : null}
      <span className="text-muted">{[d.termin, d.lieferart, seite === 'labor' ? d.praxis.name : null].filter(Boolean).join(' · ')}</span>
      {d.preisUebersicht ? (
        <Link href="?tab=details" scroll={false} className="text-white">
          <span className="text-[17px] font-medium">{preisGross(d.preisUebersicht)}</span> <span className="text-[12px] text-muted">{preisKurz(d.preisUebersicht)}</span>
        </Link>
      ) : null}
    </div>
  );
}

function Seitenleiste({ d, seite, nameAnzeigen }: { d: AuftragDetail; seite: 'praxis' | 'labor'; nameAnzeigen?: SeitenAktionen['nameAnzeigen'] }) {
  return (
    <aside aria-label="Auftrag" className="space-y-9 lg:sticky lg:top-[112px] lg:self-start">
      <div>
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Patient</p>
        {d.patient ? (
          <div className="mt-3">
            {d.patient.name ? <p className="text-[22px] font-light leading-tight">{d.patient.name}</p> : nameAnzeigen ? <NameAnzeigen orderId={d.id} anzeigen={nameAnzeigen} /> : null}
            <p className="mt-1 text-[14px] text-muted">Patienten-ID {d.patient.code}</p>
            {seite === 'praxis' ? (
              <Link href={`/patienten/${d.patient.id}`} className="mt-4 inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
                Alle Dateien des Patienten ↗
              </Link>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-muted">–</p>
        )}
      </div>

      <div className="border-t border-line pt-8">
        {d.behandlung.bild ? (
          // eslint-disable-next-line @next/next/no-img-element -- kleines festes Bild
          <img src={d.behandlung.bild} alt="" width={280} height={210} className="mb-5 aspect-[4/3] w-full max-w-[280px] bg-black object-contain" />
        ) : null}
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-[14px]">
          <dt className="text-muted">Auftrag</dt>
          <dd>{d.orderNo}</dd>
          {seite === 'labor' ? (
            <>
              <dt className="text-muted">Ordination</dt>
              <dd>
                <Link href={`/ordinationen/${d.praxis.id}`} className="border-b border-line hover:border-current">
                  {d.praxis.name}
                </Link>
              </dd>
            </>
          ) : null}
          {d.lieferart ? (
            <>
              <dt className="text-muted">Lieferart</dt>
              <dd>{d.lieferart}</dd>
            </>
          ) : null}
          <dt className="text-muted">Tempo</dt>
          <dd>{TEMPO_KURZ[d.tempo]}</dd>
          {d.preisUebersicht ? (
            <>
              <dt className="text-muted">Preis</dt>
              <dd>
                <Link href="?tab=details" scroll={false} className="text-[22px] font-medium leading-tight hover:text-rose">
                  {preisGross(d.preisUebersicht)}
                </Link>
                <span className="block text-[12px] text-muted">{preisKurz(d.preisUebersicht)}</span>
              </dd>
            </>
          ) : null}
          {d.behandler ? (
            <>
              <dt className="text-muted">Behandler</dt>
              <dd>{d.behandler}</dd>
            </>
          ) : null}
          <dt className="text-muted">Termin</dt>
          <dd>{d.termin ?? '–'}</dd>
          <dt className="text-muted">Eingereicht</dt>
          <dd>{d.eingereicht ? datumZeit(d.eingereicht) : '–'}</dd>
          {d.neuanfertigungVon ? (
            <>
              <dt className="text-muted">Neuanfertigung</dt>
              <dd>
                <Link href={`/auftraege/${d.neuanfertigungVon.id}`} className="border-b border-line hover:border-current">
                  von {d.neuanfertigungVon.nr}
                </Link>
              </dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="border-t border-line pt-8">
        <p className="text-[11px] uppercase tracking-[0.08em] text-muted">Dokumente</p>
        {d.dokumente.length ? (
          <ul className="mt-3 border-t border-line">
            {d.dokumente.map((x) => (
              <li key={x.id} className="border-b border-line">
                <a href={`/api/dokumente/${x.id}`} target="_blank" rel="noopener" className="group flex items-baseline justify-between gap-4 py-3 text-[14px]">
                  <span>
                    <span className="block group-hover:text-white">{x.name}</span>
                    <span className="block text-[13px] text-muted">
                      {x.nr} · {datum(x.am)}
                    </span>
                  </span>
                  <span aria-hidden className="text-rose">
                    ↓
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[14px] font-light text-muted">
            {d.lieferart === LIEFERART_NAMEN.fertigung && d.status !== 'storniert'
              ? 'Lieferschein und Konformitätserklärung erscheinen hier, sobald die Arbeit die Qualitätskontrolle bestanden hat.'
              : 'Keine Dokumente.'}
          </p>
        )}
      </div>
    </aside>
  );
}

function Verlauf({ d, seite }: { d: AuftragDetail; seite: 'praxis' | 'labor' }) {
  if (!d.nachrichten.length) return <p className="font-light text-muted">Noch keine Nachrichten.</p>;
  return (
    <ol className="border-t border-line">
      {d.nachrichten.map((n) =>
        n.art === 'ereignis' ? (
          <li key={n.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line py-3 text-[13px] text-muted">
            <span aria-hidden className="text-rose">
              ·
            </span>
            <span className="min-w-0 flex-1">{n.text}</span>
            <time dateTime={n.am.toISOString()}>{datumZeit(n.am)}</time>
          </li>
        ) : (
          <li key={n.id} className={`border-b border-line py-5 ${n.intern ? 'bg-soft px-4' : ''}`}>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <span className="text-white">{n.eigene ? 'Sie' : n.autor}</span>
              {seite === 'labor' && !n.eigene ? <span>· {n.von === 'praxis' ? 'Ordination' : 'Labor'}</span> : null}
              <time dateTime={n.am.toISOString()}>· {datumZeit(n.am)}</time>
              {n.intern ? <Tag ton="neutral">Intern</Tag> : null}
              {n.art === 'aenderung' ? (
                <Tag ton="neutral">Änderungswunsch · Version {n.version}</Tag>
              ) : n.art === 'reklamation' ? (
                <Tag ton="neutral">Reklamation</Tag>
              ) : n.version ? (
                <Tag ton="neutral">Design Version {n.version}</Tag>
              ) : null}
            </p>
            {n.text ? <p className="mt-2 max-w-[760px] whitespace-pre-line break-words text-[16px] font-light leading-relaxed">{n.text}</p> : null}
            {n.anhaenge.length ? (
              <ul className="mt-3 space-y-1.5 text-[14px]">
                {n.anhaenge.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="min-w-0 truncate">
                      {a.name} <span className="text-[13px] text-muted">· {groesseText(a.groesse)}</span>
                    </span>
                    <DateiAktionen id={a.id} name={a.name} groesse={a.groesse} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ),
      )}
    </ol>
  );
}

function Details({ d }: { d: AuftragDetail }) {
  return (
    <div className="space-y-12">
      {d.preisUebersicht ? <PreisKasten preis={d.preisUebersicht} /> : null}
      {d.zahnschema.map(({ block, wert }) =>
        block.typ === 'zahnleiste' ? (
          <div key={block.id}>
            <h2 className="mb-5 text-[20px] font-light">Zähne</h2>
            <Zahnleiste werkzeuge={block.werkzeuge} wert={(wert as ZahnAuswahl) ?? {}} readOnly />
          </div>
        ) : block.typ === 'kieferbogen' ? (
          <div key={block.id}>
            <h2 className="mb-5 text-[20px] font-light">Zähne</h2>
            <Kieferbogen wert={(wert as ProthesenAuswahl) ?? {}} readOnly />
          </div>
        ) : null,
      )}
      <dl className="border-t border-line text-[15px]">
        {d.zeilen.map((z) => (
          <div key={z.titel} className="grid grid-cols-1 gap-x-6 gap-y-1 border-b border-line py-3.5 sm:grid-cols-[170px_minmax(0,1fr)]">
            <dt className="text-muted">{z.titel}</dt>
            <dd className="whitespace-pre-line break-words font-light">{z.wert}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

