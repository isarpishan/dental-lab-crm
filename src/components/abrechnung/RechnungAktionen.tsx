'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Meldung } from '@/components/ui/Formular';
import { useFormAktion } from '@/components/ui/useFormAktion';
import { centEingabe, centText } from '@/lib/abrechnung/geld';
import { MAHNSTUFE_NAMEN, type Mahnstufe } from '@/lib/abrechnung/mahnwesen';
import type { Ergebnis } from '@/lib/aktion';
import { LiveVorschau } from './PdfVorschau';

type Aktion = (z: Ergebnis, f: FormData) => Promise<Ergebnis>;
const FELD = 'mt-1.5 w-full border border-line bg-transparent px-3 py-2.5 text-[15px] text-white outline-none transition-colors focus:border-rose';
const KLAPPE = 'open:basis-full';
const KOPF = 'cursor-pointer text-muted hover:text-white';
// مثل «Einstellungen»: فرم چپ، پیش‌نمایش راست (زیر xl زیر فرم)، فقط وقتی بخش باز است
const MIT_VORSCHAU = 'mt-4 grid gap-8 xl:grid-cols-[minmax(0,380px)_minmax(0,600px)] xl:gap-x-12 [&>div:last-child]:max-w-[620px]';
const vorschauVon = (q: Record<string, string>) => `/api/abrechnung/vorschau?${new URLSearchParams(q)}`;

function Rueckmeldung({ z }: { z: Ergebnis }) {
  if (z?.fehler) return <Meldung art="fehler">{z.fehler}</Meldung>;
  if (z?.erfolg) return <Meldung art="erfolg">{z.erfolg}</Meldung>;
  return null;
}

function SendenHaken({ an }: { an: string | null }) {
  if (!an) return null;
  return (
    <label className="flex items-start gap-3 text-[13px] text-muted">
      <input type="checkbox" name="senden" value="ja" defaultChecked className="mt-0.5 size-4 shrink-0 accent-rose" />
      <span>Per E-Mail an {an} senden</span>
    </label>
  );
}

/**
 * کارهای روی یک سند صادرشده (Spec فاز ۲، قدم‌های ۲ و ۳): «Zahlung buchen»، «Per E-Mail senden»،
 * «Stornieren» (Gutschrift برای کل مبلغ؛ سفارش‌ها دوباره باز می‌شوند) و «Gutschrift» با یک ردیف آزاد.
 * هر کدام جمع است و باز که شد کل عرض را می‌گیرد. Storno، Gutschrift و Mahnung کنار فرم پیش‌نمایش زندهٔ
 * PDF دارند، پیش از صدور.
 */
