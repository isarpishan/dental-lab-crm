import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { dentists, orders, orderTeeth, practices, workTypes } from '@/db/schema';
import { config, istProduktion } from '@/lib/config';
import { eintragAus } from '@/lib/katalog/auswahl';
import type { Tempo } from '@/lib/katalog/tempo';
import { blockText, blockTitel, LIEFERART_NAMEN, sichtbareBloecke } from '@/lib/orders/assistent';
import { qrPfad } from '@/lib/pdf/qr';
import { produktionsStand, type SchrittZeile } from './stand';
import { initialen } from './schritte';

/**
 * داده‌های Laufzettel (Spec فاز ۱، بخش H): شماره، **کد بیمار** (نام هرگز)، Ordination، Behandler،
 * Behandlung، طرح دندان‌ها، Farbe، Material، Express یا Same-Day، Termin، چک‌لیست مراحل و QR به صفحهٔ «Schritt erledigt».
 */

export type ZahnMarke = 'voll' | 'teil' | 'extraktion';

export type LaufzettelDaten = {
  orderNo: string;
  patientCode: string;
  praxis: string;
  behandler: string | null;
  behandlung: string;
  lieferart: string | null;
  tempo: Tempo;
  termin: string | null;
  eingereicht: Date | null;
  farbe: string | null;
  zustaendig: string | null;
  zaehne: Map<number, ZahnMarke>;
  zaehneText: string | null;
  auswahl: { titel: string; wert: string }[];
  hinweise: string | null;
  schritte: (SchrittZeile & { kurz: string | null })[];
  material: string[];
  qr: { url: string; groesse: number; pfad: string };
};

/** Zahnmarken: Versorgung voll, Prothesenbasis/Klammer grau, Extraktion mit ×. */
const MARKE: Record<string, ZahnMarke> = { basis: 'teil', klammer: 'teil', extraktion: 'extraktion' };

/** Adresse im internen Bereich, z. B. für den QR-Code (`crm.<domain>/s/A-2026-0042`). */
export const crmUrl = (pfad: string) => `${istProduktion ? 'https' : 'http'}://${config().CRM_HOST}${pfad}`;

export async function laufzettelDaten(orderId: string): Promise<LaufzettelDaten | null> {
  const stand = await produktionsStand(orderId);
  if (!stand) return null;
  const [[z], zaehne] = await Promise.all([
    db()
      .select({ o: orders, wt: workTypes, kundennr: practices.customerNo, behandler: dentists })
      .from(orders)
      .innerJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .leftJoin(practices, eq(practices.id, orders.practiceId))
      .leftJoin(dentists, eq(dentists.id, orders.dentistId))
      .where(eq(orders.id, orderId))
      .limit(1),
    db().select({ fdi: orderTeeth.fdi, art: orderTeeth.treatment }).from(orderTeeth).where(eq(orderTeeth.orderId, orderId)),
  ]);
  if (!z) return null;
  const { o, wt } = z;
  const eintrag = eintragAus(wt);
  const bloecke = sichtbareBloecke(eintrag.formSchema, o.config).filter((b) => o.config[b.id] !== undefined);
  const marken = new Map<number, ZahnMarke>();
  for (const t of zaehne) {
    const m = MARKE[t.art] ?? 'voll';
    // eine Versorgung zählt mehr als Basis oder Klammer am selben Zahn
    if (marken.get(t.fdi) !== 'voll') marken.set(t.fdi, m);
  }
  const k = stand.kopf;
  const url = crmUrl(`/s/${k.orderNo}`);
  return {
    orderNo: k.orderNo,
    patientCode: k.patientCode ?? '–',
    praxis: z.kundennr ? `${k.praxis} · ${z.kundennr}` : k.praxis,
    behandler: z.behandler ? [z.behandler.title, z.behandler.firstName, z.behandler.lastName].filter(Boolean).join(' ') : null,
    behandlung: k.behandlung,
    lieferart: o.deliveryKind ? LIEFERART_NAMEN[o.deliveryKind] : null,
    tempo: k.tempo,
    termin: k.termin,
    eingereicht: o.submittedAt,
    farbe: k.farbe,
    zustaendig: stand.zustaendig?.name ?? null,
    zaehne: marken,
    zaehneText: k.zaehne,
    auswahl: bloecke.map((b) => ({ titel: blockTitel(b), wert: blockText(b, o.config[b.id]) })),
    hinweise: o.treatmentPlan?.trim() || null,
    schritte: stand.zeilen.map((s) => ({ ...s, kurz: initialen(s.von) })),
    material: stand.verwendet.map((v) => `${v.material}${v.farbe ? ` ${v.farbe}` : ''} · LOT ${v.lotNo}`),
    qr: { url, ...qrPfad(url) },
  };
}
