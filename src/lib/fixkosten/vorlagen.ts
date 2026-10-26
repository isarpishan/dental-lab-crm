import 'server-only';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { fixkostenLaeufe, fixkostenVorlagen } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { heuteIso } from '@/lib/format';
import type { PrivatArt } from '@/lib/privat/text';
import { fixkostenAusfuehren } from './lauf';
import { naechsteFaelligkeit, proMonatCent, vorlagePruefen, type Bereich, type VorlageWerte } from './plan';
import type { LaufStatus, Rhythmus } from './text';

/** «Fixkosten» (Spec فاز ۵، قدم ۳؛ فقط Inhaber): Vorlageها، و اجراهای باز DDL برای «Zu prüfen». */

function werte(roh: Record<string, string>, bereich: Bereich): VorlageWerte {
  const r = vorlagePruefen(roh, bereich);
  if (!r.ok) throw new AppError(r.fehler);
  return r.werte;
}

/** پیش از خواندن دادهٔ پول: سررسیدهای تا امروز را بساز (برای Privat همان Buchung). */
export const fixkostenNachziehen = () => fixkostenAusfuehren(heuteIso());

export async function vorlageAnlegen(roh: Record<string, string>, bereich: Bereich, label: string) {
  const [v] = await db()
    .insert(fixkostenVorlagen)
    .values({ ...werte(roh, bereich), erstelltVonLabel: label })
    .returning();
  await fixkostenNachziehen();
  return v;
}

async function laden(id: string, bereich: Bereich) {
  const [v] = await db()
    .select()
    .from(fixkostenVorlagen)
    .where(and(eq(fixkostenVorlagen.id, id), eq(fixkostenVorlagen.bereich, bereich)))
    .limit(1);
  if (!v) throw new AppError('Diese Fixkosten gibt es nicht mehr.');
  return v;
}

/** Änderungen gelten für künftige Fälligkeiten; schon Gebuchtes bleibt, wie es ist. */
export async function vorlageAendern(id: string, roh: Record<string, string>, bereich: Bereich) {
  const vorher = await laden(id, bereich);
  const [nachher] = await db()
    .update(fixkostenVorlagen)
    .set({ ...werte(roh, bereich), geaendertAm: new Date() })
    .where(eq(fixkostenVorlagen.id, id))
    .returning();
  await fixkostenNachziehen();
  return { vorher, nachher };
}

export async function vorlageAktivSetzen(id: string, aktiv: boolean, bereich: Bereich) {
  await laden(id, bereich);
  const [v] = await db().update(fixkostenVorlagen).set({ aktiv, geaendertAm: new Date() }).where(eq(fixkostenVorlagen.id, id)).returning();
  if (aktiv) await fixkostenNachziehen();
  return v;
}

/** Löschen nur, solange noch nichts fällig war (ein Versehen); sonst pausieren. */
export async function vorlageLoeschen(id: string, bereich: Bereich) {
  const v = await laden(id, bereich);
  const [{ n }] = await db().select({ n: count() }).from(fixkostenLaeufe).where(eq(fixkostenLaeufe.vorlageId, id));
  if (n > 0) throw new AppError('Diese Fixkosten waren schon fällig und bleiben deshalb in der Liste. Zum Beenden »Pausieren« wählen oder »Endet am« setzen.');
  await db().delete(fixkostenVorlagen).where(eq(fixkostenVorlagen.id, id));
  return v;
}

export type VorlageZeile = {
  id: string;
  art: PrivatArt;
  titel: string;
  gegenpartei: string | null;
  kategorie: string;
  betragCent: number;
  mwstSatz: number | null;
  rhythmus: Rhythmus;
  ab: string;
  bis: string | null;
  aktiv: boolean;
  notiz: string | null;
  proMonatCent: number;
  naechste: string | null;
  /** wie oft schon fällig gewesen (gebucht, offen oder übersprungen) */
  laeufe: number;
  offen: number;
};

export async function vorlagenListe(bereich: Bereich): Promise<VorlageZeile[]> {
  const heute = heuteIso();
  const [vorlagen, zaehler] = await Promise.all([
    db().select().from(fixkostenVorlagen).where(eq(fixkostenVorlagen.bereich, bereich)).orderBy(desc(fixkostenVorlagen.aktiv), asc(fixkostenVorlagen.titel)),
    db()
      .select({ id: fixkostenLaeufe.vorlageId, n: count(), offen: sql<number>`count(*) filter (where ${fixkostenLaeufe.status} = 'offen')::int` })
      .from(fixkostenLaeufe)
      .groupBy(fixkostenLaeufe.vorlageId),
  ]);
  const je = new Map(zaehler.map((z) => [z.id, z]));
  return vorlagen.map((v) => ({
    id: v.id,
    art: v.art,
    titel: v.titel,
    gegenpartei: v.gegenpartei,
    kategorie: v.kategorie,
    betragCent: v.betragCent,
    mwstSatz: v.mwstSatz,
    rhythmus: v.rhythmus,
    ab: v.ab,
    bis: v.bis,
    aktiv: v.aktiv,
    notiz: v.notiz,
    proMonatCent: proMonatCent(v.betragCent, v.rhythmus),
    naechste: v.aktiv ? (naechsteFaelligkeit({ ab: v.ab, tag: v.tag, rhythmus: v.rhythmus, bis: v.bis }, heute)?.faelligAm ?? null) : null,
    laeufe: je.get(v.id)?.n ?? 0,
    offen: je.get(v.id)?.offen ?? 0,
  }));
}

export type OffenerLauf = {
  id: string;
  periode: string;
  faelligAm: string;
  titel: string;
  gegenpartei: string | null;
  kategorie: string;
  betragCent: number;
  mwstSatz: number | null;
  notiz: string | null;
};

/** DDL: fällige Fixkosten, die noch nicht übernommen oder übersprungen sind (älteste zuerst). */
export async function offeneLaeufe(): Promise<OffenerLauf[]> {
  return db()
    .select({
      id: fixkostenLaeufe.id,
      periode: fixkostenLaeufe.periode,
      faelligAm: fixkostenLaeufe.faelligAm,
      titel: fixkostenVorlagen.titel,
      gegenpartei: fixkostenVorlagen.gegenpartei,
      kategorie: fixkostenVorlagen.kategorie,
      betragCent: fixkostenVorlagen.betragCent,
      mwstSatz: fixkostenVorlagen.mwstSatz,
      notiz: fixkostenVorlagen.notiz,
    })
    .from(fixkostenLaeufe)
    .innerJoin(fixkostenVorlagen, eq(fixkostenLaeufe.vorlageId, fixkostenVorlagen.id))
    .where(and(eq(fixkostenLaeufe.status, 'offen'), eq(fixkostenVorlagen.bereich, 'ddl')))
    .orderBy(asc(fixkostenLaeufe.faelligAm), asc(fixkostenVorlagen.titel));
}

export async function laufUeberspringen(id: string) {
  const [l] = await db()
    .update(fixkostenLaeufe)
    .set({ status: 'uebersprungen' satisfies LaufStatus, erledigtAm: new Date() })
    .where(and(eq(fixkostenLaeufe.id, id), eq(fixkostenLaeufe.status, 'offen')))
    .returning();
  if (!l) throw new AppError('Diese Fixkosten sind schon erledigt.');
  const [v] = await db().select({ titel: fixkostenVorlagen.titel }).from(fixkostenVorlagen).where(eq(fixkostenVorlagen.id, l.vorlageId));
  return { ...l, titel: v?.titel ?? '' };
}
