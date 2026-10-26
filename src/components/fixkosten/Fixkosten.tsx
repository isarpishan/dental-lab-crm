'use client';

import { useRef, useState } from 'react';
import { ArtWahl } from '@/components/privat/Privat';
import { Button } from '@/components/ui/Button';
import { Fenster } from '@/components/ui/Fenster';
import { Auswahl, Feld, Textfeld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { fixkostenAktiv, fixkostenEntfernen, fixkostenSpeichern } from '@/app/intern/(app)/fixkosten/actions';
import { centEingabe, centText } from '@/lib/abrechnung/geld';
import type { Ergebnis } from '@/lib/aktion';
import { AUSGABE_KATEGORIEN, KATEGORIE_NAMEN, type AusgabeKategorie } from '@/lib/ausgaben/text';
import type { Bereich } from '@/lib/fixkosten/plan';
import { RHYTHMEN, RHYTHMUS_NAMEN, type Rhythmus } from '@/lib/fixkosten/text';
import type { VorlageZeile } from '@/lib/fixkosten/vorlagen';
import { isoDatumText } from '@/lib/format';
import { kategorienFuer, PRIVAT_KATEGORIE_NAMEN, type PrivatArt, type PrivatKategorie } from '@/lib/privat/text';

/**
 * «Fixkosten» در مرورگر (Spec فاز ۵، قدم ۳)، برای DDL و Privat: فرم Vorlage، فهرست با سررسید بعدی، و در پنجره
 * «Pausieren/Fortsetzen» و حذف (فقط اگر هنوز سررسیدی نداشته).
 */

export const kategorieName = (bereich: Bereich, k: string) =>
  bereich === 'ddl' ? (KATEGORIE_NAMEN[k as AusgabeKategorie] ?? k) : (PRIVAT_KATEGORIE_NAMEN[k as PrivatKategorie] ?? k);

const SAETZE = [
  { wert: '20', label: '20 %' },
  { wert: '13', label: '13 %' },
  { wert: '10', label: '10 %' },
  { wert: '0', label: '0 % (ohne MwSt)' },
];

const rhythmusText = (r: Rhythmus, ab: string) => {
  const tag = Number(ab.slice(8, 10));
  if (r === 'monatlich') return `monatlich am ${tag}.`;
  if (r === 'quartal') return `vierteljährlich am ${tag}.`;
  return `jährlich am ${isoDatumText(ab).slice(0, 6)}`;
};

function VorlageFormular({ bereich, v, heute, onGespeichert }: { bereich: Bereich; v?: VorlageZeile; heute: string; onGespeichert?: () => void }) {
  const [art, setArt] = useState<PrivatArt>(v?.art ?? 'ausgabe');
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await fixkostenSpeichern(z, d);
    if (r?.erfolg) onGespeichert?.();
    return r;
  }, null);
  const kategorien = bereich === 'ddl' ? AUSGABE_KATEGORIEN.map((k) => ({ wert: k, label: KATEGORIE_NAMEN[k] })) : kategorienFuer(art).map((k) => ({ wert: k, label: PRIVAT_KATEGORIE_NAMEN[k] }));
  const kategorie = v && kategorien.some((k) => k.wert === v.kategorie) ? v.kategorie : '';

  return (
    <form onSubmit={aktion} aria-label={v ? 'Fixkosten ändern' : 'Neue Fixkosten'} className="grid gap-5 sm:grid-cols-2 sm:items-start">
      <input type="hidden" name="bereich" value={bereich} />
      {v ? <input type="hidden" name="vorlage" value={v.id} /> : null}
      {bereich === 'privat' ? <ArtWahl art={art} setArt={setArt} /> : null}
      <Feld label="Titel" name="titel" required maxLength={120} autoComplete="off" defaultValue={v?.titel} placeholder={art === 'einnahme' ? 'z. B. Gehalt' : 'z. B. Miete'} />
      <Feld
        label={bereich === 'ddl' ? 'Lieferant' : art === 'einnahme' ? 'Von' : 'Empfänger'}
        name="gegenpartei"
        maxLength={120}
        autoComplete="off"
        defaultValue={v?.gegenpartei ?? ''}
        placeholder="optional"
        hinweis={bereich === 'ddl' ? 'Leer: der Titel steht als Lieferant in der Ausgabe.' : undefined}
      />
      <Auswahl key={art} label="Kategorie" name="kategorie" required defaultValue={kategorie} optionen={[{ wert: '', label: 'Bitte wählen' }, ...kategorien]} />
      <Feld
        label="Betrag (€)"
        name="betrag"
        inputMode="decimal"
        required
        autoComplete="off"
        defaultValue={centEingabe(v?.betragCent)}
        placeholder="z. B. 1.200"
        hinweis={bereich === 'ddl' ? 'Brutto, wie auf der Rechnung.' : undefined}
      />
      {bereich === 'ddl' ? <Auswahl label="MwSt-Satz" name="satz" defaultValue={v?.mwstSatz != null ? String(v.mwstSatz) : '20'} optionen={SAETZE} /> : null}
      <Auswahl
        label="Wie oft?"
        name="rhythmus"
        defaultValue={v?.rhythmus ?? 'monatlich'}
        optionen={RHYTHMEN.map((r) => ({ wert: r, label: RHYTHMUS_NAMEN[r] }))}
      />
      <Feld
        label="Erste Fälligkeit"
        name="ab"
        type="date"
        required
        defaultValue={v?.ab ?? heute}
        hinweis={`Dieser Tag gilt für jede Fälligkeit; in kürzeren Monaten der letzte Tag. Liegt das Datum in der Vergangenheit, wird nachgetragen${bereich === 'ddl' ? ' (unter »Zu prüfen«)' : ''}.`}
      />
      <Feld label="Endet am" name="bis" type="date" defaultValue={v?.bis ?? ''} hinweis="Leer lassen, wenn unbefristet." />
      <Textfeld label="Notiz" name="notiz" rows={2} maxLength={300} defaultValue={v?.notiz ?? ''} placeholder="optional" />
      <div className="space-y-4 sm:col-span-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : v ? 'Änderungen speichern' : 'Fixkosten anlegen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function NeueFixkosten({ bereich, heute }: { bereich: Bereich; heute: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  const [schluessel, setSchluessel] = useState(0);
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setSchluessel((k) => k + 1);
          fenster.current?.showModal();
        }}
        aria-haspopup="dialog"
      >
        + Neue Fixkosten
      </Button>
      <Fenster fenster={fenster} titel="Neue Fixkosten">
        <section aria-label="Neue Fixkosten">
          <h2 className="mb-8 pr-10 text-[30px] font-light leading-tight">Neue Fixkosten</h2>
          <VorlageFormular key={schluessel} bereich={bereich} heute={heute} onGespeichert={() => setTimeout(() => fenster.current?.close(), 900)} />
        </section>
      </Fenster>
    </>
  );
}

