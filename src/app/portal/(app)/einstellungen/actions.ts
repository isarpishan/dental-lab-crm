'use server';

import { revalidatePath } from 'next/cache';
import { ausfuehren, type Ergebnis } from '@/lib/aktion';
import { anfrageInfo, aktuellerPraxisNutzer } from '@/lib/auth/sessions';
import { ausFormular, einstellungenSpeichern } from '@/lib/benachrichtigungen/einstellungen';
import { AppError } from '@/lib/errors';

/** «E-Mail-Benachrichtigungen» (Spec فاز ۱، بخش M): فقط Praxis-Admin، و فقط برای Ordination خودش (از نشست). */
export async function benachrichtigungenSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const s = await aktuellerPraxisNutzer();
    if (!s) throw new AppError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    if (s.user.role !== 'praxis_admin') throw new AppError('Diese Einstellung kann nur ein Praxis-Admin ändern.');
    const n = await einstellungenSpeichern(s.praxis.id, ausFormular(form), { kind: 'practice', id: s.user.id, label: s.user.name }, (await anfrageInfo()).ip);
    revalidatePath('/portal/einstellungen');
    return { erfolg: n ? 'Gespeichert.' : 'Keine Änderungen.' };
  });
}
