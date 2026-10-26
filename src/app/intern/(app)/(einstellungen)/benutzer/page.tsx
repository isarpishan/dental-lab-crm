import { asc } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { STAFF_ROLLEN, staffUsers } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf, ROLLEN_NAMEN } from '@/lib/auth/roles';
import { datumZeit } from '@/lib/format';
import { EinladenFormular, ZeilenAktionen } from './Formulare';

export const metadata: Metadata = { title: 'Benutzer · Digital Dental Lab' };

function status(u: typeof staffUsers.$inferSelect) {
  if (!u.isActive) return { text: 'Deaktiviert', klasse: 'border-line text-muted' };
  if (!u.passwordHash) return { text: 'Eingeladen', klasse: 'border-rose text-rose' };
  return { text: 'Aktiv', klasse: 'border-line text-white' };
}

export default async function Benutzer() {
  const { user: ich } = await mitarbeiterOderAnmelden();
  if (!darf(ich.role, 'benutzer.verwalten')) {
    return <Seitenkopf eyebrow="Benutzer" titel="Kein Zugriff.">Diese Seite ist dem Inhaber vorbehalten.</Seitenkopf>;
  }

  const alle = await db().select().from(staffUsers).orderBy(asc(staffUsers.createdAt));
  const rollen = STAFF_ROLLEN.map((r) => ({ wert: r, label: ROLLEN_NAMEN[r] }));
  const einladbar = rollen.filter((r) => r.wert !== 'inhaber');

  return (
    <>
      <Seitenkopf eyebrow="10 / Benutzer" titel="Benutzer." info="Wer im Labor mit dem System arbeitet. Neue Mitarbeiter bekommen eine E-Mail mit einem Link, legen ihr Passwort fest und verbinden eine Authenticator-App." />

      <ul className="border-t border-line" aria-label="Benutzer">
        {alle.map((u, i) => {
          const s = status(u);
          return (
            <li key={u.id} className="grid gap-x-8 gap-y-3 border-b border-line py-6 lg:grid-cols-[48px_minmax(200px,1fr)_minmax(200px,0.8fr)_minmax(260px,1.2fr)] lg:items-center">
              <span className="text-[11px] text-rose">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <p className="text-[23px] font-light">{u.name}</p>
                <p className="text-[15px] text-muted">{u.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <span className={`border px-2.5 py-1 text-[11px] ${s.klasse}`}>{s.text}</span>
                <span className="text-white">{ROLLEN_NAMEN[u.role]}</span>
                <span className="text-muted">zuletzt: {datumZeit(u.lastLoginAt)}</span>
              </div>
              <ZeilenAktionen id={u.id} rolle={u.role} aktiv={u.isActive} eingerichtet={Boolean(u.passwordHash)} ichSelbst={u.id === ich.id} rollen={rollen} />
            </li>
          );
        })}
      </ul>

      <section className="mt-20 border-t border-line pt-10" aria-labelledby="einladen">
        <span className="text-[11px] text-rose">+</span>
        <h2 id="einladen" className="mt-3 text-[clamp(23px,2.6vw,38px)] font-light">
          Mitarbeiter einladen
        </h2>
        <p className="mb-8 mt-3 max-w-[560px] text-[15px] font-light text-muted">
          Rollen: Büro (Ordinationen, Aufträge, Touren), Techniker (Produktion), Fahrer (nur Touren), Vertrieb, Nur lesen. Den Inhaber-Zugang vergibt nur das Einrichtungsskript.
        </p>
        <EinladenFormular rollen={einladbar} />
      </section>
    </>
  );
}
