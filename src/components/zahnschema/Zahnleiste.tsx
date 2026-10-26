'use client';

import { useState } from 'react';
import {
  AuswahlFehler,
  brueckeAnlegen,
  brueckenzahnUmschalten,
  einzelUmschalten,
  entfernen,
  verbundenMitNaechstem,
  zusammenfassung,
  type Behandlung,
  type Einzelbehandlung,
  type ZahnAuswahl,
  type ZahnEintrag,
} from '@/lib/orders/bridge';
import { OK_REIHE, UK_REIHE } from '@/lib/orders/fdi';
import { IMPLANTAT } from './formen';
import { AuswahlUebersicht, Werkzeugleiste, type Werkzeug } from './Werkzeugleiste';

export type ZahnleistenWerkzeug = Einzelbehandlung | 'bruecke' | 'entfernen';

const WERKZEUGE: Record<ZahnleistenWerkzeug, Werkzeug<ZahnleistenWerkzeug>> = {
  krone: { id: 'krone', label: 'Krone', symbol: 'K', hinweis: 'Zahn anklicken, um eine Krone zu setzen. Ein zweiter Klick entfernt sie.' },
  implantatkrone: {
    id: 'implantatkrone',
    label: 'Implantatkrone',
    symbol: 'IK',
    hinweis: 'Zahn an der Implantatposition anklicken. Implantat- und Scanbody-Daten folgen im nächsten Schritt.',
  },
  bruecke: {
    id: 'bruecke',
    label: 'Brücke',
    symbol: 'A/G',
    hinweis: 'Ersten und letzten Zahn der Brücke anklicken. Dazwischen entstehen Glieder (G), die Enden sind Anker (A). Ein Klick auf einen mittleren Zahn wechselt zwischen Anker und Glied.',
  },
  provisorium: { id: 'provisorium', label: 'Provisorium', symbol: 'P', hinweis: 'Zahn anklicken, um ein Provisorium zu setzen.' },
  veneer: { id: 'veneer', label: 'Veneer', symbol: 'V', hinweis: 'Zahn anklicken, um ein Veneer zu setzen.' },
  inlay: { id: 'inlay', label: 'Inlay / Onlay', symbol: 'I', hinweis: 'Zahn anklicken, um ein Inlay oder Onlay zu setzen.' },
  entfernen: {
    id: 'entfernen',
    label: 'Entfernen',
    symbol: '−',
    hinweis: 'Zahn anklicken, um die Auswahl zu entfernen. Bei einer Brücke wird die ganze Brücke entfernt.',
  },
};

const SYMBOL: Record<Behandlung, string> = {
  krone: 'K',
  implantatkrone: 'IK',
  provisorium: 'P',
  veneer: 'V',
  inlay: 'I',
  bruecke_anker: 'A',
  bruecke_glied: 'G',
};

const NAME: Record<Behandlung, string> = {
  krone: 'Krone',
  implantatkrone: 'Implantatkrone',
  provisorium: 'Provisorium',
  veneer: 'Veneer',
  inlay: 'Inlay/Onlay',
  bruecke_anker: 'Brückenanker',
  bruecke_glied: 'Brückenglied',
};

/**
 * عکس دندان‌ها در `public/bilder/zaehne/<fdi>.webp`، بریده از تصویر «Keyhole»
 * که خود کاربر با هوش مصنوعی ساخت (۲۶ اکتبر ۲۰۲۶؛ مال خودمان)، با زمینهٔ شفاف. هر عکس تا وسط فاصلهٔ دو دندان
 * کناری بریده شده، پس کنار هم چیدنشان با عرض‌های زیر همان ردیف اصلی را می‌سازد.
 * عرض‌ها پیکسل عکس‌اند؛ ارتفاع همهٔ عکس‌های فک بالا ۱۹۲ و فک پایین ۱۹۸ است.
 */
