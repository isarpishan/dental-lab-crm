'use client';

import { useId, useState } from 'react';
import type { Upload, UploadSteuerung } from '@/components/auftrag/useUploads';
import { ABLAGE_HINWEIS, ABLAGE_NAMEN as NAME, ANNEHMEN, FORMATE_TEXT, groesseText, type Ablage } from '@/lib/dateien/regeln';
import type { DateiPlatz } from '@/lib/orders/form-schema';

/**
 * قدم «Dateien» (Spec فاز ۱، D.۴): برای هر فایل لازم یک ردیف جدا با برچسب (قانون DDL:
 * OK، UK و Biss برای هر طرح)، و «Weitere Dateien». فایل با «Datei wählen» یا کشیدن روی
 * ردیف اضافه می‌شود و فوراً در پس‌زمینه بالا می‌رود.
 *
 * همین در صفحهٔ سفارش (تب «Dateien» و «Daten nachreichen») هم هست: آنجا فایل‌های ارسال‌شده
 * پاک نمی‌شوند (`entfernbar`) و کنار هر فایل «Herunterladen» و «3D-Ansicht» می‌آید (`dateiAktionen`).
 */
export function DateienWahl({
  erforderlich,
  uploads,
  nachgereicht = false,
  onNachgereicht,
  weitere = true,
  zusatzPlaetze = [],
  hochladen = true,
  entfernbar = () => true,
  dateiAktionen,
}: {
  erforderlich: DateiPlatz[];
  uploads: UploadSteuerung;
  nachgereicht?: boolean;
  /** ohne: kein Kästchen »Daten werden nachgereicht«. */
  onNachgereicht?: (wert: boolean) => void;
  /** Platz »Weitere Dateien« zeigen. */
  weitere?: boolean;
  /** weitere Plätze nur zum Anzeigen (z. B. Anhänge aus Nachrichten), wenn sie Dateien haben. */
  zusatzPlaetze?: Ablage[];
  /** false: nur ansehen (z. B. stornierter Auftrag). */
  hochladen?: boolean;
  entfernbar?: (u: Upload) => boolean;
  dateiAktionen?: (u: Upload) => React.ReactNode;
}) {
  const belegt = (p: Ablage) => uploads.liste.some((u) => u.platz === p && u.status !== 'fehler');
  const fehlend = erforderlich.filter((p) => !belegt(p));
  const plaetze: Ablage[] = [...erforderlich, ...(weitere ? (['sonstiges'] as const) : []), ...zusatzPlaetze.filter(belegt)];

  return (
    <div className="max-w-[860px]">
      {hochladen ? (
        <p className="mb-6 text-[13px] text-muted">
          {FORMATE_TEXT} · bis {groesseText(uploads.maxBytes)} pro Datei
        </p>
      ) : null}
      <div className="border-t border-line">
        {plaetze.map((p) => (
          <Ablageplatz
            key={p}
            platz={p}
            pflicht={(erforderlich as Ablage[]).includes(p)}
            fehlt={!belegt(p)}
            hochladen={hochladen && !zusatzPlaetze.includes(p)}
            uploads={uploads.liste.filter((u) => u.platz === p)}
            onDateien={(d) => uploads.hochladen(p, d)}
            onEntfernen={uploads.entfernen}
            entfernbar={entfernbar}
            dateiAktionen={dateiAktionen}
          />
        ))}
      </div>
      {onNachgereicht && (fehlend.length || nachgereicht) ? (
        <label className="mt-8 flex max-w-[640px] cursor-pointer items-start gap-3 text-[15px]">
          <input type="checkbox" checked={nachgereicht} onChange={(e) => onNachgereicht(e.target.checked)} className="mt-1 size-4 shrink-0 accent-rose" />
          <span>
            Daten werden nachgereicht
            <span className="mt-1 block text-[13px] leading-relaxed text-muted">
              Ohne vollständige Scans und Biss kann das Design nicht abschließend erstellt werden. Der Auftrag geht als »Rückfrage« ein, bis die Daten
              da sind.
            </span>
          </span>
        </label>
      ) : null}
    </div>
  );
}

