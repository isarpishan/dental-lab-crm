/**
 * طرح‌های کارت‌های انتخابی، کشیدهٔ خودمان (docs/01-brand.md). هیچ تصویری از
 * سرویس دیگری کپی نشده است. لثه با ته‌رنگ rose، دندان‌ها warm white، و Klammer
 * به رنگ فلز (muted). همه در جعبهٔ ۲۰۰×۱۵۰.
 */

const LETHE = { fill: 'rgba(177,132,122,0.62)', stroke: 'rgba(208,178,160,0.9)', strokeWidth: 1.2 };
const ZAHN = { fill: '#f4f2ef', stroke: 'rgba(5,5,5,0.35)', strokeWidth: 1 };
const METALL = { stroke: '#dcd8d3', strokeWidth: 3, fill: 'none', strokeLinecap: 'round' as const };

function Molar({ x, y, s = 22, drehung = 0 }: { x: number; y: number; s?: number; drehung?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${drehung})`}>
      <rect x={-s / 2} y={-s / 2} width={s} height={s * 0.92} rx={s * 0.3} {...ZAHN} />
      <path
        d={`M${-s * 0.26} 0C${-s * 0.1} ${s * 0.06} ${s * 0.1} ${-s * 0.06} ${s * 0.26} 0`}
        stroke="rgba(5,5,5,0.4)"
        strokeWidth={1.1}
        fill="none"
      />
    </g>
  );
}

/** قوس فک بالا با زین‌های عقب در دو طرف؛ پایهٔ سه طرح بعدی. */
function Oberkiefer({ gaumen, klammern }: { gaumen: 'hufeisen' | 'vollstaendig'; klammern: boolean }) {
  const aussen = 'M40 132C30 74 58 24 100 24C142 24 170 74 160 132';
  return (
    <svg viewBox="22 14 156 124" aria-hidden className="h-full w-full">
      {gaumen === 'vollstaendig' ? (
        <path d={`${aussen}C130 120 70 120 40 132Z`} {...LETHE} />
      ) : (
        <path d={`${aussen}L138 132C144 86 128 50 100 50C72 50 56 86 62 132Z`} {...LETHE} />
      )}
      {/* لبهٔ جلو: جای دندان‌های طبیعی جلو */}
      <path d="M66 54C74 40 88 33 100 33C112 33 126 40 134 54" fill="none" stroke="rgba(208,178,160,0.8)" strokeWidth={1.2} strokeDasharray="2 3" />
      {[
        [50, 118, -8],
        [47, 97, -14],
        [52, 77, -24],
      ].map(([x, y, r]) => (
        <Molar key={`l${y}`} x={x} y={y} drehung={r} />
      ))}
      {[
        [150, 118, 8],
        [153, 97, 14],
        [148, 77, 24],
      ].map(([x, y, r]) => (
        <Molar key={`r${y}`} x={x} y={y} drehung={r} />
      ))}
      {klammern ? (
        <>
          {/* Klammer دور دندان طبیعیِ کنار زین (Eckzahn)، با خط‌چین برای دندان طبیعی */}
          <circle cx={60} cy={56} r={8} fill="none" stroke="rgba(244,242,239,0.45)" strokeDasharray="2 2" />
          <circle cx={140} cy={56} r={8} fill="none" stroke="rgba(244,242,239,0.45)" strokeDasharray="2 2" />
          <path d="M52 66C44 58 48 44 62 45C70 46 72 52 70 57" {...METALL} />
          <path d="M148 66C156 58 152 44 138 45C130 46 128 52 130 57" {...METALL} />
        </>
      ) : null}
    </svg>
  );
}

export function KlammerMit() {
  return <Oberkiefer gaumen="hufeisen" klammern />;
}

export function KlammerOhne() {
  return <Oberkiefer gaumen="hufeisen" klammern={false} />;
}

export function GaumenHufeisen() {
  return <Oberkiefer gaumen="hufeisen" klammern={false} />;
}

export function GaumenVollstaendig() {
  return <Oberkiefer gaumen="vollstaendig" klammern={false} />;
}

/** Flipper: پروتز کوچک جلو با دو دندان پیشین روی صفحهٔ نعل‌اسبی باریک. */
export function ProthesenformFlipper() {
  return (
    <svg viewBox="0 0 200 150" aria-hidden className="h-full w-full">
      <path d="M70 134C62 92 72 50 100 47C128 50 138 92 130 134L116 134C118 100 112 74 100 72C88 74 82 100 84 134Z" {...LETHE} />
      <g transform="translate(89 46) rotate(-10)">
        <rect x={-11} y={-9} width={22} height={18} rx={6} {...ZAHN} />
      </g>
      <g transform="translate(111 46) rotate(10)">
        <rect x={-11} y={-9} width={22} height={18} rx={6} {...ZAHN} />
      </g>
    </svg>
  );
}

/** Nesbit: پروتز کوچک یک‌طرفه با دو دندان و دو Klammer انعطاف‌پذیر در دو سر. */
export function ProthesenformNesbit() {
  return (
    <svg viewBox="0 0 200 150" aria-hidden className="h-full w-full">
      <g transform="rotate(-32 100 75)">
        <rect x={62} y={60} width={76} height={30} rx={13} {...LETHE} />
        <path d="M62 66C40 58 36 92 60 86" fill="none" stroke="rgba(208,178,160,0.9)" strokeWidth={6} strokeLinecap="round" />
        <path d="M138 66C160 58 164 92 140 86" fill="none" stroke="rgba(208,178,160,0.9)" strokeWidth={6} strokeLinecap="round" />
        <Molar x={86} y={75} s={24} />
        <Molar x={114} y={75} s={24} />
      </g>
    </svg>
  );
}

export const ILLUSTRATIONEN = {
  'prothesenform-flipper': ProthesenformFlipper,
  'prothesenform-nesbit': ProthesenformNesbit,
  'klammer-mit': KlammerMit,
  'klammer-ohne': KlammerOhne,
  'gaumen-hufeisen': GaumenHufeisen,
  'gaumen-vollstaendig': GaumenVollstaendig,
} as const;

export type IllustrationKey = keyof typeof ILLUSTRATIONEN;