const BILD_BREITE: Record<number, number> = {
  18: 112, 17: 111, 16: 117, 15: 93, 14: 101, 13: 104, 12: 102, 11: 128,
  21: 132, 22: 101, 23: 104, 24: 100, 25: 94, 26: 118, 27: 110, 28: 113,
  48: 132, 47: 119, 46: 124, 45: 92, 44: 96, 43: 100, 42: 98, 41: 107,
  31: 109, 32: 100, 33: 99, 34: 96, 35: 92, 36: 125, 37: 120, 38: 131,
};
const BILD_HOEHE = { oben: 192, unten: 198 };

/** مرز تاج و ریشه در عکس، درصد از بالا (فک بالا: ریشه بالا؛ فک پایین: تاج بالا). */
const HALS = 45;
/** وسط تاج، درصد از بالا: جای نماد و خط Brücke. */
const TAJ_MITTE = { oben: 74, unten: 22 };

const linie = { vectorEffect: 'non-scaling-stroke' as const, strokeWidth: 1.5, fill: 'none' };

function ZahnBild({ fdi, oben, eintrag }: { fdi: number; oben: boolean; eintrag?: ZahnEintrag }) {
  const art = eintrag?.art;
  // Brückenglied و Implantatkrone ریشهٔ طبیعی ندارند: فقط تاج دیده می‌شود
  const ohneWurzel = art === 'bruecke_glied' || art === 'implantatkrone';
  const zuschnitt = ohneWurzel ? (oben ? `inset(${HALS}% 0 0 0)` : `inset(0 0 ${100 - HALS}% 0)`) : undefined;
  return (
    <span className="relative z-10 block">
      {/* eslint-disable-next-line @next/next/no-img-element -- فایل ثابت کوچک؛ بهینه‌ساز Next لازم نیست */}
      <img
        src={`/bilder/zaehne/${fdi}.webp`}
        alt=""
        width={BILD_BREITE[fdi]}
        height={oben ? BILD_HOEHE.oben : BILD_HOEHE.unten}
        draggable={false}
        className={`block h-auto w-full select-none transition-opacity duration-[180ms] ${
          art ? 'opacity-100' : 'opacity-75 group-hover:opacity-100'
        }`}
        style={{ clipPath: zuschnitt }}
      />
      {art === 'implantatkrone' ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full overflow-visible">
          <g transform={oben ? 'translate(0 100) scale(1 -1)' : undefined} className="stroke-white" {...linie}>
            <path d={IMPLANTAT.abutment} />
            <path d={IMPLANTAT.koerper} />
            {IMPLANTAT.gewinde.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </svg>
      ) : null}
    </span>
  );
}

