import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { dentists, orders, practices, workTypes } from '@/db/schema';
import { eintragAus } from '@/lib/katalog/auswahl';
import { blockText, blockTitel, LIEFERART_NAMEN, sichtbareBloecke } from '@/lib/orders/assistent';
import { produktionsStand } from '@/lib/produktion/stand';

/**
 * داده‌های Lieferschein و Konformitätserklärung (Spec فاز ۱، بخش K). فقط **کد بیمار**؛ MDR برای
 * Sonderanfertigung کد مستعار را کافی می‌داند. Hinweise آزاد Ordination عمداً روی سند نمی‌آیند،
 * چون ممکن است نام بیمار در آن‌ها باشد؛ «Merkmale» همان جواب‌های فرم‌اند، مثل Laufzettel.
 */
export type DokumentDaten = {
  orderNo: string;
  patientCode: string;
  behandlung: string;
  zaehne: string | null;
  farbe: string | null;
  lieferart: string | null;
  behandler: string | null;
  praxis: { name: string; strasse: string | null; ort: string | null; kundennr: string };
  merkmale: { titel: string; wert: string }[];
  material: { name: string; lotNo: string }[];
  geraete: string[];
  /** Implantatversorgung: Aufbewahrung 15 statt 10 Jahre */
  implantat: boolean;
};

export async function dokumentDaten(orderId: string): Promise<DokumentDaten | null> {
  const [[z], stand] = await Promise.all([
    db()
      .select({ o: orders, wt: workTypes, praxis: practices, behandler: dentists })
      .from(orders)
      .innerJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .innerJoin(practices, eq(practices.id, orders.practiceId))
      .leftJoin(dentists, eq(dentists.id, orders.dentistId))
      .where(eq(orders.id, orderId))
      .limit(1),
    produktionsStand(orderId),
  ]);
  if (!z || !stand || !z.o.orderNo) return null;
  const { o, wt, praxis: p } = z;
  const eintrag = eintragAus(wt);
  const merkmale = sichtbareBloecke(eintrag.formSchema, o.config)
    .filter((b) => o.config[b.id] !== undefined)
    .map((b) => ({ titel: blockTitel(b), wert: blockText(b, o.config[b.id]) }));
  return {
    orderNo: stand.kopf.orderNo,
    patientCode: stand.kopf.patientCode ?? '–',
    behandlung: wt.name,
    zaehne: stand.kopf.zaehne,
    farbe: o.shade,
    lieferart: o.deliveryKind ? LIEFERART_NAMEN[o.deliveryKind] : null,
    behandler: z.behandler ? [z.behandler.title, z.behandler.firstName, z.behandler.lastName].filter(Boolean).join(' ') : null,
    praxis: { name: p.name, strasse: p.street, ort: [p.zip, p.city].filter(Boolean).join(' ') || null, kundennr: p.customerNo },
    merkmale,
    material: stand.verwendet.map((v) => ({ name: v.material, lotNo: v.lotNo })),
    geraete: [...new Set(stand.zeilen.flatMap((s) => (s.geraet ? [s.geraet] : [])))],
    implantat: wt.key.includes('implantat') || merkmale.some((m) => /implantat/i.test(m.titel)),
  };
}
