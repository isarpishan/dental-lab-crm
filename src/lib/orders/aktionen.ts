import 'server-only';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';
import {
  auftragAbsenden,
  dateiEntfernen,
  entwurfSpeichern,
  entwurfVerwerfen,
  patientAnlegen,
  patientenSuchen,
  patientFestlegen,
} from './entwurf';
import { nachrichtSenden } from './nachrichten';
import type { EntwurfDaten } from './pruefung';
import { aenderungAnfordern, designSenden, feedbackGeben, freigeben } from './design';
import { auftragLoeschen } from './loeschen';
import { datenNachreichen, laborSchritt, lieferterminSetzen, rueckfrageStellen, stornieren } from './vorgang';
import { reklamationEntscheiden, reklamationMelden, reparaturErledigt } from '@/lib/reklamationen/vorgang';

/**
 * بدنهٔ server actionهای فرم «Neuer Auftrag»، یک بار برای پورتال و پنل داخلی. فایل‌های
 * `actions.ts` هر طرف فقط `holen` (نشست ← Bearbeiter) را می‌دهند و همین‌ها را صدا می‌زنند.
 * الگوی ثابت: نشست ← zod (داخل `entwurf.ts`) ← عملیات ← audit. خطای کاربر ← `{ fehler }`.
 */
async function sicher<T extends object>(f: () => Promise<T>): Promise<T | { fehler: string }> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof AppError) return { fehler: e.message };
    throw e;
  }
}

export function auftragsAktionen(holen: () => Promise<Bearbeiter | null>) {
  async function wer(): Promise<Bearbeiter> {
    const b = await holen();
    if (!b) throw new AppError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    return b;
  }
  const ip = async () => (await anfrageInfo()).ip;
  const text = (t: unknown) => (typeof t === 'string' ? t : '');

  return {
    suchen: (ordinationId: string | null, suche: string) =>
      sicher(async () => ({ treffer: await patientenSuchen(await wer(), { suche: text(suche), ordinationId, ip: await ip() }) })),
    anlegen: (ordinationId: string | null, eingabe: unknown) => sicher(async () => patientAnlegen(await wer(), { eingabe, ordinationId, ip: await ip() })),
    patientFestlegen: (ordinationId: string | null, entwurfId: string | null, patientId: string) =>
      sicher(async () => patientFestlegen(await wer(), { entwurfId, patientId: text(patientId), ordinationId })),
    speichern: (entwurfId: string, daten: EntwurfDaten) =>
      sicher(async () => {
        await entwurfSpeichern(await wer(), text(entwurfId), daten);
        return {};
      }),
    dateiEntfernen: (dateiId: string) =>
      sicher(async () => {
        await dateiEntfernen(await wer(), text(dateiId));
        return {};
      }),
    absenden: (entwurfId: string, daten: EntwurfDaten) =>
      sicher(async () => {
        const r = await auftragAbsenden(await wer(), { entwurfId: text(entwurfId), daten, ip: await ip() });
        return 'fehler' in r ? { schritte: r.fehler } : { orderId: r.orderId };
      }),
    verwerfen: (entwurfId: string) =>
      sicher(async () => {
        await entwurfVerwerfen(await wer(), text(entwurfId), await ip());
        return {};
      }),
    // ── gesendeter Auftrag (Schritt 6) ──
    nachricht: (orderId: string, daten: { text: string; dateiIds: string[]; intern: boolean }) =>
      sicher(async () => {
        await nachrichtSenden(await wer(), text(orderId), daten);
        return {};
      }),
    stornieren: (orderId: string, grund: string) =>
      sicher(async () => {
        await stornieren(await wer(), text(orderId), grund, await ip());
        return {};
      }),
    loeschen: (orderId: string) =>
      sicher(async () => {
        await auftragLoeschen(await wer(), text(orderId), await ip());
        return {};
      }),
    nachreichen: (orderId: string, antwort: string) =>
      sicher(async () => {
        await datenNachreichen(await wer(), text(orderId), antwort, await ip());
        return {};
      }),
    // ── Design-Freigabe (Schritt 7) ──
    designSenden: (orderId: string, notiz: string) =>
      sicher(async () => {
        await designSenden(await wer(), text(orderId), notiz, await ip());
        return {};
      }),
    freigeben: (orderId: string, daten: { revisionId: string; name: string; geprueft: boolean }) =>
      sicher(async () => freigeben(await wer(), text(orderId), daten, await ip())),
    aenderung: (orderId: string, revisionId: string, daten: { zaehne: number[]; arten: string[]; text: string; dateiIds: string[] }) =>
      sicher(async () => {
        await aenderungAnfordern(await wer(), text(orderId), revisionId, daten, await ip());
        return {};
      }),
    feedback: (orderId: string, daten: { bewertung: 'up' | 'down'; kommentar: string }) =>
      sicher(async () => {
        await feedbackGeben(await wer(), text(orderId), daten);
        return {};
      }),
    laborSchritt: (orderId: string, nach: string) =>
      sicher(async () => {
        await laborSchritt(await wer(), text(orderId), nach, await ip());
        return {};
      }),
    rueckfrage: (orderId: string, daten: { text: string; fehlend: string[] }) =>
      sicher(async () => {
        await rueckfrageStellen(await wer(), text(orderId), daten, await ip());
        return {};
      }),
    liefertermin: (orderId: string, datum: string) =>
      sicher(async () => {
        await lieferterminSetzen(await wer(), text(orderId), datum, await ip());
        return {};
      }),
    // ── Reklamation (Schritt 10) ──
    reklamation: (orderId: string, daten: ReklamationDaten) => sicher(async () => reklamationMelden(await wer(), text(orderId), daten, await ip())),
    reklamationEntscheiden: (id: string, daten: EntscheidungDaten) => sicher(async () => reklamationEntscheiden(await wer(), id, daten, await ip())),
    reparaturErledigt: (id: string) =>
      sicher(async () => {
        await reparaturErledigt(await wer(), id, await ip());
        return {};
      }),
  };
}

export type ReklamationDaten = { grund: string; zaehne: number[]; text: string; dateiIds: string[] };
export type EntscheidungDaten = { entscheidung: string; notiz: string; kostenlos: boolean };
