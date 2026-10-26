'use client';

import Link from 'next/link';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { zahlenFragenAktion } from './actions';

/**
 * «Frag deine Zahlen» im Browser (Spec فاز ۵، قدم ۶): Frage auf Deutsch oder Persisch, Antwort in derselben Sprache, darunter
 * die Listen, aus denen die Zahlen stammen. Der Verlauf lebt nur in dieser Seite (nichts wird gespeichert); die letzten drei
 * Fragen gehen als Zusammenhang mit, damit »und im Vormonat?« verstanden wird.
 */

type Eintrag = { frage: string; antwort?: string; fehler?: string; quellen?: { text: string; href: string }[] };

const BEISPIELE = [
  'Wie viel habe ich im letzten Quartal für Material ausgegeben?',
  'Welche Ordination hatte dieses Jahr den meisten Umsatz?',
  'امسال چقدر خرج رستوران و غذا کردم؟',
  'Wie viel sollte ich für Steuer und SVS zurücklegen?',
];

export function Fragen({ kiAktiv }: { kiAktiv: boolean }) {
  const [verlauf, setVerlauf] = useState<Eintrag[]>([]);
  const [text, setText] = useState('');
  const [laeuft, starten] = useTransition();
  const feld = useRef<HTMLTextAreaElement>(null);

  function fragen(frage: string) {
    const f = frage.trim();
    if (!f || laeuft) return;
    const bisher = verlauf.filter((e) => e.antwort).slice(-3).map((e) => ({ frage: e.frage, antwort: e.antwort! }));
    setVerlauf((v) => [...v, { frage: f }]);
    setText('');
    starten(async () => {
      const r = await zahlenFragenAktion(f, bisher).catch(() => ({ fehler: 'Keine Verbindung. Bitte noch einmal fragen.' }));
      setVerlauf((v) => v.map((e, i) => (i === v.length - 1 ? { ...e, ...('fehler' in r ? { fehler: r.fehler } : { antwort: r.antwort, quellen: r.quellen }) } : e)));
      feld.current?.focus();
    });
  }

  function absenden(e: FormEvent) {
    e.preventDefault();
    fragen(text);
  }

  return (
    <div className="max-w-[860px]">
      {verlauf.length ? (
        <ol aria-label="Fragen und Antworten" aria-live="polite" className="mb-8 space-y-4">
          {verlauf.map((e, i) => (
            <li key={i} className="border-b border-line pb-4">
              <p dir="auto" className="text-[17px] font-light">
                {e.frage}
              </p>
              {e.antwort ? (
                <>
                  <div dir="auto" className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-paragraph" aria-label="Antwort">
                    {e.antwort}
                  </div>
                  {e.quellen?.length ? (
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                      <span>Grundlage:</span>
                      {e.quellen.map((q) => (
                        <Link key={q.href + q.text} href={q.href} className="border-b border-current text-rose-light hover:text-white">
                          {q.text}
                        </Link>
                      ))}
                    </p>
                  ) : null}
                </>
              ) : e.fehler ? (
                <p className="mt-2 text-[14px] text-rose">{e.fehler}</p>
              ) : (
                <p className="mt-2 text-[14px] text-muted">Claude rechnet …</p>
              )}
            </li>
          ))}
        </ol>
      ) : null}

      {kiAktiv ? null : (
        <p className="mb-6 text-[13px] text-rose">
          Die KI ist aus.{' '}
          <Link href="/einstellungen/ki" className="border-b border-current">
            Einstellungen → KI
          </Link>
        </p>
      )}

      <form onSubmit={absenden} aria-label="Frage stellen" className="space-y-4">
        <label className="block text-[15px]">
          Ihre Frage (Deutsch oder Persisch)
          <textarea
            ref={feld}
            dir="auto"
            rows={2}
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                fragen(text);
              }
            }}
            placeholder="z. B. Wie viel hat das Labor im September eingenommen?"
            className="mt-[9px] block w-full rounded-[8px] border border-field-line bg-field p-[15px] text-[16px] text-white placeholder:text-muted/70"
          />
        </label>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button type="submit" disabled={laeuft || !text.trim() || !kiAktiv}>
            {laeuft ? 'Claude rechnet …' : 'Fragen'}
          </Button>
          <span className="text-[13px] text-muted">Enter schickt ab, Umschalt+Enter macht eine neue Zeile.</span>
        </div>
      </form>

      {verlauf.length ? null : (
        <div className="mt-10">
          <p className="mb-3 text-[13px] text-muted">Zum Beispiel:</p>
          <ul className="flex flex-wrap gap-2">
            {BEISPIELE.map((b) => (
              <li key={b}>
                <button
                  type="button"
                  dir="auto"
                  disabled={!kiAktiv || laeuft}
                  onClick={() => fragen(b)}
                  className="rounded-[8px] border border-panel-line bg-soft px-3 py-2 text-left text-[13px] text-nav transition-colors duration-[180ms] hover:border-rose hover:text-white disabled:opacity-50"
                >
                  {b}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
