'use client';

import { useMemo, useState } from 'react';
import { OK_REIHE, UK_REIHE, relativeBreite } from '@/lib/orders/fdi';
import {
  anwenden,
  entfernen,
  hatBasis,
  zusammenfassung,
  type ProthesenAuswahl,
  type ProthesenEintrag,
  type ProthesenWerkzeug,
} from '@/lib/orders/prothese';
import { aufsicht } from './formen';
import { AuswahlUebersicht, Werkzeugleiste, type Werkzeug } from './Werkzeugleiste';

type KieferbogenWerkzeug = ProthesenWerkzeug | 'entfernen';

const WERKZEUGE: Werkzeug<KieferbogenWerkzeug>[] = [
  { id: 'ersatzzahn', label: 'Ersatzzahn', symbol: 'E', hinweis: 'Fehlende Zähne anklicken, die in der Prothese ersetzt werden.' },
  { id: 'extraktion', label: 'Extraktion', symbol: '×', hinweis: 'Zähne anklicken, die noch extrahiert und in der Prothese ersetzt werden.' },
  { id: 'basis', label: 'Basis', symbol: '▭', hinweis: 'Zusätzliche Bereiche für die Prothesenbasis anklicken. Unter ersetzten Zähnen ist die Basis immer dabei.' },
  { id: 'klammer', label: 'Klammer', symbol: '⌒', hinweis: 'Verbleibende Zähne anklicken, an denen eine Klammer sitzen soll.' },
  { id: 'entfernen', label: 'Entfernen', symbol: '−', hinweis: 'Zahn anklicken, um alle Angaben an diesem Zahn zu entfernen.' },
];

/* ── هندسه: هر فک نیمی از یک بیضی است ───────────────────────────── */

const BREITE = 520;
const HOEHE = 600;
type Bogen = { cx: number; cy: number; a: number; b: number; von: number; bis: number };
const OK_BOGEN: Bogen = { cx: 260, cy: 268, a: 200, b: 205, von: Math.PI, bis: 0 };
const UK_BOGEN: Bogen = { cx: 260, cy: 332, a: 200, b: 205, von: Math.PI, bis: 2 * Math.PI };

type Platz = {
  fdi: number;
  x: number;
  y: number;
  winkel: number; // محور x محلی در راستای قوس، محور y محلی رو به بیرون
  nx: number;
  ny: number;
  breite: number;
  tiefe: number;
  typ: ReturnType<typeof aufsicht>['typ'];
  segment: string; // مسیر قوس زیر همین دندان، برای Basis
};

const rund = (n: number, f = 100) => Math.round(n * f) / f;

function punkt(b: Bogen, t: number) {
  return { x: b.cx + b.a * Math.cos(t), y: b.cy - b.b * Math.sin(t) };
}

