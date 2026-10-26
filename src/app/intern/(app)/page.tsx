import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuftragsTabelle } from '@/components/auftrag/Listen';
import { MitAnzahl, ReiterBereich, ReiterLeiste, reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { dashboard } from '@/lib/orders/dashboard';
import { auftragsListe, filterAus } from '@/lib/orders/listen';
import { offeneAnfragen } from '@/lib/website/anfragen-daten';

export const metadata: Metadata = { title: 'Übersicht · Digital Dental Lab' };

/**
 * Übersicht als Dashboard (خواستهٔ کاربر، ۱ اکتبر ۲۰۲۶؛ Spec فاز ۱، بخش L): همه‌چیز در یک نگاه،
 * هر عدد لینک به فهرست همان کارها. بار تولید و «Nach Status» با div ساده (CLAUDE.md، قانون ۸).
 */
export default async function Uebersicht({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  // Fahrer: gleich die eigene Tour
  if (!darf(user.role, 'auftraege.sehen') && darf(user.role, 'touren.sehen')) redirect('/meine-tour');
  const vorname = user.name.split(' ')[0];
  const sehen = await bearbeiterIntern('auftraege.sehen');
  const anlegen = await bearbeiterIntern('auftraege.anlegen');
  const [zahlen, neueste, entwuerfe, anfragen] = await Promise.all([
    sehen ? dashboard(sehen) : null,
    sehen ? auftragsListe(sehen, { ...filterAus({}), status: 'offen', sortierung: 'neueste' }, null, 8) : null,
    anlegen ? auftragsListe(anlegen, { ...filterAus({}), status: 'entwurf' }, null, 10) : null,
    darf(user.role, 'stammdaten.bearbeiten') ? offeneAnfragen() : [],
  ]);
  const max = Math.max(1, ...(zahlen?.verteilung.map((v) => v.anzahl) ?? [1]));
  const maxProduktion = Math.max(1, ...(zahlen?.produktion.map((v) => v.anzahl) ?? [1]));

  const links = [
    { href: '/auftraege/neu', titel: 'Neuer Auftrag', text: 'Für eine Ordination erfassen, zum Beispiel telefonisch.', sichtbar: Boolean(anlegen) },
    { href: '/kalender', titel: 'Kalender', text: 'Liefertermine, Abholungen und Tourtage im Monat oder in der Woche.', sichtbar: darf(user.role, 'auftraege.sehen') },
    { href: '/touren', titel: 'Touren', text: 'Tagesplan, Abholwünsche, Routen und Fahrer.', sichtbar: darf(user.role, 'touren.bearbeiten') },
    { href: '/reklamationen', titel: 'Reklamationen', text: 'Gemeldete Mängel, Gewährleistung, Entscheidungen und Zahlen.', sichtbar: darf(user.role, 'auftraege.sehen') },
    { href: '/materialien', titel: 'Materialien', text: 'Resins und Chargen (LOT) für die Rückverfolgbarkeit.', sichtbar: darf(user.role, 'stammdaten.sehen') || darf(user.role, 'produktion.bearbeiten') },
    { href: '/ordinationen', titel: 'Ordinationen', text: 'Kunden, Behandler, Portal-Zugänge.', sichtbar: darf(user.role, 'stammdaten.sehen') },
    { href: '/preise', titel: 'Preise', text: 'Preise, Bearbeitungszeiten, Express- und Same-Day-Zuschlag.', sichtbar: darf(user.role, 'preise.bearbeiten') },
    { href: '/benutzer', titel: 'Benutzer', text: 'Mitarbeiter, Rollen, Zugänge.', sichtbar: darf(user.role, 'benutzer.verwalten') },
    { href: '/vorschau', titel: 'Vorschau Auftragsformular', text: 'Das Formular ausprobieren, ohne zu speichern.', sichtbar: true },
  ].filter((l) => l.sichtbar);

  // Bereiche als Tabs (Wunsch, 25.10.2026): die Zahlen oben bleiben immer sichtbar
  const TABS = [...(zahlen ? (['neueste', 'produktion', 'status'] as const) : []), ...(entwuerfe?.zeilen.length ? (['entwuerfe'] as const) : []), 'bereiche' as const];
  const tab = reiterWahl<string>((await searchParams).tab, TABS);
  const namen: Record<string, React.ReactNode> = {
    neueste: 'Neueste Aufträge',
    produktion: 'Produktion',
    status: 'Nach Status',
    entwuerfe: <MitAnzahl name="Entwürfe" anzahl={entwuerfe?.zeilen.length} />,
    bereiche: 'Bereiche',
  };

  return (
    <>
      <Seitenkopf eyebrow="01 / Übersicht" titel={`Guten Tag, ${vorname}.`}>
        {zahlen
          ? `Heute ${zahlen.heuteNeu === 1 ? 'ein neuer Auftrag' : `${zahlen.heuteNeu} neue Aufträge`} · ${zahlen.offenGesamt} offen insgesamt.`
          : 'Willkommen im System von Digital Dental Lab.'}
      </Seitenkopf>

      {anfragen.length ? (
        <Link
          href="/ordinationen#anfragen"
          className="group mb-12 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-y border-rose/60 py-6 transition-colors duration-[180ms] hover:bg-white/[0.02]"
        >
          <span>
            <span className="block text-[20px] font-light">{anfragen.length === 1 ? 'Neue Anfrage' : `${anfragen.length} neue Anfragen`} für das Praxisportal</span>
            <span className="mt-1 block text-[13px] text-muted">
              {anfragen
                .slice(0, 3)
                .map((a) => [a.vorname, a.nachname].filter(Boolean).join(' ') || a.email)
                .join(', ')}
              {anfragen.length > 3 ? ' …' : ''} · über das Kontaktformular der Website
            </span>
          </span>
          <span className="text-[15px] text-rose transition-transform duration-[180ms] group-hover:translate-x-1">Einladen ↗</span>
        </Link>
      ) : null}

      {zahlen ? (
        <>
          <section aria-label="Auf einen Blick" className="grid grid-cols-2 border-t border-line md:grid-cols-4">
            {zahlen.kacheln.map((k, i) => (
              <Link
                key={k.titel}
                href={k.href}
                className={`group border-b border-line px-0 py-7 pr-4 transition-colors duration-[180ms] hover:bg-white/[0.02] md:px-5 ${i % 4 === 0 ? 'md:pl-0' : 'md:border-l'} ${i % 2 === 1 ? 'border-l pl-4 md:pl-5' : ''}`}
              >
                <span className={`block text-[clamp(40px,4.4vw,60px)] font-light leading-none ${k.dringend && k.zahl ? 'text-rose' : k.zahl ? 'text-white' : 'text-muted'}`}>{k.zahl}</span>
                <span className="mt-3 block text-[16px] group-hover:text-white">{k.titel}</span>
                <span className="mt-1 block text-[13px] text-muted">{k.text}</span>
              </Link>
            ))}
          </section>
        </>
      ) : null}

      <div className={zahlen ? 'mt-12' : ''}>
        <ReiterLeiste label="Bereiche der Übersicht" reiter={TABS.map((x) => ({ key: x, href: `?tab=${x}`, aktiv: x === tab, inhalt: namen[x] }))} />
      </div>

      {zahlen ? (
        <>

          {tab === 'produktion' ? (
          <ReiterBereich titel="Produktion" hinweis="Wie viele Aufträge gerade in jedem Schritt sind, so wie sie in den Aufträgen weitergeschaltet wurden.">
            <ul className="space-y-2.5" aria-label="Aufträge je Schritt">
              {zahlen.produktion.map((v) => (
                <li key={v.key}>
                  <div className="grid grid-cols-[minmax(110px,170px)_minmax(0,1fr)_40px] items-center gap-4 text-[14px]">
                    <span className="truncate text-muted">{v.label}</span>
                    <span className="h-2 bg-white/[0.04]">
                      <span className={`block h-2 ${v.anzahl ? 'bg-white/70' : ''}`} style={{ width: `${(v.anzahl / maxProduktion) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{v.anzahl}</span>
                  </div>
                </li>
              ))}
            </ul>
          </ReiterBereich>
        ) : null}

          {tab === 'status' ? (
          <ReiterBereich titel="Nach Status" hinweis="Alle Aufträge außer Entwürfen.">
            <ul className="space-y-2.5">
              {zahlen.verteilung.map((v) => (
                <li key={v.key}>
                  <Link href={`/auftraege?status=${v.key}`} className="group grid grid-cols-[minmax(110px,170px)_minmax(0,1fr)_40px] items-center gap-4 text-[14px]">
                    <span className="truncate text-muted group-hover:text-white">{v.label}</span>
                    <span className="h-2 bg-white/[0.04]">
                      <span className={`block h-2 ${v.anzahl ? 'bg-white/70' : ''}`} style={{ width: `${(v.anzahl / max) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums">{v.anzahl}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </ReiterBereich>
        ) : null}

          {tab === 'neueste' ? (
          <ReiterBereich titel="Neueste Aufträge" hinweis="Offen, zuletzt eingegangen. Nur mit Patienten-ID.">
            <AuftragsTabelle zeilen={neueste?.zeilen ?? []} seite="labor" leer="Noch keine offenen Aufträge." />
            <p className="pt-6">
              <Link href="/auftraege" className="border-b border-current pb-1.5 text-[13px] text-muted hover:text-white">
                Alle Aufträge ↗
              </Link>
            </p>
          </ReiterBereich>
        ) : null}
        </>
      ) : null}

      {tab === 'entwuerfe' && entwuerfe?.zeilen.length ? (
        <ReiterBereich titel="Entwürfe" hinweis="Im Labor begonnen, noch nicht abgeschickt.">
          <AuftragsTabelle zeilen={entwuerfe.zeilen} seite="labor" leer="Keine Entwürfe." />
        </ReiterBereich>
      ) : null}

      {tab === 'bereiche' ? (
      <ReiterBereich titel="Bereiche">
        <ul className="border-t border-line">
          {links.map((l) => (
            <li key={l.href} className="border-b border-line">
              <Link href={l.href} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-1 py-4 md:grid-cols-[minmax(200px,0.8fr)_minmax(0,1fr)_auto]">
                <span className="text-[19px] font-light group-hover:text-white">{l.titel}</span>
                <span className="col-start-1 text-[14px] font-light text-muted md:col-start-auto">{l.text}</span>
                <span aria-hidden className="col-start-2 row-span-2 row-start-1 text-rose transition-transform duration-[180ms] group-hover:translate-x-1 md:col-start-auto md:row-span-1">
                  ↗
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </ReiterBereich>
    ) : null}
    </>
  );
}