export function RechnungAktionen({
  rechnungId,
  nummer,
  istRechnung,
  stornierbar,
  gutschreibbar,
  offenCent,
  heute,
  an,
  stammdaten,
  gesendet,
  mahnStufe,
  aktionen,
}: {
  rechnungId: string;
  nummer: string;
  istRechnung: boolean;
  stornierbar: boolean;
  gutschreibbar: boolean;
  /** > 0: «Zahlung buchen» با همین مبلغ به‌عنوان پیش‌فرض */
  offenCent: number | null;
  heute: string;
  an: string | null;
  stammdaten: string;
  gesendet: boolean;
  /** مرحلهٔ Mahnung که الان رسیده (قدم ۴) */
  mahnStufe: Mahnstufe | null;
  aktionen: { gutschrift: Aktion; senden: Aktion; zahlung: Aktion; mahnen: Aktion };
}) {
  const [zahlung, sendenZahlung, laeuftZahlung] = useFormAktion(aktionen.zahlung, null, { zuruecksetzenBeiErfolg: true });
  const [versand, sendenVersand, laeuftVersand] = useFormAktion(aktionen.senden, null);
  const [storno, sendenStorno, laeuftStorno] = useFormAktion(aktionen.gutschrift, null);
  const [gut, sendenGut, laeuftGut] = useFormAktion(aktionen.gutschrift, null, { zuruecksetzenBeiErfolg: true });
  const [mahnung, sendenMahnung, laeuftMahnung] = useFormAktion(aktionen.mahnen, null);
  const [offen, setOffen] = useState<'mahnung' | 'storno' | 'gutschrift' | null>(null);
  const umschalten = (welche: NonNullable<typeof offen>) => (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const auf = e.currentTarget.open;
    setOffen((jetzt) => (auf ? welche : jetzt === welche ? null : jetzt));
  };
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-3 text-[13px]">
      {istRechnung && mahnStufe && offenCent != null && offenCent > 0 ? (
        <details className={KLAPPE} onToggle={umschalten('mahnung')}>
          <summary className="cursor-pointer text-rose hover:text-white">{MAHNSTUFE_NAMEN[mahnStufe]} senden</summary>
          <LiveVorschau basis={vorschauVon({ art: 'mahnung', rechnung: rechnungId })} titel={`Vorschau: ${MAHNSTUFE_NAMEN[mahnStufe]} zu ${nummer}`} aktiv={offen === 'mahnung'} className={MIT_VORSCHAU}>
            <form onSubmit={sendenMahnung} className="grid max-w-[460px] gap-4" aria-label={`${MAHNSTUFE_NAMEN[mahnStufe]} zu ${nummer}`}>
              <input type="hidden" name="rechnungId" value={rechnungId} />
              <p className="text-muted">
                Erstellt die {MAHNSTUFE_NAMEN[mahnStufe]} über {centText(offenCent)} als PDF
                {an ? ` und sendet sie mit der Rechnung an ${an}.` : '. Ohne E-Mail-Adresse wird nur das PDF erstellt, zum Ausdrucken.'}
              </p>
              <Rueckmeldung z={mahnung} />
              <div>
                <Button type="submit" variant="secondary" disabled={laeuftMahnung}>
                  {laeuftMahnung ? 'Wird erstellt …' : an ? 'Erstellen und senden' : 'Erstellen'}
                </Button>
              </div>
            </form>
          </LiveVorschau>
        </details>
      ) : null}
      {istRechnung && offenCent != null && offenCent > 0 ? (
        <details className={KLAPPE}>
          <summary className={KOPF}>Zahlung buchen</summary>
          <form onSubmit={sendenZahlung} className="mt-4 grid max-w-[460px] gap-4" aria-label={`Zahlung zu ${nummer}`}>
            <input type="hidden" name="rechnungId" value={rechnungId} />
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[13px] text-muted">
                Betrag (€)
                <input name="betrag" className={FELD} required inputMode="decimal" defaultValue={centEingabe(offenCent)} />
              </label>
              <label className="block text-[13px] text-muted">
                Eingegangen am
                <input name="am" type="date" className={FELD} required defaultValue={heute} max={heute} />
              </label>
            </div>
            <label className="block text-[13px] text-muted">
              Zahlungsart
              <select name="art" className={`${FELD} appearance-auto`} defaultValue="ueberweisung">
                <option value="ueberweisung">Überweisung</option>
                <option value="bar">Bar</option>
                <option value="karte">Karte</option>
                <option value="sonstige">Sonstige</option>
              </select>
            </label>
            <label className="block text-[13px] text-muted">
              Notiz
              <input name="notiz" className={FELD} maxLength={300} placeholder="Optional, z. B. Kontoauszug" />
            </label>
            <Rueckmeldung z={zahlung} />
            <div>
              <Button type="submit" variant="secondary" disabled={laeuftZahlung}>
                {laeuftZahlung ? 'Wird gebucht …' : 'Buchen'}
              </Button>
            </div>
          </form>
        </details>
      ) : null}

      <details className={KLAPPE}>
        <summary className={KOPF}>{gesendet ? 'Erneut senden' : 'Per E-Mail senden'}</summary>
        {an ? (
          <form onSubmit={sendenVersand} className="mt-4 grid max-w-[460px] gap-4" aria-label={`${nummer} per E-Mail senden`}>
            <input type="hidden" name="rechnungId" value={rechnungId} />
            <p className="text-muted">
              Sendet {nummer} als PDF an {an}.
            </p>
            <Rueckmeldung z={versand} />
            <div>
              <Button type="submit" variant="secondary" disabled={laeuftVersand}>
                {laeuftVersand ? 'Wird vorbereitet …' : 'Jetzt senden'}
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-4 max-w-[460px] text-muted">
            Für diese Ordination ist keine E-Mail-Adresse hinterlegt.{' '}
            <Link href={stammdaten} className="underline underline-offset-4 hover:text-white">
              In den Stammdaten eintragen
            </Link>
          </p>
        )}
      </details>

      {istRechnung && stornierbar ? (
        <details className={KLAPPE} onToggle={umschalten('storno')}>
          <summary className={KOPF}>Stornieren</summary>
          <LiveVorschau basis={vorschauVon({ art: 'gutschrift', rechnungId, storno: 'ja' })} titel={`Vorschau: Stornorechnung zu ${nummer}`} aktiv={offen === 'storno'} className={MIT_VORSCHAU}>
            <form onSubmit={sendenStorno} className="grid max-w-[460px] gap-4" aria-label={`${nummer} stornieren`}>
              <input type="hidden" name="rechnungId" value={rechnungId} />
              <input type="hidden" name="storno" value="ja" />
              <label className="block text-[13px] text-muted">
                Grund
                <input name="grund" className={FELD} required maxLength={300} placeholder="z. B. falsche Ordination" />
              </label>
              <p className="text-muted">Stellt eine Stornorechnung über den ganzen Betrag aus. Die Aufträge sind danach wieder offen und können neu verrechnet werden.</p>
              <SendenHaken an={an} />
              <Rueckmeldung z={storno} />
              <div>
                <Button type="submit" variant="secondary" disabled={laeuftStorno}>
                  {laeuftStorno ? 'Wird ausgestellt …' : 'Stornorechnung ausstellen'}
                </Button>
              </div>
            </form>
          </LiveVorschau>
        </details>
      ) : null}

      {istRechnung && gutschreibbar ? (
        <details className={KLAPPE} onToggle={umschalten('gutschrift')}>
          <summary className={KOPF}>Gutschrift</summary>
          <LiveVorschau basis={vorschauVon({ art: 'gutschrift', rechnungId })} titel={`Vorschau: Gutschrift zu ${nummer}`} aktiv={offen === 'gutschrift'} className={MIT_VORSCHAU}>
            <form onSubmit={sendenGut} className="grid max-w-[460px] gap-4" aria-label={`Gutschrift zu ${nummer}`}>
              <input type="hidden" name="rechnungId" value={rechnungId} />
              <label className="block text-[13px] text-muted">
                Bezeichnung
                <input name="bezeichnung" className={FELD} required maxLength={300} placeholder="z. B. Kulanz Farbanpassung" />
              </label>
              <label className="block text-[13px] text-muted">
                Betrag (€)
                <input name="betrag" className={FELD} required inputMode="decimal" placeholder="0,00" />
              </label>
              <label className="block text-[13px] text-muted">
                Grund
                <input name="grund" className={FELD} required maxLength={300} />
              </label>
              <SendenHaken an={an} />
              <Rueckmeldung z={gut} />
              <div>
                <Button type="submit" variant="secondary" disabled={laeuftGut}>
                  {laeuftGut ? 'Wird ausgestellt …' : 'Gutschrift ausstellen'}
                </Button>
              </div>
            </form>
          </LiveVorschau>
        </details>
      ) : null}
    </div>
  );
}

