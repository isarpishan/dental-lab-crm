// همهٔ آزمون‌های مرورگر روی یک محیط جدا (قدم ۱۲؛ انتخاب کاربر، ۲ اکتبر ۲۰۲۶):
// - دیتابیس `<نام>_test` که هر بار از نو ساخته می‌شود: migrationها، Stammdaten و دادهٔ نمایشی کامل
// - پوشهٔ فایل `data/test-files`
// - نسخهٔ دوم برنامه روی پورت ۳۱۰۱ (پوشهٔ ساخت `.next-test`) و worker خودش
// برنامه و دادهٔ واقعی (پورت ۳۱۰۰، دیتابیس اصلی) دست نمی‌خورند؛ پس آزمون هم‌زمان با کار کاربر بی‌خطر است.
// Mailpit مشترک است؛ هر آزمون ایمیل‌های خودش (@example.invalid) را پاک می‌کند.
//   pnpm qa                               همهٔ آزمون‌ها
//   pnpm qa qa-reklamation qa-touren      فقط همین‌ها
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import postgres from 'postgres';

const PORT = 3101;
const ALLE = [
  'qa-vorschau',
  'qa-interaktion',
  'qa-anmeldung',
  'qa-stammdaten',
  'qa-tempo',
  'qa-behandlungen',
  'qa-vereinbarung',
  'qa-anfragen',
  'qa-auftrag',
  'qa-portal',
  'qa-freigabe',
  'qa-produktion',
  'qa-touren',
  'qa-reklamation',
  'qa-auftrag-loeschen',
  'qa-benachrichtigung',
  'qa-abrechnung',
  'qa-rechnung',
  'qa-zahlungen',
  'qa-mahnung',
  'qa-belegvorschau',
  'qa-export',
  'qa-ausgaben',
  'qa-ausgaben-ki',
  'qa-handy-scan',
  'qa-uebersicht',
  'qa-privat',
  'qa-fixkosten',
  'qa-bank',
  'qa-steuer',
  'qa-fragen',
  'qa-ablauf',
  'qa-rundgang',
  'qa-sicherheit',
];
const auswahl = process.argv.slice(2).map((n) => n.replace(/^scripts\//, '').replace(/\.mjs$/, ''));
const unbekannt = auswahl.filter((n) => !ALLE.includes(n));
if (unbekannt.length) {
  console.error(`✗ Unbekannte Tests: ${unbekannt.join(', ')}. Vorhanden: ${ALLE.join(', ')}`);
  process.exit(1);
}
const liste = auswahl.length ? auswahl : ALLE;

const haupt = new URL(process.env.DATABASE_URL);
const testDb = `${haupt.pathname.slice(1)}_test`;
const testUrl = new URL(haupt.href);
testUrl.pathname = `/${testDb}`;

const env = {
  ...process.env,
  QA_UMGEBUNG: '1',
  DATABASE_URL: testUrl.href,
  CRM_HOST: `crm.localhost:${PORT}`,
  PORTAL_HOST: `portal.localhost:${PORT}`,
  STORAGE_DIR: './data/test-files',
  NEXT_DIST_DIR: '.next-test',
  // Anfragen von der Website: eine nachgebaute Website in `qa-anfragen.mjs`; der Worker fragt im Test alle 2 Sekunden
  WEBSITE_ANFRAGEN_URL: 'http://127.0.0.1:3197/api/lab-leads',
  WEBSITE_ANFRAGEN_TOKEN: 'qa-website-schluessel-0123456789',
  WEBSITE_ANFRAGEN_TAKT_MS: '2000',
  // Belege lesen: eine nachgebaute Anthropic-API in `qa-ausgaben-ki.mjs` (nie die echte, kostet nichts)
  KI_API_URL: 'http://127.0.0.1:3198',
};
const zeit = () => new Date().toLocaleTimeString('de-AT');
const schritt = (t) => console.log(`\n[${zeit()}] ${t}`);

function ausfuehren(befehl, args) {
  const r = spawnSync(befehl, args, { env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`${befehl} ${args.join(' ')} fehlgeschlagen`);
  }
  return r.stdout;
}

/** باقی‌ماندهٔ یک اجرای نیمه‌کاره: برنامه روی پورت آزمون و worker آزمون */
function resteBeenden() {
  const pids = [
    ...spawnSync('lsof', ['-tiTCP:' + PORT, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.split('\n'),
    ...spawnSync('pgrep', ['-f', 'src/worker/index[.]ts --qa'], { encoding: 'utf8' }).stdout.split('\n'),
  ].filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {}
  }
  return pids.length;
}

const prozesse = [];
function starten(name, befehl, args) {
  mkdirSync('data/logs', { recursive: true });
  const log = openSync(`data/logs/qa-${name}.log`, 'w');
  const p = spawn(befehl, args, { env, detached: true, stdio: ['ignore', log, log] });
  prozesse.push(p);
  return p;
}
function aufhoeren() {
  for (const p of prozesse) {
    try {
      process.kill(-p.pid, 'SIGTERM');
    } catch {}
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    aufhoeren();
    process.exit(130);
  });
}

async function bereit(url, timeout = 180_000) {
  const ende = Date.now() + timeout;
  while (Date.now() < ende) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return true;
    } catch {}
    await new Promise((x) => setTimeout(x, 1000));
  }
  return false;
}

const ergebnisse = [];
try {
  if (resteBeenden()) await new Promise((x) => setTimeout(x, 2000));

  schritt(`Test-Datenbank »${testDb}« neu anlegen`);
  const admin = postgres(haupt.href, { onnotice: () => {} });
  await admin.unsafe(`drop database if exists "${testDb}" with (force)`);
  await admin.unsafe(`create database "${testDb}"`);
  await admin.end();
  await rm('data/test-files', { recursive: true, force: true });
  ausfuehren('pnpm', ['db:migrate']);
  console.log(ausfuehren('pnpm', ['seed', '--demo']).split('\n').filter((z) => z.startsWith('✓')).join('\n'));

  schritt(`Testprogramm auf Port ${PORT} und Test-Worker starten`);
  starten('programm', 'node_modules/.bin/next', ['dev', '--port', String(PORT)]);
  starten('worker', 'node_modules/.bin/tsx', ['--env-file-if-exists=.env', 'src/worker/index.ts', '--qa']);
  if (!(await bereit(`http://localhost:${PORT}/anmelden`))) throw new Error('Das Testprogramm startet nicht (data/logs/qa-programm.log).');
  // ساختن اولیهٔ صفحه‌های عمومی، تا اولین آزمون منتظرش نماند
  for (const pfad of ['/anmelden', '/vorschau']) await fetch(`http://localhost:${PORT}${pfad}`).catch(() => null);

  for (const name of liste) {
    schritt(`=== ${name}`);
    const r = spawnSync('node', ['--env-file=.env', `scripts/${name}.mjs`], { env, stdio: 'inherit' });
    ergebnisse.push({ name, ok: r.status === 0 });
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  ergebnisse.push({ name: 'Testumgebung', ok: false });
} finally {
  aufhoeren();
}

console.log('\n── Ergebnis ──');
for (const e of ergebnisse) console.log(`${e.ok ? '✓' : '✗'} ${e.name}`);
const fehlgeschlagen = ergebnisse.filter((e) => !e.ok).length;
console.log(fehlgeschlagen ? `\n${fehlgeschlagen} Test(s) fehlgeschlagen.` : '\nAlle Tests bestanden.');
process.exit(fehlgeschlagen ? 1 : 0);
