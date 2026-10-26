'use client';

/**
 * پنجرهٔ روی صفحه (`<dialog>` با `showModal`): حاشیهٔ نازک، دکمهٔ «×» و کلیک روی زمینهٔ تیره می‌بندد. اول برای
 * «Materialien» ساخته شد؛ «Ausgaben» هم همین را دارد.
 */
export function Fenster({
  fenster,
  titel,
  breit = false,
  children,
}: {
  fenster: React.RefObject<HTMLDialogElement | null>;
  titel: string;
  /** breiter, z. B. Beleg und Formular nebeneinander (»Zu prüfen«) */
  breit?: boolean;
  children: React.ReactNode;
}) {
  return (
    <dialog
      ref={fenster}
      aria-label={titel}
      // Klick auf den dunklen Rand schließt das Fenster
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      className={`m-auto max-h-[min(90vh,900px)] ${breit ? 'w-[min(1180px,calc(100vw-32px))]' : 'w-[min(760px,calc(100vw-32px))]'} rounded-[12px] border border-panel-line bg-black p-0 text-white backdrop:bg-black/80`}
    >
      <div className="relative p-6 md:p-8">
        <button
          type="button"
          onClick={() => fenster.current?.close()}
          aria-label="Schließen"
          className="absolute right-3 top-3 grid size-11 place-items-center text-[22px] font-light text-muted transition-colors hover:text-white"
        >
          ×
        </button>
        {children}
      </div>
    </dialog>
  );
}
