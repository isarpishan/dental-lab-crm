'use server';

import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { anfrageInfo, praxisSitzung, sitzungBeenden } from '@/lib/auth/sessions';

export async function portalAbmelden() {
  // حتی بدون پذیرش Vereinbarung، خروج همیشه ممکن است
  const s = await praxisSitzung();
  await sitzungBeenden('practice');
  if (s) await logAudit({ aktion: 'abmeldung', akteur: { kind: 'practice', id: s.user.id, label: s.user.name }, ip: (await anfrageInfo()).ip });
  redirect('/anmelden');
}
