import { asc, desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EinstellungenFormular } from '@/components/benachrichtigungen/EinstellungenFormular';
import { Meldung } from '@/components/ui/Formular';
import { ReiterLeiste } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { dentists, practices, practiceUsers, tours } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf, PRAXIS_ROLLEN_NAMEN } from '@/lib/auth/roles';
import { einstellungenVon } from '@/lib/benachrichtigungen/einstellungen';
import { datumZeit } from '@/lib/format';
import { annahmenVon } from '@/lib/vereinbarung/annahme';
import { konto } from '@/lib/abrechnung/daten';
import { centText } from '@/lib/abrechnung/geld';
import { saldoAus } from '@/lib/abrechnung/offen';
import { rechnungenVon } from '@/lib/abrechnung/rechnung';
import { VEREINBARUNG_VERSION } from '@/lib/vereinbarung/text';
import { benachrichtigungenSpeichern } from '../actions';
import { BehandlerNeu, BehandlerZeile, OrdinationFormular, ZugangAktionen, ZugangEinladen } from '../Formulare';

export const metadata: Metadata = { title: 'Ordination · Digital Dental Lab' };

function zugangStatus(u: typeof practiceUsers.$inferSelect) {
  if (!u.isActive) return { text: 'Deaktiviert', klasse: 'border-line text-muted' };
  if (!u.passwordHash) return { text: 'Eingeladen', klasse: 'border-rose text-rose' };
  return { text: 'Aktiv', klasse: 'border-line text-white' };
}

const TABS = ['stammdaten', 'behandler', 'konto', 'zugaenge', 'vereinbarung', 'benachrichtigungen'] as const;
type Tab = (typeof TABS)[number];
const TAB_NAMEN: Record<Tab, string> = {
  stammdaten: 'Stammdaten',
  behandler: 'Behandler',
  konto: 'Konto',
  zugaenge: 'Portal-Zugänge',
  vereinbarung: 'Vereinbarung',
  benachrichtigungen: 'Benachrichtigungen',
};
const HINWEIS = 'mb-8 max-w-[680px] text-[13px] text-muted';

/**
 * صفحهٔ یک Ordination. بخش‌ها تب‌اند (`?tab=`، مثل صفحهٔ هر سفارش)، نه زیر هم، تا لازم نباشد تا پایین
 * اسکرول شود (خواستهٔ کاربر، ۲۵ اکتبر ۲۰۲۶). تب «Konto» فقط برای نقش‌هایی که Abrechnung را می‌بینند.
 */
