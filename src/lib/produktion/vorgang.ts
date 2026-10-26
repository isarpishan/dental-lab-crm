import 'server-only';
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { materialLots, orderMaterials, orders, orderSteps, staffUsers, workTypes } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { AppError } from '@/lib/errors';
import { statusWechseln, type Status } from '@/lib/orders/status';
import { aktiveSchritte, lageVon, type Lage } from './lage';
import { chargenFuer, druckerListe } from './material';
import { PRODUKTIONS_ROLLEN } from './rollen';
import { DRUCK_SCHRITTE, erledigenVon, zielPruefen, type Schritt } from './schritte';
import { dokumenteAusstellen } from '@/lib/dokumente/ausstellen';

/**
 * کارهای برد تولید (Spec فاز ۱، بخش H): کشیدن کارت، «Erledigt» و «Zuständig».
 * اگر مرحلهٔ تازه وضعیت پورتال دیگری دارد، وضعیت فقط با `statusWechseln` عوض می‌شود.
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
const akteurVon = (b: Bearbeiter) => ({ kind: b.kind, id: b.id, label: b.label });
const GEAENDERT = 'Der Auftrag wurde inzwischen geändert. Bitte laden Sie die Seite neu.';

async function laden(b: Bearbeiter, orderId: string) {
  if (b.seite !== 'labor') throw new AppError('Dafür fehlt Ihnen die Berechtigung.');
  if (!/^[0-9a-f-]{36}$/.test(orderId)) throw new AppError('Auftrag nicht gefunden.');
  const [z] = await db()
    .select({ o: orders, wt: { key: workTypes.key, stepKeys: workTypes.stepKeys, needsFreigabe: workTypes.needsFreigabe } })
    .from(orders)
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!z || z.o.status === 'entwurf' || !z.o.orderNo) throw new AppError('Auftrag nicht gefunden.');
  return { o: z.o, wt: z.wt, lage: lageVon(z.o, z.wt, await aktiveSchritte()) };
}

/**
 * سفارش را به مرحلهٔ `ziel` می‌برد. رو به جلو: مرحلهٔ قبلی «erledigt»؛ رو به عقب: مرحله‌های بعدی
 * دوباره باز. نگهبان هم‌زمانی: وضعیت و `current_step_key` باید همان باشند که خوانده شد.
 * رفتن به «Übergabe» (`versendet`) در همین تراکنش Konformitätserklärung و Lieferschein را صادر
 * می‌کند (`lib/dokumente/ausstellen.ts`)؛ شماره‌های اسناد تازه برگردانده می‌شوند.
 */
async function bewegen(
  tx: Tx,
  e: { b: Bearbeiter; o: typeof orders.$inferSelect; lage: Lage; ziel: Schritt; nach: Status | null; erledigt: boolean; geraet?: string | null },
) {
  const { b, o, lage, ziel } = e;
  const jetzt = new Date();
  const von = lage.ist.spalte;
  const iVon = lage.plan.findIndex((s) => s.key === von);
  const iZiel = lage.plan.findIndex((s) => s.key === ziel.key);

  if (e.nach) {
    await statusWechseln(tx, {
      orderId: o.id,
      von: lage.ist.status,
      nach: e.nach,
      wer: 'labor',
      akteur: { kind: 'staff', id: b.id },
      umstaende: lage.umstaende,
      felder: { currentStepKey: ziel.key },
    });
  } else {
    const r = await tx
      .update(orders)
      .set({ currentStepKey: ziel.key, updatedAt: jetzt })
      .where(and(eq(orders.id, o.id), eq(orders.status, lage.ist.status), o.currentStepKey ? eq(orders.currentStepKey, o.currentStepKey) : isNull(orders.currentStepKey)))
      .returning({ id: orders.id });
    if (!r.length) throw new AppError(GEAENDERT);
  }

  if (von && (e.erledigt || (iVon >= 0 && iZiel > iVon))) {
    await tx
      .insert(orderSteps)
      .values({ orderId: o.id, stepKey: von, doneAt: jetzt, doneBy: b.id, deviceKey: e.geraet ?? null })
      .onConflictDoUpdate({ target: [orderSteps.orderId, orderSteps.stepKey], set: { doneAt: jetzt, doneBy: b.id, ...(e.geraet ? { deviceKey: e.geraet } : {}) } });
  }
  if (iZiel >= 0 && iVon > iZiel) {
    const spaeter = lage.plan.slice(iZiel + 1).map((s) => s.key);
    await tx.update(orderSteps).set({ doneAt: null, doneBy: null }).where(and(eq(orderSteps.orderId, o.id), inArray(orderSteps.stepKey, spaeter)));
  }
  await tx
    .insert(orderSteps)
    .values({ orderId: o.id, stepKey: ziel.key, startedAt: jetzt })
    .onConflictDoUpdate({ target: [orderSteps.orderId, orderSteps.stepKey], set: { startedAt: jetzt, doneAt: null, doneBy: null } });
  return e.nach === 'versendet' && o.deliveryKind === 'fertigung' ? dokumenteAusstellen(tx, o.id, { id: b.id, label: b.label }) : [];
}

