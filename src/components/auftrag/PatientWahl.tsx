'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Feld, Meldung } from '@/components/ui/Formular';
import type { PatientTreffer } from '@/lib/orders/entwurf';

export type PatientAktionen = {
  suchen: (suche: string) => Promise<{ treffer?: PatientTreffer[]; fehler?: string }>;
  anlegen: (eingabe: { vorname: string; nachname: string; geburtsdatum: string; trotzdem: boolean }) => Promise<{
    patient?: PatientTreffer;
    doppelt?: PatientTreffer;
    fehler?: string;
  }>;
  /** بیمار را برای Entwurf تعیین می‌کند (و Entwurf را اگر هنوز نیست می‌سازد). */
  waehlen: (p: PatientTreffer) => Promise<string | null>;
};

const zusatz = (p: PatientTreffer) => [p.code, p.geburtsdatum ? `geb. ${p.geburtsdatum}` : null, p.zuletzt ? `zuletzt ${p.zuletzt}` : null].filter(Boolean).join(' · ');

/**
 * قدم «Patient» (Spec فاز ۱، D.۱): جست‌وجو در بیماران همین Ordination (نام یا Patienten-ID)
 * با آخرین بیماران در ابتدا، یا «Neuen Patienten anlegen». بیمار تکراری پیش از ساختن
 * پیشنهاد داده می‌شود.
 */
