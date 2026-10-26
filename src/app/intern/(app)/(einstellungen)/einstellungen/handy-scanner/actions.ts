'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { zugangAnlegen, zugangEntfernen, zugangSperren } from '@/lib/ausgaben/scan-zugang';

/** «Einstellungen → Handy-Scanner». Der Schlüssel geht nur einmal an den Browser zurück und nie ins Protokoll. */
export type ZugangErgebnis = (Ergebnis & { schluessel?: string }) | null;

const nameSchema = z.object({ name: z.string().trim().min(1, 'Bitte einen Namen eingeben, z. B. »iPhone Isar«.').max(60, 'Der Name ist zu lang.') });

export async function scanZugangAnlegen(_: ZugangErgebnis, form: FormData): Promise<ZugangErgebnis> {
  let schluessel: string | undefined;
  const r = await ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const d = nameSchema.safeParse({ name: form.get('name') ?? '' });
    if (!d.success) return { fehler: d.error.issues[0]?.message ?? 'Ungültige Angaben.' };
    const neu = await zugangAnlegen(d.data.name, user.id);
    await logAudit({
      aktion: 'scan_zugang_angelegt',
      akteur: akteurVon(user),
      ziel: { typ: 'scan_zugang', id: neu.id },
      details: { name: d.data.name },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern/einstellungen/handy-scanner');
    schluessel = neu.schluessel;
    return { erfolg: `Zugang »${d.data.name}« angelegt.`, id: neu.id };
  });
  return r && schluessel ? { ...r, schluessel } : r;
}

export async function scanZugangSperren(id: string): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const d = z.string().uuid().safeParse(id);
    if (!d.success) return { fehler: 'Ungültiger Zugang.' };
    const weg = await zugangSperren(d.data);
    await logAudit({
      aktion: 'scan_zugang_gesperrt',
      akteur: akteurVon(user),
      ziel: { typ: 'scan_zugang', id: weg.id },
      details: { name: weg.name },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern/einstellungen/handy-scanner');
    return { erfolg: `Zugang »${weg.name}« gesperrt. Dieser Kurzbefehl kann nichts mehr hochladen.` };
  });
}

export async function scanZugangEntfernen(id: string): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    const d = z.string().uuid().safeParse(id);
    if (!d.success) return { fehler: 'Ungültiger Zugang.' };
    const weg = await zugangEntfernen(d.data);
    await logAudit({
      aktion: 'scan_zugang_entfernt',
      akteur: akteurVon(user),
      ziel: { typ: 'scan_zugang', id: weg.id },
      details: { name: weg.name },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern/einstellungen/handy-scanner');
    return { erfolg: `Zugang »${weg.name}« entfernt.` };
  });
}
