'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { DateiAktionen } from '@/components/auftrag/AuftragBedienung';
import { useUploads } from '@/components/auftrag/useUploads';
import { Button } from '@/components/ui/Button';
import { Feld, Meldung, Textfeld } from '@/components/ui/Formular';
import { ANNEHMEN, groesseText } from '@/lib/dateien/regeln';
import { AENDERUNGS_ARTEN } from '@/lib/orders/aenderung';
import type { DateiInfo } from '@/lib/orders/entwurf';
import { DATEI_NAMEN, type DateiPlatz } from '@/lib/orders/form-schema';

/**
 * Design-Freigabe im Browser (Spec فاز ۱، بخش G): «Freigeben & herunterladen» mit Name und Häkchen,
 * «Änderung anfordern» mit Zähnen, Art der Änderung und Text, «Wie gefällt Ihnen das Design?», und
 * im Labor: Design hochladen und senden, nächster Schritt, Rückfrage, Liefertermin.
 */

type Ergebnis = Promise<{ fehler?: string }>;

/** Datei-Download ohne die Seite zu verlassen. */
function herunterladen(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const CHIP = 'inline-flex min-h-10 items-center border px-3.5 text-[14px] transition-colors duration-[180ms]';
const chipKlasse = (an: boolean) => `${CHIP} ${an ? 'border-rose text-white' : 'border-line text-nav hover:border-line-strong hover:text-white'}`;

/* ── Ordination ───────────────────────────────────────────────── */

export function FreigabeDialog({
  orderId,
  revisionId,
  version,
  name,
  freigeben,
}: {
  orderId: string;
  revisionId: string;
  version: number;
  name: string;
  freigeben: (orderId: string, daten: { revisionId: string; name: string; geprueft: boolean }) => Promise<{ download?: string; fehler?: string }>;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [wer, setWer] = useState(name);
  const [geprueft, setGeprueft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  return (
    <>
      <Button onClick={() => dialog.current?.showModal()}>Freigeben & herunterladen</Button>
      <dialog
        ref={dialog}
        aria-labelledby={`freigabe-${revisionId}`}
        className="m-auto w-[min(560px,calc(100vw-32px))] rounded-[12px] border border-panel-line bg-black p-0 text-white backdrop:bg-black/80"
      >
        <form
          className="space-y-6 p-6 md:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            starten(async () => {
              setFehler(null);
              const r = await freigeben(orderId, { revisionId, name: wer, geprueft });
              if (r.fehler || !r.download) {
                setFehler(r.fehler ?? 'Die Freigabe ist fehlgeschlagen.');
                return;
              }
              dialog.current?.close();
              herunterladen(r.download);
              router.refresh();
            });
          }}
        >
          <h2 id={`freigabe-${revisionId}`} className="text-[26px] font-light leading-tight">
            Design Version {version} freigeben
          </h2>
          <p className="text-[15px] font-light leading-relaxed text-muted">
            Mit der Freigabe bestätigen Sie das Design. Name, Zeitpunkt und Ihre Internetadresse werden dazu gespeichert. Danach startet der Download.
          </p>
          <Feld label="Ihr Name" required value={wer} onChange={(e) => setWer(e.target.value)} autoComplete="name" />
          <label className="flex cursor-pointer items-start gap-3 text-[15px]">
            <input type="checkbox" checked={geprueft} onChange={(e) => setGeprueft(e.target.checked)} className="mt-1 size-4 shrink-0 accent-rose" />
            Ich habe das Design geprüft.
          </label>
          {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <Button type="submit" disabled={laeuft || !geprueft}>
              {laeuft ? 'Wird freigegeben …' : 'Freigeben'}
            </Button>
            <Button variant="text" onClick={() => dialog.current?.close()}>
              Abbrechen
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function AenderungFormular({
  orderId,
  revisionId,
  zaehne,
  maxBytes,
  titel,
  aenderung,
  dateiEntfernen,
}: {
  orderId: string;
  revisionId: string;
  zaehne: number[];
  maxBytes: number;
  titel: string;
  aenderung: (orderId: string, revisionId: string, daten: { zaehne: number[]; arten: string[]; text: string; dateiIds: string[] }) => Ergebnis;
  dateiEntfernen: (id: string) => Ergebnis;
}) {
  const router = useRouter();
  const uploads = useUploads({ entwurfId: orderId, start: [], maxBytes, entfernenAktion: dateiEntfernen });
  const [offen, setOffen] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<number[]>([]);
  const [arten, setArten] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const feld = useId();
  const umschalten = <T,>(liste: T[], w: T) => (liste.includes(w) ? liste.filter((x) => x !== w) : [...liste, w]);

  if (!offen) {
    return (
      <Button variant="secondary" onClick={() => setOffen(true)}>
        {titel}
      </Button>
    );
  }
  return (
    <form
      aria-label={titel}
      className="w-full space-y-7 border-t border-line pt-7"
      onSubmit={(e) => {
        e.preventDefault();
        starten(async () => {
          setFehler(null);
          const dateiIds = uploads.liste.filter((u) => u.status === 'fertig' && u.id).map((u) => u.id!);
          const r = await aenderung(orderId, revisionId, { zaehne: gewaehlt, arten, text, dateiIds });
          if (r.fehler) setFehler(r.fehler);
          else router.refresh();
        });
      }}
    >
      <h3 className="text-[22px] font-light">{titel}</h3>
      {zaehne.length ? (
        <fieldset>
          <legend className="text-[15px]">Welche Zähne?</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {zaehne.map((z) => (
              <button key={z} type="button" aria-pressed={gewaehlt.includes(z)} onClick={() => setGewaehlt((g) => umschalten(g, z))} className={chipKlasse(gewaehlt.includes(z))}>
                Zahn {z}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset>
        <legend className="text-[15px]">Was soll geändert werden?</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {AENDERUNGS_ARTEN.map((a) => (
            <button key={a} type="button" aria-pressed={arten.includes(a)} onClick={() => setArten((x) => umschalten(x, a))} className={chipKlasse(arten.includes(a))}>
              {a}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="max-w-[760px]">
        <Textfeld label="Beschreibung" required rows={4} maxLength={5000} placeholder="Zum Beispiel: Zahn 12 etwas länger, an 11 angleichen" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label htmlFor={feld} className="inline-block cursor-pointer border-b border-current pb-1 text-[13px] text-muted hover:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-rose">
          Markierte Screenshots oder Referenzbilder anhängen (optional)
          <input
            id={feld}
            type="file"
            multiple
            accept={ANNEHMEN}
            className="sr-only"
            aria-label="Bilder anhängen"
            onChange={(e) => {
              if (e.target.files?.length) uploads.hochladen('nachricht', [...e.target.files]);
              e.target.value = '';
            }}
          />
        </label>
        {uploads.liste.map((u) => (
          <p key={u.schluessel} className="text-[14px]">
            {u.status === 'fertig' ? '✓' : u.status === 'fehler' ? '!' : '↑'} {u.name} <span className="text-[13px] text-muted">{groesseText(u.groesse)}</span>
            {u.fehler ? <span className="ml-2 text-[13px] text-rose-light">{u.fehler}</span> : null}
          </p>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button type="submit" disabled={laeuft || uploads.laufend > 0}>
          {laeuft ? 'Wird gesendet …' : 'Änderung senden'}
        </Button>
        <Button variant="text" onClick={() => setOffen(false)}>
          Abbrechen
        </Button>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </form>
  );
}

function Daumen({ unten }: { unten?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden className={unten ? 'rotate-180' : ''}>
      <path d="M7 10v10H4V10h3Zm0 0 4-7c1.5 0 2.5 1.2 2.2 2.7L12.6 9H18a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7" />
    </svg>
  );
}

export function FeedbackFormular({ orderId, feedback }: { orderId: string; feedback: (orderId: string, daten: { bewertung: 'up' | 'down'; kommentar: string }) => Ergebnis }) {
  const router = useRouter();
  const [unten, setUnten] = useState(false);
  const [kommentar, setKommentar] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const senden = (bewertung: 'up' | 'down') =>
    starten(async () => {
      setFehler(null);
      const r = await feedback(orderId, { bewertung, kommentar });
      if (r.fehler) setFehler(r.fehler);
      else router.refresh();
    });
  return (
    <div className="space-y-4">
      <p className="text-[18px] font-light">Wie gefällt Ihnen das Design?</p>
      <div className="flex gap-3">
        <button type="button" disabled={laeuft} onClick={() => senden('up')} className={`${chipKlasse(false)} gap-2`}>
          <Daumen /> Gut
        </button>
        <button type="button" disabled={laeuft} aria-pressed={unten} onClick={() => setUnten(true)} className={`${chipKlasse(unten)} gap-2`}>
          <Daumen unten /> Nicht gut
        </button>
      </div>
      {unten ? (
        <div className="max-w-[640px] space-y-4">
          <Textfeld label="Was hat nicht gepasst?" rows={2} maxLength={1000} value={kommentar} onChange={(e) => setKommentar(e.target.value)} />
          <Button variant="secondary" disabled={laeuft} onClick={() => senden('down')}>
            Senden
          </Button>
        </div>
      ) : null}
      {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
    </div>
  );
}

/* ── Labor ────────────────────────────────────────────────────── */

export function LaborSchritte({ orderId, schritte, schritt }: { orderId: string; schritte: { nach: string; label: string }[]; schritt: (orderId: string, nach: string) => Ergebnis }) {
  const router = useRouter();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  if (!schritte.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {schritte.map((s, i) => (
        <Button
          key={s.nach}
          variant={i === 0 ? 'primary' : 'secondary'}
          disabled={laeuft}
          onClick={() =>
            starten(async () => {
              setFehler(null);
              const r = await schritt(orderId, s.nach);
              if (r.fehler) setFehler(r.fehler);
              else router.refresh();
            })
          }
        >
          {s.label}
        </Button>
      ))}
      {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
    </div>
  );
}

export function DesignHochladen({
  orderId,
  ausstehend,
  maxBytes,
  mitFreigabe,
  senden,
  dateiEntfernen,
}: {
  orderId: string;
  ausstehend: DateiInfo[];
  maxBytes: number;
  mitFreigabe: boolean;
  senden: (orderId: string, notiz: string) => Ergebnis;
  dateiEntfernen: (id: string) => Ergebnis;
}) {
  const router = useRouter();
  const uploads = useUploads({ entwurfId: orderId, start: ausstehend, maxBytes, entfernenAktion: dateiEntfernen });
  const [notiz, setNotiz] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const feld = useId();
  const fertig = uploads.liste.filter((u) => u.status === 'fertig').length;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <label
          htmlFor={feld}
          className="cursor-pointer border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-rose"
        >
          Design-Dateien wählen
          <input
            id={feld}
            type="file"
            multiple
            accept={ANNEHMEN}
            aria-label="Design-Dateien hochladen"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) uploads.hochladen('design', [...e.target.files]);
              e.target.value = '';
            }}
          />
        </label>
        <span className="text-[13px] text-muted">STL, PLY, OBJ, 3MF oder ZIP</span>
      </div>
      {uploads.liste.length ? (
        <ul className="space-y-2 text-[14px]">
          {uploads.liste.map((u) => (
            <li key={u.schluessel} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span aria-hidden className={u.status === 'fehler' ? 'text-rose' : 'text-white'}>
                {u.status === 'fertig' ? '✓' : u.status === 'fehler' ? '!' : '↑'}
              </span>
              <span className="min-w-0 truncate">{u.name}</span>
              <span className="text-[13px] text-muted">
                {groesseText(u.groesse)}
                {u.status === 'laeuft' ? ` · ${Math.round(u.fortschritt * 100)} %` : ''}
              </span>
              {u.status === 'fertig' && u.id ? <DateiAktionen id={u.id} name={u.name} groesse={u.groesse} /> : null}
              <button type="button" onClick={() => uploads.entfernen(u)} aria-label={`${u.name} entfernen`} className="border-b border-current text-[13px] text-muted hover:text-white">
                Entfernen
              </button>
              {u.fehler ? <span className="basis-full text-[13px] text-rose-light">{u.fehler}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="max-w-[760px]">
        <Textfeld label="Notiz für die Ordination (optional)" rows={2} maxLength={2000} value={notiz} onChange={(e) => setNotiz(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button
          disabled={laeuft || uploads.laufend > 0 || !fertig}
          onClick={() =>
            starten(async () => {
              setFehler(null);
              const r = await senden(orderId, notiz);
              if (r.fehler) setFehler(r.fehler);
              else {
                for (const u of uploads.liste) uploads.vergessen(u);
                setNotiz('');
                router.refresh();
              }
            })
          }
        >
          {laeuft ? 'Wird gesendet …' : mitFreigabe ? 'Zur Freigabe senden' : 'Design senden'}
        </Button>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </div>
  );
}

export function RueckfrageFormular({
  orderId,
  pflicht,
  rueckfrage,
}: {
  orderId: string;
  pflicht: DateiPlatz[];
  rueckfrage: (orderId: string, daten: { text: string; fehlend: string[] }) => Ergebnis;
}) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  const [fehlend, setFehlend] = useState<string[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  if (!offen) {
    return (
      <Button variant="text" onClick={() => setOffen(true)}>
        Rückfrage stellen
      </Button>
    );
  }
  return (
    <form
      aria-label="Rückfrage stellen"
      className="w-full max-w-[760px] space-y-5 border-t border-line pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        starten(async () => {
          setFehler(null);
          const r = await rueckfrage(orderId, { text, fehlend });
          if (r.fehler) setFehler(r.fehler);
          else router.refresh();
        });
      }}
    >
      <Textfeld label="Frage an die Ordination" required rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
      {pflicht.length ? (
        <fieldset>
          <legend className="text-[15px]">Fehlende Daten (optional)</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {pflicht.map((p) => (
              <button key={p} type="button" aria-pressed={fehlend.includes(p)} onClick={() => setFehlend((f) => (f.includes(p) ? f.filter((x) => x !== p) : [...f, p]))} className={chipKlasse(fehlend.includes(p))}>
                {DATEI_NAMEN[p]}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird gesendet …' : 'Rückfrage senden'}
        </Button>
        <Button variant="text" onClick={() => setOffen(false)}>
          Abbrechen
        </Button>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </form>
  );
}

export function LieferterminFormular({
  orderId,
  wert,
  heute,
  setzen,
}: {
  orderId: string;
  wert: string | null;
  heute: string;
  setzen: (orderId: string, datum: string) => Ergebnis;
}) {
  const router = useRouter();
  const [datum, setDatum] = useState(wert ?? '');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  return (
    <form
      aria-label="Liefertermin"
      className="flex flex-wrap items-end gap-x-4 gap-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        starten(async () => {
          setFehler(null);
          const r = await setzen(orderId, datum);
          if (r.fehler) setFehler(r.fehler);
          else router.refresh();
        });
      }}
    >
      <div className="w-[220px]">
        <Feld label="Liefertermin" type="date" min={heute} value={datum} onChange={(e) => setDatum(e.target.value)} />
      </div>
      <Button type="submit" variant="secondary" disabled={laeuft || datum === (wert ?? '')} className="mb-[3px]">
        {laeuft ? 'Wird gespeichert …' : 'Speichern'}
      </Button>
      {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
    </form>
  );
}
