'use server';

import { revalidatePath } from 'next/cache';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import type { Bereich } from '@/lib/fixkosten/plan';
import { laufUeberspringen, vorlageAendern, vorlageAktivSetzen, vorlageAnlegen, vorlageLoeschen } from '@/lib/fixkosten/vorlagen';
import { monatTitel } from '@/lib/ausgaben/text';

/**
 * «Fixkosten» (Spec فاز ۵، قدم ۳): همان actionها برای DDL (`ausgaben.verwalten`) و Privat (`privat.verwalten`).
 * Bereich از فرم می‌آید ولی حق همان Bereich سنجیده می‌شود و Vorlage فقط در Bereich خودش پیدا می‌شود.
 */
const FELDER = ['art', 'titel', 'gegenpartei', 'kategorie', 'betrag', 'satz', 'rhythmus', 'ab', 'bis', 'notiz'] as const;
const felder = (form: FormData) => Object.fromEntries(FELDER.map((f) => [f, typeof form.get(f) === 'string' ? (form.get(f) as string) : '']));

async function mitBereich(form: FormData) {
  const bereich: Bereich = form.get('bereich') === 'privat' ? 'privat' : 'ddl';
  const { user } = await mitBerechtigung(bereich === 'privat' ? 'privat.verwalten' : 'ausgaben.verwalten');
  return { user, bereich, ip: (await anfrageInfo()).ip };
}

export async function fixkostenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user, bereich, ip } = await mitBereich(form);
    const id = form.get('vorlage');
    if (typeof id === 'string' && id) {
      const { vorher, nachher } = await vorlageAendern(id, felder(form), bereich);
      const { erstelltAm: _e, geaendertAm: _g, ...alt } = vorher;
      await logAudit({ aktion: 'fixkosten_geaendert', akteur: akteurVon(user), ziel: { typ: 'fixkosten', id }, details: { bereich, titel: nachher.titel, aenderungen: aenderungen(alt, nachher) }, ip });
      revalidatePath('/intern', 'layout');
      return { erfolg: `${nachher.titel} gespeichert. Gilt ab der nächsten Fälligkeit.`, id };
    }
    const v = await vorlageAnlegen(felder(form), bereich, user.name);
    await logAudit({
      aktion: 'fixkosten_angelegt',
      akteur: akteurVon(user),
      ziel: { typ: 'fixkosten', id: v.id },
      details: { bereich, titel: v.titel, art: v.art, betragCent: v.betragCent, rhythmus: v.rhythmus, ab: v.ab },
      ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: `${v.titel} angelegt.`, id: v.id };
  });
}

export async function fixkostenAktiv(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user, bereich, ip } = await mitBereich(form);
    const aktiv = form.get('aktiv') === 'ja';
    const v = await vorlageAktivSetzen(String(form.get('vorlage') ?? ''), aktiv, bereich);
    await logAudit({ aktion: aktiv ? 'fixkosten_fortgesetzt' : 'fixkosten_pausiert', akteur: akteurVon(user), ziel: { typ: 'fixkosten', id: v.id }, details: { bereich, titel: v.titel }, ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: aktiv ? `${v.titel} läuft wieder.` : `${v.titel} pausiert. Es wird nichts mehr gebucht, bis Sie fortsetzen.` };
  });
}

export async function fixkostenEntfernen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user, bereich, ip } = await mitBereich(form);
    const v = await vorlageLoeschen(String(form.get('vorlage') ?? ''), bereich);
    await logAudit({ aktion: 'fixkosten_geloescht', akteur: akteurVon(user), ziel: { typ: 'fixkosten', id: v.id }, details: { bereich, titel: v.titel }, ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `${v.titel} gelöscht.` };
  });
}

/** DDL »Zu prüfen«: diesen Monat nicht als Ausgabe buchen (z. B. Abo gekündigt, Rechnung kam nicht). */
export async function fixkostenUeberspringen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const l = await laufUeberspringen(String(form.get('lauf') ?? ''));
    await logAudit({
      aktion: 'fixkosten_uebersprungen',
      akteur: akteurVon(user),
      ziel: { typ: 'fixkosten', id: l.vorlageId },
      details: { titel: l.titel, periode: l.periode },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: `${l.titel} für ${monatTitel(l.periode)} übersprungen.` };
  });
}
