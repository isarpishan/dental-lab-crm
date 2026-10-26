'use server';

import { revalidatePath } from 'next/cache';
import { centText } from '@/lib/abrechnung/geld';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { privatAendern, privatAnlegen, privatLoeschen } from '@/lib/privat/buchungen';
import { PRIVAT_KATEGORIE_NAMEN } from '@/lib/privat/text';

/** «Privat» (Spec فاز ۵، قدم ۲؛ فقط Inhaber). Beleg بعد از ذخیره از `api/privat/[id]/beleg` می‌آید. */
const FELDER = ['art', 'datum', 'betrag', 'kategorie', 'haendler', 'notiz'] as const;
const felder = (form: FormData) => Object.fromEntries(FELDER.map((f) => [f, typeof form.get(f) === 'string' ? (form.get(f) as string) : '']));

export async function privatSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('privat.verwalten');
    const ip = (await anfrageInfo()).ip;
    const id = form.get('buchung');
    if (typeof id === 'string' && id) {
      const { vorher, nachher } = await privatAendern(id, felder(form));
      const { erfasstAm: _e, geaendertAm: _g, ...alt } = vorher;
      await logAudit({ aktion: 'privat_geaendert', akteur: akteurVon(user), ziel: { typ: 'privat_buchung', id }, details: { aenderungen: aenderungen(alt, nachher) }, ip });
      revalidatePath('/intern', 'layout');
      return { erfolg: 'Buchung gespeichert.', id };
    }
    const eingang = form.get('eingang');
    const b = await privatAnlegen(felder(form), { id: user.id, label: user.name }, typeof eingang === 'string' && eingang ? eingang : undefined);
    await logAudit({
      aktion: 'privat_erfasst',
      akteur: akteurVon(user),
      ziel: { typ: 'privat_buchung', id: b.id },
      details: { art: b.art, datum: b.datum, kategorie: b.kategorie, betragCent: b.betragCent, ausZuPruefen: Boolean(eingang) },
      ip,
    });
    revalidatePath('/intern', 'layout');
    const was = b.haendler ?? PRIVAT_KATEGORIE_NAMEN[b.kategorie];
    return { erfolg: `${b.art === 'einnahme' ? 'Einnahme' : 'Ausgabe'} erfasst: ${was}, ${centText(b.betragCent)}.`, id: b.id };
  });
}

export async function privatEntfernen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('privat.verwalten');
    const b = await privatLoeschen(String(form.get('buchung') ?? ''));
    await logAudit({
      aktion: 'privat_geloescht',
      akteur: akteurVon(user),
      ziel: { typ: 'privat_buchung', id: b.id },
      details: { art: b.art, datum: b.datum, betragCent: b.betragCent },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: 'Buchung gelöscht.' };
  });
}
