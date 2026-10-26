import 'server-only';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { devices, materialLots, materials, orderMaterials, workTypes } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { schluesselAus } from '@/lib/katalog/neu';
import { heuteIso } from '@/lib/format';
import { farbenLesen, mengeText, type Einheit } from './material-text';

/**
 * «Materialien und Chargen» (Spec فاز ۱، بخش C و H): هر Resin با Chargeهایش. در «3D-Druck»
 * Charge و دستگاه انتخاب می‌شوند و در `order_materials` و `order_steps` می‌مانند (ردیابی MDR،
 * بعداً روی Konformitätserklärung). Charge پاک نمی‌شود، فقط «aufgebraucht».
 */

export type ChargeOption = {
  id: string;
  material: string;
  lotNo: string;
  ablauf: string | null;
  abgelaufen: boolean;
  einheit: Einheit;
  farbe: string | null;
  /** noch vorhanden (null: wird nicht gezählt) */
  bestand: number | null;
  /** nur Flaschen: Viertel in der offenen Flasche, null = voll */
  fuellung: number | null;
  /** Material ist für diese Behandlung vorgesehen */
  passend: boolean;
};

const abgelaufen = (ablauf: string | null, heute = heuteIso()) => Boolean(ablauf && ablauf < heute);

/** Chargen, die gerade verwendet werden können (nicht aufgebraucht, Material aktiv). Passende zuerst. */
export async function chargenFuer(workTypeKey: string | null): Promise<ChargeOption[]> {
  const zeilen = await db()
    .select({ lot: materialLots, name: materials.name, hersteller: materials.manufacturer, fuer: materials.indications, einheit: materials.unit })
    .from(materialLots)
    .innerJoin(materials, eq(materials.key, materialLots.materialKey))
    .where(and(isNull(materialLots.usedUpAt), eq(materials.isActive, true)))
    .orderBy(asc(materials.manufacturer), asc(materials.name), desc(materialLots.createdAt));
  const heute = heuteIso();
  return zeilen
    .map((z) => ({
      id: z.lot.id,
      material: `${z.hersteller} ${z.name}`,
      lotNo: z.lot.lotNo,
      ablauf: z.lot.expiryDate,
      abgelaufen: abgelaufen(z.lot.expiryDate, heute),
      einheit: z.einheit,
      farbe: z.lot.shade,
      bestand: z.lot.stock,
      fuellung: z.lot.fillQuarters,
      passend: Boolean(workTypeKey && z.fuer.includes(workTypeKey)),
    }))
    .sort((a, b) => Number(b.passend) - Number(a.passend));
}

export async function druckerListe(): Promise<{ key: string; name: string }[]> {
  return db()
    .select({ key: devices.key, name: devices.name })
    .from(devices)
    .where(and(eq(devices.kind, 'drucker'), eq(devices.isActive, true)))
    .orderBy(asc(devices.name));
}

/* ── Seite »Materialien« ───────────────────────────────────────── */

export type ChargeZeile = {
  id: string;
  lotNo: string;
  ablauf: string | null;
  eingang: string | null;
  aufgebraucht: Date | null;
  abgelaufen: boolean;
  auftraege: number;
  farbe: string | null;
  /** gekauft / noch vorhanden (null: Charge von vor der Zählung) */
  menge: number | null;
  bestand: number | null;
  /** nur Flaschen: Viertel in der offenen Flasche (4 voll … 1), null = voll */
  fuellung: number | null;
};
export type MaterialZeile = { key: string; name: string; hersteller: string; aktiv: boolean; fuer: string[]; fuerKeys: string[]; einheit: Einheit; farben: string[]; chargen: ChargeZeile[] };

