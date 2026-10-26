'use server';

import { revalidatePath } from 'next/cache';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { steuerSpeichern } from '@/lib/steuer/einstellungen';
import { AppError } from '@/lib/errors';

const FELDER = ['gehalt', 'monate', 'beginn', 'svs', 'vorauszahlungen', 'schaetzung'] as const;

/** «Einstellungen → Steuer» (Spec فاز ۵، قدم ۵؛ فقط Inhaber). */
export async function steuerEinstellungenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const jahr = Number(form.get('jahr'));
    if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) throw new AppError('Ungültiges Jahr.');
    const roh = Object.fromEntries(FELDER.map((f) => [f, typeof form.get(f) === 'string' ? (form.get(f) as string) : '']));
    const { vorher, nachher } = await steuerSpeichern(jahr, roh);
    await logAudit({
      aktion: 'steuer_einstellungen_geaendert',
      akteur: akteurVon(user),
      details: { jahr, aenderungen: vorher ? aenderungen(vorher, nachher) : { neu: { von: null, zu: nachher } } },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Gespeichert. Die Vorschau für ${jahr} ist aktualisiert.` };
  });
}
