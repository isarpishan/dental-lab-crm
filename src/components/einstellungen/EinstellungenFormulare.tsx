'use client';

import { Button } from '@/components/ui/Button';
import { Feld, Meldung, Textfeld } from '@/components/ui/Formular';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';

type Aktion = (z: Ergebnis, f: FormData) => Promise<Ergebnis>;

function Rueckmeldung({ z }: { z: Ergebnis }) {
  if (z?.fehler) return <Meldung art="fehler">{z.fehler}</Meldung>;
  if (z?.erfolg) return <Meldung art="erfolg">{z.erfolg}</Meldung>;
  return null;
}

export type AusstellerWerte = { name: string; zusatz: string; strasse: string; plz: string; ort: string; land: string; telefon: string; email: string; web: string };
export type RechnungsWerte = { iban: string; bic: string; uid: string; zahlungszielTage: number; hinweis: string; fusstext: string };

/** صادرکنندهٔ اسناد و فاکتورها (Lieferschein، Konformitätserklärung، Rechnung، Vereinbarung). */
export function AusstellerFormular({ werte, aktion }: { werte: AusstellerWerte; aktion: Aktion }) {
  const [z, absenden, laeuft] = useFormAktion(aktion, null);
  return (
    <form onSubmit={absenden} className="grid max-w-[760px] gap-6" aria-label="Aussteller">
      <Feld label="Name" name="name" defaultValue={werte.name} required hinweis="So steht es als Aussteller und Hersteller auf allen Dokumenten." />
      <Feld label="Zusatz" name="zusatz" defaultValue={werte.zusatz} hinweis="Optional, z. B. die Bezeichnung des Betriebs." />
      <Feld label="Straße und Hausnummer" name="strasse" defaultValue={werte.strasse} required />
      <div className="grid gap-6 sm:grid-cols-[140px_1fr]">
        <Feld label="PLZ" name="plz" defaultValue={werte.plz} inputMode="numeric" />
        <Feld label="Ort" name="ort" defaultValue={werte.ort} required />
      </div>
      <Feld label="Land" name="land" defaultValue={werte.land} />
      <div className="grid gap-6 sm:grid-cols-2">
        <Feld label="Telefon" name="telefon" type="tel" defaultValue={werte.telefon} />
        <Feld label="E-Mail" name="email" type="email" defaultValue={werte.email} />
      </div>
      <Feld label="Website" name="web" defaultValue={werte.web} />
      <Rueckmeldung z={z} />
      <div>
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
      </div>
    </form>
  );
}

/** داده‌های فاکتور: پرداخت، UID، متن معافیت مالیاتی. */
export function RechnungsdatenFormular({ werte, aktion }: { werte: RechnungsWerte; aktion: Aktion }) {
  const [z, absenden, laeuft] = useFormAktion(aktion, null);
  return (
    <form onSubmit={absenden} className="grid max-w-[760px] gap-6" aria-label="Rechnungen">
      <Feld label="IBAN" name="iban" defaultValue={werte.iban} required autoComplete="off" />
      <div className="grid gap-6 sm:grid-cols-2">
        <Feld label="BIC" name="bic" defaultValue={werte.bic} autoComplete="off" hinweis="Optional." />
        <Feld label="UID-Nummer" name="uid" defaultValue={werte.uid} autoComplete="off" hinweis="Nur wenn vorhanden." />
      </div>
      <Feld label="Zahlungsziel (Tage)" name="zahlungszielTage" defaultValue={String(werte.zahlungszielTage)} inputMode="numeric" required />
      <Feld label="Hinweis zur Umsatzsteuer" name="hinweis" defaultValue={werte.hinweis} required hinweis="Steht auf jeder Rechnung unter dem Betrag." />
      <Textfeld label="Text am Ende der Rechnung" name="fusstext" defaultValue={werte.fusstext} rows={3} />
      <Rueckmeldung z={z} />
      <div>
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
      </div>
    </form>
  );
}

export type MahnWerte = { erinnerungTage: number; mahnung1Tage: number; mahnung2Tage: number; fristTage: number };

/** Mahnwesen: چند روز بعد از سررسید هر مرحله رسیده است، و چند روز مهلت تازه می‌دهد. */
export function MahnwesenFormular({ werte, aktion }: { werte: MahnWerte; aktion: Aktion }) {
  const [z, absenden, laeuft] = useFormAktion(aktion, null);
  return (
    <form onSubmit={absenden} className="grid max-w-[760px] gap-6" aria-label="Mahnwesen">
      <div className="grid gap-6 sm:grid-cols-3">
        <Feld label="Zahlungserinnerung nach" name="erinnerungTage" defaultValue={String(werte.erinnerungTage)} inputMode="numeric" required hinweis="Tage nach der Fälligkeit" />
        <Feld label="1. Mahnung nach" name="mahnung1Tage" defaultValue={String(werte.mahnung1Tage)} inputMode="numeric" required hinweis="Tage nach der Fälligkeit" />
        <Feld label="2. Mahnung nach" name="mahnung2Tage" defaultValue={String(werte.mahnung2Tage)} inputMode="numeric" required hinweis="Tage nach der Fälligkeit" />
      </div>
      <Feld label="Neue Frist (Tage)" name="fristTage" defaultValue={String(werte.fristTage)} inputMode="numeric" required hinweis="Bis wann nach jedem Schreiben bezahlt werden soll." />
      <Rueckmeldung z={z} />
      <div>
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : 'Speichern'}
        </Button>
      </div>
    </form>
  );
}
