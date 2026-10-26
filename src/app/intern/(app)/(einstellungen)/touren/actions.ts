'use server';

import { revalidatePath } from 'next/cache';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { bearbeiterIntern, type Bearbeiter } from '@/lib/auth/bearbeiter';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';
import { tagKurz } from '@/lib/touren/plan';
import { abgeholt, abholungEinplanen, praxisTourSetzen, praxisVerschieben, tourSpeichern, zustellen } from '@/lib/touren/vorgang';

/**
 * Touren (Spec فاز ۱، بخش I). «Zugestellt» و «Abgeholt»: راننده (فقط تور خودش) یا Büro.
 * بقیه فقط با `touren.bearbeiten`. الگو: نشست و نقش ← zod (در `lib/touren/vorgang.ts`) ← عملیات ← audit.
 */
async function mitTour<T extends object>(f: (b: Bearbeiter, ip: string | null) => Promise<T>): Promise<T | { fehler: string }> {
  const b = await bearbeiterIntern('touren.sehen');
  if (!b) return { fehler: 'Dafür fehlt Ihnen die Berechtigung.' };
  try {
    const r = await f(b, (await anfrageInfo()).ip);
    revalidatePath('/intern', 'layout');
    return r;
  } catch (e) {
    if (e instanceof AppError) return { fehler: e.message };
    throw e;
  }
}

export async function zugestellt(praxisId: string, orderIds: string[]): Promise<{ fehler?: string; anzahl?: number }> {
  return mitTour(async (b, ip) => ({ anzahl: await zustellen(b, praxisId, orderIds, ip) }));
}

export async function abgeholtMelden(id: string): Promise<{ fehler?: string }> {
  return mitTour(async (b, ip) => {
    await abgeholt(b, id, ip);
    return {};
  });
}

const wert = (form: FormData, feld: string) => {
  const v = form.get(feld);
  return typeof v === 'string' ? v : '';
};

export async function einplanen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await mitBerechtigung('touren.bearbeiten');
    const b = await bearbeiterIntern('touren.bearbeiten');
    if (!b) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
    await abholungEinplanen(b, wert(form, 'id'), wert(form, 'tour'), wert(form, 'datum'), (await anfrageInfo()).ip);
    revalidatePath('/intern', 'layout');
    return { erfolg: `Eingeplant für ${tagKurz(wert(form, 'datum'))}.` };
  });
}

function tourEingabe(form: FormData) {
  return {
    name: wert(form, 'name'),
    tage: form.getAll('tage').map(String),
    fahrerId: wert(form, 'fahrer'),
    aktiv: wert(form, 'aktiv') !== 'nein',
  };
}

export async function tourAnlegen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('touren.bearbeiten');
    const t = await tourSpeichern(null, tourEingabe(form));
    await logAudit({ aktion: 'tour_angelegt', akteur: akteurVon(user), ziel: { typ: 'tour', id: t.id }, details: t.neu, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `${t.name} angelegt. Jetzt Ordinationen hinzufügen.` };
  });
}

export async function tourAendern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('touren.bearbeiten');
    const id = wert(form, 'id');
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('Diese Tour gibt es nicht mehr.');
    const t = await tourSpeichern(id, tourEingabe(form));
    const diff = t.alt ? aenderungen(t.alt, t.neu) : {};
    if (Object.keys(diff).length) await logAudit({ aktion: 'tour_geaendert', akteur: akteurVon(user), ziel: { typ: 'tour', id }, details: diff, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: 'Gespeichert.' };
  });
}

/** Ordination in eine Tour aufnehmen, herausnehmen oder in der Reihenfolge verschieben. */
export async function route(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('touren.bearbeiten');
    const tourId = wert(form, 'tour');
    const praxisId = wert(form, 'praxis');
    if (![tourId, praxisId].every((v) => /^[0-9a-f-]{36}$/.test(v))) throw new AppError('Bitte eine Ordination wählen.');
    const was = wert(form, 'was');
    if (was === 'hinzu') await praxisTourSetzen(praxisId, tourId);
    else if (was === 'weg') await praxisTourSetzen(praxisId, null);
    else if (was === 'hoch' || was === 'runter') await praxisVerschieben(tourId, praxisId, was);
    else throw new AppError('Unbekannte Aktion.');
    if (was === 'hinzu' || was === 'weg') {
      await logAudit({ aktion: 'ordination_geaendert', akteur: akteurVon(user), ziel: { typ: 'practice', id: praxisId }, details: { tour: was === 'hinzu' ? tourId : null }, ip: (await anfrageInfo()).ip });
    }
    revalidatePath('/intern', 'layout');
    return null;
  });
}
