import 'server-only';
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { belegEingang, privatBuchungen } from '@/db/schema';
import { belegTypVon, BELEG_MAX_BYTES } from '@/lib/ausgaben/text';
import { dateinameBereinigen } from '@/lib/dateien/regeln';
import { AppError } from '@/lib/errors';
import { datenAb, datenVor, uebersichtBerechnen, type Uebersicht } from '@/lib/finanzen/uebersicht';
import { heuteIso } from '@/lib/format';
import { kopfLesen, lesen, loeschen, speichern, ZuGross } from '@/lib/storage';
import { privatPruefen, type PrivatWerte } from './pruefen';
import { zaehltImErgebnis, type PrivatArt, type PrivatKategorie } from './text';

/**
 * «Privat» (Spec فاز ۵، قدم ۲؛ فقط Inhaber). جدا از `expenses`: هیچ‌چیز اینجا به Export یا اسناد DDL نمی‌رود.
 * Beleg اختیاری است؛ از «Zu prüfen» (`eingangId`، در همان تراکنش منتقل می‌شود) یا بعد از ذخیره از `api/privat/[id]/beleg`.
 */

function werte(roh: Record<string, string>): PrivatWerte {
  const r = privatPruefen(roh, heuteIso());
  if (!r.ok) throw new AppError(r.fehler);
  return r.werte;
}

export async function privatAnlegen(roh: Record<string, string>, akteur: { id: string; label: string }, eingangId?: string) {
  const w = werte(roh);
  return db().transaction(async (tx) => {
    let beleg = {};
    if (eingangId) {
      const [e] = await tx.delete(belegEingang).where(eq(belegEingang.id, eingangId)).returning();
      if (!e) throw new AppError('Dieser Beleg ist nicht mehr unter »Zu prüfen« (schon übernommen oder verworfen).');
      beleg = { belegKey: e.belegKey, belegSha256: e.belegSha256, belegGroesse: e.belegGroesse, belegTyp: e.belegTyp, belegName: e.belegName, belegAm: e.hochgeladenAm };
    }
    const [neu] = await tx
      .insert(privatBuchungen)
      .values({ ...w, ...beleg, quelle: eingangId ? 'beleg' : 'hand', erfasstVon: akteur.id, erfasstVonLabel: akteur.label })
      .returning();
    return neu;
  });
}

export async function privatAendern(id: string, roh: Record<string, string>) {
  const w = werte(roh);
  return db().transaction(async (tx) => {
    const [vorher] = await tx.select().from(privatBuchungen).where(eq(privatBuchungen.id, id)).for('update');
    if (!vorher || vorher.geloeschtAm) throw new AppError('Diese Buchung gibt es nicht mehr.');
    const [nachher] = await tx
      .update(privatBuchungen)
      .set({ ...w, geaendertAm: new Date() })
      .where(eq(privatBuchungen.id, id))
      .returning();
    return { vorher, nachher };
  });
}

/** Nur als gelöscht markieren (der Beleg bleibt; versehentliches Löschen lässt sich in der Datenbank zurücknehmen). */
export async function privatLoeschen(id: string) {
  const [b] = await db()
    .update(privatBuchungen)
    .set({ geloeschtAm: new Date() })
    .where(and(eq(privatBuchungen.id, id), isNull(privatBuchungen.geloeschtAm)))
    .returning();
  if (!b) throw new AppError('Diese Buchung gibt es nicht mehr.');
  return b;
}