function Reihe({
  reihe,
  oben,
  wert,
  start,
  readOnly,
  onZahn,
}: {
  reihe: readonly number[];
  oben: boolean;
  wert: ZahnAuswahl;
  start: number | null;
  readOnly: boolean;
  onZahn: (fdi: number) => void;
}) {
  const mitte = oben ? TAJ_MITTE.oben : TAJ_MITTE.unten;
  return (
    <div className="relative flex" role="group" aria-label={oben ? 'Oberkiefer' : 'Unterkiefer'}>
      {/* خط وسط بین 11|21 و 41|31 */}
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-line" />
      {reihe.map((fdi, i) => {
        const eintrag = wert[fdi];
        const istStart = start === fdi;
        const zumNaechsten = verbundenMitNaechstem(wert, fdi);
        const vomVorigen = i > 0 && verbundenMitNaechstem(wert, reihe[i - 1]);
        const inhalt = (
          <>
            <span
              className={`relative block rounded-[10px] px-[6%] py-1 transition-colors duration-[180ms] ${
                eintrag ? 'bg-white/[0.06]' : ''
              } ${istStart ? 'outline-1 outline-offset-0 outline-dashed outline-rose' : ''}`}
            >
              {/* خط Brücke از وسط این دندان تا وسط دندان بعدی، در دو نیمه */}
              {zumNaechsten ? (
                <span aria-hidden className="absolute left-1/2 right-0 z-0 h-[3px] bg-white" style={{ top: `${mitte}%` }} />
              ) : null}
              {vomVorigen ? (
                <span aria-hidden className="absolute left-0 right-1/2 z-0 h-[3px] bg-white" style={{ top: `${mitte}%` }} />
              ) : null}
              <ZahnBild fdi={fdi} oben={oben} eintrag={eintrag} />
              {eintrag ? (
                <span
                  aria-hidden
                  className="absolute left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white px-1.5 py-[3px] text-[10px] font-medium leading-none text-black"
                  style={{ top: `${mitte}%` }}
                >
                  {SYMBOL[eintrag.art]}
                </span>
              ) : null}
            </span>
            <span
              className={`mt-1.5 block text-center text-[12px] leading-[18px] tabular-nums ${
                istStart ? 'text-rose' : eintrag ? 'text-white' : 'text-muted group-hover:text-white'
              }`}
            >
              {fdi}
            </span>
          </>
        );
        const label = `Zahn ${fdi}: ${eintrag ? NAME[eintrag.art] : 'nicht ausgewählt'}`;
        // عرض هر دندان به نسبت عکسش، تا همهٔ عکس‌های یک ردیف یک ارتفاع داشته باشند
        const breite = { flex: `${BILD_BREITE[fdi]} 1 0`, minWidth: 0 };
        return readOnly ? (
          <div key={fdi} style={breite} aria-label={label} role="img">
            {inhalt}
          </div>
        ) : (
          <button
            key={fdi}
            type="button"
            aria-pressed={Boolean(eintrag)}
            aria-label={label}
            onClick={() => onZahn(fdi)}
            className="group cursor-pointer"
            style={breite}
          >
            {inhalt}
          </button>
        );
      })}
    </div>
  );
}

/** نام هر ربع کنار ردیف، مثل تصویر مرجع؛ فقط در صفحه‌های پهن. */
function Seite({ text }: { text: string }) {
  return <span className="hidden w-[76px] shrink-0 self-center text-[12px] leading-snug text-muted 2xl:block">{text}</span>;
}

/** راهنمای حالت تک‌ابزاری: بدون ستون ابزار، پس پاک‌کردن هم با کلیک است. */
const EINZEL_HINWEIS: Partial<Record<ZahnleistenWerkzeug, string>> = {
  krone: 'Klicken Sie auf jeden Zahn, der eine Krone bekommt. Ein zweiter Klick entfernt sie.',
  inlay: 'Klicken Sie auf jeden Zahn, der ein Inlay oder Onlay bekommt. Ein zweiter Klick entfernt es.',
  veneer: 'Klicken Sie auf jeden Zahn, der ein Veneer bekommt. Ein zweiter Klick entfernt es.',
  implantatkrone: 'Klicken Sie auf jede Implantatposition. Ein zweiter Klick entfernt sie.',
  provisorium: 'Klicken Sie auf jeden Zahn, der ein Provisorium bekommt. Ein zweiter Klick entfernt es.',
  bruecke:
    'Klicken Sie auf den ersten und den letzten Zahn der Brücke. Dazwischen entstehen Glieder (G), die Enden sind Anker (A). Ein Klick auf einen mittleren Zahn wechselt zwischen Anker und Glied, ein Klick auf ein Ende entfernt die Brücke.',
};

/**
 * نمودار دندان‌ها (عکس، نمای کنار) برای Krone، Brücke، Veneer و غیره (مرجع روش کار:
 * docs/referenz/sprintray/04). منطق در `lib/orders/bridge.ts` است و اینجا فقط
 * نمایش و کلیک‌ها هستند.
 *
 * اگر Behandlung فقط یک ابزار دارد (Krone، Brücke، Inlay، …)، ستون ابزار نشان
 * داده نمی‌شود و فقط یک خط راهنما بالای نمودار می‌آید (خواستهٔ کاربر: ساده، قدم‌به‌قدم).
 */
