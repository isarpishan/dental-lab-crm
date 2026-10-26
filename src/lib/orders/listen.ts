import 'server-only';
import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '@/db/client';
import { orderFiles, orders, orderStatusHistory, patients, portalStatuses, practices, workTypes } from '@/db/schema';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { entschluesseln } from '@/lib/crypto';
import { istAblage, type Ablage } from '@/lib/dateien/regeln';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { isoDatumText } from '@/lib/format';
import { bildUrl } from '@/lib/katalog/auswahl';
import { istEilig, type Tempo } from '@/lib/katalog/tempo';
import { normalisieren, passt } from '@/lib/patienten/suche';
import { quelleVon, type DateiInfo } from './entwurf';
import { ABGESCHLOSSEN, AKTION_NOETIG, fortschritt, type Fortschritt } from './fortschritt';
import { ungelesen } from './nachrichten';
import { istStatus, type Status } from './status';

/**
 * فهرست‌های پورتال و پنل داخلی (Spec فاز ۱، بخش E). نام بیمار رمزگذاری شده است، پس
 * جست‌وجو بعد از رمزگشایی در حافظه انجام می‌شود؛ فقط ردیف‌هایی که نشان داده می‌شوند در
 * Data-Access-Log ثبت می‌شوند. در پنل داخلی نام بیمار نه نشان داده و نه جست‌وجو می‌شود.
 */

import { SORTIERUNGEN, type Sortierung } from './listen-text';

export type ListenFilter = {
  suche: string;
  behandlung: string;
  /** '' alle · 'aktion' · 'offen' · 'entwurf' · ein Status */
  status: string;
  sortierung: Sortierung;
  ordination: string;
  /** nur Aufträge eines Patienten (Patientenseite). */
  patient?: string;
  /** für »faellig«: Termin bis einschließlich (ISO-Datum). */
  bis?: string;
  /** für »faellig«: Termin ab einschließlich (»Heute fällig«: von = bis = heute). */
  von?: string;
};

export function filterAus(p: Record<string, string | string[] | undefined>): ListenFilter {
  const text = (k: string) => (typeof p[k] === 'string' ? (p[k] as string).slice(0, 80) : '');
  const sortierung = text('sortierung');
  return {
    suche: text('suche'),
    behandlung: text('behandlung'),
    status: text('status'),
    sortierung: sortierung in SORTIERUNGEN ? (sortierung as Sortierung) : 'geaendert',
    ordination: text('ordination'),
    bis: /^\d{4}-\d{2}-\d{2}$/.test(text('bis')) ? text('bis') : undefined,
    von: /^\d{4}-\d{2}-\d{2}$/.test(text('von')) ? text('von') : undefined,
  };
}

export type AuftragsZeile = {
  id: string;
  orderNo: string | null;
  status: Status;
  statusLabel: string;
  behandlung: { key: string; name: string; bild: string | null } | null;
  praxis: { id: string; name: string };
  patient: { id: string; code: string; name: string | null } | null;
  fortschritt: Fortschritt;
  termin: string | null;
  tempo: Tempo;
  /** «Ihre Aktion erforderlich»: Status, der Handeln verlangt, oder neue Nachricht. */
  aktion: boolean;
  /** der Status selbst verlangt Handeln dieser Seite (Ordination: Rückfrage, Freigabe, Einprobe; Labor: neu eingegangen). */
  statusAktion: boolean;
  ungelesen: number;
  geaendert: Date;
  eingereicht: Date | null;
};

/** آخرین وضعیت پیش از وضعیت فعلی (برای Rückfrage و Storno در نوار پیشرفت). */
export async function vorherigeStatus(orderIds: readonly string[]): Promise<Map<string, Status>> {
  if (!orderIds.length) return new Map();
  const zeilen = await db()
    .select({ orderId: orderStatusHistory.orderId, status: orderStatusHistory.status })
    .from(orderStatusHistory)
    .where(inArray(orderStatusHistory.orderId, [...orderIds]))
    .orderBy(asc(orderStatusHistory.at));
  const verlauf = new Map<string, string[]>();
  for (const z of zeilen) verlauf.set(z.orderId, [...(verlauf.get(z.orderId) ?? []), z.status]);
  const ergebnis = new Map<string, Status>();
  for (const [id, liste] of verlauf) {
    const letzter = liste.at(-1);
    const davor = [...liste].reverse().find((s) => s !== letzter && s !== 'rueckfrage');
    if (davor && istStatus(davor)) ergebnis.set(id, davor);
  }
  return ergebnis;
}

export function terminText(o: { dueDate: string | null; desiredDate: string | null }): string | null {
  if (o.dueDate) return `Liefertermin ${isoDatumText(o.dueDate)}`;
  if (o.desiredDate) return `Wunschtermin ${isoDatumText(o.desiredDate)}`;
  return null;
}

