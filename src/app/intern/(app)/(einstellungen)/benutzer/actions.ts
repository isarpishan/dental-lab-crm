'use server';

import { and, eq, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db/client';
import { STAFF_ROLLEN, staffUsers } from '@/db/schema';
import { akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { einladungErstellen, einladungsLink, EINLADUNG_STUNDEN } from '@/lib/auth/einladung';
import { mitBerechtigung } from '@/lib/auth/guard';
import { ROLLEN_NAMEN } from '@/lib/auth/roles';
import { alleSitzungenBeenden, anfrageInfo } from '@/lib/auth/sessions';
import { emailEinreihen } from '@/lib/email';
import { einladungMail } from '@/lib/email/vorlagen';
import { AppError } from '@/lib/errors';

const EINLADBARE_ROLLEN = STAFF_ROLLEN.filter((r) => r !== 'inhaber');

const einladenSchema = z.object({
  name: z.string().trim().min(2, 'Bitte den Namen eingeben.').max(120),
  email: z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse eingeben.'),
  rolle: z.enum(EINLADBARE_ROLLEN as [string, ...string[]], { message: 'Bitte eine Rolle wählen.' }),
});

async function einladungSenden(user: { id: string; name: string; email: string; role: (typeof STAFF_ROLLEN)[number] }) {
  const token = await einladungErstellen('staff', user.id);
  const link = einladungsLink('staff', token);
  const mail = einladungMail({ name: user.name, rolle: ROLLEN_NAMEN[user.role], link, gueltigStunden: EINLADUNG_STUNDEN });
  await emailEinreihen({ an: user.email, betreff: mail.betreff, text: mail.text, html: mail.html });
  return link;
}

export async function mitarbeiterEinladen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('benutzer.verwalten');
    const r = einladenSchema.safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: r.error.issues[0].message };
    const rolle = r.data.rolle as (typeof STAFF_ROLLEN)[number];

    const [neu] = await db()
      .insert(staffUsers)
      .values({ name: r.data.name, email: r.data.email, role: rolle })
      .onConflictDoNothing({ target: staffUsers.email })
      .returning();
    if (!neu) return { fehler: 'Für diese E-Mail-Adresse gibt es bereits einen Zugang.' };

    const link = await einladungSenden(neu);
    await logAudit({ aktion: 'benutzer_eingeladen', akteur: akteurVon(ich), ziel: { typ: 'staff_user', id: neu.id }, details: { email: neu.email, rolle }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Einladung an ${neu.email} wurde verschickt.`, link };
  });
}

async function zielNutzer(id: string) {
  const [u] = await db().select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
  if (!u) throw new AppError('Diesen Benutzer gibt es nicht mehr.');
  return u;
}

async function weitererAktiverInhaber(ausser: string) {
  const [{ anzahl }] = await db()
    .select({ anzahl: sql<number>`count(*)::int` })
    .from(staffUsers)
    .where(and(eq(staffUsers.role, 'inhaber'), eq(staffUsers.isActive, true), ne(staffUsers.id, ausser)));
  return anzahl > 0;
}

export async function rolleAendern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('benutzer.verwalten');
    const r = z.object({ id: z.string().uuid(), rolle: z.enum(STAFF_ROLLEN) }).safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: 'Ungültige Angabe.' };
    const u = await zielNutzer(r.data.id);
    if (u.id === ich.id) return { fehler: 'Ihre eigene Rolle können Sie nicht ändern.' };
    if (u.role === 'inhaber' && r.data.rolle !== 'inhaber' && !(await weitererAktiverInhaber(u.id))) {
      return { fehler: 'Es muss mindestens ein aktiver Inhaber bleiben.' };
    }
    if (u.role === r.data.rolle) return null;
    await db().update(staffUsers).set({ role: r.data.rolle }).where(eq(staffUsers.id, u.id));
    await logAudit({ aktion: 'rolle_geaendert', akteur: akteurVon(ich), ziel: { typ: 'staff_user', id: u.id }, details: { von: u.role, zu: r.data.rolle }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Rolle von ${u.name}: ${ROLLEN_NAMEN[r.data.rolle]}.` };
  });
}

export async function aktivUmschalten(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('benutzer.verwalten');
    const r = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: 'Ungültige Angabe.' };
    const u = await zielNutzer(r.data.id);
    if (u.id === ich.id) return { fehler: 'Sie können sich nicht selbst deaktivieren.' };
    if (u.isActive && u.role === 'inhaber' && !(await weitererAktiverInhaber(u.id))) {
      return { fehler: 'Es muss mindestens ein aktiver Inhaber bleiben.' };
    }
    await db().update(staffUsers).set({ isActive: !u.isActive }).where(eq(staffUsers.id, u.id));
    if (u.isActive) await alleSitzungenBeenden('staff', u.id); // sofort abgemeldet
    await logAudit({
      aktion: u.isActive ? 'benutzer_deaktiviert' : 'benutzer_aktiviert',
      akteur: akteurVon(ich),
      ziel: { typ: 'staff_user', id: u.id },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    return { erfolg: u.isActive ? `${u.name} ist deaktiviert und wurde sofort abgemeldet.` : `${u.name} ist wieder aktiv.` };
  });
}

export async function einladungErneut(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('benutzer.verwalten');
    const r = z.object({ id: z.string().uuid() }).safeParse(Object.fromEntries(form));
    if (!r.success) return { fehler: 'Ungültige Angabe.' };
    const u = await zielNutzer(r.data.id);
    if (u.id === ich.id) return { fehler: 'Für Ihren eigenen Zugang: pnpm inhaber --neu' };
    // Zugang zurücksetzen: altes Passwort und alte App gelten nicht mehr
    await db().update(staffUsers).set({ passwordHash: null, totpEnabled: false, totpSecretEnc: null }).where(eq(staffUsers.id, u.id));
    await alleSitzungenBeenden('staff', u.id);
    const link = await einladungSenden(u);
    await logAudit({ aktion: 'einladung_erneuert', akteur: akteurVon(ich), ziel: { typ: 'staff_user', id: u.id }, ip: (await anfrageInfo()).ip });
    revalidatePath('/intern', 'layout');
    return { erfolg: `Neue Einladung an ${u.email} verschickt. Der alte Zugang gilt nicht mehr.`, link };
  });
}
