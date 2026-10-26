'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { DateienWahl } from '@/components/auftrag/DateienWahl';
import { istAnzeigbar, ModelAnsicht } from '@/components/auftrag/ModelAnsicht';
import { useUploads, type Upload } from '@/components/auftrag/useUploads';
import { Button } from '@/components/ui/Button';
import { Meldung, Textfeld } from '@/components/ui/Formular';
import { ANNEHMEN, groesseText } from '@/lib/dateien/regeln';
import type { DateiInfo } from '@/lib/orders/entwurf';
import type { DateiPlatz } from '@/lib/orders/form-schema';

/**
 * بخش‌های تعاملی صفحهٔ سفارش (Spec فاز ۱، بخش F). داده و server actionها از صفحه می‌آیند؛
 * بعد از هر کار موفق صفحه از سرور تازه می‌شود (`router.refresh`).
 */

type Ergebnis = Promise<{ fehler?: string }>;

/** کنار هر فایل ارسال‌شده: «3D-Ansicht» (برای STL، PLY، OBJ) و «Herunterladen». */
export function DateiAktionen({ id, name, groesse, herunterladen = true }: { id: string; name: string; groesse: number; herunterladen?: boolean }) {
  return (
    <>
      {istAnzeigbar(name) ? <ModelAnsicht dateiId={id} name={name} groesse={groesse} /> : null}
      {herunterladen ? (
        <a href={`/api/dateien/${id}`} aria-label={`${name} herunterladen`} className="border-b border-current pb-0.5 text-[13px] text-muted hover:text-white">
          Herunterladen
        </a>
      ) : null}
    </>
  );
}

const aktionenFuer = (u: Upload) => (u.id ? <DateiAktionen id={u.id} name={u.name} groesse={u.groesse} /> : null);

/** تب «Dateien»: فایل‌ها در همان جاهای فرم، با امکان افزودن (نه پاک کردن) تا سفارش باز است. */
export function DateienTab({
  orderId,
  pflicht,
  dateien,
  maxBytes,
  hochladen,
  dateiEntfernen,
}: {
  orderId: string;
  pflicht: DateiPlatz[];
  dateien: DateiInfo[];
  maxBytes: number;
  hochladen: boolean;
  dateiEntfernen: (id: string) => Ergebnis;
}) {
  const uploads = useUploads({ entwurfId: orderId, start: dateien, maxBytes, entfernenAktion: dateiEntfernen });
  return (
    <DateienWahl
      erforderlich={pflicht}
      uploads={hochladen ? uploads : { ...uploads, hochladen: () => {} }}
      weitere={hochladen || dateien.some((d) => d.platz === 'sonstiges')}
      zusatzPlaetze={['nachricht']}
      hochladen={hochladen}
      entfernbar={(u) => u.status !== 'fertig'}
      dateiAktionen={aktionenFuer}
    />
  );
}

/** «Daten nachreichen» در وضعیت Rückfrage: فایل‌های لازم و/یا یک پاسخ، بعد سفارش ادامه پیدا می‌کند. */
export function Nachreichen({
  orderId,
  pflicht,
  dateien,
  maxBytes,
  nachreichen,
  dateiEntfernen,
}: {
  orderId: string;
  pflicht: DateiPlatz[];
  dateien: DateiInfo[];
  maxBytes: number;
  nachreichen: (orderId: string, antwort: string) => Ergebnis;
  dateiEntfernen: (id: string) => Ergebnis;
}) {
  const router = useRouter();
  const uploads = useUploads({ entwurfId: orderId, start: dateien, maxBytes, entfernenAktion: dateiEntfernen });
  const [antwort, setAntwort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  return (
    <div className="space-y-8">
      <DateienWahl erforderlich={pflicht} uploads={uploads} entfernbar={(u) => u.status !== 'fertig'} dateiAktionen={aktionenFuer} />
      <div className="max-w-[760px]">
        <Textfeld label="Antwort (optional)" value={antwort} maxLength={5000} onChange={(e) => setAntwort(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button
          disabled={laeuft || uploads.laufend > 0}
          onClick={() =>
            starten(async () => {
              setFehler(null);
              const r = await nachreichen(orderId, antwort);
              if (r.fehler) setFehler(r.fehler);
              else router.refresh();
            })
          }
        >
          {laeuft ? 'Wird gesendet …' : 'Daten senden'}
        </Button>
        {uploads.laufend ? <p className="text-[15px] text-muted">Dateien werden noch hochgeladen …</p> : null}
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </div>
  );
}

/** «Auftrag stornieren» با دلیل؛ اول یک کلیک برای باز شدن، بعد تأیید. */
export function StornoFormular({ orderId, stornieren }: { orderId: string; stornieren: (orderId: string, grund: string) => Ergebnis }) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  if (!offen) {
    return (
      <Button variant="text" onClick={() => setOffen(true)}>
        Auftrag stornieren
      </Button>
    );
  }
  return (
    <form
      aria-label="Auftrag stornieren"
      className="w-full max-w-[640px] space-y-5 border-t border-line pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        starten(async () => {
          setFehler(null);
          const r = await stornieren(orderId, grund);
          if (r.fehler) setFehler(r.fehler);
          else router.refresh();
        });
      }}
    >
      <Textfeld label="Grund der Stornierung" required rows={3} maxLength={500} value={grund} onChange={(e) => setGrund(e.target.value)} />
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird storniert …' : 'Endgültig stornieren'}
        </Button>
        <Button variant="text" onClick={() => setOffen(false)}>
          Abbrechen
        </Button>
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </form>
  );
}