function AktivSchalter({ bereich, v }: { bereich: Bereich; v: VorlageZeile }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(fixkostenAktiv, null);
  return (
    <form onSubmit={aktion} className="space-y-3">
      <input type="hidden" name="bereich" value={bereich} />
      <input type="hidden" name="vorlage" value={v.id} />
      <input type="hidden" name="aktiv" value={v.aktiv ? 'nein' : 'ja'} />
      <Button type="submit" variant="secondary" disabled={laeuft}>
        {v.aktiv ? 'Pausieren' : 'Fortsetzen'}
      </Button>
      <Rueckmeldung zustand={zustand} />
    </form>
  );
}

function Loeschen({ bereich, v, onGeloescht }: { bereich: Bereich; v: VorlageZeile; onGeloescht: () => void }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await fixkostenEntfernen(z, d);
    if (r?.erfolg) onGeloescht();
    return r;
  }, null);
  return (
    <details className="border-t border-line pt-6">
      <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-white">Fixkosten löschen …</summary>
      <form onSubmit={aktion} className="mt-4 space-y-4">
        <input type="hidden" name="bereich" value={bereich} />
        <input type="hidden" name="vorlage" value={v.id} />
        <p className="text-[13px] text-muted">Nur möglich, solange noch nichts fällig war. Sonst »Pausieren« oder »Endet am« setzen.</p>
        <Button type="submit" variant="secondary" disabled={laeuft} aria-label={`Wirklich löschen: ${v.titel}`}>
          Wirklich löschen
        </Button>
        <Rueckmeldung zustand={zustand} />
      </form>
    </details>
  );
}

const SPALTEN = 'lg:grid-cols-[minmax(0,1fr)_170px_130px_120px]';

