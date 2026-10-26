'use server';

import { revalidatePath } from 'next/cache';
import { akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { centLesen } from '@/lib/abrechnung/geld';
import { auszugEntfernen, auszugLesen, sichereUebernehmen, umsatzZuordnen, umsatzZuruecksetzen, vorschlagFuer, wahlAus, type Wahl } from '@/lib/bank/auszuege';
import { AppError } from '@/lib/errors';

/** «Bank» (Spec فاز ۵، قدم ۴؛ فقط Inhaber: حساب مخلوط شخصی و لابراتوار است). */

async function inhaber() {
  const { user } = await mitBerechtigung('ausgaben.verwalten');
  return { user, akteur: akteurVon(user), ip: (await anfrageInfo()).ip };
}

function wahlLesen(form: FormData): Wahl | 'vorschlag' {
  const f = (k: string) => (typeof form.get(k) === 'string' ? (form.get(k) as string) : '');
  switch (f('aktion')) {
    case 'vorschlag':
      return 'vorschlag';
    case 'rechnung': {
      const b = centLesen(f('betrag'));
      if (!b.ok || b.wert == null) throw new AppError('Bitte den Betrag angeben.');
      if (!f('rechnung')) throw new AppError('Bitte eine Rechnung wählen.');
      return { aktion: 'rechnung', rechnungId: f('rechnung'), betragCent: b.wert };
    }
    case 'ausgabe':
      if (!f('ausgabe')) throw new AppError('Bitte eine Ausgabe wählen.');
      return { aktion: 'ausgabe', expenseId: f('ausgabe') };
    case 'privat_neu':
      if (!f('kategorie')) throw new AppError('Bitte eine Kategorie wählen.');
      return { aktion: 'privat_neu', kategorie: f('kategorie') };
    case 'fixkosten':
      if (!f('lauf')) throw new AppError('Bitte die Fixkosten wählen.');
      return { aktion: 'fixkosten', laufId: f('lauf') };
    case 'fixkosten_neu': {
      const bereich = f('bereich');
      if (bereich !== 'ddl' && bereich !== 'privat') throw new AppError('Bitte Privat oder Labor wählen.');
      const roh = Object.fromEntries(['titel', 'gegenpartei', 'kategorie', 'betrag', 'satz', 'rhythmus', 'ab', 'bis', 'notiz'].map((k) => [k, f(k)]));
      return { aktion: 'fixkosten_neu', bereich, roh };
    }
    case 'ddl_offen':
      return { aktion: 'ddl_offen' };
    case 'ignorieren':
      return { aktion: 'ignorieren' };
    default:
      throw new AppError('Bitte eine Zuordnung wählen.');
  }
}

export async function bankZuordnen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { akteur, ip } = await inhaber();
    const id = String(form.get('umsatz') ?? '');
    let wahl = wahlLesen(form);
    if (wahl === 'vorschlag') {
      const v = await vorschlagFuer(id);
      if (!v) throw new AppError('Für diese Zeile gibt es keinen Vorschlag mehr. Bitte »Ändern …« wählen.');
      wahl = wahlAus(v);
    }
    const text = await umsatzZuordnen(id, wahl, akteur, ip);
    await logAudit({ aktion: 'bank_zugeordnet', akteur, ziel: { typ: 'bank_umsatz', id }, details: { ...wahl }, ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: text };
  });
}

export async function bankZuruecksetzen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { akteur, ip } = await inhaber();
    const u = await umsatzZuruecksetzen(String(form.get('umsatz') ?? ''), akteur, ip);
    await logAudit({ aktion: 'bank_zurueckgesetzt', akteur, ziel: { typ: 'bank_umsatz', id: u.id }, details: { zuordnung: u.zuordnung, betragCent: u.betragCent, buchungstag: u.buchungstag }, ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: 'Zuordnung aufgehoben. Die Zeile steht wieder unter »Zu klären«.' };
  });
}

export async function bankSichereUebernehmen(_: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { akteur, ip } = await inhaber();
    const r = await sichereUebernehmen(akteur, ip);
    await logAudit({ aktion: 'bank_zugeordnet', akteur, details: { sichereVorschlaege: r.n, fehler: r.fehler.length }, ip });
    revalidatePath('/intern', 'layout');
    if (r.fehler.length) return { fehler: `${r.n} übernommen. Nicht möglich: ${r.fehler.join(' · ')}` };
    return { erfolg: r.n === 1 ? 'Ein Vorschlag übernommen.' : `${r.n} Vorschläge übernommen.` };
  });
}

export async function bankAuszugNeuLesen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { akteur, ip } = await inhaber();
    const id = String(form.get('auszug') ?? '');
    const r = await auszugLesen(id);
    if (!r.ok) return { fehler: r.fehler };
    await logAudit({ aktion: 'bank_auszug_gelesen', akteur, ziel: { typ: 'bank_auszug', id }, details: { nummer: r.nummer, datum: r.datum, neu: r.neu, schonDa: r.schonDa }, ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Gelesen: ${r.neu} neue Zeilen${r.schonDa ? `, ${r.schonDa} schon vorhanden` : ''}.` };
  });
}

export async function bankAuszugEntfernen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { akteur, ip } = await inhaber();
    const a = await auszugEntfernen(String(form.get('auszug') ?? ''));
    await logAudit({ aktion: 'bank_auszug_entfernt', akteur, ziel: { typ: 'bank_auszug', id: a.id }, details: { datei: a.dateiName, nummer: a.auszugNummer }, ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `${a.dateiName} entfernt.` };
  });
}
