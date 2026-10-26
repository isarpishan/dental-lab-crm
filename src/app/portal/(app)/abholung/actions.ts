'use server';

import { revalidatePath } from 'next/cache';
import { ausfuehren, type Ergebnis } from '@/lib/aktion';
import { bearbeiterPortal } from '@/lib/auth/bearbeiter';
import { anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';
import { tagKurz } from '@/lib/touren/plan';
import { abholungAnfordern, abholungZurueckziehen } from '@/lib/touren/vorgang';

/** «Abholung anfordern» im Portal. Die Ordination kommt immer aus der Sitzung (`bearbeiterPortal`). */
async function praxis() {
  const b = await bearbeiterPortal();
  if (!b) throw new AppError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
  return b;
}

const wert = (form: FormData, feld: string) => {
  const v = form.get(feld);
  return typeof v === 'string' ? v : '';
};

export async function anfordern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const r = await abholungAnfordern(await praxis(), { datum: wert(form, 'datum'), notiz: wert(form, 'notiz'), orderId: wert(form, 'auftrag') }, (await anfrageInfo()).ip);
    revalidatePath('/portal', 'layout');
    return {
      erfolg: r.geplant ? `Eingeplant: Wir kommen am ${tagKurz(r.geplant)}.` : 'Danke. Sobald wir die Abholung eingeplant haben, sehen Sie den Tag hier.',
    };
  });
}

export async function zurueckziehen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await abholungZurueckziehen(await praxis(), wert(form, 'id'), (await anfrageInfo()).ip);
    revalidatePath('/portal', 'layout');
    return null;
  });
}