/** Karte auf dem Brett gezogen (oder Auswahl »Schritt« am Handy). */
export async function schrittSetzen(b: Bearbeiter, orderId: string, zielKey: unknown, vonKey: unknown, ip: string | null) {
  const { o, lage } = await laden(b, orderId);
  if (typeof vonKey === 'string' && vonKey !== (lage.ist.spalte ?? '')) throw new AppError(GEAENDERT);
  const ziel = (await aktiveSchritte()).find((s) => s.key === zielKey);
  if (!ziel) throw new AppError('Unbekannter Schritt.');
  if (!lage.ist.spalte) throw new AppError('Dieser Auftrag ist nicht mehr in der Produktion.');
  const r = zielPruefen(lage.ist, ziel, lage.umstaende, lage.plan);
  if (!r.ok) throw new AppError(r.grund);
  if (ziel.key === lage.ist.spalte) return;
  const dokumente = await db().transaction((tx) => bewegen(tx, { b, o, lage, ziel, nach: r.nach, erledigt: false }));
  await logAudit({
    aktion: 'schritt_verschoben',
    akteur: akteurVon(b),
    ziel: { typ: 'auftrag', id: o.id },
    details: { auftrag: o.orderNo, von: lage.ist.spalte, nach: ziel.key, ...(r.nach ? { status: r.nach } : {}), ...(dokumente.length ? { dokumente } : {}) },
    ip,
  });
}

const erledigtSchema = z.object({
  schritt: z.string().min(1).max(40),
  geraet: z.string().max(60).nullish(),
  chargen: z.array(z.uuid()).max(10).default([]),
  /** Kapseln je gewählter Charge (nur Kapsel-Materialien; Flaschen werden mit «Flasche leer» gezählt) */
  mengen: z.record(z.string(), z.number().int().min(1, 'Bitte mindestens 1 Kapsel angeben.').max(50, 'Höchstens 50 Kapseln.')).default({}),
});

/**
 * «Erledigt» für den aktuellen Schritt (Tablet nach QR, oder Auftragsseite). `schritt` ist der Schritt,
 * den der Bildschirm zeigt: ein zweiter Klick findet ihn schon erledigt und ändert nichts.
 * Beim 3D-Druck: Drucker und Charge(n) für die Rückverfolgbarkeit (MDR).
 */
