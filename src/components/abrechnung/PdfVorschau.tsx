'use client';

import { useRef, useState } from 'react';

/**
 * پیش‌نمایش یک سند PDF پیش از صدور (مثل بخش Vorschau در arkan-crm). iframe از همین آدرس
 * (`/api/abrechnung/vorschau`)، چون CSP صفحه‌ها فقط همین را اجازه می‌دهد. روی موبایل PDF داخل صفحه
 * درست نشان داده نمی‌شود؛ آن‌جا فقط «Vorschau als PDF öffnen».
 */
export function PdfVorschau({ src, titel, hinweis = 'Vorschau' }: { src: string; titel: string; hinweis?: string }) {
  const [geladen, setGeladen] = useState<string | null>(null);
  const laedt = geladen !== src;
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-[13px]">
        <span className="hidden text-muted md:inline" aria-live="polite">
          {laedt ? 'Vorschau wird aktualisiert …' : hinweis}
        </span>
        <a href={src} target="_blank" rel="noopener" className="border-b border-current pb-0.5 text-muted hover:text-white">
          <span className="md:hidden">Vorschau als PDF öffnen</span>
          <span className="max-md:hidden">Als PDF öffnen</span>
        </a>
      </figcaption>
      {/* «FitH»: Seite auf volle Breite, ohne Werkzeugleiste, wie ein Blatt Papier */}
      <iframe
        src={`${src}#view=FitH&toolbar=0&navpanes=0`}
        title={titel}
        onLoad={() => setGeladen(src)}
        className={`hidden aspect-[210/297] w-full border border-line bg-white transition-opacity duration-200 md:block ${laedt ? 'opacity-60' : ''}`}
      />
    </figure>
  );
}

/**
 * فرم(ها) و پیش‌نمایش زنده: هر تغییر در فرم‌های داخل این بخش، بعد از مکث کوتاه، پیش‌نمایش را با همان
 * مقدارها از نو می‌سازد، پیش از ذخیره یا صدور. `aktiv=false` (مثلاً بخش بسته): بدون پیش‌نمایش و بدون
 * درخواست.
 */
export function LiveVorschau({
  basis,
  titel,
  hinweis,
  aktiv = true,
  className,
  vorschauClassName,
  children,
}: {
  /** آدرس پیش‌نمایش بدون ورودی فرم، مثلاً `/api/abrechnung/vorschau?art=muster` */
  basis: string;
  titel: string;
  hinweis?: string;
  aktiv?: boolean;
  className?: string;
  vorschauClassName?: string;
  children: React.ReactNode;
}) {
  const bereich = useRef<HTMLDivElement>(null);
  const warten = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [src, setSrc] = useState(basis);
  const neu = () => {
    if (warten.current) clearTimeout(warten.current);
    warten.current = setTimeout(() => {
      const [pfad, suche = ''] = basis.split('?');
      const q = new URLSearchParams(suche);
      // Werte aus der Basis (z. B. art, rechnungId) bleiben, die Formularwerte kommen dazu
      for (const form of bereich.current?.querySelectorAll('form') ?? []) {
        for (const [k, v] of new FormData(form)) if (typeof v === 'string' && !q.has(k)) q.set(k, v.slice(0, 600));
      }
      setSrc(`${pfad}?${q}`);
    }, 450);
  };
  return (
    <div ref={bereich} onInput={neu} onChange={neu} onReset={neu} className={className}>
      <div className="min-w-0">{children}</div>
      {aktiv ? (
        <div className={vorschauClassName}>
          <PdfVorschau src={src} titel={titel} hinweis={hinweis} />
        </div>
      ) : null}
    </div>
  );
}
