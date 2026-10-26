import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { devices, materialLots, materials, orderMaterials, orders, orderStatusHistory, orderSteps, orderTeeth, patients, practices, staffUsers, workTypes } from '@/db/schema';
import { dokumenteVon, type DokumentInfo } from '@/lib/dokumente/liste';
import type { Tempo } from '@/lib/katalog/tempo';
import { terminText } from '@/lib/orders/listen';
import type { Status } from '@/lib/orders/status';
import { aktiveSchritte, lageVon } from './lage';
import { chargenFuer, druckerListe, type ChargeOption } from './material';
import { DRUCK_SCHRITTE, erledigenVon, zaehneKurz, zielPruefen, type Erledigen } from './schritte';
import { PRODUKTIONS_ROLLEN } from './rollen';

/**
 * وضعیت تولید یک سفارش: فهرست مراحل همین سفارش با «erledigt am … von …»، مرحلهٔ فعلی و این‌که
 * «Erledigt» چه می‌کند. برای صفحهٔ سفارش، صفحهٔ «Schritt erledigt» (QR) و Laufzettel.
 * فقط کد بیمار؛ نام بیمار اینجا هرگز خوانده نمی‌شود.
 */

export type SchrittZeile = {
  key: string;
  label: string;
  zustand: 'erledigt' | 'aktuell' | 'offen';
  am: Date | null;
  von: string | null;
  geraet: string | null;
};

export type ProduktionsStand = {
  orderId: string;
  status: Status;
  kopf: {
    orderNo: string;
    patientCode: string | null;
    behandlung: string;
    praxis: string;
    tempo: Tempo;
    termin: string | null;
    zaehne: string | null;
    farbe: string | null;
  };
  zeilen: SchrittZeile[];
  aktuell: { key: string; label: string; seit: Date | null } | null;
  erledigen: Erledigen;
  /** «Schritt korrigieren»: wohin der Auftrag von Hand gesetzt werden darf (z. B. nach der QK zurück in die Ausarbeitung) */
  ziele: { key: string; label: string }[];
  /** nur beim 3D-Druck */
  druck: { drucker: { key: string; name: string }[]; chargen: ChargeOption[] } | null;
  verwendet: { material: string; lotNo: string; ablauf: string | null; farbe: string | null; menge: number; einheit: 'flasche' | 'kapsel' }[];
  zustaendig: { id: string; name: string } | null;
  personen: { id: string; name: string }[];
  /** Konformitätserklärung und Lieferschein, sobald der Auftrag in der Übergabe ist */
  dokumente: DokumentInfo[];
};

const ABGESCHLOSSEN: readonly Status[] = ['geliefert', 'abgeschlossen'];

/** `A-2026-0042` ← id (Seite `/s/A-2026-0042` nach dem QR-Code). */
export async function auftragIdVonNummer(nr: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{3,30}$/.test(nr)) return null;
  const [o] = await db().select({ id: orders.id }).from(orders).where(eq(orders.orderNo, nr)).limit(1);
  return o?.id ?? null;
}