/** Beleg nachreichen (Body = Datei). Ein vorhandener Beleg wird nicht ersetzt, wie bei den Ausgaben. */
export async function privatBelegSpeichern(id: string, d: { name: string | null; laenge: number | null; inhalt: ReadableStream<Uint8Array> | null }) {
  if (!d.inhalt) throw new AppError('Keine Datei empfangen.');
  if (d.laenge != null && d.laenge > BELEG_MAX_BYTES) throw new AppError('Der Beleg ist zu groß (höchstens 20 MB).');
  const [b] = await db().select({ geloeschtAm: privatBuchungen.geloeschtAm, belegKey: privatBuchungen.belegKey }).from(privatBuchungen).where(eq(privatBuchungen.id, id)).limit(1);
  if (!b || b.geloeschtAm) throw new AppError('Diese Buchung gibt es nicht mehr.');
  if (b.belegKey) throw new AppError('Diese Buchung hat schon einen Beleg.');
  let datei: Awaited<ReturnType<typeof speichern>>;
  try {
    datei = await speichern(d.inhalt, BELEG_MAX_BYTES);
  } catch (e) {
    if (e instanceof ZuGross) throw new AppError('Der Beleg ist zu groß (höchstens 20 MB).');
    throw e;
  }
  const typ = belegTypVon(await kopfLesen(datei.key));
  if (!typ || datei.groesse === 0) {
    await loeschen(datei.key);
    throw new AppError('Bitte ein Foto (JPG, PNG, HEIC) oder ein PDF wählen.');
  }
  const name = dateinameBereinigen(d.name ?? '') || `Beleg.${typ.endung}`;
  const [gesetzt] = await db()
    .update(privatBuchungen)
    .set({ belegKey: datei.key, belegSha256: datei.sha256, belegGroesse: datei.groesse, belegTyp: typ.typ, belegName: name, belegAm: new Date() })
    .where(and(eq(privatBuchungen.id, id), isNull(privatBuchungen.belegKey), isNull(privatBuchungen.geloeschtAm)))
    .returning({ id: privatBuchungen.id, haendler: privatBuchungen.haendler });
  if (!gesetzt) {
    await loeschen(datei.key);
    throw new AppError('Diese Buchung hat schon einen Beleg.');
  }
  return { ...gesetzt, name, typ: typ.typ, groesse: datei.groesse };
}

export async function privatBelegLaden(id: string) {
  const [b] = await db()
    .select({ key: privatBuchungen.belegKey, typ: privatBuchungen.belegTyp, name: privatBuchungen.belegName, groesse: privatBuchungen.belegGroesse })
    .from(privatBuchungen)
    .where(eq(privatBuchungen.id, id))
    .limit(1);
  if (!b?.key || !b.typ || b.groesse == null) return null;
  return { typ: b.typ, name: b.name ?? 'Beleg', groesse: b.groesse, oeffnen: () => lesen(b.key!) };
}

export type PrivatZeile = {
  id: string;
  art: PrivatArt;
  datum: string;
  betragCent: number;
  kategorie: PrivatKategorie;
  haendler: string | null;
  notiz: string | null;
  quelle: string;
  beleg: { typ: string; name: string; groesse: number } | null;
};

/** Alle nicht gelöschten Buchungen, neueste zuerst. */
export async function allePrivat(): Promise<PrivatZeile[]> {
  const zeilen = await db()
    .select()
    .from(privatBuchungen)
    .where(isNull(privatBuchungen.geloeschtAm))
    .orderBy(desc(privatBuchungen.datum), desc(privatBuchungen.erfasstAm));
  return zeilen.map((b) => ({
    id: b.id,
    art: b.art,
    datum: b.datum,
    betragCent: b.betragCent,
    kategorie: b.kategorie,
    haendler: b.haendler,
    notiz: b.notiz,
    quelle: b.quelle,
    beleg: b.belegKey && b.belegTyp && b.belegGroesse != null ? { typ: b.belegTyp, name: b.belegName ?? 'Beleg', groesse: b.belegGroesse } : null,
  }));
}

/** «Übersicht» Privat: dieselbe Rechnung wie bei DDL (`uebersichtBerechnen`), ohne »fakturiert«. */
export async function privatUebersicht(monat: string): Promise<Uebersicht> {
  const zeilen = await db()
    .select({ art: privatBuchungen.art, datum: privatBuchungen.datum, cent: privatBuchungen.betragCent, kategorie: privatBuchungen.kategorie })
    .from(privatBuchungen)
    .where(and(isNull(privatBuchungen.geloeschtAm), gte(privatBuchungen.datum, datenAb(monat)), lt(privatBuchungen.datum, datenVor(monat))));
  const zaehlen = zeilen.filter((z) => zaehltImErgebnis(z.kategorie));
  return uebersichtBerechnen(monat, {
    einnahmen: zaehlen.filter((z) => z.art === 'einnahme'),
    fakturiert: [],
    ausgaben: zaehlen.filter((z) => z.art === 'ausgabe'),
  });
}