function Ablageplatz({
  platz,
  pflicht,
  fehlt,
  hochladen,
  uploads,
  onDateien,
  onEntfernen,
  entfernbar,
  dateiAktionen,
}: {
  platz: Ablage;
  pflicht: boolean;
  fehlt: boolean;
  hochladen: boolean;
  uploads: Upload[];
  onDateien: (dateien: File[]) => void;
  onEntfernen: (u: Upload) => Promise<void>;
  entfernbar: (u: Upload) => boolean;
  dateiAktionen?: (u: Upload) => React.ReactNode;
}) {
  const [ziehen, setZiehen] = useState(false);
  const feld = useId();
  return (
    <section
      aria-label={NAME[platz]}
      onDragOver={(e) => {
        if (!hochladen || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setZiehen(true);
      }}
      onDragLeave={() => setZiehen(false)}
      onDrop={(e) => {
        e.preventDefault();
        setZiehen(false);
        if (e.dataTransfer.files.length) onDateien([...e.dataTransfer.files]);
      }}
      className={`border-b py-5 transition-colors duration-[180ms] ${ziehen ? 'border-rose bg-rose/5' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3 className="text-[18px] font-light">
            {NAME[platz]}
            {pflicht ? (
              <span className="ml-1 text-rose" aria-hidden>
                *
              </span>
            ) : null}
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            {ABLAGE_HINWEIS[platz]}
            {pflicht && fehlt ? <span className="text-rose-light"> · fehlt noch</span> : null}
          </p>
        </div>
        {hochladen ? (
          <label
            htmlFor={feld}
            className="cursor-pointer border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-rose"
          >
            {uploads.length ? 'Weitere Datei' : 'Datei wählen'}
            <input
              id={feld}
              type="file"
              multiple
              accept={ANNEHMEN}
              aria-label={`${NAME[platz]} hochladen`}
              className="sr-only"
              onChange={(e) => {
                if (e.target.files?.length) onDateien([...e.target.files]);
                e.target.value = '';
              }}
            />
          </label>
        ) : null}
      </div>
      {uploads.length ? (
        <ul className="mt-4 space-y-2.5">
          {uploads.map((u) => (
            <DateiZeile key={u.schluessel} u={u} onEntfernen={entfernbar(u) ? () => onEntfernen(u) : undefined} aktionen={u.status === 'fertig' ? dateiAktionen?.(u) : null} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DateiZeile({ u, onEntfernen, aktionen }: { u: Upload; onEntfernen?: () => void; aktionen?: React.ReactNode }) {
  const prozent = Math.round(u.fortschritt * 100);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 text-[14px]">
      <span className="flex min-w-0 items-baseline gap-2">
        <span aria-hidden className={u.status === 'fehler' ? 'text-rose' : u.status === 'fertig' ? 'text-white' : 'text-muted'}>
          {u.status === 'fehler' ? '!' : u.status === 'fertig' ? '✓' : '↑'}
        </span>
        <span className="min-w-0 truncate" title={u.name}>
          {u.name}
        </span>
        <span className="shrink-0 text-[13px] text-muted">{groesseText(u.groesse)}</span>
      </span>
      <span className="flex items-center gap-4">
        {aktionen}
        {onEntfernen ? (
          <button
            type="button"
            onClick={onEntfernen}
            aria-label={`${u.name} ${u.status === 'laeuft' ? 'abbrechen' : 'entfernen'}`}
            className="border-b border-current pb-0.5 text-[13px] text-muted hover:text-white"
          >
            {u.status === 'laeuft' ? 'Abbrechen' : 'Entfernen'}
          </button>
        ) : null}
      </span>
      {u.status === 'laeuft' ? (
        <span className="col-span-2 flex items-center gap-3" role="progressbar" aria-label={`${u.name} wird hochgeladen`} aria-valuenow={prozent} aria-valuemin={0} aria-valuemax={100}>
          <span className="h-px flex-1 bg-line">
            <span className="block h-px bg-white transition-[width] duration-200" style={{ width: `${prozent}%` }} />
          </span>
          <span className="w-10 text-right text-[12px] text-muted">{prozent} %</span>
        </span>
      ) : null}
      {u.fehler ? (
        <p role="alert" className="col-span-2 text-[13px] text-rose-light">
          {u.fehler}
        </p>
      ) : null}
    </li>
  );
}
