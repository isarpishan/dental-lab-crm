import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { settings, workTypes } from '@/db/schema';
import { katalogAus, type AuswahlKatalog } from './auswahl';
import { IMPLANTAT_HERSTELLER } from './stammdaten';

/** کاتالوگ فرم سفارش از دیتابیس: Behandlungهای فعال با قیمت‌های فعلی Inhaber. */
export async function auswahlKatalogAusDb(): Promise<AuswahlKatalog> {
  const [zeilen, [hersteller]] = await Promise.all([
    db().select().from(workTypes).where(eq(workTypes.isActive, true)).orderBy(asc(workTypes.position)),
    db().select({ value: settings.value }).from(settings).where(eq(settings.key, 'implantat_hersteller')).limit(1),
  ]);
  const liste = Array.isArray(hersteller?.value) ? (hersteller.value as string[]) : IMPLANTAT_HERSTELLER;
  return katalogAus(zeilen, liste);
}