/**
 * «Auftrag löschen» (nur Inhaber, nur solange nichts daran gearbeitet wurde): erst ein Klick zum Öffnen, dann mit
 * Warnung bestätigen. Danach zurück zur Liste.
 */
export function AuftragLoeschen({ orderId, nr, loeschen }: { orderId: string; nr: string | null; loeschen: (orderId: string) => Ergebnis }) {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  return (
    <section aria-label="Auftrag löschen" className="border-t border-line pt-6">
      {!offen ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <Button variant="text" onClick={() => setOffen(true)}>
            Auftrag löschen …
          </Button>
          <span className="text-[13px] text-muted">Für irrtümlich angelegte Aufträge, an denen noch nichts gemacht wurde.</span>
        </div>
      ) : (
        <div className="max-w-[640px] space-y-4">
          <p className="text-[15px] text-paragraph">
            Auftrag {nr ?? ''} mit allen Dateien und Nachrichten endgültig löschen? Er verschwindet auch im Portal der Ordination. Das lässt sich nicht rückgängig machen.
          </p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <Button
              variant="secondary"
              disabled={laeuft}
              onClick={() =>
                starten(async () => {
                  setFehler(null);
                  const r = await loeschen(orderId);
                  if (r.fehler) setFehler(r.fehler);
                  else router.push('/auftraege');
                })
              }
            >
              {laeuft ? 'Wird gelöscht …' : 'Endgültig löschen'}
            </Button>
            <Button variant="text" onClick={() => setOffen(false)}>
              Abbrechen
            </Button>
          </div>
          {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
        </div>
      )}
    </section>
  );
}

/** پیام تازه در «Kommunikation»، با پیوست. در لابراتوار با کلید «Intern». */
export function NachrichtFormular({
  orderId,
  labor,
  maxBytes,
  senden,
  dateiEntfernen,
}: {
  orderId: string;
  labor: boolean;
  maxBytes: number;
  senden: (orderId: string, daten: { text: string; dateiIds: string[]; intern: boolean }) => Ergebnis;
  dateiEntfernen: (id: string) => Ergebnis;
}) {
  const router = useRouter();
  const uploads = useUploads({ entwurfId: orderId, start: [], maxBytes, entfernenAktion: dateiEntfernen });
  const [text, setText] = useState('');
  const [intern, setIntern] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  const feld = useId();
  const fertige = uploads.liste.filter((u) => u.status === 'fertig' && u.id);

  return (
    <form
      aria-label="Nachricht schreiben"
      className="max-w-[760px] space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        starten(async () => {
          setFehler(null);
          const r = await senden(orderId, { text, dateiIds: fertige.map((u) => u.id!), intern });
          if (r.fehler) {
            setFehler(r.fehler);
            return;
          }
          setText('');
          setIntern(false);
          for (const u of uploads.liste) uploads.vergessen(u);
          router.refresh();
        });
      }}
    >
      <Textfeld label="Nachricht" rows={4} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} />
      {uploads.liste.length ? (
        <ul className="space-y-2 text-[14px]">
          {uploads.liste.map((u) => (
            <li key={u.schluessel} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={u.status === 'fehler' ? 'text-rose' : u.status === 'fertig' ? 'text-white' : 'text-muted'} aria-hidden>
                {u.status === 'fehler' ? '!' : u.status === 'fertig' ? '✓' : '↑'}
              </span>
              <span className="min-w-0 truncate">{u.name}</span>
              <span className="text-[13px] text-muted">
                {groesseText(u.groesse)}
                {u.status === 'laeuft' ? ` · ${Math.round(u.fortschritt * 100)} %` : ''}
              </span>
              <button type="button" onClick={() => uploads.entfernen(u)} aria-label={`${u.name} entfernen`} className="border-b border-current text-[13px] text-muted hover:text-white">
                Entfernen
              </button>
              {u.fehler ? <span className="basis-full text-[13px] text-rose-light">{u.fehler}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Button type="submit" disabled={laeuft || uploads.laufend > 0}>
          {laeuft ? 'Wird gesendet …' : 'Senden'}
        </Button>
        <label htmlFor={feld} className="cursor-pointer border-b border-current pb-1.5 text-[13px] text-muted hover:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-rose">
          Datei anhängen
          <input
            id={feld}
            type="file"
            multiple
            accept={ANNEHMEN}
            aria-label="Datei anhängen"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) uploads.hochladen('nachricht', [...e.target.files]);
              e.target.value = '';
            }}
          />
        </label>
        {labor ? (
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input type="checkbox" checked={intern} onChange={(e) => setIntern(e.target.checked)} className="size-4 accent-rose" />
            Intern (nur im Labor sichtbar)
          </label>
        ) : null}
        {fehler ? <Meldung art="fehler">{fehler}</Meldung> : null}
      </div>
    </form>
  );
}

/** «Name anzeigen» در پنل داخلی: نام فقط با کلیک، و هر بار در Data-Access-Log. */
export function NameAnzeigen({ orderId, anzeigen }: { orderId: string; anzeigen: (orderId: string) => Promise<{ name?: string; fehler?: string }> }) {
  const [name, setName] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starten] = useTransition();
  if (name) return <p className="text-[18px] font-light">{name}</p>;
  return (
    <div className="space-y-2">
      <Button
        variant="text"
        disabled={laeuft}
        onClick={() =>
          starten(async () => {
            const r = await anzeigen(orderId);
            if (r.name) setName(r.name);
            else setFehler(r.fehler ?? 'Nicht möglich.');
          })
        }
      >
        Name anzeigen
      </Button>
      {fehler ? <p className="text-[13px] text-rose-light">{fehler}</p> : null}
    </div>
  );
}