export async function materialListe(): Promise<{ materialien: MaterialZeile[]; behandlungen: { key: string; name: string }[] }> {
  const [mats, lots, verwendet, wts] = await Promise.all([
    db().select().from(materials),
    db().select().from(materialLots).orderBy(desc(materialLots.createdAt)),
    db().select({ lotId: orderMaterials.lotId, n: count() }).from(orderMaterials).groupBy(orderMaterials.lotId),
    db().select({ key: workTypes.key, name: workTypes.name }).from(workTypes).orderBy(asc(workTypes.position)),
  ]);
  const namen = new Map(wts.map((w) => [w.key, w.name]));
  const anzahl = new Map(verwendet.map((v) => [v.lotId, v.n]));
  const heute = heuteIso();
  // Reihenfolge wie in den Stammdaten: nach der ersten Behandlung, für die das Material ist
  const rang = (m: (typeof mats)[number]) => Math.min(...m.indications.map((k) => wts.findIndex((w) => w.key === k)).filter((i) => i >= 0), 999);
  return {
    behandlungen: wts,
    materialien: mats
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || rang(a) - rang(b) || a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name))
      .map((m) => ({
        key: m.key,
        name: m.name,
        hersteller: m.manufacturer,
        aktiv: m.isActive,
        fuer: m.indications.map((k) => namen.get(k) ?? k),
        fuerKeys: m.indications,
        einheit: m.unit,
        farben: m.shades,
        chargen: lots
          .filter((l) => l.materialKey === m.key)
          .map((l) => ({
            id: l.id,
            lotNo: l.lotNo,
            ablauf: l.expiryDate,
            eingang: l.receivedAt,
            aufgebraucht: l.usedUpAt,
            abgelaufen: abgelaufen(l.expiryDate, heute),
            auftraege: anzahl.get(l.id) ?? 0,
            farbe: l.shade,
            menge: l.quantity,
            bestand: l.stock,
            fuellung: l.fillQuarters,
          })),
      })),
  };
}

const isoDatum = z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein gültiges Datum angeben.')]).transform((v) => v || null);

const anzahl = (feld: string) => {
  const Feld = feld[0].toUpperCase() + feld.slice(1);
  return z.coerce
    .number({ error: `Bitte ${feld} als ganze Zahl angeben.` })
    .int(`Bitte ${feld} als ganze Zahl angeben.`)
    .min(0, `${Feld} kann nicht negativ sein.`)
    .max(9999, `${Feld} ist zu groß.`);
};

export const chargeSchema = z.object({
  material: z.string().min(1).max(60),
  lotNo: z.string().trim().min(2, 'Bitte die LOT-Nummer vom Etikett eingeben.').max(40, 'Die LOT-Nummer ist zu lang.'),
  ablauf: isoDatum,
  eingang: isoDatum,
  farbe: z.string().trim().max(12).default(''),
  menge: anzahl('die Anzahl').min(1, 'Bitte die Anzahl angeben (mindestens 1).'),
});

export async function chargeAnlegen(roh: unknown) {
  const r = chargeSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { material, lotNo, ablauf, eingang, menge } = r.data;
  const [m] = await db()
    .select({ key: materials.key, name: materials.name, hersteller: materials.manufacturer, farben: materials.shades, einheit: materials.unit })
    .from(materials)
    .where(eq(materials.key, material))
    .limit(1);
  if (!m) throw new AppError('Material nicht gefunden.');
  // Material mit Farben: jede Charge hat genau eine davon
  const farbe = r.data.farbe.toUpperCase() || null;
  if (m.farben.length && !farbe) throw new AppError(`Bitte die Farbe wählen (${m.farben.join(', ')}).`);
  if (farbe && m.farben.length && !m.farben.includes(farbe)) throw new AppError(`${m.hersteller} ${m.name} gibt es nicht in ${farbe}.`);
  const neu = await db()
    .insert(materialLots)
    .values({ materialKey: m.key, lotNo, expiryDate: ablauf, receivedAt: eingang ?? heuteIso(), shade: farbe, quantity: menge, stock: menge })
    .onConflictDoNothing()
    .returning({ id: materialLots.id });
  if (!neu.length) throw new AppError(`Die Charge ${lotNo} ist für ${m.hersteller} ${m.name} schon erfasst.`);
  return { id: neu[0].id, material: `${m.hersteller} ${m.name}`, lotNo, ablauf, farbe, menge: mengeText(menge, m.einheit) };
}

