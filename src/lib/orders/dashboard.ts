import 'server-only';
import { and, count, eq, inArray, max, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { orders, orderStatusHistory, pickupRequests } from '@/db/schema';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { heuteIso, seitTagen } from '@/lib/format';
import { PORTAL_STATUS } from '@/lib/katalog/stammdaten';
import { produktionsBrett } from '@/lib/produktion/brett';
import { offeneReklamationen } from '@/lib/reklamationen/liste';
import { ABGESCHLOSSEN } from './fortschritt';
import { ungelesen } from './nachrichten';

/**
 * داشبورد Übersicht (Spec فاز ۱، بخش L؛ نسخهٔ اول به خواستهٔ کاربر، ۱ اکتبر ۲۰۲۶): هر عدد یک لینک
 * به فهرست همان کارهاست. از قدم ۱۰: «Heute fällig»، «Offene Reklamationen»، «Offene Abholungen»،
 * «In Übergabe»، «Warten auf Freigabe» با «seit X Tagen»، و بار تولید (تعداد در هر مرحلهٔ Kanban).
 */

export type Kachel = { titel: string; zahl: number; text: string; href: string; dringend: boolean };

const OFFEN_AUS = [...ABGESCHLOSSEN, 'entwurf', 'freigegeben'];

export async function dashboard(b: Bearbeiter) {
  const heute = heuteIso();
  const inDreiTagen = heuteIso(new Date(Date.now() + 2 * 86_400_000));
  // heute 00:00 in Wien
  const startHeute = sql`(date_trunc('day', now() at time zone 'Europe/Vienna') at time zone 'Europe/Vienna')`;

  const offen = sql`${orders.status} not in (${sql.join(
    OFFEN_AUS.map((s) => sql`${s}`),
    sql`, `,
  )})`;
  const termin = sql`coalesce(${orders.dueDate}, ${orders.desiredDate})`;

  const [jeStatus, [heuteNeu], eilig, [ueberfaellig], [heuteFaellig], [bald], offeneIds, abholungen, reklamationen, freigabeSeit, brett] = await Promise.all([
    db().select({ status: orders.status, anzahl: count() }).from(orders).where(ne(orders.status, 'entwurf')).groupBy(orders.status),
    db().select({ n: count() }).from(orders).where(and(ne(orders.status, 'entwurf'), sql`${orders.submittedAt} >= ${startHeute}`)),
    db().select({ tempo: orders.tempo, n: count() }).from(orders).where(and(inArray(orders.tempo, ['express', 'same_day']), offen)).groupBy(orders.tempo),
    db().select({ n: count() }).from(orders).where(and(offen, sql`${termin} < ${heute}`)),
    db().select({ n: count() }).from(orders).where(and(offen, sql`${termin} = ${heute}`)),
    db().select({ n: count() }).from(orders).where(and(offen, sql`${termin} >= ${heute}`, sql`${termin} <= ${inDreiTagen}`)),
    db().select({ id: orders.id }).from(orders).where(ne(orders.status, 'entwurf')),
    db().select({ status: pickupRequests.status, n: count() }).from(pickupRequests).where(inArray(pickupRequests.status, ['offen', 'eingeplant'])).groupBy(pickupRequests.status),
    offeneReklamationen(),
    // seit wann wartet jeder Auftrag in »Warten auf Freigabe« (letzter Eintritt)
    db()
      .select({ seit: max(orderStatusHistory.at) })
      .from(orderStatusHistory)
      .innerJoin(orders, eq(orders.id, orderStatusHistory.orderId))
      .where(and(eq(orders.status, 'design_freigabe'), eq(orderStatusHistory.status, 'design_freigabe')))
      .groupBy(orders.id),
    produktionsBrett(b, { suche: '', ordination: '', behandlung: '', tempo: '', meine: false }),
  ]);
  const neu = await ungelesen(b, offeneIds.map((o) => o.id));
  const anzahl = (...s: string[]) => jeStatus.filter((x) => s.includes(x.status)).reduce((a, x) => a + x.anzahl, 0);
  const abholungOffen = abholungen.find((a) => a.status === 'offen')?.n ?? 0;
  const abholungGeplant = abholungen.find((a) => a.status === 'eingeplant')?.n ?? 0;
  const sameDay = eilig.find((e) => e.tempo === 'same_day')?.n ?? 0;
  const express = eilig.find((e) => e.tempo === 'express')?.n ?? 0;
  const aeltesteFreigabe = freigabeSeit.flatMap((f) => (f.seit ? [f.seit] : [])).sort((a, b2) => a.getTime() - b2.getTime())[0];

  const kacheln: Kachel[] = [
    { titel: 'Neu eingegangen', zahl: anzahl('eingereicht'), text: 'Daten prüfen, Design beginnen', href: '/auftraege?status=eingereicht', dringend: true },
    { titel: 'Neue Nachrichten', zahl: neu.size, text: 'Aufträge mit ungelesener Nachricht', href: '/auftraege?status=aktion', dringend: true },
    { titel: 'Termin überfällig', zahl: ueberfaellig.n, text: 'Liefer- oder Wunschtermin vorbei', href: `/auftraege?status=faellig&bis=${heute}&sortierung=liefertermin`, dringend: true },
    { titel: 'Heute fällig', zahl: heuteFaellig.n, text: 'Liefer- oder Wunschtermin heute', href: `/auftraege?status=faellig&von=${heute}&bis=${heute}&sortierung=liefertermin`, dringend: true },
    { titel: 'Offene Reklamationen', zahl: reklamationen, text: 'Entscheiden oder Reparatur zurückgeben', href: '/reklamationen', dringend: true },
    {
      titel: 'Offene Abholungen',
      zahl: abholungOffen + abholungGeplant,
      text: abholungOffen ? `${abholungOffen} noch einzuplanen` : 'Alle eingeplant',
      href: '/touren',
      dringend: abholungOffen > 0,
    },
    { titel: 'Termin in 3 Tagen', zahl: bald.n, text: 'Liefer- oder Wunschtermin bald', href: `/auftraege?status=faellig&bis=${inDreiTagen}&sortierung=liefertermin`, dringend: false },
    { titel: 'Rückfrage offen', zahl: anzahl('rueckfrage'), text: 'Wartet auf die Ordination', href: '/auftraege?status=rueckfrage', dringend: false },
    { titel: 'In Planung', zahl: anzahl('in_planung', 'in_ueberarbeitung'), text: 'Design in Arbeit', href: '/auftraege?status=in_planung', dringend: false },
    {
      titel: 'Warten auf Freigabe',
      zahl: anzahl('design_freigabe'),
      text: aeltesteFreigabe ? `Die älteste ${seitTagen(aeltesteFreigabe)}` : 'Design bei der Ordination',
      href: '/auftraege?status=design_freigabe',
      dringend: false,
    },
    { titel: 'In Übergabe', zahl: anzahl('versendet'), text: 'Fertig, mit der nächsten Tour', href: '/auftraege?status=versendet', dringend: false },
    {
      titel: 'Express & Same-Day offen',
      zahl: express + sameDay,
      text: express + sameDay ? `${express} Express · ${sameDay} Same-Day` : 'Mit Zuschlag',
      href: '/auftraege?status=eilig',
      dringend: sameDay > 0,
    },
  ];
  const verteilung = PORTAL_STATUS.filter((s) => s.key !== 'entwurf').map((s) => ({ key: s.key, label: s.label, anzahl: anzahl(s.key) }));
  const produktion = brett.spalten.map((s) => ({ key: s.key, label: s.label, anzahl: s.karten.length }));
  const offenGesamt = jeStatus.filter((x) => !OFFEN_AUS.includes(x.status)).reduce((a, x) => a + x.anzahl, 0);
  return { kacheln, verteilung, produktion, heuteNeu: heuteNeu.n, offenGesamt };
}