export function Zahnleiste({
  werkzeuge,
  wert,
  onChange,
  readOnly = false,
}: {
  werkzeuge: Exclude<ZahnleistenWerkzeug, 'entfernen'>[];
  wert: ZahnAuswahl;
  onChange?: (neu: ZahnAuswahl) => void;
  readOnly?: boolean;
}) {
  const [aktiv, setAktiv] = useState<ZahnleistenWerkzeug>(werkzeuge[0]);
  const einzeln = werkzeuge.length === 1;
  const [start, setStart] = useState<number | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const liste = [...werkzeuge, 'entfernen' as const].map((w) => WERKZEUGE[w]);
  const hinweisListe = start
    ? liste.map((w) => (w.id === 'bruecke' ? { ...w, hinweis: `Brücke ab Zahn ${start}: jetzt den letzten Zahn der Brücke anklicken. Esc bricht ab.` } : w))
    : liste;

  function aendern(neu: ZahnAuswahl) {
    onChange?.(neu);
  }

  function onZahn(fdi: number) {
    setFehler(null);
    if (aktiv === 'entfernen') {
      aendern(entfernen(wert, fdi));
    } else if (aktiv === 'bruecke') {
      if (start === null) {
        const umgeschaltet = brueckenzahnUmschalten(wert, fdi);
        if (umgeschaltet !== wert) aendern(umgeschaltet);
        // بدون ستون ابزار، «Entfernen» نداریم: کلیک روی یک سرِ Brücke آن را برمی‌دارد
        else if (einzeln && wert[fdi]?.spanne) aendern(entfernen(wert, fdi));
        else setStart(fdi);
      } else if (start === fdi) {
        setStart(null);
      } else {
        try {
          aendern(brueckeAnlegen(wert, start, fdi));
        } catch (e) {
          if (e instanceof AuswahlFehler) setFehler(e.message);
          else throw e;
        }
        setStart(null);
      }
    } else {
      aendern(einzelUmschalten(wert, fdi, aktiv));
    }
  }

  const diagramm = (
    <div className="min-w-0">
      <div className="overflow-x-auto rounded-[12px] border border-panel-line bg-soft px-4 py-6">
        <div className="mx-auto min-w-[640px] max-w-[1080px]">
          <div className="flex gap-4">
            <Seite text="Oberkiefer rechts" />
            <div className="min-w-0 flex-1">
              <Reihe reihe={OK_REIHE} oben wert={wert} start={start} readOnly={readOnly} onZahn={onZahn} />
            </div>
            <Seite text="Oberkiefer links" />
          </div>
          <div className="my-5 h-px bg-line" />
          <div className="flex gap-4">
            <Seite text="Unterkiefer rechts" />
            <div className="min-w-0 flex-1">
              <Reihe reihe={UK_REIHE} oben={false} wert={wert} start={start} readOnly={readOnly} onZahn={onZahn} />
            </div>
            <Seite text="Unterkiefer links" />
          </div>
        </div>
      </div>
      {fehler ? (
        <p role="alert" className="mt-3 text-[13px]">
          <span className="mr-2 text-rose">!</span>
          {fehler}
        </p>
      ) : null}
      <AuswahlUebersicht zeilen={zusammenfassung(wert)} leerText="Sobald Sie Zähne auswählen, erscheinen sie hier." />
    </div>
  );

  if (readOnly) return diagramm;

  const abbrechen = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && start !== null) setStart(null);
  };

  if (einzeln) {
    return (
      <div onKeyDown={abbrechen}>
        <p className="mb-6 max-w-[620px] text-[15px] font-light leading-relaxed text-muted" aria-live="polite">
          {start ? `Brücke ab Zahn ${start}: jetzt den letzten Zahn der Brücke anklicken. Esc bricht ab.` : EINZEL_HINWEIS[aktiv]}
        </p>
        {diagramm}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[200px_minmax(0,1fr)]" onKeyDown={abbrechen}>
      <Werkzeugleiste
        titel="Werkzeug"
        werkzeuge={hinweisListe}
        aktiv={aktiv}
        onWahl={(w) => {
          setAktiv(w);
          setStart(null);
          setFehler(null);
        }}
      />
      {diagramm}
    </div>
  );
}