export async function schrittErledigt(b: Bearbeiter, orderId: string, roh: unknown, ip: string | null): Promise<{ weiter: string | null }> {
  const r = erledigtSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues.find((i) => i.path[0] === 'mengen')?.message ?? 'Ungültige Eingabe.');
  const { o, wt, lage } = await laden(b, orderId);
  if (lage.ist.spalte !== r.data.schritt) throw new AppError('Dieser Schritt ist schon erledigt. Bitte laden Sie die Seite neu.');
  const aktuell = (await aktiveSchritte()).find((s) => s.key === lage.ist.spalte)!;
  const e = erledigenVon(lage.ist, lage.umstaende, lage.plan);

  if (e.art === 'geliefert') {
    await db().transaction(async (tx) => {
      await statusWechseln(tx, {
        orderId: o.id,
        von: lage.ist.status,
        nach: 'geliefert',
        wer: 'labor',
        akteur: { kind: 'staff', id: b.id },
        umstaende: lage.umstaende,
        felder: { deliveredAt: new Date() },
      });
      await tx
        .insert(orderSteps)
        .values({ orderId: o.id, stepKey: aktuell.key, doneAt: new Date(), doneBy: b.id })
        .onConflictDoUpdate({ target: [orderSteps.orderId, orderSteps.stepKey], set: { doneAt: new Date(), doneBy: b.id } });
    });
    await logAudit({ aktion: 'schritt_erledigt', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, schritt: aktuell.key, status: 'geliefert' }, ip });
    return { weiter: null };
  }
  if (e.art !== 'weiter') throw new AppError(e.text);

  let geraet: string | null = null;
  let chargen: { id: string; lotNo: string; menge: number; einheit: 'flasche' | 'kapsel'; zaehlen: boolean }[] = [];
  if (DRUCK_SCHRITTE.includes(aktuell.key)) {
    const [drucker, optionen] = await Promise.all([druckerListe(), chargenFuer(wt?.key ?? null)]);
    geraet = r.data.geraet ?? null;
    if (drucker.length && !geraet) throw new AppError('Bitte den Drucker wählen.');
    if (geraet && !drucker.some((d) => d.key === geraet)) throw new AppError('Unbekannter Drucker.');
    const gewaehlt = optionen.filter((c) => r.data.chargen.includes(c.id));
    if (gewaehlt.length !== r.data.chargen.length) throw new AppError('Eine Charge ist nicht mehr verfügbar. Bitte laden Sie die Seite neu.');
    const alt = gewaehlt.find((c) => c.abgelaufen);
    if (alt) throw new AppError(`Die Charge ${alt.lotNo} (${alt.material}) ist abgelaufen.`);
    if (!gewaehlt.length && optionen.some((c) => c.passend && !c.abgelaufen)) throw new AppError('Bitte die verwendete Charge wählen.');
    chargen = gewaehlt.map((c) => ({
      id: c.id,
      lotNo: c.lotNo,
      einheit: c.einheit,
      // Kapseln: vom Bestand abziehen (Standard 1); Flaschen: nichts, die zählt «Flasche leer»
      menge: c.einheit === 'kapsel' ? (r.data.mengen[c.id] ?? 1) : 0,
      zaehlen: c.einheit === 'kapsel' && c.bestand != null,
    }));
  }

  const dokumente = await db().transaction(async (tx) => {
    const nummern = await bewegen(tx, { b, o, lage, ziel: e.ziel, nach: e.nach, erledigt: true, geraet });
    if (chargen.length) {
      // die Charge muss in diesem Moment noch offen sein
      const offen = await tx
        .select({ id: materialLots.id })
        .from(materialLots)
        .where(and(inArray(materialLots.id, chargen.map((c) => c.id)), isNull(materialLots.usedUpAt)));
      if (offen.length !== chargen.length) throw new AppError('Eine Charge ist nicht mehr verfügbar. Bitte laden Sie die Seite neu.');
      // Kapseln vom Bestand abziehen; bei 0 ist die Charge aufgebraucht. Zu wenig: alles zurück (Transaktion).
      for (const c of chargen.filter((x) => x.zaehlen && x.menge > 0)) {
        const [rest] = await tx
          .update(materialLots)
          .set({ stock: sql`${materialLots.stock} - ${c.menge}`, usedUpAt: sql`case when ${materialLots.stock} - ${c.menge} = 0 then now() else ${materialLots.usedUpAt} end` })
          .where(and(eq(materialLots.id, c.id), gte(materialLots.stock, c.menge)))
          .returning({ bestand: materialLots.stock });
        if (!rest) {
          const [l] = await tx.select({ bestand: materialLots.stock }).from(materialLots).where(eq(materialLots.id, c.id));
          throw new AppError(`In der Charge ${c.lotNo} ${l?.bestand === 1 ? 'ist nur noch 1 Kapsel' : `sind nur noch ${l?.bestand ?? 0} Kapseln`}. Bitte die Anzahl prüfen oder den Bestand in »Materialien« korrigieren.`);
        }
      }
      await tx
        .insert(orderMaterials)
        .values(chargen.map((c) => ({ orderId: o.id, lotId: c.id, stepKey: aktuell.key, createdBy: b.id, quantity: c.menge })))
        .onConflictDoNothing();
    }
    return nummern;
  });
  await logAudit({
    aktion: 'schritt_erledigt',
    akteur: akteurVon(b),
    ziel: { typ: 'auftrag', id: o.id },
    details: {
      auftrag: o.orderNo,
      schritt: aktuell.key,
      weiter: e.ziel.key,
      ...(e.nach ? { status: e.nach } : {}),
      ...(geraet ? { geraet } : {}),
      ...(chargen.length ? { chargen: chargen.map((c) => c.lotNo), ...(chargen.some((c) => c.menge) ? { kapseln: Object.fromEntries(chargen.filter((c) => c.menge).map((c) => [c.lotNo, c.menge])) } : {}) } : {}),
      ...(dokumente.length ? { dokumente } : {}),
    },
    ip,
  });
  return { weiter: e.ziel.label };
}


export async function zustaendigSetzen(b: Bearbeiter, orderId: string, userIdRoh: unknown, ip: string | null) {
  const { o } = await laden(b, orderId);
  const userId = typeof userIdRoh === 'string' && userIdRoh ? userIdRoh : null;
  let name: string | null = null;
  if (userId) {
    if (!/^[0-9a-f-]{36}$/.test(userId)) throw new AppError('Unbekannte Person.');
    const [u] = await db()
      .select({ name: staffUsers.name })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, userId), eq(staffUsers.isActive, true), inArray(staffUsers.role, PRODUKTIONS_ROLLEN)))
      .limit(1);
    if (!u) throw new AppError('Diese Person kann keine Produktionsschritte übernehmen.');
    name = u.name;
  }
  if (o.assigneeId === userId) return;
  await db().update(orders).set({ assigneeId: userId, updatedAt: new Date() }).where(eq(orders.id, o.id));
  await logAudit({ aktion: 'zustaendig_geaendert', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { auftrag: o.orderNo, zustaendig: name }, ip });
}
