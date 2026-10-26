'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Auswahl, Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';
import { WOCHENTAGE } from '@/lib/touren/plan';

/** دکمه‌ها و فرم‌های تور (Spec فاز ۱، بخش I). بعد از هر کار موفق صفحه از سرور تازه می‌شود. */

type Aktion<A extends unknown[]> = (...a: A) => Promise<{ fehler?: string }>;

function useKnopf<A extends unknown[]>(aktion: Aktion<A>) {
  const router = useRouter();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const ausfuehren = (...a: A) =>
    starten(async () => {
      setFehler(null);
      const r = await aktion(...a);
      if (r.fehler) setFehler(r.fehler);
      else router.refresh();
    });
  return { fehler, laeuft, ausfuehren };
}

/** «Zugestellt»: alle offenen Arbeiten dieses Stopps auf einmal. */
export function ZustellenKnopf({ praxisId, praxis, orderIds, aktion }: { praxisId: string; praxis: string; orderIds: string[]; aktion: Aktion<[string, string[]]> }) {
  const k = useKnopf(aktion);
  return (
    <div className="space-y-2">
      <Button disabled={k.laeuft} onClick={() => k.ausfuehren(praxisId, orderIds)} aria-label={`Zugestellt: ${praxis}`} className="min-w-[200px] max-[640px]:w-full">
        {k.laeuft ? 'Wird gespeichert …' : orderIds.length > 1 ? `Zugestellt (${orderIds.length} Arbeiten)` : 'Zugestellt'}
      </Button>
      {k.fehler ? <p className="text-[13px] text-rose-light">{k.fehler}</p> : null}
    </div>
  );
}

export function AbgeholtKnopf({ id, aktion, beschriftung = 'Abgeholt' }: { id: string; aktion: Aktion<[string]>; beschriftung?: string }) {
  const k = useKnopf(aktion);
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Button variant="secondary" disabled={k.laeuft} onClick={() => k.ausfuehren(id)} className="max-[640px]:px-5 max-[640px]:py-3 max-[640px]:text-[15px]">
        {k.laeuft ? '…' : beschriftung}
      </Button>
      {k.fehler ? <span className="text-[13px] text-rose-light">{k.fehler}</span> : null}
    </span>
  );
}

