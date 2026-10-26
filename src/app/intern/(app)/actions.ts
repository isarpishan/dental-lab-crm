'use server';

import { redirect } from 'next/navigation';
import { logAudit } from '@/lib/audit';
import { aktuellerMitarbeiter, anfrageInfo, sitzungBeenden } from '@/lib/auth/sessions';

export async function abmelden() {
  const s = await aktuellerMitarbeiter();
  await sitzungBeenden('staff');
  if (s) await logAudit({ aktion: 'abmeldung', akteur: { kind: 'staff', id: s.user.id, label: s.user.name }, ip: (await anfrageInfo()).ip });
  redirect('/anmelden');
}
