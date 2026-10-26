'use server';

import { revalidatePath } from 'next/cache';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { ausgabeAendern, ausgabeAnlegen, ausgabeLoeschen } from '@/lib/ausgaben/ausgaben';
import { eingangLesen, eingangVerwerfen } from '@/lib/ausgaben/eingang';
import { centText } from '@/lib/abrechnung/geld';
import { umsatzOffen, umsatzZuordnen } from '@/lib/bank/auszuege';

/** «Ausgaben» (nur Inhaber). Der Beleg kommt danach über `api/ausgaben/[id]/beleg`. */
const FELDER = ['rechnungsdatum', 'bezahltAm', 'lieferant', 'rechnungsnummer', 'kategorie', 'beschreibung', 'netto', 'satz', 'mwst'] as const;

const felder = (form: FormData) => Object.fromEntries(FELDER.map((f) => [f, typeof form.get(f) === 'string' ? (form.get(f) as string) : '']));

export async function ausgabeSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const id = form.get('ausgabe');
    const ip = (await anfrageInfo()).ip;
    if (typeof id === 'string' && id) {
      const { vorher, nachher } = await ausgabeAendern(id, felder(form));
      const { erfasstAm: _e, geaendertAm: _g, ...alt } = vorher;
      await logAudit({
        aktion: 'ausgabe_geaendert',
        akteur: akteurVon(user),
        ziel: { typ: 'ausgabe', id },
        details: { lieferant: nachher.lieferant, aenderungen: aenderungen(alt, nachher) },
        ip,
      });
      revalidatePath('/intern', 'layout');
      return { erfolg: `Ausgabe ${nachher.lieferant} gespeichert.`, id };
    }
    const eingang = form.get('eingang');
    const lauf = form.get('lauf');
    // aus »Bank« (Spec فاز ۵، قدم ۴): erst prüfen, ob die Bankzeile noch frei ist, dann Ausgabe anlegen und verbinden
    const umsatz = form.get('umsatz');
    if (typeof umsatz === 'string' && umsatz) await umsatzOffen(umsatz, 'ausgabe');
    const a = await ausgabeAnlegen(
      felder(form),
      { id: user.id, label: user.name },
      typeof eingang === 'string' && eingang ? eingang : undefined,
      typeof lauf === 'string' && lauf ? lauf : undefined,
    );
    await logAudit({
      aktion: 'ausgabe_erfasst',
      akteur: akteurVon(user),
      ziel: { typ: 'ausgabe', id: a.id },
      details: {
        lieferant: a.lieferant,
        rechnungsnummer: a.rechnungsnummer,
        bezahltAm: a.bezahltAm,
        kategorie: a.kategorie,
        nettoCent: a.nettoCent,
        mwstCent: a.mwstCent,
        bruttoCent: a.bruttoCent,
        ausZuPruefen: Boolean(eingang),
        ausFixkosten: Boolean(lauf),
        ausBank: Boolean(umsatz),
      },
      ip,
    });
    if (typeof umsatz === 'string' && umsatz) {
      await umsatzZuordnen(umsatz, { aktion: 'ausgabe', expenseId: a.id, erstelltHier: true }, akteurVon(user), ip);
      await logAudit({ aktion: 'bank_zugeordnet', akteur: akteurVon(user), ziel: { typ: 'bank_umsatz', id: umsatz }, details: { aktion: 'ausgabe', expenseId: a.id, neu: true }, ip });
    }
    revalidatePath('/intern', 'layout');
    return { erfolg: `Ausgabe erfasst: ${a.lieferant}, ${centText(a.bruttoCent)}.`, id: a.id };
  });
}

export async function ausgabeEntfernen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const a = await ausgabeLoeschen(String(form.get('ausgabe') ?? ''), user.name);
    await logAudit({
      aktion: 'ausgabe_geloescht',
      akteur: akteurVon(user),
      ziel: { typ: 'ausgabe', id: a.id },
      details: { lieferant: a.lieferant, rechnungsnummer: a.rechnungsnummer, bruttoCent: a.bruttoCent, mitBeleg: Boolean(a.belegKey) },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Ausgabe ${a.lieferant} gelöscht.` };
  });
}

/** Beleg unter »Zu prüfen« noch einmal lesen lassen (z. B. nachdem der KI-Schlüssel eingetragen wurde). */
export async function eingangNeuLesen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await mitBerechtigung('ausgaben.verwalten');
    const r = await eingangLesen(String(form.get('eingang') ?? ''));
    revalidatePath('/intern', 'layout');
    return r.status === 'gelesen' && !r.fehler ? { erfolg: 'Gelesen. Bitte die Angaben prüfen.' } : { fehler: r.fehler ?? 'Nicht gelesen.' };
  });
}

/** Beleg unter »Zu prüfen« verwerfen: noch keine Ausgabe, daher werden Eintrag und Datei gelöscht. */
export async function eingangEntfernen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const e = await eingangVerwerfen(String(form.get('eingang') ?? ''));
    await logAudit({ aktion: 'beleg_verworfen', akteur: akteurVon(user), ziel: { typ: 'beleg_eingang', id: e.id }, details: { datei: e.belegName }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `${e.belegName} verworfen.` };
  });
}