/** Liste der Fixkosten; pausierte und beendete gedämpft. Ein Klick öffnet Formular, Pausieren und Löschen. */
export function FixkostenListe({ bereich, zeilen, heute }: { bereich: Bereich; zeilen: VorlageZeile[]; heute: string }) {
  const fenster = useRef<HTMLDialogElement>(null);
  const [gewaehlt, setGewaehlt] = useState<VorlageZeile | null>(null);
  const v = gewaehlt ? (zeilen.find((z) => z.id === gewaehlt.id) ?? gewaehlt) : undefined;

  if (!zeilen.length)
    return (
      <p className="max-w-[680px] text-[15px] font-light text-muted">
        Noch keine Fixkosten. {bereich === 'ddl' ? 'Zum Beispiel Miete, Leasing, Software-Abos oder SVS.' : 'Zum Beispiel Miete, Strom, Versicherungen, Abos oder das Gehalt.'}
      </p>
    );

  return (
    <div className="max-w-[1040px]">
      <div aria-hidden className={`hidden gap-x-6 border-b border-line pb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-muted lg:grid ${SPALTEN}`}>
        <span>Titel</span>
        <span>Wie oft</span>
        <span>Nächste Fälligkeit</span>
        <span className="text-right">Betrag</span>
      </div>
      <ul aria-label="Fixkosten">
        {zeilen.map((z) => {
          const stand = !z.aktiv ? 'pausiert' : z.naechste ? isoDatumText(z.naechste) : 'beendet';
          return (
            <li key={z.id} className="border-b border-line">
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => {
                  setGewaehlt(z);
                  fenster.current?.showModal();
                }}
                className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 py-2.5 text-left ${SPALTEN} ${z.aktiv && z.naechste ? '' : 'text-muted'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] group-hover:text-rose">{z.titel}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {kategorieName(bereich, z.kategorie)}
                    {z.gegenpartei ? ` · ${z.gegenpartei}` : ''}
                    <span className="lg:hidden">
                      {' '}
                      · {rhythmusText(z.rhythmus, z.ab)} · {z.aktiv && z.naechste ? `nächste ${isoDatumText(z.naechste)}` : stand}
                    </span>
                    {z.offen ? <span className="text-rose"> · {z.offen} zu prüfen</span> : null}
                  </span>
                </span>
                <span className="hidden text-[13px] text-paragraph lg:block">{rhythmusText(z.rhythmus, z.ab)}</span>
                <span className={`hidden text-[13px] lg:block ${z.aktiv && z.naechste ? 'text-paragraph' : 'text-muted'}`}>{stand}</span>
                <span className={`col-start-2 row-start-1 text-right text-[15px] tabular-nums lg:col-start-auto lg:row-start-auto ${z.art === 'einnahme' ? 'text-einnahme' : ''}`}>
                  {z.art === 'einnahme' ? '+ ' : ''}
                  {centText(z.betragCent)}
                  {z.rhythmus !== 'monatlich' ? <span className="block text-[11px] text-muted">≈ {centText(z.proMonatCent)} / Monat</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Fenster fenster={fenster} titel={v ? `Fixkosten ${v.titel}` : 'Fixkosten'}>
        {v ? (
          <section aria-label={`Fixkosten ${v.titel}`} key={v.id}>
            <h2 className="pr-10 text-[30px] font-light leading-tight">{v.titel}</h2>
            <p className="mb-8 mt-2 text-[13px] text-muted">
              {centText(v.betragCent)} {rhythmusText(v.rhythmus, v.ab)} · {v.aktiv ? (v.naechste ? `nächste Fälligkeit ${isoDatumText(v.naechste)}` : 'beendet') : 'pausiert'} ·{' '}
              {v.laeufe === 1 ? 'einmal fällig gewesen' : `${v.laeufe}-mal fällig gewesen`}
            </p>
            <div className="space-y-10">
              <VorlageFormular bereich={bereich} v={v} heute={heute} />
              <AktivSchalter bereich={bereich} v={v} />
              {v.laeufe === 0 ? <Loeschen bereich={bereich} v={v} onGeloescht={() => setTimeout(() => fenster.current?.close(), 900)} /> : null}
            </div>
          </section>
        ) : null}
      </Fenster>
    </div>
  );
}