function layout(bogen: Bogen, reihe: readonly number[]): Platz[] {
  const N = 720;
  const ts: number[] = [];
  const len: number[] = [];
  let vorher = punkt(bogen, bogen.von);
  for (let i = 0; i <= N; i++) {
    const t = bogen.von + ((bogen.bis - bogen.von) * i) / N;
    const p = punkt(bogen, t);
    ts.push(t);
    len.push(i === 0 ? 0 : len[i - 1] + Math.hypot(p.x - vorher.x, p.y - vorher.y));
    vorher = p;
  }
  const gesamt = len[N];
  const tBei = (s: number) => {
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (len[mid] < s) lo = mid;
      else hi = mid;
    }
    const f = (s - len[lo]) / (len[hi] - len[lo] || 1);
    return ts[lo] + (ts[hi] - ts[lo]) * f;
  };

  const rel = reihe.map(relativeBreite);
  const einheit = gesamt / rel.reduce((a, b) => a + b, 0);
  let kumuliert = 0;

  return reihe.map((fdi, i) => {
    const s0 = kumuliert * einheit;
    kumuliert += rel[i];
    const s1 = kumuliert * einheit;
    const t = tBei((s0 + s1) / 2);
    const p = punkt(bogen, t);
    let nx = (p.x - bogen.cx) / (bogen.a * bogen.a);
    let ny = (p.y - bogen.cy) / (bogen.b * bogen.b);
    const l = Math.hypot(nx, ny);
    nx /= l;
    ny /= l;
    const form = aufsicht(fdi);
    const breite = rel[i] * einheit * 0.9;

    const schritte = 12;
    const punkte = Array.from({ length: schritte + 1 }, (_, k) => punkt(bogen, tBei(s0 - 0.5 + ((s1 - s0 + 1) * k) / schritte)));
    const segment = punkte.map((q, k) => `${k ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('');

    // گرد کردن: سرور و مرورگر باید دقیقاً همان اعداد را بسازند (hydration)
    return {
      fdi,
      x: rund(p.x),
      y: rund(p.y),
      winkel: rund((Math.atan2(ny, nx) * 180) / Math.PI - 90),
      nx: rund(nx, 1000),
      ny: rund(ny, 1000),
      breite: rund(breite),
      tiefe: rund((breite * form.tiefe) / form.breite),
      typ: form.typ,
      segment,
    };
  });
}

function bogenPfad(b: Bogen, versatz: number) {
  const g: Bogen = { ...b, a: b.a + versatz, b: b.b + versatz };
  const punkte = Array.from({ length: 61 }, (_, i) => punkt(g, g.von + ((g.bis - g.von) * i) / 60));
  return punkte.map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join('');
}

/* ── یک دندان از بالا ───────────────────────────────────────────── */

function Zahnform({ p, eintrag }: { p: Platz; eintrag?: ProthesenEintrag }) {
  const w = p.breite;
  const d = p.tiefe;
  const ersetzt = Boolean(eintrag?.zahn);
  const fuellung = ersetzt ? '#f4f2ef' : 'rgba(244,242,239,0.16)';
  const furche = ersetzt ? 'rgba(5,5,5,0.45)' : 'rgba(244,242,239,0.35)';
  const r = p.typ === 'molar' ? Math.min(w, d) * 0.3 : p.typ === 'schneidezahn' ? d * 0.45 : Math.min(w, d) * 0.48;

  return (
    <>
      {p.typ === 'eckzahn' ? (
        <ellipse className="zahn-form" rx={w / 2} ry={d / 2} fill={fuellung} />
      ) : (
        <rect className="zahn-form" x={-w / 2} y={-d / 2} width={w} height={d} rx={r} fill={fuellung} />
      )}
      {p.typ === 'molar' ? (
        // فقط شیار میانی، تا با علامت × (Extraktion) اشتباه نشود
        <path d={`M${-w * 0.26} 0C${-w * 0.1} ${d * 0.07} ${w * 0.1} ${-d * 0.07} ${w * 0.26} 0`} stroke={furche} strokeWidth={1.3} fill="none" />
      ) : null}
      {p.typ === 'praemolar' ? <path d={`M${-w * 0.2} 0L${w * 0.2} 0`} stroke={furche} strokeWidth={1.3} /> : null}
      {eintrag?.zahn === 'extraktion' ? (
        <path d={`M${-w * 0.22} ${-d * 0.22}L${w * 0.22} ${d * 0.22}M${w * 0.22} ${-d * 0.22}L${-w * 0.22} ${d * 0.22}`} stroke="#050505" strokeWidth={2.2} />
      ) : null}
      {eintrag?.klammer ? (
        <path d={`M${-w / 2 - 3} ${d * 0.05}Q0 ${d / 2 + 15} ${w / 2 + 3} ${d * 0.05}`} stroke="#f4f2ef" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      ) : null}
    </>
  );
}

function beschreibung(fdi: number, e?: ProthesenEintrag) {
  const teile: string[] = [];
  if (e?.zahn === 'ersatzzahn') teile.push('Ersatzzahn');
  if (e?.zahn === 'extraktion') teile.push('Extraktion');
  if (e?.klammer) teile.push('Klammer');
  if (e?.basis && !e.zahn) teile.push('Basis');
  return `Zahn ${fdi}: ${teile.length ? teile.join(', ') : 'nicht ausgewählt'}`;
}

/**
 * قوس فک بالا و پایین از بالا، برای Teilprothese (مرجع روش کار:
 * docs/referenz/sprintray/03). منطق در `lib/orders/prothese.ts` است.
 */
export function Kieferbogen({
  wert,
  onChange,
  readOnly = false,
}: {
  wert: ProthesenAuswahl;
  onChange?: (neu: ProthesenAuswahl) => void;
  readOnly?: boolean;
}) {
  const [aktiv, setAktiv] = useState<KieferbogenWerkzeug>('ersatzzahn');
  const plaetze = useMemo(() => [...layout(OK_BOGEN, OK_REIHE), ...layout(UK_BOGEN, UK_REIHE)], []);

  function onZahn(fdi: number) {
    if (readOnly) return;
    onChange?.(aktiv === 'entfernen' ? entfernen(wert, fdi) : anwenden(wert, fdi, aktiv));
  }

  const diagramm = (
    <div className="min-w-0">
      <div className="overflow-x-auto rounded-[12px] border border-panel-line bg-soft px-2 py-4 sm:px-6">
        {/* روی گوشی‌های باریک قوس اسکرول می‌شود تا دندان‌ها برای لمس کوچک نشوند */}
        <svg viewBox={`0 0 ${BREITE} ${HOEHE}`} className="mx-auto block h-auto w-full min-w-[480px] max-w-[520px]" role="group" aria-label="Ober- und Unterkiefer">
          {/* خطوط راهنمای قوس */}
          {[OK_BOGEN, UK_BOGEN].map((b, i) => (
            <g key={i} fill="none" stroke="rgba(244,242,239,0.12)" strokeWidth={1}>
              <path d={bogenPfad(b, 38)} />
              <path d={bogenPfad(b, -38)} />
            </g>
          ))}
          <text x={260} y={200} textAnchor="middle" fill="#a6a19d" fontSize={13}>
            Oberkiefer
          </text>
          <text x={260} y={408} textAnchor="middle" fill="#a6a19d" fontSize={13}>
            Unterkiefer
          </text>

          {/* Basis زیر دندان‌ها */}
          {plaetze.map((p) =>
            hatBasis(wert[p.fdi]) ? (
              <path key={`b${p.fdi}`} d={p.segment} stroke="rgba(177,132,122,0.5)" strokeWidth={72} fill="none" />
            ) : null,
          )}

          {plaetze.map((p) => {
            const e = wert[p.fdi];
            return (
              <g
                key={p.fdi}
                className={readOnly ? undefined : 'zahn-ziel'}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.winkel.toFixed(1)})`}
                role={readOnly ? 'img' : 'button'}
                tabIndex={readOnly ? undefined : 0}
                aria-pressed={readOnly ? undefined : Boolean(e)}
                aria-label={beschreibung(p.fdi, e)}
                onClick={() => onZahn(p.fdi)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onZahn(p.fdi);
                  }
                }}
              >
                {/* سطح کلیک بزرگ‌تر از خود دندان */}
                <rect x={-p.breite / 2 - 4} y={-p.tiefe / 2 - 6} width={p.breite + 8} height={p.tiefe + 12} fill="transparent" />
                <Zahnform p={p} eintrag={e} />
              </g>
            );
          })}

          {plaetze.map((p) => {
            const abstand = p.tiefe / 2 + 18;
            return (
              <text
                key={`n${p.fdi}`}
                x={rund(p.x + p.nx * abstand)}
                y={rund(p.y + p.ny * abstand + 4)}
                textAnchor="middle"
                fontSize={11}
                fill={wert[p.fdi] ? '#f4f2ef' : '#a6a19d'}
                aria-hidden
              >
                {p.fdi}
              </text>
            );
          })}
        </svg>
      </div>
      <AuswahlUebersicht zeilen={zusammenfassung(wert)} leerText="Sobald Sie Zähne markieren, erscheinen sie hier." />
    </div>
  );

  if (readOnly) return diagramm;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[200px_minmax(0,1fr)]">
      <Werkzeugleiste titel="Werkzeug" werkzeuge={WERKZEUGE} aktiv={aktiv} onWahl={setAktiv} />
      {diagramm}
    </div>
  );
}
