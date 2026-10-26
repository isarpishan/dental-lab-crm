'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ausfuehren, type Ergebnis } from '@/lib/aktion';
import { anfrageInfo, praxisSitzung } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';
import { annehmen } from '@/lib/vereinbarung/annahme';

const eingabe = z.object({
  version: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  gelesen: z.literal('ja'),
});

/**
 * «Vereinbarung annehmen»: نشست (بدون شرط پذیرش؛ همین‌جا پذیرفته می‌شود) ← zod ← `annehmen` (نقش،
 * sha256، ثبت، ایمیل تأیید و logAudit) ← revalidate ← صفحهٔ اصلی پورتال.
 */
export async function vereinbarungAnnehmen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  const r = await ausfuehren(async () => {
    const s = await praxisSitzung();
    if (!s) throw new AppError('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    const d = eingabe.safeParse({ version: form.get('version'), sha256: form.get('sha256'), gelesen: form.get('gelesen') });
    if (!d.success) throw new AppError('Bitte bestätigen Sie, dass Sie die Vereinbarung gelesen haben und berechtigt sind, sie anzunehmen.');
    await annehmen(s, d.data, await anfrageInfo());
    revalidatePath('/portal', 'layout');
    return null;
  });
  if (r?.fehler) return r;
  redirect('/');
}