export default async function Ordination({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ neu?: string; tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'stammdaten.sehen')) {
    return <Seitenkopf eyebrow="Ordinationen" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  }
  const [{ id }, { neu, tab: t }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [p] = await db().select().from(practices).where(eq(practices.id, id)).limit(1);
  if (!p) notFound();

  const mitKonto = darf(user.role, 'abrechnung.sehen');
  const tabs = TABS.filter((x) => x !== 'konto' || mitKonto);
  const tab: Tab = tabs.includes(t as Tab) ? (t as Tab) : 'stammdaten';
  const bearbeitbar = darf(user.role, 'stammdaten.bearbeiten');

  const [behandler, zugaenge, touren, benachrichtigungen, annahmen] = await Promise.all([
    db().select().from(dentists).where(eq(dentists.practiceId, id)).orderBy(desc(dentists.isActive), asc(dentists.lastName)),
    db().select().from(practiceUsers).where(eq(practiceUsers.practiceId, id)).orderBy(asc(practiceUsers.createdAt)),
    tab === 'stammdaten' ? db().select({ id: tours.id, name: tours.name }).from(tours).where(eq(tours.isActive, true)).orderBy(asc(tours.name)) : [],
    tab === 'benachrichtigungen' ? einstellungenVon(id) : null,
    annahmenVon(id),
  ]);
  const aktuell = annahmen.find((a) => a.version === VEREINBARUNG_VERSION);
  const [kontoStand, rechnungen] = tab === 'konto' ? await Promise.all([konto(id), rechnungenVon(id)]) : [null, []];
  const saldo = saldoAus(rechnungen.flatMap((r) => (r.stand ? [{ stand: r.stand, faelligAm: r.faelligAm }] : [])));
  const aktiveBehandler = behandler.filter((b) => b.isActive).length;

  return (
    <>
      <Seitenkopf eyebrow={`Ordination · ${p.customerNo}${p.isDemo ? ' · Demo' : ''}`} titel={p.name} kompakt>
        {[p.street, [p.zip, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Noch keine Adresse.'}
        {!p.isActive ? ' · Deaktiviert: Portal gesperrt.' : ''}
        {p.isActive && darf(user.role, 'auftraege.anlegen') ? (
          <span className="mt-4 block">
            <Link href={`/auftraege/neu?ordination=${p.id}`} className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
              Neuer Auftrag für diese Ordination ↗
            </Link>
          </span>
        ) : null}
      </Seitenkopf>

      {neu ? (
        <div className="mb-10 max-w-[680px]">
          <Meldung art="erfolg">Die Ordination ist angelegt (Kundennummer {p.customerNo}). Fügen Sie jetzt Behandler und Portal-Zugänge hinzu.</Meldung>
        </div>
      ) : null}

      <ReiterLeiste
        label="Bereiche der Ordination"
        reiter={tabs.map((x) => ({
          key: x,
          href: `?tab=${x}`,
          aktiv: x === tab,
          inhalt: (
            <>
              {TAB_NAMEN[x]}
              {x === 'behandler' && aktiveBehandler ? <span className="ml-1.5 text-[13px] text-muted">({aktiveBehandler})</span> : null}
              {x === 'zugaenge' && zugaenge.length ? <span className="ml-1.5 text-[13px] text-muted">({zugaenge.length})</span> : null}
              {x === 'vereinbarung' && !aktuell ? <span className="ml-1.5 border border-rose px-1.5 text-[11px] text-rose">offen</span> : null}
            </>
          ),
        }))}
      />

      <section id={`bereich-${tab}`} aria-label={TAB_NAMEN[tab]} className="pt-8">
        {tab === 'stammdaten' ? (
          <>
            <p className={HINWEIS}>Adresse, Abrechnung und Voreinstellungen für Aufträge.</p>
            {bearbeitbar ? (
              <OrdinationFormular
                touren={touren}
                werte={{
                  id: p.id,
                  name: p.name,
                  street: p.street,
                  zip: p.zip,
                  city: p.city,
                  uidNumber: p.uidNumber,
                  phone: p.phone,
                  email: p.email,
                  billingEmail: p.billingEmail,
                  billingMode: p.billingMode,
                  defaultDeliveryKind: p.defaultDeliveryKind,
                  tourId: p.tourId,
                  deliveryNotes: p.deliveryNotes,
                  isActive: p.isActive,
                }}
              />
            ) : (
              <dl className="grid max-w-[680px] grid-cols-[180px_1fr] gap-y-3 text-[15px]">
                <dt className="text-muted">Telefon</dt>
                <dd>{p.phone ?? '–'}</dd>
                <dt className="text-muted">E-Mail</dt>
                <dd>{p.email ?? '–'}</dd>
                <dt className="text-muted">UID-Nummer</dt>
                <dd>{p.uidNumber ?? '–'}</dd>
                <dt className="text-muted">Abrechnung</dt>
                <dd>{p.billingMode === 'sammel' ? 'Sammelrechnung (monatlich)' : 'Einzelrechnung (pro Auftrag)'}</dd>
              </dl>
            )}
          </>
        ) : null}

        {tab === 'behandler' ? (
          <>
            <p className={HINWEIS}>Zahnärztinnen und Zahnärzte dieser Ordination. Sie werden im Auftrag als Behandler ausgewählt.</p>
            {behandler.length ? (
              <ul className="mb-10 border-t border-line" aria-label="Behandler">
                {behandler.map((b) => (
                  <BehandlerZeile key={b.id} b={b} bearbeitbar={bearbeitbar} />
                ))}
              </ul>
            ) : (
              <p className="mb-10 text-[15px] font-light text-muted">Noch keine Behandler.</p>
            )}
            {bearbeitbar ? <BehandlerNeu practiceId={p.id} /> : null}
          </>
        ) : null}

        {tab === 'konto' && kontoStand ? (
          <>
            <p className={HINWEIS}>Abrechnung mit dieser Ordination: was noch nicht verrechnet ist und was aus Rechnungen noch offen ist.</p>
            <p className="flex flex-wrap items-baseline gap-x-4 text-[15px]">
              <span className="text-[28px] font-light">{centText(kontoStand.cent)}</span>
              <span className="text-muted">noch nicht verrechnet</span>
              {kontoStand.ohnePreis ? <span className="text-rose">{kontoStand.ohnePreis} ohne Preis</span> : null}
            </p>
            {saldo.offenCent !== 0 ? (
              <p className="mt-3 flex flex-wrap items-baseline gap-x-4 text-[15px]">
                <span className="text-[28px] font-light">{centText(Math.abs(saldo.offenCent))}</span>
                <span className="text-muted">{saldo.offenCent > 0 ? 'offen aus Rechnungen' : 'Guthaben der Ordination'}</span>
                {saldo.ueberfaelligCent > 0 ? <span className="text-rose">davon {centText(saldo.ueberfaelligCent)} überfällig</span> : null}
              </p>
            ) : null}
            <Link href={`/abrechnung/${p.id}`} className="mt-6 inline-block border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
              Konto öffnen ↗
            </Link>
          </>
        ) : null}

        {tab === 'zugaenge' ? (
          <>
            <p className={HINWEIS}>Wer aus der Ordination Aufträge sendet und Designs freigibt. Jede Person bekommt eine E-Mail mit einem Link und legt ihr Passwort selbst fest.</p>
            {zugaenge.length ? (
              <ul className="mb-10 border-t border-line" aria-label="Portal-Zugänge">
                {zugaenge.map((u) => {
                  const s = zugangStatus(u);
                  return (
                    <li key={u.id} className="grid gap-x-8 gap-y-3 border-b border-line py-5 xl:grid-cols-[minmax(180px,1fr)_minmax(180px,0.8fr)_minmax(220px,1fr)] xl:items-center">
                      <div>
                        <p className="text-[18px] font-light">{u.name}</p>
                        <p className="text-[13px] text-muted">{u.email}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[13px]">
                        <span className={`border px-2.5 py-1 text-[11px] ${s.klasse}`}>{s.text}</span>
                        <span>{PRAXIS_ROLLEN_NAMEN[u.role]}</span>
                        <span className="text-muted">zuletzt: {datumZeit(u.lastLoginAt)}</span>
                      </div>
                      {bearbeitbar ? <ZugangAktionen id={u.id} aktiv={u.isActive} eingerichtet={Boolean(u.passwordHash)} /> : <span />}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mb-10 text-[15px] font-light text-muted">Noch keine Portal-Zugänge.</p>
            )}
            {bearbeitbar && p.isActive ? <ZugangEinladen practiceId={p.id} /> : null}
          </>
        ) : null}

        {tab === 'vereinbarung' ? (
          <>
            <p className={HINWEIS}>Datenschutz und Portalnutzung. Ein Praxis-Admin nimmt sie beim ersten Anmelden im Portal an; bis dahin ist das Portal für die Ordination gesperrt.</p>
            {!aktuell ? (
              <p className="mb-6 text-[15px] font-light text-muted">
                Version {VEREINBARUNG_VERSION} noch nicht angenommen{annahmen.length ? ' (ältere Fassung siehe unten)' : ''}. Portal-Zugänge funktionieren erst nach der Annahme.
              </p>
            ) : null}
            {annahmen.length ? (
              <ul className="border-t border-line" aria-label="Angenommene Vereinbarungen">
                {annahmen.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-line py-5">
                    <div>
                      <p className="text-[18px] font-light">
                        Version {a.version}
                        {a.version === VEREINBARUNG_VERSION ? '' : ' · nicht mehr aktuell'}
                      </p>
                      <p className="text-[13px] text-muted">
                        angenommen am {datumZeit(a.acceptedAt)} von {a.acceptedByName} ({a.acceptedByEmail})
                      </p>
                    </div>
                    <a href={`/api/vereinbarung/${a.id}`} target="_blank" rel="noopener" className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
                      PDF öffnen ↗
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {tab === 'benachrichtigungen' && benachrichtigungen ? (
          <>
            <p className={HINWEIS}>Welche E-Mails die aktiven Portal-Zugänge bekommen. Ein Praxis-Admin stellt das auch selbst im Portal ein.</p>
            <EinstellungenFormular werte={benachrichtigungen} aktion={benachrichtigungenSpeichern} bearbeitbar={bearbeitbar} practiceId={p.id} />
          </>
        ) : null}
      </section>

      <p className="mt-14 border-t border-line pt-8">
        <Link href="/ordinationen" className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
          Zurück zur Liste
        </Link>
      </p>
    </>
  );
}
