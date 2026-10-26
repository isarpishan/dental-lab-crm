'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import { isoDatumText } from '@/lib/format';
import type { ChargeOption } from '@/lib/produktion/material';
import { einheitWort, farbeNormal, flaschenStand, mengeText, zahlMitBruch } from '@/lib/produktion/material-text';
import type { ProduktionsStand } from '@/lib/produktion/stand';

/**
 * «Schritt erledigt» (Spec فاز ۱، بخش H): دکمهٔ بزرگ برای مرحلهٔ فعلی. در «3D-Druck» دستگاه و
 * Charge(ها) هم انتخاب می‌شوند (ردیابی MDR). همین در صفحهٔ QR تبلت و در صفحهٔ سفارش.
 */

export type ErledigtAktion = (
  orderId: string,
  daten: { schritt: string; geraet: string | null; chargen: string[]; mengen?: Record<string, number> },
) => Promise<{ fehler?: string; weiter?: string | null }>;

const WAHL_INNEN = 'flex cursor-pointer items-center gap-3 py-3.5 text-[16px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45';
const WAHL = `${WAHL_INNEN} border-t border-line`;

function ChargeWahl({
  c,
  gewaehlt,
  umschalten,
  zahnfarbe,
  menge,
  mengeSetzen,
}: {
  c: ChargeOption;
  gewaehlt: boolean;
  umschalten: () => void;
  zahnfarbe: string | null;
  menge: number;
  mengeSetzen: (n: number) => void;
}) {
  const farbePasst = Boolean(c.farbe && zahnfarbe && farbeNormal(c.farbe) === farbeNormal(zahnfarbe));
  return (
    <div className="border-t border-line">
      <label className={WAHL_INNEN}>
        <input type="checkbox" checked={gewaehlt} disabled={c.abgelaufen} onChange={umschalten} className="size-5 shrink-0 accent-rose" />
        <span className="min-w-0">
          {c.material}
          {c.farbe ? <span className={farbePasst ? 'text-rose-light' : ''}> {c.farbe}</span> : null} · <span className="font-medium">LOT {c.lotNo}</span>
          <span className="block text-[13px] text-muted">
            {[
              c.abgelaufen ? `abgelaufen am ${isoDatumText(c.ablauf)}` : c.ablauf ? `verwendbar bis ${isoDatumText(c.ablauf)}` : null,
              c.bestand != null
                ? c.einheit === 'flasche' && c.fuellung
                  ? `noch ${zahlMitBruch(flaschenStand(c.bestand, c.fuellung))} ${einheitWort(flaschenStand(c.bestand, c.fuellung), 'flasche')}`
                  : `noch ${mengeText(c.bestand, c.einheit)}`
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {farbePasst ? <span className="text-rose-light"> · passt zur Zahnfarbe</span> : null}
          </span>
        </span>
      </label>
      {gewaehlt && c.einheit === 'kapsel' ? (
        <label className="mb-3.5 ml-8 flex items-center gap-3 text-[15px]">
          Kapseln
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={menge}
            onChange={(e) => mengeSetzen(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            aria-label={`Kapseln aus LOT ${c.lotNo}`}
            className="w-20 rounded-[8px] border border-field-line bg-field px-3 py-2 text-[16px] text-white"
          />
          <span className="text-[13px] text-muted">werden vom Bestand abgezogen</span>
        </label>
      ) : null}
    </div>
  );
}

export function SchrittErledigen({
  stand,
  erledigt,
  auftragsLink,
}: {
  stand: Pick<ProduktionsStand, 'orderId' | 'aktuell' | 'erledigen' | 'druck'> & { kopf?: { farbe: string | null } };
  erledigt: ErledigtAktion;
  /** auf dem Tablet: Link zur Auftragsseite, wenn es dort weitergeht */
  auftragsLink?: string;
}) {
  const router = useRouter();
  const [geraet, setGeraet] = useState<string | null>(stand.druck?.drucker.length === 1 ? stand.druck.drucker[0].key : null);
  const [chargen, setChargen] = useState<string[]>([]);
  const [mengen, setMengen] = useState<Record<string, number>>({});
  const [fehler, setFehler] = useState<string | null>(null);
  // Erfolg bleibt sichtbar, auch wenn danach schon der nächste Schritt angezeigt wird
  const [erfolg, setErfolg] = useState<{ text: string; schritt: string } | null>(null);
  const [laeuft, starten] = useTransition();
  const { aktuell, erledigen, druck } = stand;
  const erfolgMeldung = erfolg ? <Meldung art="erfolg">{erfolg.text}</Meldung> : null;

  if (erfolg && erfolg.schritt === aktuell?.key) return erfolgMeldung;
  if (!aktuell || erledigen.art === 'nichts' || erledigen.art === 'warten') {
    return (
      <div className="space-y-6">
        {erfolgMeldung}
        {'text' in erledigen ? <p className="max-w-[620px] text-[17px] font-light text-paragraph">{erledigen.text}</p> : null}
      </div>
    );
  }
  if (erledigen.art === 'design') {
    return (
      <div className="space-y-3">
        {erfolgMeldung}
        <p className="max-w-[620px] text-[17px] font-light text-paragraph">{erledigen.text}</p>
        {auftragsLink ? (
          <Link href={auftragsLink} className="inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
            Zur Auftragsseite
          </Link>
        ) : null}
      </div>
    );
  }

  const zahnfarbe = stand.kopf?.farbe ?? null;
  // Chargen in der Zahnfarbe des Auftrags zuerst
  const farbeZuerst = (a: ChargeOption, b: ChargeOption) =>
    Number(Boolean(zahnfarbe && b.farbe && farbeNormal(b.farbe) === farbeNormal(zahnfarbe))) - Number(Boolean(zahnfarbe && a.farbe && farbeNormal(a.farbe) === farbeNormal(zahnfarbe)));
  const passend = (druck?.chargen.filter((c) => c.passend) ?? []).sort(farbeZuerst);
  const andere = druck?.chargen.filter((c) => !c.passend) ?? [];
  const umschalten = (id: string) => setChargen((alt) => (alt.includes(id) ? alt.filter((x) => x !== id) : [...alt, id]));
  const titel = erledigen.art === 'geliefert' ? 'Geliefert' : `${aktuell.label} erledigt`;

  return (
    <div className="space-y-6">
      {erfolgMeldung}
      <form
        aria-label="Schritt erledigt"
        className="max-w-[640px] space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          starten(async () => {
            setFehler(null);
            const kapseln = Object.fromEntries(
              chargen.filter((id) => druck?.chargen.find((c) => c.id === id)?.einheit === 'kapsel').map((id) => [id, mengen[id] ?? 1]),
            );
            const r = await erledigt(stand.orderId, { schritt: aktuell.key, geraet, chargen, mengen: kapseln });
            if (r.fehler) setFehler(r.fehler);
            else {
              setErfolg({ text: r.weiter ? `${aktuell.label} erledigt. Weiter mit: ${r.weiter}.` : `${titel}.`, schritt: aktuell.key });
              setChargen([]);
              setMengen({});
              router.refresh();
            }
          });
        }}
      >
        {druck ? (
          <>
            {druck.drucker.length ? (
              <fieldset>
                <legend className="mb-2 text-[15px]">
                  Drucker<span className="ml-1 text-rose" aria-hidden>*</span>
                </legend>
                {druck.drucker.map((d) => (
                  <label key={d.key} className={WAHL}>
                    <input type="radio" name="geraet" value={d.key} checked={geraet === d.key} onChange={() => setGeraet(d.key)} className="size-5 shrink-0 accent-rose" />
                    {d.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <fieldset>
              <legend className="mb-2 text-[15px]">
                Charge
                {passend.some((c) => !c.abgelaufen) ? <span className="ml-1 text-rose" aria-hidden>*</span> : null}
              </legend>
              {passend.map((c) => (
                <ChargeWahl
                  key={c.id}
                  c={c}
                  gewaehlt={chargen.includes(c.id)}
                  umschalten={() => umschalten(c.id)}
                  zahnfarbe={zahnfarbe}
                  menge={mengen[c.id] ?? 1}
                  mengeSetzen={(n) => setMengen((m) => ({ ...m, [c.id]: n }))}
                />
              ))}
              {!passend.length ? <p className="border-t border-line py-3.5 text-[15px] text-muted">Für diese Behandlung ist noch keine Charge erfasst.</p> : null}
              {andere.length ? (
                <details className="border-t border-line">
                  <summary className="cursor-pointer py-3.5 text-[15px] text-muted hover:text-white">Andere Materialien ({andere.length})</summary>
                  {andere.map((c) => (
                    <ChargeWahl
                  key={c.id}
                  c={c}
                  gewaehlt={chargen.includes(c.id)}
                  umschalten={() => umschalten(c.id)}
                  zahnfarbe={zahnfarbe}
                  menge={mengen[c.id] ?? 1}
                  mengeSetzen={(n) => setMengen((m) => ({ ...m, [c.id]: n }))}
                />
                  ))}
                </details>
              ) : null}
              <Link href="/materialien" className="mt-3 inline-block border-b border-current pb-1 text-[13px] text-muted hover:text-white">
                Neue Charge erfassen
              </Link>
            </fieldset>
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
          <Button type="submit" disabled={laeuft} className="min-w-[240px] text-[17px] max-[640px]:w-full">
            {laeuft ? 'Wird gespeichert …' : titel}
          </Button>
          {erledigen.art === 'weiter' ? <p className="text-[15px] text-muted">Danach: {erledigen.ziel.label}</p> : null}
        </div>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </form>
    </div>
  );
}

/** «Zuständig»: wer den Auftrag in der Produktion betreut (Initialen auf der Karte). */
export function ZustaendigWahl({
  orderId,
  wert,
  personen,
  setzen,
}: {
  orderId: string;
  wert: string | null;
  personen: { id: string; name: string }[];
  setzen: (orderId: string, userId: string) => Promise<{ fehler?: string }>;
}) {
  const router = useRouter();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  return (
    <div className="max-w-[360px]">
      <label className="block text-[15px]">
        Zuständig
        <select
          value={wert ?? ''}
          disabled={laeuft}
          onChange={(e) => {
            const id = e.target.value;
            starten(async () => {
              setFehler(null);
              const r = await setzen(orderId, id);
              if (r.fehler) setFehler(r.fehler);
              else router.refresh();
            });
          }}
          className="mt-[9px] block w-full appearance-auto rounded-[8px] border border-field-line bg-field p-[13px] text-[16px] text-white"
        >
          <option value="">Niemand</option>
          {personen.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {fehler ? <p className="mt-2 text-[13px] text-rose-light">{fehler}</p> : null}
    </div>
  );
}

/**
 * «Schritt korrigieren …»: den Auftrag von Hand auf einen anderen erlaubten Schritt setzen (vergessenes Weiterschalten,
 * oder nach der Qualitätskontrolle zurück in die Ausarbeitung). Ersetzt das Ziehen auf dem früheren Kanban.
 * Aus dem 3D-Druck nach vorn geht es nur mit »Erledigt« (Drucker und Charge).
 */
export function SchrittKorrigieren({ stand, verschieben }: { stand: ProduktionsStand; verschieben: (orderId: string, nach: string, von: string) => Promise<{ fehler?: string }> }) {
  const router = useRouter();
  const [ziel, setZiel] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  return (
    <details className="max-w-[520px]">
      <summary className="cursor-pointer list-none text-[13px] text-rose-light hover:text-white">Schritt korrigieren …</summary>
      <form
        aria-label="Schritt korrigieren"
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ziel || !stand.aktuell) return;
          starten(async () => {
            setFehler(null);
            const r = await verschieben(stand.orderId, ziel, stand.aktuell!.key);
            if (r.fehler) setFehler(r.fehler);
            else {
              setZiel('');
              router.refresh();
            }
          });
        }}
      >
        <p className="text-[13px] text-muted">Nur wenn das Weiterschalten vergessen wurde oder ein Schritt wiederholt werden muss. Sonst »Erledigt« verwenden.</p>
        <label className="block text-[15px]">
          Auf Schritt setzen
          <select
            value={ziel}
            onChange={(e) => setZiel(e.target.value)}
            className="mt-[9px] block w-full appearance-auto rounded-[8px] border border-field-line bg-field p-[13px] text-[16px] text-white"
          >
            <option value="">Bitte wählen</option>
            {stand.ziele.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="secondary" disabled={laeuft || !ziel}>
          {laeuft ? 'Wird gespeichert …' : 'Schritt setzen'}
        </Button>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </form>
    </details>
  );
}