/**
 * Bestand einer Charge ändern: «eins» = eine Flasche leer (−1), «setzen» = gezählten Bestand eintragen.
 * Bei 0 ist die Charge aufgebraucht; wer den Bestand wieder erhöht, öffnet sie wieder.
 */
export async function bestandAendern(id: string, art: 'eins' | 'setzen', wertRoh?: unknown) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('Charge nicht gefunden.');
  return db().transaction(async (tx) => {
    const [l] = await tx
      .select({ lotNo: materialLots.lotNo, bestand: materialLots.stock, menge: materialLots.quantity, einheit: materials.unit, material: materials.key })
      .from(materialLots)
      .innerJoin(materials, eq(materials.key, materialLots.materialKey))
      .where(eq(materialLots.id, id))
      // sperrt die Charge (und ihr Material) bis zum Ende, damit zwei gleichzeitige «Flasche leer» nicht dieselbe Zahl lesen
      .for('update');
    if (!l) throw new AppError('Charge nicht gefunden.');
    let neu: number;
    if (art === 'eins') {
      if (l.bestand == null) throw new AppError('Für diese Charge ist kein Bestand erfasst. Bitte zuerst den Bestand eintragen.');
      if (l.bestand <= 0) throw new AppError('Der Bestand ist schon 0.');
      neu = l.bestand - 1;
    } else {
      const w = anzahl('der Bestand').safeParse(wertRoh);
      if (!w.success) throw new AppError(w.error.issues[0].message);
      neu = w.data;
    }
    await tx
      .update(materialLots)
      .set({
        stock: neu,
        quantity: l.menge == null || neu > l.menge ? Math.max(neu, 1) : l.menge,
        usedUpAt: neu === 0 ? new Date() : null,
        // «Flasche leer»: die nächste Flasche ist voll; ohne Bestand gibt es keine offene Flasche
        ...(art === 'eins' || neu === 0 ? { fillQuarters: null } : {}),
      })
      .where(eq(materialLots.id, id));
    return { lotNo: l.lotNo, material: l.material, vorher: l.bestand, nachher: neu, text: mengeText(neu, l.einheit) };
  });
}

/** «Aufgebraucht» (oder zurück): die Charge erscheint dann nicht mehr bei »3D-Druck«. */
export async function chargeAufgebraucht(id: string, aufgebraucht: boolean) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('Charge nicht gefunden.');
  const [l] = await db()
    .update(materialLots)
    .set({ usedUpAt: aufgebraucht ? new Date() : null })
    .where(eq(materialLots.id, id))
    .returning({ lotNo: materialLots.lotNo, material: materialLots.materialKey });
  if (!l) throw new AppError('Charge nicht gefunden.');
  return l;
}

const einheitSchema = z.enum(['flasche', 'kapsel'], { error: 'Bitte Flasche oder Kapsel wählen.' });

export const materialSchema = z.object({
  hersteller: z.string().trim().min(2, 'Bitte den Hersteller angeben.').max(60),
  name: z.string().trim().min(2, 'Bitte den Namen des Materials angeben.').max(80),
  fuer: z.array(z.string().max(60)).max(40),
  einheit: einheitSchema.default('flasche'),
  farben: z.string().max(400).default(''),
});

function farbenOderFehler(text: string): string[] {
  const f = farbenLesen(text);
  if ('fehler' in f) throw new AppError(f.fehler);
  return f.farben;
}

/** Schlüssel aus Hersteller und Name, z. B. »sprintray_crown_ht«. */
export function materialSchluessel(hersteller: string, name: string): string {
  return schluesselAus(`${hersteller}_${name}`);
}

