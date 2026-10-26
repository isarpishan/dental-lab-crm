'use client';

export type Werkzeug<T extends string> = { id: T; label: string; symbol: string; hinweis: string };

/**
 * ستون ابزار سمت چپ نمودار. ردیف‌های جداشده با خط، مثل `service-row` سایت.
 * ابزار فعال: متن سفید، نماد rose و یک خط rose در لبه.
 */
export function Werkzeugleiste<T extends string>({
  titel,
  werkzeuge,
  aktiv,
  onWahl,
}: {
  titel: string;
  werkzeuge: Werkzeug<T>[];
  aktiv: T;
  onWahl: (id: T) => void;
}) {
  const aktuell = werkzeuge.find((w) => w.id === aktiv);
  return (
    <div>
      <p className="eyebrow mb-3">{titel}</p>
      <ul className="border-t border-line" role="radiogroup" aria-label={titel}>
        {werkzeuge.map((w) => {
          const istAktiv = w.id === aktiv;
          return (
            <li key={w.id} className="border-b border-line">
              <button
                type="button"
                role="radio"
                aria-checked={istAktiv}
                onClick={() => onWahl(w.id)}
                className={`relative flex min-h-11 w-full items-center gap-3 py-2 pl-3 pr-2 text-left text-[15px] transition-colors duration-[180ms] ${
                  istAktiv ? 'text-white' : 'text-nav hover:text-white'
                }`}
              >
                <span aria-hidden className={`absolute inset-y-2 left-0 w-0.5 ${istAktiv ? 'bg-rose' : 'bg-transparent'}`} />
                <span
                  aria-hidden
                  className={`inline-grid h-6 min-w-6 place-items-center border px-1 text-[11px] font-medium ${
                    istAktiv ? 'border-rose text-rose' : 'border-line text-muted'
                  }`}
                >
                  {w.symbol}
                </span>
                {w.label}
              </button>
            </li>
          );
        })}
      </ul>
      {aktuell ? (
        <p className="mt-4 text-[13px] font-light leading-relaxed text-muted" aria-live="polite">
          {aktuell.hinweis}
        </p>
      ) : null}
    </div>
  );
}

/** «Auswahl-Übersicht»: همهٔ انتخاب‌ها به شکل متن، تا هیچ چیز فقط با شکل گفته نشود. */
export function AuswahlUebersicht({ zeilen, leerText }: { zeilen: string[]; leerText: string }) {
  return (
    <div className="mt-8 border-t border-line pt-5" aria-live="polite">
      <p className="eyebrow">Auswahl-Übersicht</p>
      {zeilen.length ? (
        <ul className="mt-3 space-y-1.5 text-[15px] font-light">
          {zeilen.map((z) => (
            <li key={z}>{z}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[15px] font-light text-muted">{leerText}</p>
      )}
    </div>
  );
}
