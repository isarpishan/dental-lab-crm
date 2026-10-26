import { DateiAktionen } from '@/components/auftrag/AuftragBedienung';
import { AenderungFormular, DesignHochladen, FeedbackFormular, FreigabeDialog, LaborSchritte, LieferterminFormular, RueckfrageFormular } from '@/components/auftrag/DesignBedienung';
import { groesseText } from '@/lib/dateien/regeln';
import { datumZeit } from '@/lib/format';
import { REVISIONS_NAMEN, type DesignVersion } from '@/lib/orders/design';
import type { AuftragDetail } from '@/lib/orders/detail';

/**
 * Design-Teil der Auftragsseite (Spec فاز ۱، بخش G): Karte zur Freigabe in der Ordination,
 * Steuerung im Labor, und der Bereich »Design von DDL« im Tab »Dateien« mit Verlauf.
 */

type Ergebnis = Promise<{ fehler?: string }>;
export type DesignAktionen = {
  freigeben?: (orderId: string, daten: { revisionId: string; name: string; geprueft: boolean }) => Promise<{ download?: string; fehler?: string }>;
  aenderung?: (orderId: string, revisionId: string, daten: { zaehne: number[]; arten: string[]; text: string; dateiIds: string[] }) => Ergebnis;
  feedback?: (orderId: string, daten: { bewertung: 'up' | 'down'; kommentar: string }) => Ergebnis;
  designSenden?: (orderId: string, notiz: string) => Ergebnis;
  laborSchritt?: (orderId: string, nach: string) => Ergebnis;
  rueckfrage?: (orderId: string, daten: { text: string; fehlend: string[] }) => Ergebnis;
  liefertermin?: (orderId: string, datum: string) => Ergebnis;
  dateiEntfernen: (id: string) => Ergebnis;
};

const zipLink = (orderId: string, v: DesignVersion) => (v.dateien.length > 1 ? `/api/auftraege/${orderId}/design?version=${v.revision}` : `/api/dateien/${v.dateien[0]?.id}`);

function Zitat({ titel, text }: { titel: string; text: string }) {
  return (
    <blockquote className="max-w-[760px] border-l-2 border-rose pl-5">
      <p className="text-[13px] text-muted">{titel}</p>
      <p className="mt-1 whitespace-pre-line text-[17px] font-light leading-relaxed">{text}</p>
    </blockquote>
  );
}

