'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { senden } from '@/components/finanzen/beleg-hochladen';
import { Button } from '@/components/ui/Button';
import { Fenster } from '@/components/ui/Fenster';
import { Auswahl, Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { centEingabe, centText } from '@/lib/abrechnung/geld';
import type { Ergebnis } from '@/lib/aktion';
import { AUSGABE_KATEGORIEN, KATEGORIE_NAMEN, type AusgabeKategorie } from '@/lib/ausgaben/text';
import type { Vorschlag } from '@/lib/bank/abgleich';
import type { AusgabeKurz, AuszugZeile, OffeneRechnungKurz, UmsatzZeile } from '@/lib/bank/auszuege';
import { RHYTHMEN, RHYTHMUS_NAMEN } from '@/lib/fixkosten/text';
import { datum, isoDatumText } from '@/lib/format';
import { kategorienFuer, PRIVAT_KATEGORIE_NAMEN, type PrivatKategorie } from '@/lib/privat/text';
import { AusgabeAusBank } from '../ausgaben/Ausgaben';
import { bankAuszugEntfernen, bankAuszugNeuLesen, bankSichereUebernehmen, bankZuordnen, bankZuruecksetzen } from './actions';

/**
 * «Bank» در مرورگر (Spec فاز ۵، قدم ۴): بالا بردن Kontoauszug، فهرست‌های «Zu klären»، «Beleg fehlt» و «Zugeordnet»،
 * پنجرهٔ «Ändern …» با همهٔ راه‌ها (Privat، Fixkosten، Rechnung، Ausgabe، Beleg fehlt، Ignorieren) و فهرست Auszugها.
 */

export function vorschlagText(v: Vorschlag): string {
  switch (v.aktion) {
    case 'rechnung':
      return `Zahlung zu ${v.text}`;
    case 'ausgabe':
      return `Ausgabe: ${v.text}`;
    case 'privat_verbinden':
      return `Privat: ${v.text}`;
    case 'privat_neu':
      return `Privat · ${PRIVAT_KATEGORIE_NAMEN[v.kategorie]}`;
    case 'fixkosten':
      return `Fixkosten: ${v.text}`;
    case 'ddl_offen':
      return `Labor · Beleg fehlt${v.kategorie ? ` (${KATEGORIE_NAMEN[v.kategorie as AusgabeKategorie] ?? v.kategorie})` : ''}`;
    default:
      return 'Ignorieren';
  }
}

const betragText = (c: number) => (c > 0 ? `+ ${centText(c)}` : centText(c));

// ════════════════ Hochladen ════════════════

type Stand = { name: string; text: string; fehler: boolean };

export function AuszugHochladen({ kiAktiv }: { kiAktiv: boolean }) {
  const router = useRouter();
  const eingabe = useRef<HTMLInputElement>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [stand, setStand] = useState<Stand[]>([]);

  async function hochladen(dateien: File[]) {
    if (!dateien.length) return;
    setLaeuft(true);
    const liste: Stand[] = dateien.map((d) => ({ name: d.name, text: 'wartet …', fehler: false }));
    setStand([...liste]);
    for (const [i, d] of dateien.entries()) {
      liste[i] = { ...liste[i], text: kiAktiv ? 'wird hochgeladen und gelesen (bis zu einer Minute) …' : 'wird hochgeladen …' };
      setStand([...liste]);
      try {
        const r = await senden('/api/bank/auszug', { inhalt: d, name: d.name });
        const j = (await r.json().catch(() => null)) as { ok?: boolean; fehler?: string; neu?: number; schonDa?: number; nummer?: string | null; datum?: string | null } | null;
        if (!r.ok) liste[i] = { ...liste[i], text: j?.fehler ?? 'Nicht hochgeladen.', fehler: true };
        else if (!j?.ok) liste[i] = { ...liste[i], text: `hochgeladen, aber: ${j?.fehler ?? 'nicht gelesen.'}`, fehler: true };
        else
          liste[i] = {
            ...liste[i],
            text: `gelesen${j.nummer ? `: Auszug ${j.nummer}` : ''}${j.datum ? ` vom ${isoDatumText(j.datum)}` : ''}, ${j.neu} neue Zeilen${j.schonDa ? `, ${j.schonDa} schon vorhanden` : ''}`,
            fehler: false,
          };
      } catch {
        liste[i] = { ...liste[i], text: 'Keine Verbindung. Nicht hochgeladen.', fehler: true };
      }
      setStand([...liste]);
      router.refresh();
    }
    setLaeuft(false);
    router.push('?tab=klaeren', { scroll: false });
  }

  return (
    <>
      <Button onClick={() => eingabe.current?.click()} disabled={laeuft}>
        {laeuft ? 'Kontoauszug wird gelesen …' : 'Kontoauszug hochladen'}
      </Button>
      <input
        ref={eingabe}
        type="file"
        multiple
        accept="application/pdf,.pdf,text/csv,.csv"
        aria-label="Kontoauszüge wählen (PDF oder CSV)"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const d = [...(e.target.files ?? [])];
          e.target.value = '';
          void hochladen(d);
        }}
      />
      {stand.length ? (
        <ul aria-label="Hochgeladene Kontoauszüge" aria-live="polite" className="order-last max-w-[760px] basis-full space-y-1 text-[13px]">
          {stand.map((x, i) => (
            <li key={i} className={x.fehler ? 'text-rose' : 'text-muted'}>
              <span className={x.fehler ? '' : 'text-white'}>{x.name}</span> · {x.text}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function SichereUebernehmen({ anzahl }: { anzahl: number }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>((z) => bankSichereUebernehmen(z), null);
  if (!anzahl && !zustand) return null;
  return (
    <form onSubmit={aktion} className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3">
      {anzahl ? (
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird übernommen …' : `Sichere Vorschläge übernehmen (${anzahl})`}
        </Button>
      ) : null}
      <span className="text-[13px] text-muted">{anzahl ? 'Rechnungsnummer erkannt, gleicher Betrag am selben Tag, oder Privat mit Kategorie.' : null}</span>
      <div className="basis-full" aria-live="polite">
        <Rueckmeldung zustand={zustand} />
      </div>
    </form>
  );
}

// ════════════════ Zeilen ════════════════

/** ein Knopf, der eine Zuordnung abschickt (Übernehmen, Ignorieren, Zurücksetzen …) */
function Knopf({
  umsatz,
  felder,
  text,
  aktion = bankZuordnen,
  variant = 'secondary',
  onErfolg,
  label,
}: {
  umsatz: string;
  felder: Record<string, string>;
  text: string;
  aktion?: (z: Ergebnis, d: FormData) => Promise<Ergebnis>;
  variant?: 'primary' | 'secondary' | 'text';
  onErfolg?: () => void;
  label?: string;
}) {
  const [zustand, abschicken, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await aktion(z, d);
    if (r?.erfolg) onErfolg?.();
    return r;
  }, null);
  return (
    <form onSubmit={abschicken} className="contents">
      <input type="hidden" name="umsatz" value={umsatz} />
      {Object.entries(felder).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={variant} disabled={laeuft} aria-label={label}>
        {laeuft ? '…' : text}
      </Button>
      {zustand?.fehler ? <span className="basis-full text-[13px] text-rose">{zustand.fehler}</span> : null}
    </form>
  );
}

const SPALTEN = 'lg:grid-cols-[84px_minmax(0,1.3fr)_minmax(0,1.2fr)_110px_auto]';

export function UmsatzListe({
  zeilen,
  modus,
  rechnungen,
  ausgaben,
  heute,
  leer,
}: {
  zeilen: UmsatzZeile[];
  modus: 'klaeren' | 'beleg' | 'erledigt';
  rechnungen: OffeneRechnungKurz[];
  ausgaben: AusgabeKurz[];
  heute: string;
  leer: string;
}) {
  const fenster = useRef<HTMLDialogElement>(null);
  const [gewaehlt, setGewaehlt] = useState<UmsatzZeile | null>(null);
  const [anfang, setAnfang] = useState<'aendern' | 'ausgabe'>('aendern');
  const oeffnen = (z: UmsatzZeile, a: 'aendern' | 'ausgabe') => {
    setGewaehlt(z);
    setAnfang(a);
    fenster.current?.showModal();
  };
  const schliessen = () => setTimeout(() => fenster.current?.close(), 900);

  // das Fenster bleibt auch nach der letzten Zeile da, damit die Rückmeldung sichtbar ist
  return (
    <div className="max-w-[1240px]">
      {zeilen.length ? null : <p className="text-[15px] font-light text-muted">{leer}</p>}
      {zeilen.length ? (
        <div aria-hidden className={`hidden gap-x-6 border-b border-line pb-3 text-[11px] font-medium uppercase tracking-[0.04em] text-muted lg:grid ${SPALTEN}`}>
          <span>Datum</span>
          <span>Buchung</span>
          <span>{modus === 'erledigt' ? 'Zugeordnet' : 'Vorschlag'}</span>
          <span className="text-right">Betrag</span>
          <span />
        </div>
      ) : null}
      <ul hidden={!zeilen.length} aria-label={modus === 'klaeren' ? 'Bankzeilen zu klären' : modus === 'beleg' ? 'Bankzeilen ohne Beleg' : 'Zugeordnete Bankzeilen'}>
        {zeilen.map((z) => {
          const v = z.vorschlag;
          return (
            <li key={z.id} className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-1 border-b border-line py-2 ${SPALTEN}`}>
              <span className="hidden text-[13px] text-paragraph lg:block">{isoDatumText(z.buchungstag)}</span>
              <span className="min-w-0">
                <span className="block truncate text-[15px]">{z.gegenpartei ?? z.text.slice(0, 40)}</span>
                <span className="block truncate text-[12px] text-muted" title={z.text}>
                  <span className="lg:hidden">{isoDatumText(z.buchungstag)} · </span>
                  {z.text}
                </span>
              </span>
              <span className="col-span-2 row-start-2 text-[13px] lg:col-span-1 lg:row-start-auto">
                {modus === 'erledigt' ? (
                  <span className="text-paragraph">{z.ziel}</span>
                ) : v ? (
                  <>
                    <span className={v.sicher ? 'text-white' : 'text-paragraph'}>{vorschlagText(v)}</span>
                    {!v.sicher && v.aktion !== 'ddl_offen' && v.aktion !== 'ignorieren' ? <span className="text-rose"> · bitte prüfen</span> : null}
                  </>
                ) : (
                  <span className="text-muted">{modus === 'beleg' ? 'noch keine Ausgabe gefunden' : '–'}</span>
                )}
              </span>
              <span className={`col-start-2 row-start-1 text-right text-[15px] tabular-nums lg:col-start-auto lg:row-start-auto ${z.betragCent > 0 ? 'text-einnahme' : ''}`}>
                {betragText(z.betragCent)}
              </span>
              <span className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-2 lg:col-span-1 lg:justify-end">
                {modus === 'erledigt' ? (
                  <Knopf umsatz={z.id} felder={{}} text="Zurücksetzen" aktion={bankZuruecksetzen} variant="text" label={`Zurücksetzen: ${z.gegenpartei ?? z.text}`} />
                ) : (
                  <>
                    {v && (modus === 'klaeren' || v.aktion === 'ausgabe' || v.aktion === 'fixkosten') ? (
                      <Knopf umsatz={z.id} felder={{ aktion: 'vorschlag' }} text={modus === 'beleg' ? 'Verbinden' : 'Übernehmen'} label={`Übernehmen: ${z.gegenpartei ?? z.text}`} />
                    ) : null}
                    {modus === 'beleg' ? (
                      <Button variant="text" onClick={() => oeffnen(z, 'ausgabe')} aria-haspopup="dialog">
                        Als Ausgabe erfassen
                      </Button>
                    ) : null}
                    <Button variant="text" onClick={() => oeffnen(z, 'aendern')} aria-haspopup="dialog" aria-label={`Ändern: ${z.gegenpartei ?? z.text}`}>
                      Ändern …
                    </Button>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      <Fenster fenster={fenster} titel={gewaehlt ? `Bankzeile ${gewaehlt.gegenpartei ?? ''}` : 'Bankzeile'}>
        {gewaehlt ? (
          <AendernInhalt key={`${gewaehlt.id}-${anfang}`} z={gewaehlt} anfang={anfang} rechnungen={rechnungen} ausgaben={ausgaben} heute={heute} onFertig={schliessen} />
        ) : null}
      </Fenster>
    </div>
  );
}

function Abschnitt({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <section aria-label={titel} className="border-t border-line pt-6">
      <h3 className="mb-4 text-[15px]">{titel}</h3>
      {children}
    </section>
  );
}

function WahlFormular({ umsatz, aktion, knopf, onFertig, children }: { umsatz: string; aktion: string; knopf: string; onFertig: () => void; children?: React.ReactNode }) {
  const [zustand, abschicken, laeuft] = useFormAktion<Ergebnis>(async (z, d) => {
    const r = await bankZuordnen(z, d);
    if (r?.erfolg) onFertig();
    return r;
  }, null);
  return (
    <form onSubmit={abschicken} className="space-y-4" aria-label={knopf}>
      <input type="hidden" name="umsatz" value={umsatz} />
      <input type="hidden" name="aktion" value={aktion} />
      {children}
      <Button type="submit" variant="secondary" disabled={laeuft}>
        {laeuft ? 'Wird gespeichert …' : knopf}
      </Button>
      <div aria-live="polite">
        <Rueckmeldung zustand={zustand} />
      </div>
    </form>
  );
}

/** Fenster »Ändern …«: alle Möglichkeiten für eine Bankzeile. */
function AendernInhalt({
  z,
  anfang,
  rechnungen,
  ausgaben,
  heute,
  onFertig,
}: {
  z: UmsatzZeile;
  anfang: 'aendern' | 'ausgabe';
  rechnungen: OffeneRechnungKurz[];
  ausgaben: AusgabeKurz[];
  heute: string;
  onFertig: () => void;
}) {
  const ein = z.betragCent > 0;
  const art = ein ? 'einnahme' : 'ausgabe';
  const betrag = Math.abs(z.betragCent);
  const vorschlagKat = z.vorschlag?.aktion === 'privat_neu' ? z.vorschlag.kategorie : (z.privatKategorie as PrivatKategorie | null);
  // gleicher Betrag zuerst, dann nach Abstand
  const passendeAusgaben = [...ausgaben].sort(
    (a, b) => Number(b.bruttoCent === betrag) - Number(a.bruttoCent === betrag) || Math.abs(Date.parse(a.bezahltAm) - Date.parse(z.buchungstag)) - Math.abs(Date.parse(b.bezahltAm) - Date.parse(z.buchungstag)),
  );

  return (
    <section aria-label={`Bankzeile ${z.gegenpartei ?? ''}`} className="space-y-8">
      <div>
        <h2 className="pr-10 text-[30px] font-light leading-tight">
          {z.gegenpartei ?? 'Bankzeile'} <span className={`whitespace-nowrap tabular-nums ${z.betragCent > 0 ? 'text-einnahme' : ''}`}>{betragText(z.betragCent)}</span>
        </h2>
        <p className="mt-2 text-[13px] text-muted">
          {datum(new Date(`${z.buchungstag}T12:00:00`))} · {z.text}
        </p>
      </div>

      {anfang === 'ausgabe' ? (
        <AusgabeAusBank umsatz={z.id} lieferant={z.gegenpartei ?? z.text.slice(0, 60)} datum={z.buchungstag} bruttoCent={betrag} kategorie={z.kategorie} heute={heute} onGespeichert={onFertig} />
      ) : (
        <>
          <Abschnitt titel="Privat">
            <WahlFormular umsatz={z.id} aktion="privat_neu" knopf="Privat buchen" onFertig={onFertig}>
              <Auswahl
                label="Kategorie"
                name="kategorie"
                required
                defaultValue={vorschlagKat && kategorienFuer(art).includes(vorschlagKat) ? vorschlagKat : ''}
                optionen={[{ wert: '', label: 'Bitte wählen' }, ...kategorienFuer(art).map((k) => ({ wert: k, label: PRIVAT_KATEGORIE_NAMEN[k] }))]}
              />
            </WahlFormular>
          </Abschnitt>

          <Abschnitt titel="Fixkosten (Abo, Miete …)">
            <FixkostenAusZeile z={z} onFertig={onFertig} />
          </Abschnitt>

          {ein ? (
            <Abschnitt titel="Zahlung zu einer Rechnung des Labors">
              {rechnungen.length ? (
                <WahlFormular umsatz={z.id} aktion="rechnung" knopf="Zahlung buchen" onFertig={onFertig}>
                  <Auswahl
                    label="Rechnung"
                    name="rechnung"
                    required
                    defaultValue={z.vorschlag?.aktion === 'rechnung' ? z.vorschlag.id : ''}
                    optionen={[{ wert: '', label: 'Bitte wählen' }, ...rechnungen.map((r) => ({ wert: r.id, label: `${r.nummer} · ${r.praxis} · offen ${centText(r.offenCent)}` }))]}
                  />
                  <Feld label="Betrag (€)" name="betrag" inputMode="decimal" required defaultValue={centEingabe(z.vorschlag?.aktion === 'rechnung' ? z.vorschlag.betragCent : betrag)} />
                </WahlFormular>
              ) : (
                <p className="text-[13px] text-muted">Keine offene Rechnung.</p>
              )}
            </Abschnitt>
          ) : (
            <Abschnitt titel="Ausgabe des Labors">
              <div className="space-y-6">
                {passendeAusgaben.length ? (
                  <WahlFormular umsatz={z.id} aktion="ausgabe" knopf="Mit Ausgabe verbinden" onFertig={onFertig}>
                    <Auswahl
                      label="Erfasste Ausgabe"
                      name="ausgabe"
                      required
                      defaultValue={z.vorschlag?.aktion === 'ausgabe' ? z.vorschlag.id : ''}
                      optionen={[
                        { wert: '', label: 'Bitte wählen' },
                        ...passendeAusgaben.slice(0, 60).map((a) => ({ wert: a.id, label: `${a.lieferant} · ${centText(a.bruttoCent)} · ${isoDatumText(a.bezahltAm)}` })),
                      ]}
                    />
                  </WahlFormular>
                ) : null}
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {z.zuordnung !== 'ddl_offen' ? <Knopf umsatz={z.id} felder={{ aktion: 'ddl_offen' }} text="Beleg fehlt, später erfassen" onErfolg={onFertig} /> : null}
                </div>
                <details>
                  <summary className="cursor-pointer list-none text-[13px] text-rose-light hover:text-white">Jetzt als Ausgabe erfassen …</summary>
                  <div className="mt-6">
                    <AusgabeAusBank umsatz={z.id} lieferant={z.gegenpartei ?? z.text.slice(0, 60)} datum={z.buchungstag} bruttoCent={betrag} kategorie={z.kategorie} heute={heute} onGespeichert={onFertig} />
                  </div>
                </details>
              </div>
            </Abschnitt>
          )}

          <Abschnitt titel="Weder noch">
            <p className="mb-4 text-[13px] text-muted">Zum Beispiel Geld zwischen eigenen Konten oder in der Familie.</p>
            <Knopf umsatz={z.id} felder={{ aktion: 'ignorieren' }} text="Ignorieren" onErfolg={onFertig} />
          </Abschnitt>
        </>
      )}
    </section>
  );
}

const SAETZE = [
  { wert: '20', label: '20 %' },
  { wert: '13', label: '13 %' },
  { wert: '10', label: '10 %' },
  { wert: '0', label: '0 % (ohne MwSt)' },
];

/** wiederkehrende Zahlung: neue Fixkosten ab dieser Zeile (Privat oder Labor) */
function FixkostenAusZeile({ z, onFertig }: { z: UmsatzZeile; onFertig: () => void }) {
  const ein = z.betragCent > 0;
  const art = ein ? 'einnahme' : 'ausgabe';
  const [bereich, setBereich] = useState<'privat' | 'ddl'>(!ein && (z.bereich === 'ddl' || z.zuordnung === 'ddl_offen') ? 'ddl' : 'privat');
  const privatKat = z.privatKategorie && kategorienFuer(art).includes(z.privatKategorie as PrivatKategorie) ? z.privatKategorie : ein ? '' : 'abos';
  const ddlKat = z.kategorie && (AUSGABE_KATEGORIEN as readonly string[]).includes(z.kategorie) ? z.kategorie : 'software';
  return (
    <>
      <p className="mb-4 text-[13px] text-muted">
        Für Zahlungen, die regelmäßig kommen. Diese Zeile wird die erste Fälligkeit; die nächsten Abbuchungen mit demselben Betrag schlägt »Zu klären« dann selbst vor. Ändern oder beenden unter »Fixkosten«.
      </p>
      <WahlFormular umsatz={z.id} aktion="fixkosten_neu" knopf="Als Fixkosten anlegen" onFertig={onFertig}>
        {!ein ? (
          <Auswahl
            label="Gehört zu"
            name="bereich"
            value={bereich}
            onChange={(e) => setBereich(e.target.value as 'privat' | 'ddl')}
            optionen={[
              { wert: 'privat', label: 'Privat' },
              { wert: 'ddl', label: 'DDL-Labor (wird eine Ausgabe)' },
            ]}
          />
        ) : (
          <input type="hidden" name="bereich" value="privat" />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Feld label="Titel" name="titel" required maxLength={120} autoComplete="off" defaultValue={(z.gegenpartei ?? '').slice(0, 120)} placeholder="z. B. Netflix" />
          {bereich === 'ddl' ? (
            <Auswahl
              key="ddl"
              label="Kategorie"
              name="kategorie"
              required
              defaultValue={ddlKat}
              optionen={AUSGABE_KATEGORIEN.map((k) => ({ wert: k, label: KATEGORIE_NAMEN[k] }))}
            />
          ) : (
            <Auswahl
              key="privat"
              label="Kategorie"
              name="kategorie"
              required
              defaultValue={privatKat}
              optionen={[{ wert: '', label: 'Bitte wählen' }, ...kategorienFuer(art).map((k) => ({ wert: k, label: PRIVAT_KATEGORIE_NAMEN[k] }))]}
            />
          )}
          <Feld label="Betrag (€)" name="betrag" inputMode="decimal" required autoComplete="off" defaultValue={centEingabe(Math.abs(z.betragCent))} />
          {bereich === 'ddl' ? <Auswahl label="MwSt-Satz" name="satz" defaultValue="20" optionen={SAETZE} /> : null}
          <Auswahl label="Wie oft?" name="rhythmus" defaultValue="monatlich" optionen={RHYTHMEN.map((r) => ({ wert: r, label: RHYTHMUS_NAMEN[r] }))} />
          <Feld label="Erste Fälligkeit" name="ab" type="date" required defaultValue={z.buchungstag} hinweis="Früher setzen, wenn ältere Abbuchungen schon da sind." />
        </div>
      </WahlFormular>
    </>
  );
}

// ════════════════ Kontoauszüge ════════════════

function AuszugAktion({ id, aktion, text, label }: { id: string; aktion: (z: Ergebnis, d: FormData) => Promise<Ergebnis>; text: string; label: string }) {
  const [zustand, abschicken, laeuft] = useFormAktion<Ergebnis>(aktion, null);
  return (
    <form onSubmit={abschicken} className="contents">
      <input type="hidden" name="auszug" value={id} />
      <Button type="submit" variant="text" disabled={laeuft} aria-label={label}>
        {laeuft ? '…' : text}
      </Button>
      {zustand ? (
        <span className={`basis-full text-[13px] ${zustand.fehler ? 'text-rose' : 'text-muted'}`} aria-live="polite">
          {zustand.fehler ?? zustand.erfolg}
        </span>
      ) : null}
    </form>
  );
}

export function AuszugListe({ auszuege, kiAktiv }: { auszuege: AuszugZeile[]; kiAktiv: boolean }) {
  if (!auszuege.length) return <p className="text-[15px] font-light text-muted">Noch kein Kontoauszug. Im eBanking der BAWAG unter »Kontoauszüge« das PDF laden oder die Umsätze als CSV exportieren und hier hochladen.</p>;
  return (
    <ul aria-label="Kontoauszüge" className="max-w-[1240px]">
      {auszuege.map((a) => (
        <li key={a.id} className="grid gap-x-6 gap-y-1 border-b border-line py-2.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-baseline">
          <span className="min-w-0">
            <span className="block truncate text-[15px]">
              {a.nummer ? `Auszug ${a.nummer}` : a.name}
              {a.datum ? ` vom ${isoDatumText(a.datum)}` : ''}
            </span>
            <span className="block truncate text-[13px] text-muted">
              {a.name} · hochgeladen {datum(a.hochgeladenAm)}
            </span>
          </span>
          <span className="text-[13px] text-paragraph">
            {a.status === 'gelesen' && a.alterCent != null && a.neuerCent != null ? (
              <>
                {centText(a.alterCent)} → {centText(a.neuerCent)}
                {a.luecke ? <span className="block text-rose">Kontostand passt nicht zum vorigen Auszug: fehlt einer?</span> : null}
              </>
            ) : a.status === 'gelesen' ? (
              <span className="text-muted">Umsatzliste (CSV), ohne Kontostand</span>
            ) : (
              <span className="text-rose">{a.fehler}</span>
            )}
          </span>
          <span className="text-[13px] text-muted">
            {a.status === 'gelesen' ? `${a.neu} neu${a.schonDa ? `, ${a.schonDa} schon vorhanden` : ''} · ${a.zugeordnet} zugeordnet` : 'nicht gelesen'}
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href={`/api/bank/auszug/${a.id}`} target="_blank" rel="noopener" className="text-[13px] text-muted hover:text-white">
              {/\.csv$/i.test(a.name) ? 'CSV ↓' : 'PDF ↗'}
            </a>
            {a.status === 'fehler' && kiAktiv ? <AuszugAktion id={a.id} aktion={bankAuszugNeuLesen} text="Erneut lesen" label={`Erneut lesen: ${a.name}`} /> : null}
            {a.zugeordnet === 0 ? <AuszugAktion id={a.id} aktion={bankAuszugEntfernen} text="Entfernen" label={`Entfernen: ${a.name}`} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