export async function produktionsStand(orderId: string): Promise<ProduktionsStand | null> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return null;
  const [z] = await db()
    .select({ o: orders, wt: { key: workTypes.key, name: workTypes.name, stepKeys: workTypes.stepKeys, needsFreigabe: workTypes.needsFreigabe }, praxis: practices.name, code: patients.code })
    .from(orders)
    .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
    .leftJoin(practices, eq(practices.id, orders.practiceId))
    .leftJoin(patients, eq(patients.id, orders.patientId))
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!z || z.o.status === 'entwurf' || !z.o.orderNo) return null;
  const { o } = z;

  const [alle, schritte, verwendet, [letzte], zaehne, personen, dokumente] = await Promise.all([
    aktiveSchritte(),
    db()
      .select({ s: orderSteps, von: staffUsers.name, geraet: devices.name })
      .from(orderSteps)
      .leftJoin(staffUsers, eq(staffUsers.id, orderSteps.doneBy))
      .leftJoin(devices, eq(devices.key, orderSteps.deviceKey))
      .where(eq(orderSteps.orderId, o.id)),
    db()
      .select({ material: materials.name, hersteller: materials.manufacturer, lotNo: materialLots.lotNo, ablauf: materialLots.expiryDate, farbe: materialLots.shade, menge: orderMaterials.quantity, einheit: materials.unit })
      .from(orderMaterials)
      .innerJoin(materialLots, eq(materialLots.id, orderMaterials.lotId))
      .innerJoin(materials, eq(materials.key, materialLots.materialKey))
      .where(eq(orderMaterials.orderId, o.id))
      .orderBy(asc(orderMaterials.createdAt)),
    db().select({ at: orderStatusHistory.at }).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, o.id)).orderBy(desc(orderStatusHistory.at)).limit(1),
    db().select({ fdi: orderTeeth.fdi }).from(orderTeeth).where(eq(orderTeeth.orderId, o.id)),
    db()
      .select({ id: staffUsers.id, name: staffUsers.name })
      .from(staffUsers)
      .where(and(eq(staffUsers.isActive, true), inArray(staffUsers.role, PRODUKTIONS_ROLLEN)))
      .orderBy(asc(staffUsers.name)),
    dokumenteVon([o.id]),
  ]);
  const lage = lageVon(o, z.wt, alle);
  const { ist, plan } = lage;
  const zeile = new Map(schritte.map((s) => [s.s.stepKey, s]));

  // bis wohin ist der Auftrag gekommen (für Schritte ohne eigenen Eintrag, z. B. vor Schritt 8)
  const status = ist.status;
  const bis = ABGESCHLOSSEN.includes(status) || (status === 'freigegeben' && o.deliveryKind === 'design')
    ? plan.length
    : plan.findIndex((s) => s.key === (ist.spalte === 'ueberarbeitung' ? 'cad_design' : ist.spalte));

  const zeilen: SchrittZeile[] = plan.map((s, i) => {
    const e = zeile.get(s.key);
    const zustand = s.key === ist.spalte ? 'aktuell' : e?.s.doneAt || (bis >= 0 && i < bis) ? 'erledigt' : 'offen';
    return { key: s.key, label: s.label, zustand, am: zustand === 'erledigt' ? (e?.s.doneAt ?? null) : null, von: zustand === 'erledigt' ? (e?.von ?? null) : null, geraet: e?.geraet ?? null };
  });

  const def = ist.spalte ? alle.find((s) => s.key === ist.spalte) : undefined;
  const gestartet = ist.spalte ? zeile.get(ist.spalte)?.s.startedAt : null;
  const seit = [gestartet, letzte?.at].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const erledigen = erledigenVon(ist, lage.umstaende, plan);
  const druck =
    def && DRUCK_SCHRITTE.includes(def.key) && erledigen.art === 'weiter'
      ? await Promise.all([druckerListe(), chargenFuer(z.wt?.key ?? null)]).then(([drucker, chargen]) => ({ drucker, chargen }))
      : null;
  // auch wer inzwischen eine andere Rolle hat, bleibt als »Zuständig« sichtbar
  const zustaendig = o.assigneeId
    ? (personen.find((p) => p.id === o.assigneeId) ??
      (await db().select({ id: staffUsers.id, name: staffUsers.name }).from(staffUsers).where(eq(staffUsers.id, o.assigneeId)).limit(1))[0] ??
      null)
    : null;

  return {
    orderId: o.id,
    status,
    kopf: {
      orderNo: o.orderNo!,
      patientCode: z.code,
      behandlung: z.wt?.name ?? '–',
      praxis: z.praxis ?? '–',
      tempo: o.tempo ?? 'standard',
      termin: terminText(o),
      zaehne: zaehneKurz(zaehne.map((t) => t.fdi)),
      farbe: o.shade,
    },
    zeilen,
    aktuell: def ? { key: def.key, label: def.label, seit } : null,
    erledigen,
    ziele: ist.spalte ? plan.filter((s) => s.key !== ist.spalte && zielPruefen(ist, s, lage.umstaende, plan).ok).map((s) => ({ key: s.key, label: s.label })) : [],
    druck,
    verwendet: verwendet.map((v) => ({ material: `${v.hersteller} ${v.material}`, lotNo: v.lotNo, ablauf: v.ablauf, farbe: v.farbe, menge: v.menge, einheit: v.einheit })),
    zustaendig,
    personen: zustaendig && !personen.some((p) => p.id === zustaendig.id) ? [...personen, zustaendig] : personen,
    dokumente: dokumente.get(o.id) ?? [],
  };
}
