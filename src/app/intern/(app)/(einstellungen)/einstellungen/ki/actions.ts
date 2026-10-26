'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { kiVerbindungTesten } from '@/lib/ai-safe';
import { akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { kiLaden, kiSpeichern } from '@/lib/ki/einstellungen';
import { istKiModell, type KiModell } from '@/lib/ki/modelle';

/** «Einstellungen → KI» (nur Inhaber). Der Schlüssel kommt nie ins Protokoll, nur ob er neu ist. */
const schema = z.object({
  modell: z.custom<KiModell>(istKiModell, 'Bitte ein Modell wählen.'),
  schluessel: z.string().trim().max(400, 'Der Schlüssel ist zu lang.'),
});

async function pruefen(): Promise<string> {
  const ki = await kiLaden();
  if (!ki.schluessel) return 'Noch kein Schlüssel eingetragen.';
  return (await kiVerbindungTesten({ schluessel: ki.schluessel, modell: ki.modell })) ?? '';
}

export async function kiEinstellungenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('einstellungen.verwalten');
    const d = schema.safeParse({ modell: form.get('modell'), schluessel: form.get('schluessel') ?? '' });
    if (!d.success) return { fehler: d.error.issues[0]?.message ?? 'Ungültige Angaben.' };
    const neu = d.data.schluessel !== '';
    const alt = await kiLaden();
    await kiSpeichern({ modell: d.data.modell, schluessel: neu ? d.data.schluessel : undefined });
    await logAudit({
      aktion: 'ki_einstellungen_geaendert',
      akteur: akteurVon(user),
      ziel: { typ: 'einstellung', id: 'ki' },
      details: { modell: { von: alt.modell, zu: d.data.modell }, schluesselNeu: neu },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    const fehler = await pruefen();
    if (fehler) return { fehler: `Gespeichert, aber: ${fehler}` };
    return { erfolg: 'Gespeichert. Die Verbindung zu Anthropic funktioniert.' };
  });
}

export async function kiTesten(): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await mitBerechtigung('einstellungen.verwalten');
    const fehler = await pruefen();
    return fehler ? { fehler } : { erfolg: 'Die Verbindung zu Anthropic funktioniert.' };
  });
}

export async function kiSchluesselEntfernen(): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('einstellungen.verwalten');
    const alt = await kiLaden();
    if (!alt.schluessel) return { fehler: 'Es ist kein Schlüssel eingetragen.' };
    await kiSpeichern({ modell: alt.modell, schluessel: null });
    await logAudit({
      aktion: 'ki_einstellungen_geaendert',
      akteur: akteurVon(user),
      ziel: { typ: 'einstellung', id: 'ki' },
      details: { schluesselEntfernt: true },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: 'Schlüssel gelöscht. Belege werden nicht mehr automatisch gelesen.' };
  });
}