/** Zahlung اشتباه ثبت‌شده: با یک قدم تأیید، تا با یک کلیک پاک نشود. */
export function ZahlungLoeschen({ zahlungId, titel, aktion }: { zahlungId: string; titel: string; aktion: Aktion }) {
  const [z, senden, laeuft] = useFormAktion(aktion, null);
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-muted hover:text-white">Löschen</summary>
      <form onSubmit={senden} className="mt-3 grid gap-3" aria-label={`${titel} löschen`}>
        <input type="hidden" name="zahlungId" value={zahlungId} />
        <Rueckmeldung z={z} />
        <div>
          <Button type="submit" variant="secondary" disabled={laeuft}>
            {laeuft ? 'Wird gelöscht …' : 'Zahlung löschen'}
          </Button>
        </div>
      </form>
    </details>
  );
}

/** نامه‌ای که با ایمیل نرفته (بی‌آدرس یا خطا): دوباره بفرست. */
export function MahnungNochmal({ mahnungId, titel, aktion }: { mahnungId: string; titel: string; aktion: Aktion }) {
  const [z, senden, laeuft] = useFormAktion(aktion, null);
  return (
    <form onSubmit={senden} className="grid gap-2 text-[13px]" aria-label={`${titel} per E-Mail senden`}>
      <input type="hidden" name="mahnungId" value={mahnungId} />
      <Rueckmeldung z={z} />
      <div>
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird vorbereitet …' : 'Per E-Mail senden'}
        </Button>
      </div>
    </form>
  );
}
