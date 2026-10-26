'use server';

import { revalidatePath } from 'next/cache';
import { akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { aktuellerMitarbeiter, anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';
import { bestandAendern, chargeAnlegen, chargeAufgebraucht, fuellungSetzen, materialAktivSetzen, materialAnlegen, materialEinstellen } from '@/lib/produktion/material';
import { FUELLUNG_NAMEN } from '@/lib/produktion/material-text';

/**
 * «Materialien und Chargen». Charge erfassen und «aufgebraucht»: wer produziert oder Stammdaten pflegt
 * (Techniker öffnet eine neue Flasche). Material anlegen und ein-/ausblenden: nur Stammdaten.
 */
async function chargenRecht() {
  const s = await aktuellerMitarbeiter();
  if (!s) throw new AppError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  if (!darf(s.user.role, 'produktion.bearbeiten') && !darf(s.user.role, 'stammdaten.bearbeiten')) throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  return s;
}

const wert = (form: FormData, feld: string) => {
  const v = form.get(feld);
  return typeof v === 'string' ? v : '';
};

export async function chargeErfassen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await chargenRecht();
    const c = await chargeAnlegen({
      material: wert(form, 'material'),
      lotNo: wert(form, 'lot'),
      ablauf: wert(form, 'ablauf'),
      eingang: wert(form, 'eingang'),
      farbe: wert(form, 'farbe'),
      menge: wert(form, 'menge'),
    });
    await logAudit({
      aktion: 'charge_angelegt',
      akteur: akteurVon(user),
      ziel: { typ: 'charge', id: c.id },
      details: { material: c.material, lot: c.lotNo, ablauf: c.ablauf, farbe: c.farbe, menge: c.menge },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Charge ${c.lotNo}${c.farbe ? ` (${c.farbe})` : ''} für ${c.material} erfasst: ${c.menge}.` };
  });
}

export async function chargeUmschalten(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await chargenRecht();
    const aufgebraucht = wert(form, 'aufgebraucht') === 'ja';
    const l = await chargeAufgebraucht(wert(form, 'charge'), aufgebraucht);
    await logAudit({ aktion: 'charge_geaendert', akteur: akteurVon(user), ziel: { typ: 'charge', id: wert(form, 'charge') }, details: { material: l.material, lot: l.lotNo, aufgebraucht }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return null;
  });
}

/** «Flasche leer» (−1) oder gezählten Bestand eintragen. */
export async function bestandAktualisieren(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await chargenRecht();
    const art = wert(form, 'art') === 'eins' ? 'eins' : 'setzen';
    const l = await bestandAendern(wert(form, 'charge'), art, wert(form, 'bestand'));
    await logAudit({
      aktion: 'charge_bestand',
      akteur: akteurVon(user),
      ziel: { typ: 'charge', id: wert(form, 'charge') },
      details: { material: l.material, lot: l.lotNo, art, vorher: l.vorher, nachher: l.nachher },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: `LOT ${l.lotNo}: noch ${l.text}${l.nachher === 0 ? ' – aufgebraucht' : ''}.` };
  });
}

/** Füllstand der offenen Flasche: Voll, ¾, ½, ¼. */
export async function fuellungAktualisieren(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await chargenRecht();
    const l = await fuellungSetzen(wert(form, 'charge'), wert(form, 'viertel'));
    await logAudit({
      aktion: 'charge_bestand',
      akteur: akteurVon(user),
      ziel: { typ: 'charge', id: wert(form, 'charge') },
      details: { material: l.material, lot: l.lotNo, art: 'fuellung', vorher: l.vorher, nachher: l.nachher },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: `LOT ${l.lotNo}: offene Flasche ${FUELLUNG_NAMEN[l.nachher] === 'Voll' ? 'voll' : FUELLUNG_NAMEN[l.nachher]}.` };
  });
}

/** Einheit (Flasche/Kapsel) und Farben eines Materials: nur Stammdaten. */
export async function materialEinstellungen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('stammdaten.bearbeiten');
    const m = await materialEinstellen(wert(form, 'key'), { einheit: wert(form, 'einheit'), farben: wert(form, 'farben') });
    await logAudit({ aktion: 'material_geaendert', akteur: akteurVon(user), ziel: { typ: 'material', id: m.key }, details: { name: m.name, vorher: m.vorher, nachher: m.nachher }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: 'Gespeichert.' };
  });
}

export async function materialNeu(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('stammdaten.bearbeiten');
    const m = await materialAnlegen({
      hersteller: wert(form, 'hersteller'),
      name: wert(form, 'name'),
      fuer: form.getAll('fuer').filter((x): x is string => typeof x === 'string'),
      einheit: wert(form, 'einheit') || 'flasche',
      farben: wert(form, 'farben'),
    });
    await logAudit({ aktion: 'material_angelegt', akteur: akteurVon(user), ziel: { typ: 'material', id: m.key }, details: { name: m.name }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `${m.name} angelegt. Jetzt können Sie die erste Charge erfassen.` };
  });
}

export async function materialUmschalten(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('stammdaten.bearbeiten');
    const aktiv = wert(form, 'aktiv') === 'ja';
    const m = await materialAktivSetzen(wert(form, 'key'), aktiv);
    await logAudit({ aktion: 'material_geaendert', akteur: akteurVon(user), ziel: { typ: 'material', id: m.key }, details: { name: m.name, aktiv }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return null;
  });
}