function VersionsDateien({ v, herunterladen }: { v: DesignVersion; herunterladen: boolean }) {
  return (
    <ul className="space-y-2 text-[15px]">
      {v.dateien.map((f) => (
        <li key={f.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="min-w-0 truncate font-light">
            {f.name} <span className="text-[13px] text-muted">· {groesseText(f.groesse)}</span>
          </span>
          <DateiAktionen id={f.id} name={f.name} groesse={f.groesse} herunterladen={herunterladen} />
        </li>
      ))}
    </ul>
  );
}

/** Ordination, Tab »Status«: prüfen und freigeben, herunterladen, Überarbeitung, Feedback. */
export function DesignKarteOrdination({ d, aktionen, nutzerName, maxBytes }: { d: AuftragDetail; aktionen: DesignAktionen; nutzerName: string; maxBytes: number }) {
  const v = d.design.aktuell;
  return (
    <>
      {d.status === 'in_ueberarbeitung' && v?.aenderung ? <Zitat titel={`Ihr Änderungswunsch zu Version ${v.revision}`} text={v.aenderung} /> : null}
      {v && d.kann.freigeben && aktionen.freigeben && aktionen.aenderung ? (
        <section aria-label="Design prüfen" className="space-y-6 rounded-[12px] border border-rose p-6 md:p-8">
          <div>
            <h3 className="text-[24px] font-light">Bitte prüfen Sie das Design (Version {v.revision}).</h3>
            <p className="mt-2 text-[15px] text-muted">Öffnen Sie die 3D-Ansicht. Der Download wird mit Ihrer Freigabe freigeschaltet.</p>
          </div>
          {v.notiz ? <Zitat titel="Notiz von Digital Dental Lab" text={v.notiz} /> : null}
          <VersionsDateien v={v} herunterladen={false} />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <FreigabeDialog orderId={d.id} revisionId={v.id} version={v.revision} name={nutzerName} freigeben={aktionen.freigeben} />
            <AenderungFormular orderId={d.id} revisionId={v.id} zaehne={d.zaehne} maxBytes={maxBytes} titel="Änderung anfordern" aenderung={aktionen.aenderung} dateiEntfernen={aktionen.dateiEntfernen} />
          </div>
        </section>
      ) : null}
      {v && v.status === 'freigegeben' && d.status === 'freigegeben' ? (
        <section aria-label="Design herunterladen" className="space-y-6 rounded-[12px] border border-panel-line p-6 md:p-8">
          <div>
            <h3 className="text-[24px] font-light">Design Version {v.revision}</h3>
            <p className="mt-2 text-[15px] text-muted">
              Freigegeben{v.entschieden ? ` am ${datumZeit(v.entschieden.am)}${v.entschieden.name ? ` von ${v.entschieden.name}` : ''}` : ''}.
            </p>
          </div>
          <VersionsDateien v={v} herunterladen />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <a href={zipLink(d.id, v)} download className="rounded-[30px] bg-button px-[26px] py-[17px] text-button-ink transition-[filter] duration-[180ms] hover:brightness-105">
              Dateien herunterladen
            </a>
            {d.kann.aenderung && aktionen.aenderung ? (
              <AenderungFormular orderId={d.id} revisionId={v.id} zaehne={d.zaehne} maxBytes={maxBytes} titel="Überarbeitung anfordern" aenderung={aktionen.aenderung} dateiEntfernen={aktionen.dateiEntfernen} />
            ) : null}
          </div>
        </section>
      ) : null}
      {d.kann.feedback && aktionen.feedback ? <FeedbackFormular orderId={d.id} feedback={aktionen.feedback} /> : null}
      {d.feedback ? <p className="text-[15px] text-muted">Danke für Ihr Feedback.</p> : null}
    </>
  );
}

/** Labor, Tab »Status«: Design senden, Rückfrage, »Abschließen«, Liefertermin. */
export function LaborSteuerung({ d, aktionen, maxBytes, heute }: { d: AuftragDetail; aktionen: DesignAktionen; maxBytes: number; heute: string }) {
  const v = d.design.aktuell;
  const offen = !['storniert', 'abgeschlossen', 'geliefert'].includes(d.status);
  // Produktionsschritte stehen im Abschnitt »Produktion«; hier Design, Rückfrage und »Abschließen«
  const kastenTitel = d.kann.design || d.kann.rueckfrage ? 'Design und Rückfrage' : 'Nächster Schritt';
  return (
    <>
      {d.status === 'in_ueberarbeitung' && v?.aenderung ? <Zitat titel={`Änderungswunsch der Ordination zu Version ${v.revision}`} text={v.aenderung} /> : null}
      {d.status === 'design_freigabe' && v ? (
        <p className="text-[15px] text-muted">
          Version {v.revision} liegt seit {datumZeit(v.hochgeladen)} bei der Ordination zur Freigabe.
        </p>
      ) : null}
      {d.feedback ? (
        <p className="text-[15px]">
          Feedback der Ordination: <span className={d.feedback.bewertung === 'up' ? 'text-white' : 'text-rose-light'}>{d.feedback.bewertung === 'up' ? 'Gut' : 'Nicht gut'}</span>
          {d.feedback.kommentar ? <span className="text-muted"> · „{d.feedback.kommentar}“</span> : null}
        </p>
      ) : null}
      {offen && (d.laborSchritte.length || d.kann.design || d.kann.rueckfrage) ? (
        <section aria-label={kastenTitel} className="space-y-8 rounded-[12px] border border-panel-line p-6 md:p-8">
          <h3 className="text-[22px] font-light">{kastenTitel}</h3>
          {aktionen.laborSchritt ? <LaborSchritte orderId={d.id} schritte={d.laborSchritte} schritt={aktionen.laborSchritt} /> : null}
          {d.kann.design && aktionen.designSenden ? (
            <div className="space-y-4 border-t border-line pt-6">
              <h4 className="text-[18px] font-light">{v ? `Neue Version (Version ${v.revision + 1})` : 'Design hochladen'}</h4>
              <DesignHochladen
                orderId={d.id}
                ausstehend={d.design.ausstehend}
                maxBytes={maxBytes}
                mitFreigabe={d.freigabeNoetig}
                senden={aktionen.designSenden}
                dateiEntfernen={aktionen.dateiEntfernen}
              />
            </div>
          ) : null}
          {d.kann.rueckfrage && aktionen.rueckfrage ? <RueckfrageFormular orderId={d.id} pflicht={d.pflichtDateien} rueckfrage={aktionen.rueckfrage} /> : null}
        </section>
      ) : null}
      {offen && aktionen.liefertermin ? <LieferterminFormular orderId={d.id} wert={d.liefertermin} heute={heute} setzen={aktionen.liefertermin} /> : null}
    </>
  );
}

/** Tab »Dateien«: »Design von DDL« mit aktueller Version und Verlauf. */
export function DesignDateienBereich({ d, seite }: { d: AuftragDetail; seite: 'praxis' | 'labor' }) {
  const v = d.design.aktuell;
  const darf = (x: DesignVersion) => seite === 'labor' || x.status === 'freigegeben';
  return (
    <div className="space-y-6">
      <h2 className="text-[24px] font-light">Design von DDL</h2>
      {!v ? (
        <p className="max-w-[620px] text-[15px] font-light text-muted">
          {seite === 'praxis' ? 'Sobald Ihr Design bereit ist, sehen Sie es hier in 3D. Der Download wird mit Ihrer Freigabe freigeschaltet.' : 'Noch kein Design gesendet.'}
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-[15px]">
            Version {v.revision} · <span className={v.status === 'offen' ? 'text-rose-light' : 'text-paragraph'}>{REVISIONS_NAMEN[v.status]}</span>
            <span className="text-muted"> · {datumZeit(v.hochgeladen)}</span>
          </p>
          <VersionsDateien v={v} herunterladen={darf(v)} />
          {!darf(v) ? <p className="text-[13px] text-muted">Download nach Ihrer Freigabe.</p> : null}
          {darf(v) && v.dateien.length > 1 ? (
            <a href={zipLink(d.id, v)} download className="inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
              Alle Dateien als ZIP ↓
            </a>
          ) : null}
        </div>
      )}
      {seite === 'labor' && d.design.ausstehend.length ? (
        <p className="text-[13px] text-muted">Noch nicht gesendet: {d.design.ausstehend.map((f) => f.name).join(', ')}</p>
      ) : null}
      {d.design.frueher.length ? (
        <details className="border-t border-line pt-4">
          <summary className="cursor-pointer text-[15px] text-muted hover:text-white">Verlauf ({d.design.frueher.length})</summary>
          <ol className="mt-4 space-y-4">
            {d.design.frueher.map((x) => (
              <li key={x.id} className="border-b border-line pb-4 text-[14px]">
                <p>
                  Version {x.revision} · {REVISIONS_NAMEN[x.status]} <span className="text-muted">· {datumZeit(x.hochgeladen)}</span>
                </p>
                <p className="mt-1 text-muted">{x.dateien.map((f) => f.name).join(', ')}</p>
                {x.aenderung ? <p className="mt-2 whitespace-pre-line font-light">Änderungswunsch: {x.aenderung}</p> : null}
                {seite === 'labor' ? <VersionsDateien v={x} herunterladen /> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}
