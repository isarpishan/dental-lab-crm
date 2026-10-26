'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import type { Ergebnis } from '@/lib/aktion';
import { bildHochladen } from './actions';

const BREITE = 480;
const HOEHE = 360;

/**
 * عکس در خود مرورگر ۴۸۰ × ۳۶۰ می‌شود، مثل عکس‌های کاشی سایت: کل موضوع دیده می‌شود (بدون بریدن)،
 * حاشیه سیاه. پس عکس ۱۰ مگابایتی گوشی هم فقط چند ده کیلوبایت فرستاده می‌شود. WebP، یا JPG اگر
 * مرورگر WebP نمی‌سازد.
 */
export async function bildVerkleinern(datei: File): Promise<File> {
  let quelle: ImageBitmap;
  try {
    quelle = await createImageBitmap(datei);
  } catch {
    throw new Error('Dieses Bild kann der Browser nicht öffnen. Bitte ein JPG, PNG oder WebP wählen.');
  }
  const leinwand = document.createElement('canvas');
  leinwand.width = BREITE;
  leinwand.height = HOEHE;
  const c = leinwand.getContext('2d');
  if (!c) throw new Error('Das Bild konnte nicht vorbereitet werden.');
  c.fillStyle = '#000';
  c.fillRect(0, 0, BREITE, HOEHE);
  const f = Math.min(BREITE / quelle.width, HOEHE / quelle.height);
  const [w, h] = [quelle.width * f, quelle.height * f];
  c.imageSmoothingQuality = 'high';
  c.drawImage(quelle, (BREITE - w) / 2, (HOEHE - h) / 2, w, h);
  quelle.close();
  const als = (typ: string, q: number) => new Promise<Blob | null>((fertig) => leinwand.toBlob(fertig, typ, q));
  let blob = await als('image/webp', 0.85);
  if (blob?.type !== 'image/webp') blob = await als('image/jpeg', 0.88);
  if (!blob) throw new Error('Das Bild konnte nicht vorbereitet werden.');
  return new File([blob], blob.type === 'image/webp' ? 'bild.webp' : 'bild.jpg', { type: blob.type });
}

const ANNEHMEN = 'image/jpeg,image/png,image/webp,image/heic';

function Vorschaubild({ src, klein = false }: { src: string | null; klein?: boolean }) {
  const groesse = klein ? 'h-9 w-12' : 'aspect-[4/3] w-full';
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- عکس کوچک کاشی
    <img src={src} alt="" width={BREITE} height={HOEHE} className={`${groesse} block shrink-0 bg-black object-contain`} />
  ) : (
    <span aria-hidden className={`${groesse} grid shrink-0 place-items-center border border-dashed border-line bg-soft text-[13px] text-muted`}>
      {klein ? '+' : 'Kein Bild'}
    </span>
  );
}

/**
 * فیلد عکس در «Neue Behandlung»: فایل کوچک‌شده جای فایل اصلی در همان `<input name="bild">` می‌نشیند،
 * پس فرم با `useFormAktion` معمولی فرستاده می‌شود. بعد از موفقیت، فرم با `key` تازه از نو ساخته می‌شود.
 */
export function BildFeld({ onBereit }: { onBereit: (bereit: boolean) => void }) {
  const eingabe = useRef<HTMLInputElement>(null);
  const [vorschau, setVorschau] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => () => void (vorschau && URL.revokeObjectURL(vorschau)), [vorschau]);

  async function gewaehlt(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    setFehler(null);
    if (!datei) return setVorschau(null);
    onBereit(false);
    try {
      const klein = await bildVerkleinern(datei);
      const dt = new DataTransfer();
      dt.items.add(klein);
      e.target.files = dt.files;
      setVorschau(URL.createObjectURL(klein));
    } catch (err) {
      e.target.value = '';
      setVorschau(null);
      setFehler((err as Error).message);
    } finally {
      onBereit(true);
    }
  }

  return (
    <div className="text-[15px]">
      <span id="bild-label">Bild</span>
      <div className="mt-[9px] grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] items-center gap-5">
        <Vorschaubild src={vorschau} />
        <div className="space-y-2">
          <button type="button" onClick={() => eingabe.current?.click()} className="border-b border-current pb-1 text-[15px] hover:text-rose-light">
            {vorschau ? 'Anderes Bild wählen' : 'Bild wählen'}
          </button>
          <p className="text-[13px] text-muted">Wie auf der Website: Motiv auf schwarzem Hintergrund. Wird auf 480 × 360 verkleinert, nichts wird abgeschnitten.</p>
        </div>
      </div>
      <input ref={eingabe} type="file" name="bild" accept={ANNEHMEN} aria-labelledby="bild-label" onChange={gewaehlt} className="sr-only" tabIndex={-1} />
      {fehler ? (
        <p role="alert" className="mt-3 text-[13px] text-rose-light">
          {fehler}
        </p>
      ) : null}
    </div>
  );
}

/**
 * عکس و «Bild ändern» در هر ردیف «Preise»؛ `children` تیک و نام Behandlung است. بیرون از فرم بزرگ ذخیره
 * می‌شود (فرم تو در تو ممکن نیست)، با همان `useActionState`؛ قیمت‌هایی که هنوز ذخیره نشده‌اند در فیلدها می‌مانند.
 */
export function BildAendern({ schluessel, name, bild, children }: { schluessel: string; name: string; bild: string | null; children: React.ReactNode }) {
  const eingabe = useRef<HTMLInputElement>(null);
  const [zustand, senden, laeuft] = useActionState<Ergebnis, FormData>(bildHochladen, null);
  const [vorbereiten, setVorbereiten] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const beschaeftigt = laeuft || vorbereiten;

  async function gewaehlt(e: React.ChangeEvent<HTMLInputElement>) {
    const datei = e.target.files?.[0];
    e.target.value = '';
    if (!datei) return;
    setFehler(null);
    setVorbereiten(true);
    try {
      const daten = new FormData();
      daten.set('key', schluessel);
      daten.set('bild', await bildVerkleinern(datei));
      startTransition(() => senden(daten));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setVorbereiten(false);
    }
  }

  const waehlen = () => eingabe.current?.click();
  const meldung = fehler ?? zustand?.fehler;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <button type="button" onClick={waehlen} disabled={beschaeftigt} tabIndex={-1} aria-hidden className="shrink-0 disabled:opacity-50">
          <Vorschaubild src={bild} klein />
        </button>
        <div className="min-w-0">
          {children}
          <button
            type="button"
            onClick={waehlen}
            disabled={beschaeftigt}
            aria-label={`Bild ${bild ? 'ändern' : 'hinzufügen'}: ${name}`}
            className="ml-8 mt-1 block border-b border-current text-[12px] leading-snug text-muted hover:text-white disabled:opacity-50"
          >
            {beschaeftigt ? 'Wird gespeichert …' : bild ? 'Bild ändern' : 'Bild hinzufügen'}
          </button>
        </div>
      </div>
      <input ref={eingabe} type="file" accept={ANNEHMEN} onChange={gewaehlt} className="sr-only" tabIndex={-1} aria-hidden />
      <span aria-live="polite" className="sr-only">
        {zustand?.erfolg ?? ''}
      </span>
      {meldung ? (
        <p role="alert" className="mt-2 text-[13px] text-rose-light">
          {meldung}
        </p>
      ) : null}
    </div>
  );
}
