// کمک مشترک آزمون‌ها (قدم ۱۰): اسناد (Lieferschein، Konformitätserklärung) و Reklamationهای سفارش‌های
// آزمایشی را با فایل‌های PDF پاک می‌کند، و شمارنده‌های سفارش، سند و Reklamation را برمی‌گرداند.
// اسناد در دیتابیس غیرقابل‌تغییرند؛ trigger فقط در تراکنشی که `ddl.dokumente_loeschen = 'qa'` گفته پاک‌کردن را می‌پذیرد.
import { rm } from 'node:fs/promises';
import path from 'node:path';

const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');

export async function belegeLoeschen(sql, orderIds) {
  if (!orderIds.length) return;
  const dateien = await sql`select storage_key from ddl.documents where order_id in ${sql(orderIds)}`;
  await sql.begin(async (tx) => {
    await tx`set local ddl.dokumente_loeschen = 'qa'`;
    await tx`delete from ddl.documents where order_id in ${tx(orderIds)}`;
  });
  for (const d of dateien) await rm(path.join(SPEICHER, d.storage_key), { force: true });
  await sql`delete from ddl.complaints where order_id in ${sql(orderIds)}`;
}

/** شمارنده‌هایی که آزمون‌ها مصرف می‌کنند، و جایی که شمارهٔ واقعی‌شان ذخیره است. */
const QUELLEN = {
  auftrag: (sql, jahr) => sql`select coalesce(max(substring(order_no from 8)::int), 0) as n from ddl.orders where order_no ~ ${`^A-${jahr}-\\d{4}$`}`,
  konformitaet: (sql, jahr) => sql`select coalesce(max(substring(doc_no from 9)::int), 0) as n from ddl.documents where doc_no ~ ${`^KE-${jahr}-\\d{4}$`}`,
  lieferschein: (sql, jahr) => sql`select coalesce(max(substring(doc_no from 9)::int), 0) as n from ddl.documents where doc_no ~ ${`^LS-${jahr}-\\d{4}$`}`,
  reklamation: (sql, jahr) => sql`select coalesce(max(substring(complaint_no from 9)::int), 0) as n from ddl.complaints where complaint_no ~ ${`^RK-${jahr}-\\d{4}$`}`,
};

/** فقط شمارنده‌هایی که آزمون‌ها مصرف می‌کنند (Kundennummer را کسی در همان لحظه شاید واقعاً بگیرد). */
export const zaehlerStand = (sql) => sql`select scope, year, last_value from ddl.number_sequences where scope in ${sql(Object.keys(QUELLEN))} order by scope, year`;

/**
 * بعد از پاک‌شدن دادهٔ آزمایشی: هر شمارنده = بیشترِ «مقدار پیش از آزمون» و «بالاترین شمارهٔ واقعیِ
 * باقی‌مانده». پس اگر کسی هم‌زمان در برنامه یک شمارهٔ واقعی گرفته باشد، شمارنده هرگز پایین‌تر از آن نمی‌رود.
 */
export async function belegZaehlerZurueck(sql, vorher) {
  for (const [scope, hoechste] of Object.entries(QUELLEN)) {
    for (const { year } of await sql`select year from ddl.number_sequences where scope = ${scope}`) {
      const alt = vorher.find((x) => x.scope === scope && x.year === year)?.last_value ?? 0;
      const [{ n }] = await hoechste(sql, year);
      const wert = Math.max(alt, n);
      if (wert > 0) await sql`update ddl.number_sequences set last_value = ${wert} where scope = ${scope} and year = ${year}`;
      else await sql`delete from ddl.number_sequences where scope = ${scope} and year = ${year}`;
    }
  }
}