/** Büro: offene Abholung in eine Tour und an einen Tag legen (mit Vorschlag). */
export function EinplanenFormular({
  id,
  touren,
  vorschlag,
  heute,
  aktion,
}: {
  id: string;
  touren: { id: string; name: string }[];
  vorschlag: { tourId: string; datum: string | null } | null;
  heute: string;
  aktion: (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
}) {
  const [zustand, senden, laeuft] = useFormAktion<Ergebnis>(aktion, null);
  if (!touren.length) return <p className="text-[13px] text-muted">Noch keine Tour angelegt.</p>;
  return (
    <form onSubmit={senden} aria-label="Abholung einplanen" className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <input type="hidden" name="id" value={id} />
      <Auswahl label="Tour" name="tour" defaultValue={vorschlag?.tourId ?? touren[0].id} optionen={touren.map((t) => ({ wert: t.id, label: t.name }))} />
      <Feld label="Tag" name="datum" type="date" required min={heute} defaultValue={vorschlag?.datum ?? heute} />
      <Button type="submit" variant="secondary" disabled={laeuft} className="sm:mb-1">
        {laeuft ? '…' : 'Einplanen'}
      </Button>
      <div aria-live="polite" className="sm:col-span-3">
        <Rueckmeldung zustand={zustand} />
      </div>
    </form>
  );
}

type TourWerte = { id: string; name: string; tage: number[]; fahrerId: string | null; aktiv: boolean };

/** Tour anlegen oder ändern: Name, Tage, Fahrer, aktiv. */
export function TourFormular({
  tour,
  fahrer,
  aktion,
}: {
  tour?: TourWerte;
  fahrer: { id: string; name: string }[];
  aktion: (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
}) {
  const [zustand, senden, laeuft] = useFormAktion<Ergebnis>(aktion, null, { zuruecksetzenBeiErfolg: !tour });
  const tage = tour?.tage ?? [1, 2, 3, 4, 5];
  return (
    <form onSubmit={senden} aria-label={tour ? `Tour bearbeiten: ${tour.name}` : 'Neue Tour'} className="max-w-[860px] space-y-6">
      {tour ? <input type="hidden" name="id" value={tour.id} /> : null}
      <div className="grid gap-6 sm:grid-cols-2">
        <Feld label="Name" name="name" required maxLength={60} defaultValue={tour?.name} placeholder="z. B. Tour Wien Nord" autoComplete="off" />
        <Auswahl
          label="Fahrer"
          name="fahrer"
          defaultValue={tour?.fahrerId ?? ''}
          optionen={[{ wert: '', label: 'Noch offen' }, ...fahrer.map((f) => ({ wert: f.id, label: f.name }))]}
        />
      </div>
      <fieldset>
        <legend className="text-[15px]">
          Tage<span className="ml-1 text-rose" aria-hidden>*</span>
        </legend>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-3">
          {WOCHENTAGE.map((w) => (
            <label key={w.nr} className="flex items-center gap-2.5 text-[15px]">
              <input type="checkbox" name="tage" value={w.nr} defaultChecked={tage.includes(w.nr)} className="size-4 accent-rose" />
              {w.lang}
            </label>
          ))}
        </div>
      </fieldset>
      {tour ? (
        <Auswahl
          label="Status"
          name="aktiv"
          defaultValue={tour.aktiv ? 'ja' : 'nein'}
          optionen={[
            { wert: 'ja', label: 'Aktiv' },
            { wert: 'nein', label: 'Pausiert (kein Tagesplan)' },
          ]}
        />
      ) : null}
      <div className="space-y-4">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : tour ? 'Speichern' : 'Tour anlegen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

/** ↑ ↓ «Entfernen» und «Hinzufügen» in der Route einer Tour. */
export function RouteKnopf({
  tourId,
  praxisId,
  was,
  label,
  beschriftung,
  aktion,
}: {
  tourId: string;
  praxisId: string;
  was: 'hoch' | 'runter' | 'weg';
  label: string;
  beschriftung: string;
  aktion: (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
}) {
  const [zustand, senden, laeuft] = useFormAktion<Ergebnis>(aktion, null);
  return (
    <form onSubmit={senden} className="inline">
      <input type="hidden" name="tour" value={tourId} />
      <input type="hidden" name="praxis" value={praxisId} />
      <input type="hidden" name="was" value={was} />
      <button type="submit" disabled={laeuft} aria-label={label} title={label} className="min-w-8 px-1.5 py-1 text-[13px] text-muted hover:text-white disabled:opacity-40">
        {beschriftung}
      </button>
      {zustand?.fehler ? <span className="ml-2 text-[13px] text-rose-light">{zustand.fehler}</span> : null}
    </form>
  );
}

export function PraxisHinzufuegen({
  tourId,
  praxen,
  aktion,
}: {
  tourId: string;
  praxen: { id: string; name: string; tour: string | null }[];
  aktion: (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
}) {
  const [zustand, senden, laeuft] = useFormAktion<Ergebnis>(aktion, null);
  if (!praxen.length) return null;
  return (
    <form onSubmit={senden} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="tour" value={tourId} />
      <input type="hidden" name="was" value="hinzu" />
      <div className="min-w-[240px] flex-1">
        <Auswahl
          label="Ordination hinzufügen"
          name="praxis"
          optionen={[{ wert: '', label: 'Ordination wählen …' }, ...praxen.map((p) => ({ wert: p.id, label: p.tour ? `${p.name} (jetzt: ${p.tour})` : p.name }))]}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={laeuft} className="mb-1">
        Hinzufügen
      </Button>
      {zustand?.fehler ? <p className="w-full text-[13px] text-rose-light">{zustand.fehler}</p> : null}
    </form>
  );
}
