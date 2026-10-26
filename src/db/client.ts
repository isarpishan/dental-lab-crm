import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '@/lib/config';
import * as schema from './schema';

/**
 * اتصال دیتابیس، تنبل (lazy): فقط در اولین استفاده ساخته می‌شود تا
 * `next build` بدون .env هم کار کند. در حالت توسعه روی globalThis می‌ماند تا
 * بارگذاری دوبارهٔ کد اتصال‌های تازه نسازد.
 */
type Db = PostgresJsDatabase<typeof schema>;
const g = globalThis as unknown as { ddlDb?: Db; ddlSql?: postgres.Sql };

export function db(): Db {
  if (!g.ddlDb) {
    g.ddlSql = postgres(config().DATABASE_URL, { max: 10, onnotice: () => {} });
    g.ddlDb = drizzle(g.ddlSql, { schema });
  }
  return g.ddlDb;
}

/** فقط برای اسکریپت‌ها و تست‌ها: بستن اتصال تا پروسه تمام شود. */
export async function dbSchliessen() {
  await g.ddlSql?.end();
  g.ddlSql = undefined;
  g.ddlDb = undefined;
}
