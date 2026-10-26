'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * علامت کوچک «i» کنار تیتر صفحه. توضیح صفحه با بردن موس روی آن باز و با بیرون‌رفتن موس بسته می‌شود؛
 * کلیک (یا لمس روی تبلت و موبایل) آن را باز نگه می‌دارد تا کلیک دوباره، کلیک بیرون یا Escape.
 * جعبه زیر تیتر و از لبهٔ چپ سرِ صفحه باز می‌شود (نزدیک‌ترین والد `relative`)، تا روی موبایل بیرون نزند.
 */
export function SeitenInfo({ children }: { children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  const [fest, setFest] = useState(false);
  const knopf = useRef<HTMLButtonElement>(null);
  const kasten = useRef<HTMLDivElement>(null);
  const zu = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const offen = hover || fest;

  useEffect(() => {
    if (!fest) return;
    const weg = (e: PointerEvent) => {
      const ziel = e.target as Node;
      if (!knopf.current?.contains(ziel) && !kasten.current?.contains(ziel)) setFest(false);
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFest(false);
        knopf.current?.focus();
      }
    };
    document.addEventListener('pointerdown', weg);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('pointerdown', weg);
      document.removeEventListener('keydown', taste);
    };
  }, [fest]);

  useEffect(() => () => {
    if (zu.current) clearTimeout(zu.current);
  }, []);

  // فقط موس واقعی: لمس روی تبلت وگرنه «enter» و «click» را با هم می‌فرستد و جعبه فوراً بسته می‌شود
  const rein = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (zu.current) clearTimeout(zu.current);
    setHover(true);
  };
  const raus = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    // مکث کوتاه: رفتن موس از علامت به جعبه (برای انتخاب متن) آن را نمی‌بندد
    zu.current = setTimeout(() => setHover(false), 150);
  };

  return (
    <>
      <button
        ref={knopf}
        type="button"
        aria-label="Erläuterung zu dieser Seite"
        aria-expanded={offen}
        aria-controls={id}
        onClick={() => {
          setFest((f) => !f);
          setHover(false);
        }}
        onPointerEnter={rein}
        onPointerLeave={raus}
        className={`ml-4 inline-flex size-[22px] translate-y-[-0.35em] items-center justify-center rounded-full border align-middle text-[12px] leading-none transition-colors duration-[180ms] max-[640px]:ml-3 ${
          offen ? 'border-rose text-rose-light' : 'border-line-strong text-muted hover:border-rose hover:text-rose-light'
        }`}
      >
        <span aria-hidden className="font-normal italic">
          i
        </span>
      </button>
      <div
        ref={kasten}
        id={id}
        role="note"
        hidden={!offen}
        onPointerEnter={rein}
        onPointerLeave={raus}
        className="absolute left-0 top-full z-30 mt-4 w-[min(600px,100%)] rounded-[12px] border border-panel-line bg-field px-5 py-4 text-[15px] font-light leading-relaxed text-paragraph"
      >
        {children}
      </div>
    </>
  );
}
