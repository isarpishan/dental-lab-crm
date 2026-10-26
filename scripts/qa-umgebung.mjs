import { readFileSync } from 'node:fs';

// آدرس‌های محیط آزمون (قدم ۱۲). آزمون‌ها فقط از راه `pnpm qa` (`scripts/qa.mjs`) اجرا می‌شوند: دیتابیس
// جدا (`…_test`)، پوشهٔ فایل جدا و برنامهٔ جدا روی پورت ۳۱۰۱. این قفل نمی‌گذارد آزمونی روی برنامه و
// دادهٔ واقعی (پورت ۳۱۰۰) اجرا شود.
const db = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  } catch {
    return '';
  }
})();
if (process.env.QA_UMGEBUNG !== '1' || !db.endsWith('_test')) {
  console.error('✗ Die Tests laufen nur in der eigenen Testumgebung. Bitte so starten: pnpm qa');
  process.exit(1);
}
export const CRM = `http://${process.env.CRM_HOST}`;
export const PORTAL = `http://${process.env.PORTAL_HOST}`;
export const BASIS = `http://localhost:${new URL(CRM).port}`;

// Vereinbarung (پورتال تا پذیرش بسته است): Ordinationهای آزمایشی آن را مستقیم در دیتابیس «پذیرفته‌اند»،
// تا آزمون‌های دیگر به صفحهٔ /vereinbarung نخورند. خود صفحه و پذیرش را `qa-vereinbarung` می‌آزماید.
// نسخه از خود کد خوانده می‌شود، چون آزمون‌ها TypeScript را import نمی‌کنند.
export const VEREINBARUNG_VERSION = readFileSync(new URL('../src/lib/vereinbarung/text.ts', import.meta.url), 'utf8').match(/VEREINBARUNG_VERSION = '([^']+)'/)[1];

export async function vereinbarungAngenommen(sql, praxisId, nutzerId) {
  await sql`insert into ddl.practice_agreements (practice_id, version, inhalt, sha256, accepted_by_id, accepted_by_name, accepted_by_email)
    select ${praxisId}, ${VEREINBARUNG_VERSION}, ${sql.json({ qa: true })}, 'qa', u.id, u.name, u.email from ddl.practice_users u where u.id = ${nutzerId}
    on conflict (practice_id, version) do nothing`;
}

/** پیش از پاک‌کردن Ordinationهای آزمایشی یا کاربرانشان؛ trigger فقط با این تنظیم اجازه می‌دهد. */
export async function vereinbarungenLoeschen(sql, praxen) {
  if (!praxen.length) return;
  await sql.begin(async (tx) => {
    await tx`set local ddl.vereinbarung_loeschen = 'qa'`;
    await tx`delete from ddl.practice_agreements where practice_id in ${tx(praxen)}`;
  });
}
