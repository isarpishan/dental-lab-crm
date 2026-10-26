/**
 * پروسهٔ پشت‌صحنه: کارهای صف (`jobs`) را یکی‌یکی انجام می‌دهد. الگوی Content
 * Studio، روی Postgres با `FOR UPDATE SKIP LOCKED` تا چند worker هم‌زمان یک کار
 * را برندارند. `AppError` یعنی تکرار فایده ندارد؛ بقیهٔ خطاها با فاصلهٔ بیشتر
 * دوباره امتحان می‌شوند.
 *   اجرا: pnpm worker
 */
import { sql } from 'drizzle-orm';
import { db, dbSchliessen } from '@/db/client';
import { AppError } from '@/lib/errors';
import { fixkostenAusfuehren } from '@/lib/fixkosten/lauf';
import { heuteIso } from '@/lib/format';
import { anfragenAbrufen, anfrageStatusMelden, websiteVerbindung } from '@/lib/website/anfragen';
import { benachrichtigungSenden } from './handlers/benachrichtigung';
import { emailMitAnhangSenden, emailSenden } from './handlers/email';

type Handler = (payload: unknown) => Promise<unknown>;
const HANDLER: Record<string, Handler> = {
  email_senden: emailSenden,
  email_mit_anhang: emailMitAnhangSenden,
  benachrichtigung: benachrichtigungSenden,
  // «Jetzt abrufen» in CRM و گزارش وضعیت به سایت (درخواست‌های پورتال)
  website_anfragen_abrufen: () => anfragenAbrufen(),
  website_anfrage_status: (p) => anfrageStatusMelden(p),
};

let stopp = false;
const zeit = () => new Date().toISOString().slice(11, 19);

type Job = { id: string; type: string; payload: unknown; attempts: number; max_attempts: number };

async function naechsterJob(): Promise<Job | null> {
  const zeilen = await db().execute<Job>(sql`
    update ddl.jobs set status = 'laufend', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from ddl.jobs
      where status = 'wartend' and run_after <= now()
      order by created_at
      for update skip locked
      limit 1
    )
    returning id, type, payload, attempts, max_attempts`);
  return zeilen[0] ?? null;
}

async function einen(): Promise<boolean> {
  const job = await naechsterJob();
  if (!job) return false;
  const handler = HANDLER[job.type];
  try {
    if (!handler) throw new AppError(`Kein Handler für «${job.type}»`);
    const ergebnis = await handler(job.payload);
    await db().execute(sql`update ddl.jobs set status = 'fertig', output = ${JSON.stringify(ergebnis ?? null)}::jsonb, finished_at = now(), error = null where id = ${job.id}`);
    console.log(`[${zeit()}] ✔ ${job.type} ${job.id}`);
  } catch (e) {
    const endgueltig = e instanceof AppError || job.attempts >= job.max_attempts;
    const text = e instanceof Error ? e.message : String(e);
    const warten = 30 * job.attempts * job.attempts;
    await db().execute(sql`
      update ddl.jobs set
        status = ${endgueltig ? 'fehler' : 'wartend'},
        error = ${text},
        run_after = now() + make_interval(secs => ${warten}),
        finished_at = ${endgueltig ? sql`now()` : null}
      where id = ${job.id}`);
    console.log(`[${zeit()}] ✘ ${job.type} ${job.id}${endgueltig ? '' : ` (neuer Versuch in ${warten}s)`}: ${text}`);
  }
  return true;
}

// درخواست‌های پورتال از سایت: هر ۵ دقیقه، فقط اگر کلید تنظیم شده (`ddl website`). خطا فقط یک بار در گزارش،
// تا سایتِ در دسترس نبودن گزارش را پر نکند؛ وضعیت در CRM دیده می‌شود (`settings.website_abruf`).
const ABRUF_TAKT = Number(process.env.WEBSITE_ANFRAGEN_TAKT_MS) || 5 * 60_000;
let naechsterAbruf = 0;
let abrufFehler = false;
async function websiteAbruf() {
  if (!websiteVerbindung() || Date.now() < naechsterAbruf) return;
  naechsterAbruf = Date.now() + ABRUF_TAKT;
  try {
    const r = await anfragenAbrufen();
    if (r?.neu) console.log(`[${zeit()}] ✔ Website: ${r.neu} neue Anfrage(n) für das Praxisportal`);
    abrufFehler = false;
  } catch (e) {
    if (!abrufFehler) console.log(`[${zeit()}] ✘ Website-Anfragen: ${e instanceof Error ? e.message : String(e)}`);
    abrufFehler = true;
  }
}

// «Fixkosten» (Spec فاز ۵، قدم ۳): هر ساعت یک بار، تا Privat در روز سررسید ثبت شود حتی اگر کسی صفحه را باز نکند.
// صفحه‌ها هم پیش از خواندن همین را صدا می‌زنند؛ دو اجرای هم‌زمان بی‌خطرند (unique روی Vorlage و Periode).
let naechsteFixkosten = 0;
async function fixkosten() {
  if (Date.now() < naechsteFixkosten) return;
  naechsteFixkosten = Date.now() + 60 * 60_000;
  try {
    const r = await fixkostenAusfuehren(heuteIso());
    if (r.privat || r.ddl) console.log(`[${zeit()}] ✔ Fixkosten: ${r.privat} privat gebucht, ${r.ddl} für das Labor unter »Zu prüfen«`);
  } catch (e) {
    console.log(`[${zeit()}] ✘ Fixkosten: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function haengendeFreigeben() {
  // کاری که worker قبلی وسطش متوقف شده، دوباره در صف
  await db().execute(sql`update ddl.jobs set status = 'wartend' where status = 'laufend' and locked_at < now() - interval '10 minutes'`);
}

process.on('SIGINT', () => (stopp = true));
process.on('SIGTERM', () => (stopp = true));

console.log(`[${zeit()}] Worker gestartet`);
await haengendeFreigeben();
while (!stopp) {
  await websiteAbruf();
  await fixkosten();
  const gearbeitet = await einen().catch((e) => {
    console.error(`[${zeit()}] Fehler in der Schleife:`, e);
    return false;
  });
  if (!gearbeitet) await new Promise((r) => setTimeout(r, 2000));
}
await dbSchliessen();
console.log(`[${zeit()}] Worker beendet`);
