import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { orders, productionSteps, workTypes } from '@/db/schema';
import { istStatus, type Status, type Umstaende } from '@/lib/orders/status';
import { planVon, spalteVon, type Ist, type Schritt } from './schritte';

/** مراحل فعال تولید، به ترتیب برد (ستون‌های Kanban). */
export async function aktiveSchritte(): Promise<Schritt[]> {
  const zeilen = await db().select().from(productionSteps).where(eq(productionSteps.isActive, true)).orderBy(asc(productionSteps.position));
  return zeilen.flatMap((s) => (istStatus(s.portalStatusKey) ? [{ key: s.key, label: s.label, portal: s.portalStatusKey }] : []));
}

export type Lage = {
  ist: Ist;
  umstaende: Umstaende;
  plan: Schritt[];
};

type Kern = Pick<typeof orders.$inferSelect, 'status' | 'currentStepKey' | 'deliveryKind' | 'config'>;
type Art = Pick<typeof workTypes.$inferSelect, 'stepKeys' | 'needsFreigabe'>;

/** جای سفارش در تولید: plan خودش، ستون فعلی و شرط‌های `status.ts`. */
export function lageVon(o: Kern, wt: Art | null | undefined, alle: readonly Schritt[]): Lage {
  const status: Status = istStatus(o.status) ? o.status : 'eingereicht';
  const umstaende: Umstaende = { lieferart: o.deliveryKind, freigabeNoetig: wt?.needsFreigabe ?? true };
  const plan = planVon(alle, { stepKeys: wt?.stepKeys ?? [], ...umstaende, einprobe: o.config.einprobe === true });
  return { ist: { status, spalte: spalteVon(status, o.currentStepKey, plan, alle) }, umstaende, plan };
}
