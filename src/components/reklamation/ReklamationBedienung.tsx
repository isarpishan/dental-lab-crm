'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { useUploads } from '@/components/auftrag/useUploads';
import { Button } from '@/components/ui/Button';
import { Meldung, Textfeld } from '@/components/ui/Formular';
import { ANNEHMEN, groesseText } from '@/lib/dateien/regeln';
import { GRUND_NAMEN } from '@/lib/reklamationen/regeln';

/**
 * «Reklamation melden» (Ordination) / «Reklamation erfassen» (Labor, z. B. telefonisch) und die
 * Entscheidung des Büros (Spec فاز ۱، بخش J). Bilder als Anhang der Nachricht in der Kommunikation.
 */

type Ergebnis = Promise<{ fehler?: string }>;
export type MeldenAktion = (orderId: string, daten: { grund: string; zaehne: number[]; text: string; dateiIds: string[] }) => Promise<{ fehler?: string; nr?: string }>;
export type EntscheidenAktion = (id: string, daten: { entscheidung: string; notiz: string; kostenlos: boolean }) => Promise<{ fehler?: string; neuerAuftrag?: string | null }>;

const CHIP = 'inline-flex min-h-10 items-center border px-3.5 text-[14px] transition-colors duration-[180ms]';
const chipKlasse = (an: boolean) => `${CHIP} ${an ? 'border-rose text-white' : 'border-line text-nav hover:border-line-strong hover:text-white'}`;

export function ReklamationMelden({
  orderId,
  zaehne,
  maxBytes,
  labor,
  melden,
  dateiEntfernen,
}: {
  orderId: string;
  zaehne: number[];
  maxBytes: number;
  labor: boolean;
  melden: MeldenAktion;
  dateiEntfernen: (id: string) => Ergebnis;
}) {
  const router = useRouter();
  const uploads = useUploads({ entwurfId: orderId, start: [], maxBytes, entfernenAktion: dateiEntfernen });
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState<string | null>(null);
  const [gewaehlt, setGewaehlt] = useState<number[]>([]);
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const feld = useId();
  const titel = labor ? 'Reklamation erfassen' : 'Reklamation melden';

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
          if (!grund) return setFehler('Bitte einen Grund wählen.');
          const dateiIds = uploads.liste.filter((u) => u.status === 'fertig' && u.id).map((u) => u.id!);
          const r = await melden(orderId, { grund, zaehne: gewaehlt, text, dateiIds });
          if (r.fehler) setFehler(r.fehler);
          else {
            setOffen(false);
            router.refresh();
          }
        });
      }}
    >
      <div>
        <h3 className="text-[22px] font-light">{titel}</h3>
        <p className="mt-2 max-w-[620px] text-[15px] text-muted">
          {labor ? 'Für die Ordination, zum Beispiel nach einem Anruf. Sie sieht die Reklamation im Portal.' : 'Beschreiben Sie bitte, was nicht passt. Fotos helfen uns bei der Prüfung.'}
        </p>
      </div>
      <fieldset>
        <legend className="text-[15px]">
          Grund<span className="ml-1 text-rose" aria-hidden>*</span>
        </legend>
        <div role="radiogroup" className="mt-3 flex flex-wrap gap-2">
          {Object.entries(GRUND_NAMEN).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={grund === k} onClick={() => setGrund(k)} className={chipKlasse(grund === k)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {zaehne.length ? (
        <fieldset>
          <legend className="text-[15px]">Welche Zähne? (optional)</legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {zaehne.map((z) => (
              <button
                key={z}
                type="button"
                aria-pressed={gewaehlt.includes(z)}
                onClick={() => setGewaehlt((g) => (g.includes(z) ? g.filter((x) => x !== z) : [...g, z]))}
                className={chipKlasse(gewaehlt.includes(z))}
              >
                Zahn {z}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="max-w-[760px]">
        <Textfeld label="Beschreibung" required rows={4} maxLength={5000} placeholder="Zum Beispiel: Krone 14 sitzt approximal zu stramm" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label
          htmlFor={feld}
          className="inline-block cursor-pointer border-b border-current pb-1 text-[13px] text-muted hover:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-rose"
        >
          Fotos anhängen (optional)
          <input
            id={feld}
            type="file"
            multiple
            accept={ANNEHMEN}
            className="sr-only"
            aria-label="Fotos anhängen"
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
          {laeuft ? 'Wird gesendet …' : 'Reklamation senden'}
        </Button>
        <Button variant="text" onClick={() => setOffen(false)}>
          Abbrechen
        </Button>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </form>
  );
}

const ENTSCHEIDUNGEN = [
  { wert: 'neuanfertigung', label: 'Neuanfertigung', text: 'Neuer Auftrag mit denselben Angaben und Scans' },
  { wert: 'reparatur', label: 'Reparatur', text: 'Die Arbeit wird im Labor nachgebessert' },
  { wert: 'abgelehnt', label: 'Abgelehnt', text: 'Mit Begründung für die Ordination' },
] as const;

export function ReklamationEntscheiden({ id, garantie, entscheiden }: { id: string; garantie: boolean; entscheiden: EntscheidenAktion }) {
  const router = useRouter();
  const [wahl, setWahl] = useState<string | null>(null);
  const [kostenlos, setKostenlos] = useState(garantie);
  const [notiz, setNotiz] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const name = useId();
  return (
    <form
      aria-label="Reklamation entscheiden"
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        starten(async () => {
          setFehler(null);
          if (!wahl) return setFehler('Bitte eine Entscheidung wählen.');
          const r = await entscheiden(id, { entscheidung: wahl, notiz, kostenlos: wahl === 'neuanfertigung' && kostenlos });
          if (r.fehler) setFehler(r.fehler);
          else router.refresh();
        });
      }}
    >
      <fieldset>
        <legend className="text-[15px]">Entscheidung</legend>
        <div className="mt-3 border-t border-line">
          {ENTSCHEIDUNGEN.map((x) => (
            <label key={x.wert} className="flex cursor-pointer items-baseline gap-3 border-b border-line py-3">
              <input type="radio" name={name} value={x.wert} checked={wahl === x.wert} onChange={() => setWahl(x.wert)} className="size-4 translate-y-0.5 accent-rose" />
              <span className="text-[16px]">{x.label}</span>
              <span className="text-[13px] text-muted">{x.text}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {wahl === 'neuanfertigung' ? (
        <label className="flex items-center gap-3 text-[15px]">
          <input type="checkbox" checked={kostenlos} onChange={(e) => setKostenlos(e.target.checked)} className="size-4 accent-rose" />
          Ohne Berechnung (Gewährleistung oder Kulanz)
        </label>
      ) : null}
      <div className="max-w-[760px]">
        <Textfeld
          label={wahl === 'abgelehnt' ? 'Begründung für die Ordination' : 'Nachricht an die Ordination (optional)'}
          required={wahl === 'abgelehnt'}
          rows={3}
          maxLength={3000}
          value={notiz}
          onChange={(e) => setNotiz(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Entscheidung senden'}
        </Button>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </form>
  );
}

export function ReparaturErledigt({ id, aktion }: { id: string; aktion: (id: string) => Ergebnis }) {
  const router = useRouter();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-4">
      <Button
        variant="secondary"
        disabled={laeuft}
        onClick={() =>
          starten(async () => {
            setFehler(null);
            const r = await aktion(id);
            if (r.fehler) setFehler(r.fehler);
            else router.refresh();
          })
        }
      >
        {laeuft ? '…' : 'Reparatur erledigt'}
      </Button>
      {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
    </span>
  );
}