export async function auftragsListe(b: Bearbeiter, f: ListenFilter, ip: string | null, max = 100): Promise<{ zeilen: AuftragsZeile[]; aktion: number; gesamt: number }> {
  const bedingungen = [
    // Entwürfe nur von der eigenen Seite (siehe `auftragFuer`)
    or(ne(orders.status, 'entwurf'), eq(orders.source, quelleVon(b))),
  ];
  if (b.seite === 'praxis') bedingungen.push(eq(orders.practiceId, b.practiceId));
  else if (/^[0-9a-f-]{36}$/.test(f.ordination)) bedingungen.push(eq(orders.practiceId, f.ordination));
  if (f.behandlung) bedingungen.push(eq(orders.workTypeKey, f.behandlung));
  if (f.patient && /^[0-9a-f-]{36}$/.test(f.patient)) bedingungen.push(eq(orders.patientId, f.patient));

  const roh = await db()
    .select({
      o: orders,
      statusLabel: portalStatuses.label,
      wtName: workTypes.name,
      wtBild: workTypes.imageKey,
      freigabe: workTypes.needsFreigabe,
      praxisName: practices.name,
      p: { id: patients.id, code: patients.code, vorname: patients.firstNameEnc, nachname: patients.lastNameEnc },
    })
    .from(orders)
    .innerJoin(practices, eq(practices.id, orders.practiceId))
    .innerJoin(portalStatuses, eq(portalStatuses.key, orders.status))
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .leftJoin(patients, eq(patients.id, orders.patientId))
    .where(and(...bedingungen))
    .orderBy(desc(orders.updatedAt))
    .limit(2000);

  const ids = roh.map((r) => r.o.id);
  const [vorher, neu] = await Promise.all([vorherigeStatus(roh.filter((r) => r.o.status === 'rueckfrage' || r.o.status === 'storniert').map((r) => r.o.id)), ungelesen(b, ids)]);
  const mitNamen = b.seite === 'praxis';

  let zeilen = roh.map(({ o, statusLabel, wtName, wtBild, freigabe, praxisName, p }) => {
    const status = o.status as Status;
    const name = mitNamen && p?.vorname && p.nachname ? `${entschluesseln(p.vorname)} ${entschluesseln(p.nachname)}` : null;
    const offen = neu.get(o.id) ?? 0;
    return {
      id: o.id,
      orderNo: o.orderNo,
      status,
      statusLabel,
      behandlung: o.workTypeKey && wtName ? { key: o.workTypeKey, name: wtName, bild: bildUrl(wtBild) } : null,
      praxis: { id: o.practiceId, name: praxisName },
      patient: p?.id ? { id: p.id, code: p.code, name } : null,
      fortschritt: fortschritt(status, { lieferart: o.deliveryKind, freigabeNoetig: freigabe ?? true, einprobe: o.config.einprobe === true, vorher: vorher.get(o.id) }),
      termin: terminText(o),
      tempo: o.tempo ?? 'standard',
      // die Ordination muss handeln; im Labor: neue Nachricht der Ordination
      aktion: (b.seite === 'praxis' && AKTION_NOETIG.includes(status)) || offen > 0,
      statusAktion: b.seite === 'praxis' ? AKTION_NOETIG.includes(status) : status === 'eingereicht',
      ungelesen: offen,
      geaendert: o.updatedAt,
      eingereicht: o.submittedAt,
      _neueste: (o.submittedAt ?? o.createdAt).getTime(),
      _termin: o.dueDate ?? o.desiredDate,
    };
  });

  const aktion = zeilen.filter((z) => z.aktion && z.status !== 'entwurf').length;
  if (f.status === 'aktion') zeilen = zeilen.filter((z) => z.aktion && z.status !== 'entwurf');
  else if (f.status === 'offen') zeilen = zeilen.filter((z) => z.status !== 'entwurf' && !ABGESCHLOSSEN.includes(z.status));
  else if (f.status === 'produktion') zeilen = zeilen.filter((z) => z.status === 'in_produktion' || z.status === 'einprobe');
  // «eilig»: Express و Same-Day (کاشی داشبورد)
  else if (f.status === 'eilig') zeilen = zeilen.filter((z) => istEilig(z.tempo) && z.status !== 'entwurf' && !ABGESCHLOSSEN.includes(z.status) && z.status !== 'freigegeben');
  else if (f.status === 'faellig')
    zeilen = zeilen.filter(
      (z) => z._termin && z._termin <= f.bis! && (!f.von || z._termin >= f.von) && z.status !== 'entwurf' && !ABGESCHLOSSEN.includes(z.status) && z.status !== 'freigegeben',
    );
  else if (f.status) zeilen = zeilen.filter((z) => z.status === f.status);

  if (f.suche.trim()) {
    const s = normalisieren(f.suche);
    zeilen = zeilen.filter(
      (z) =>
        (z.patient && passt(f.suche, { vorname: z.patient.name ?? '', nachname: '', code: z.patient.code })) ||
        normalisieren(z.orderNo ?? '').includes(s) ||
        normalisieren(z.behandlung?.name ?? '').includes(s) ||
        (b.seite === 'labor' && normalisieren(z.praxis.name).includes(s)),
    );
  }

  if (f.sortierung === 'neueste') zeilen.sort((a, b2) => b2._neueste - a._neueste);
  else if (f.sortierung === 'liefertermin') zeilen.sort((a, b2) => (a._termin ?? '9999').localeCompare(b2._termin ?? '9999'));

  const gesamt = zeilen.length;
  const gezeigt = zeilen.slice(0, max).map(({ _neueste: _n, _termin: _t, ...z }) => z);
  const patientIds = [...new Set(gezeigt.flatMap((z) => (z.patient?.name ? [z.patient.id] : [])))];
  if (patientIds.length) await zugriffProtokollieren({ akteur: b, aktion: 'entschluesseln', patientIds, ip });
  return { zeilen: gezeigt, aktion, gesamt };
}