export function PatientWahl({ aktionen, gewaehlt, onFertig }: { aktionen: PatientAktionen; gewaehlt: PatientTreffer | null; onFertig: () => void }) {
  const [suche, setSuche] = useState('');
  const [treffer, setTreffer] = useState<PatientTreffer[] | null>(null);
  const [neu, setNeu] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const anfrage = useRef(0);

  useEffect(() => {
    const nr = ++anfrage.current;
    const t = setTimeout(
      async () => {
        const r = await aktionen.suchen(suche);
        if (nr !== anfrage.current) return;
        if (r.fehler) setFehler(r.fehler);
        setTreffer(r.treffer ?? []);
        // noch keine Patienten: gleich das Formular zeigen
        if (!suche && r.treffer?.length === 0) setNeu(true);
      },
      suche ? 250 : 0,
    );
    return () => clearTimeout(t);
  }, [suche, aktionen]);

  function waehlen(p: PatientTreffer) {
    setFehler(null);
    starten(async () => {
      const f = await aktionen.waehlen(p);
      if (f) setFehler(f);
      else onFertig();
    });
  }

  const ohnePatienten = treffer !== null && treffer.length === 0 && !suche;

  return (
    <div className="max-w-[760px]">
      {!ohnePatienten ? (
        <>
          <Feld
            label="Patient suchen"
            type="search"
            placeholder="Name oder Patienten-ID"
            autoComplete="off"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
          />
          <p className="mt-6 text-[11px] uppercase tracking-[0.08em] text-muted">{suche ? 'Treffer' : 'Zuletzt'}</p>
          <div role="group" aria-label="Patienten" aria-busy={treffer === null} className="mt-3 border-t border-line">
            {treffer?.map((p) => {
              const aktiv = gewaehlt?.id === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={aktiv}
                  disabled={laeuft}
                  onClick={() => waehlen(p)}
                  className="group flex min-h-16 w-full items-center justify-between gap-4 border-b border-line py-3.5 text-left disabled:cursor-wait"
                >
                  <span className="min-w-0">
                    <span className={`block text-[18px] font-light ${aktiv ? 'text-white' : 'text-nav group-hover:text-white'}`}>{p.name}</span>
                    <span className="mt-0.5 block text-[13px] text-muted">{zusatz(p)}</span>
                  </span>
                  <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-full border ${aktiv ? 'border-white' : 'border-muted/70'}`}>
                    {aktiv ? <span className="size-[7px] rounded-full bg-white" /> : null}
                  </span>
                </button>
              );
            })}
            {treffer?.length === 0 ? <p className="border-b border-line py-4 text-[15px] font-light text-muted">Kein Patient gefunden.</p> : null}
          </div>
        </>
      ) : (
        <p className="text-[15px] font-light text-muted">Noch keine Patienten angelegt.</p>
      )}

      {fehler ? (
        <div className="mt-6">
          <Meldung art="fehler">{fehler}</Meldung>
        </div>
      ) : null}

      <div className="mt-8">
        {neu ? (
          <NeuerPatient aktionen={aktionen} onGewaehlt={waehlen} onAbbrechen={ohnePatienten ? undefined : () => setNeu(false)} vorschlag={suche} />
        ) : (
          <Button variant="text" onClick={() => setNeu(true)}>
            Neuen Patienten anlegen <span aria-hidden>+</span>
          </Button>
        )}
      </div>
    </div>
  );
}

function NeuerPatient({
  aktionen,
  onGewaehlt,
  onAbbrechen,
  vorschlag,
}: {
  aktionen: PatientAktionen;
  onGewaehlt: (p: PatientTreffer) => void;
  onAbbrechen?: () => void;
  vorschlag: string;
}) {
  // ein einzelnes Suchwort ohne Ziffern ist meist der Nachname
  const [daten, setDaten] = useState({ vorname: '', nachname: /^\S+$/.test(vorschlag.trim()) && !/\d/.test(vorschlag) ? vorschlag.trim() : '', geburtsdatum: '' });
  const [fehler, setFehler] = useState<string | null>(null);
  const [doppelt, setDoppelt] = useState<PatientTreffer | null>(null);
  const [laeuft, starten] = useTransition();
  const setzen = (feld: keyof typeof daten) => (e: { target: { value: string } }) => {
    setDoppelt(null);
    setDaten((d) => ({ ...d, [feld]: e.target.value }));
  };

  function anlegen(trotzdem: boolean) {
    setFehler(null);
    starten(async () => {
      const r = await aktionen.anlegen({ ...daten, trotzdem });
      if (r.fehler) setFehler(r.fehler);
      else if (r.doppelt) setDoppelt(r.doppelt);
      else if (r.patient) onGewaehlt(r.patient);
    });
  }

  return (
    <form
      aria-label="Neuen Patienten anlegen"
      onSubmit={(e) => {
        e.preventDefault();
        anlegen(false);
      }}
      className="border-t border-line pt-8"
    >
      <h3 className="text-[20px] font-light">Neuer Patient</h3>
      <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2">
        <Feld label="Vorname" name="vorname" required autoComplete="off" value={daten.vorname} onChange={setzen('vorname')} />
        <Feld label="Nachname" name="nachname" required autoComplete="off" value={daten.nachname} onChange={setzen('nachname')} />
        <Feld label="Geburtsdatum" name="geburtsdatum" type="date" hinweis="Optional" value={daten.geburtsdatum} onChange={setzen('geburtsdatum')} />
      </div>
      <p className="mt-5 max-w-[620px] text-[13px] leading-relaxed text-muted">
        Der Name wird verschlüsselt gespeichert. Im Labor, auf Laufzetteln und in E-Mails erscheint nur die Patienten-ID.
      </p>
      {doppelt ? (
        <div className="mt-6 space-y-4">
          <Meldung art="fehler">
            Es gibt bereits {doppelt.name} ({[doppelt.code, doppelt.geburtsdatum ? `geb. ${doppelt.geburtsdatum}` : null].filter(Boolean).join(', ')}).
          </Meldung>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <Button onClick={() => onGewaehlt(doppelt)} disabled={laeuft}>
              Diesen Patienten verwenden
            </Button>
            <Button variant="text" onClick={() => anlegen(true)} disabled={laeuft}>
              Trotzdem neu anlegen
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Button type="submit" disabled={laeuft}>
            {laeuft ? 'Wird angelegt …' : 'Anlegen und weiter'}
          </Button>
          {onAbbrechen ? (
            <Button variant="text" onClick={onAbbrechen}>
              Abbrechen
            </Button>
          ) : null}
          {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
        </div>
      )}
    </form>
  );
}

/** صفحهٔ «Neuer Patient» در پورتال: همان فرم، و بعد صفحهٔ بیمار. */
export function NeuerPatientSeite({ anlegen }: { anlegen: (ordination: string | null, eingabe: Parameters<PatientAktionen['anlegen']>[0]) => ReturnType<PatientAktionen['anlegen']> }) {
  const router = useRouter();
  return (
    <div className="max-w-[760px]">
      <NeuerPatient
        aktionen={{ suchen: async () => ({ treffer: [] }), anlegen: (e) => anlegen(null, e), waehlen: async () => null }}
        onGewaehlt={(p) => router.push(`/patienten/${p.id}`)}
        vorschlag=""
      />
    </div>
  );
}