export async function materialAnlegen(roh: unknown) {
  const r = materialSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { hersteller, name, einheit } = r.data;
  const farben = farbenOderFehler(r.data.farben);
  const wts = r.data.fuer.length ? await db().select({ key: workTypes.key }).from(workTypes).where(inArray(workTypes.key, r.data.fuer)) : [];
  const key = materialSchluessel(hersteller, name);
  if (!key) throw new AppError('Bitte einen gültigen Namen angeben.');
  const neu = await db()
    .insert(materials)
    .values({ key, name, manufacturer: hersteller, indications: wts.map((w) => w.key), unit: einheit, shades: farben })
    .onConflictDoNothing()
    .returning({ key: materials.key });
  if (!neu.length) throw new AppError(`${hersteller} ${name} gibt es schon.`);
  return { key, name: `${hersteller} ${name}` };
}

export async function materialAktivSetzen(key: string, aktiv: boolean) {
  const [m] = await db().update(materials).set({ isActive: aktiv }).where(eq(materials.key, key)).returning({ key: materials.key, name: materials.name });
  if (!m) throw new AppError('Material nicht gefunden.');
  return m;
}

/** Einheit und Farben eines Materials (Stammdaten). Farben, die schon an einer Charge hängen, bleiben erlaubt. */
export async function materialEinstellen(key: string, roh: { einheit: unknown; farben: unknown }) {
  const einheit = einheitSchema.safeParse(roh.einheit);
  if (!einheit.success) throw new AppError(einheit.error.issues[0].message);
  const farben = farbenOderFehler(typeof roh.farben === 'string' ? roh.farben : '');
  const [vorher] = await db().select({ einheit: materials.unit, farben: materials.shades }).from(materials).where(eq(materials.key, key)).limit(1);
  if (!vorher) throw new AppError('Material nicht gefunden.');
  const benutzt = await db()
    .selectDistinct({ farbe: materialLots.shade })
    .from(materialLots)
    .where(and(eq(materialLots.materialKey, key), isNull(materialLots.usedUpAt), sql`${materialLots.shade} is not null`));
  const fehlt = benutzt.map((b) => b.farbe!).filter((f) => !farben.includes(f));
  if (farben.length && fehlt.length) throw new AppError(`Offene Chargen haben noch die Farbe ${fehlt.join(', ')}. Bitte diese Farbe in der Liste lassen.`);
  const [m] = await db().update(materials).set({ unit: einheit.data, shades: farben }).where(eq(materials.key, key)).returning({ key: materials.key, name: materials.name });
  return { ...m, vorher, nachher: { einheit: einheit.data, farben } };
}

/** Füllstand der offenen Flasche einer Charge (Voll, ¾, ½, ¼). Nur für Flaschen mit Bestand. */
export async function fuellungSetzen(id: string, viertelRoh: unknown) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new AppError('Charge nicht gefunden.');
  const v = z.coerce.number().int().min(1).max(4).safeParse(viertelRoh);
  if (!v.success) throw new AppError('Bitte Voll, ¾, ½ oder ¼ wählen.');
  const [l] = await db()
    .select({ lotNo: materialLots.lotNo, bestand: materialLots.stock, vorher: materialLots.fillQuarters, einheit: materials.unit, material: materials.key })
    .from(materialLots)
    .innerJoin(materials, eq(materials.key, materialLots.materialKey))
    .where(eq(materialLots.id, id));
  if (!l) throw new AppError('Charge nicht gefunden.');
  if (l.einheit !== 'flasche') throw new AppError('Den Füllstand gibt es nur bei Flaschen.');
  if (!l.bestand) throw new AppError('Für diese Charge ist keine Flasche mehr da. Bitte zuerst den Bestand eintragen.');
  // «Voll» wird als null gespeichert: wie eine neue Flasche
  await db().update(materialLots).set({ fillQuarters: v.data === 4 ? null : v.data }).where(eq(materialLots.id, id));
  return { lotNo: l.lotNo, material: l.material, vorher: l.vorher ?? 4, nachher: v.data };
}