/* ── Patienten (nur Portal) ───────────────────────────────────── */

export type PatientenZeile = {
  id: string;
  code: string;
  name: string;
  kuerzel: string;
  geburtsdatum: string | null;
  behandlung: string | null;
  weitere: number;
  status: string | null;
  geaendert: Date;
  angelegt: Date;
};

export async function patientenListe(b: Extract<Bearbeiter, { seite: 'praxis' }>, suche: string, ip: string | null): Promise<PatientenZeile[]> {
  const [liste, auftraege] = await Promise.all([
    db().select().from(patients).where(eq(patients.practiceId, b.practiceId)),
    db()
      .select({ patientId: orders.patientId, status: orders.status, label: portalStatuses.label, name: workTypes.name, geaendert: orders.updatedAt })
      .from(orders)
      .innerJoin(portalStatuses, eq(portalStatuses.key, orders.status))
      .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .where(and(eq(orders.practiceId, b.practiceId), ne(orders.status, 'entwurf')))
      .orderBy(desc(orders.updatedAt)),
  ]);
  const zeilen = liste
    .map((p) => {
      const vorname = entschluesseln(p.firstNameEnc);
      const nachname = entschluesseln(p.lastNameEnc);
      const eigene = auftraege.filter((a) => a.patientId === p.id);
      const aktive = eigene.filter((a) => !ABGESCHLOSSEN.includes(a.status as Status));
      const juengste = eigene[0];
      return {
        id: p.id,
        code: p.code,
        name: `${vorname} ${nachname}`,
        vorname,
        nachname,
        kuerzel: `${vorname[0] ?? ''}${nachname[0] ?? ''}`.toUpperCase(),
        geburtsdatum: p.birthDateEnc ? isoDatumText(entschluesseln(p.birthDateEnc)) : null,
        behandlung: (aktive[0] ?? juengste)?.name ?? null,
        weitere: Math.max(0, aktive.length - 1),
        status: aktive[0]?.label ?? null,
        geaendert: new Date(Math.max(p.updatedAt.getTime(), juengste?.geaendert.getTime() ?? 0)),
        angelegt: p.createdAt,
      };
    })
    .filter((p) => passt(suche, p))
    .sort((a, b2) => b2.geaendert.getTime() - a.geaendert.getTime())
    .slice(0, 200)
    .map(({ vorname: _v, nachname: _n, ...p }) => p);
  if (zeilen.length) await zugriffProtokollieren({ akteur: b, aktion: 'entschluesseln', patientIds: zeilen.map((z) => z.id), ip });
  return zeilen;
}

/** همهٔ فایل‌هایی که Ordination برای یک بیمار فرستاده، در همهٔ سفارش‌ها («Alle Dateien des Patienten»). */
export async function dateienDesPatienten(b: Extract<Bearbeiter, { seite: 'praxis' }>, patientId: string) {
  const zeilen = await db()
    .select({ f: orderFiles, orderId: orders.id, orderNo: orders.orderNo, behandlung: workTypes.name })
    .from(orderFiles)
    .innerJoin(orders, eq(orders.id, orderFiles.orderId))
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .where(
      and(
        eq(orders.patientId, patientId),
        eq(orders.practiceId, b.practiceId),
        eq(orderFiles.origin, 'praxis'),
        isNull(orderFiles.deletedAt),
        or(ne(orders.status, 'entwurf'), eq(orders.source, 'portal')),
      ),
    )
    .orderBy(desc(orderFiles.createdAt));
  return zeilen.map((z) => ({
    datei: { id: z.f.id, platz: (z.f.slot && istAblage(z.f.slot) ? z.f.slot : 'sonstiges') as Ablage, name: entschluesseln(z.f.filenameEnc), groesse: z.f.size } satisfies DateiInfo,
    auftrag: { id: z.orderId, nr: z.orderNo, behandlung: z.behandlung },
    am: z.f.createdAt,
  }));
}
