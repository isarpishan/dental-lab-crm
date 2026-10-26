import type { LieferOptionen } from '@/db/schema';
import type { Lieferart } from '@/lib/orders/assistent';
import { euroBetrag } from './preise';

/**
 * قیمت «ab» هر Lieferart برای فرم «Neuer Auftrag» و صفحهٔ هر سفارش. جدا از `auswahl.ts`
 * تا مرورگر برای این چند تابع کل کاتالوگ را بار نکند.
 */

/** برای هر Lieferartی که هست: «ab € 250 pro Zahn»، یا null تا Inhaber قیمتی وارد کند. */
export type AbPreise = Partial<Record<Lieferart, string | null>>;

/** نام کوتاه Lieferart روی کاشی‌ها؛ نام کامل در `LIEFERART_NAMEN`. */
const LIEFERART_KURZ: Record<Lieferart, string> = { fertigung: 'Fertig', design: 'Nur Design' };

/** فاصلهٔ نشکن: کاشی باریک خط را فقط بین نام و مبلغ می‌شکند، نه وسط «ab € 89,50 pro Zahn». */
const amStueck = (t: string) => t.replace(/ /g, '\u00a0');

export function optionPreis(o: LieferOptionen[Lieferart]): string | null {
  return o?.preisAb != null ? `ab ${euroBetrag(o.preisAb)} pro ${o.einheit}` : null;
}

/** قیمت «ab» هر Lieferart؛ برای یک گروه، کمترین از بین اعضایی که آن Lieferart را دارند. */
export function abPreise(...alle: LieferOptionen[]): AbPreise {
  const preise: AbPreise = {};
  for (const l of ['fertigung', 'design'] as const) {
    const optionen = alle.flatMap((o) => (o[l] ? [o[l]] : []));
    if (!optionen.length) continue;
    const mitPreis = optionen.filter((o) => o.preisAb != null);
    preise[l] = mitPreis.length ? optionPreis(mitPreis.reduce((a, b) => (b.preisAb! < a.preisAb! ? b : a))) : null;
  }
  return preise;
}

/** قیمت یک Lieferart، یا «Preis auf Anfrage». */
export const lieferPreis = (preise: AbPreise, l: Lieferart) => preise[l] ?? 'Preis auf Anfrage';

/**
 * خط‌های قیمت روی کاشی (خواستهٔ کاربر، ۵ اکتبر ۲۰۲۶): هر Lieferart با نام خودش، «Fertig ab € 250
 * pro Zahn» و «Nur Design ab € 50 pro Zahn». پیش از این فقط ارزان‌ترین عدد بی‌نام می‌آمد که
 * همیشه قیمت Design بود و برای کار آماده گمراه‌کننده. Fertig اول، مگر Ordination «Nur Design»
 * را Standard گذاشته باشد. تا هیچ قیمتی نیست: فقط «Preis auf Anfrage».
 */
export function preisZeilen(preise: AbPreise, zuerst: Lieferart | null = null): string[] {
  const reihenfolge: Lieferart[] = zuerst === 'design' ? ['design', 'fertigung'] : ['fertigung', 'design'];
  const da = reihenfolge.filter((l) => l in preise);
  if (!da.some((l) => preise[l])) return ['Preis auf Anfrage'];
  return da.map((l) => `${amStueck(LIEFERART_KURZ[l])} ${amStueck(preise[l] ?? 'auf Anfrage')}`);
}
