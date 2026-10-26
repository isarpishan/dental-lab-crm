// آزمون قدم ۵ فاز ۲ در Chrome: خروجی Excel برای Steuerberater از صفحهٔ «Abrechnung». سندها و پرداخت‌های آزمایشی
// در مارس ۲۰۲۰ (دوره‌ای که هیچ دادهٔ دیگری ندارد)؛ دانلود از فرم، بعد هر چهار برگه خوانده و سنجیده می‌شود:
// Übersicht، Rechnungen (وضعیت در Stichtag)، Zahlungen (فقط دوره)، Offene Posten (با روزهای überfällig).
// همچنین دورهٔ نادرست، لینک‌های آماده، نقش‌ها و audit.
// دادهٔ آزمایشی: «QA · Export …»، @example.invalid، شماره‌های «QA-EX-…»؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-export  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const BILDER = process.env.QA_BILDER ?? null;
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};
const sichtbar = async (loc, timeout = 8000) => {
  try {
    await loc.waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
};
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
/** عدد تاریخ Excel */
const serie = (t) => Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10))) / 86_400_000 + 25_569;

/** یک برگهٔ xlsx به‌صورت آرایهٔ ردیف‌ها (متن یا عدد)؛ ZIP را `unzip` خود macOS باز می‌کند */
function blatt(datei, nr) {
  const x = execFileSync('unzip', ['-p', datei, `xl/worksheets/sheet${nr}.xml`]).toString('utf8');
  const zeilen = [];
  for (const [, inhalt] of x.matchAll(/<row r="\d+">(.*?)<\/row>/g)) {
    const zeile = [];
    for (const [, spalte, t, v] of inhalt.matchAll(/<c r="([A-Z]+)\d+"[^>]*>(?:<is><t[^>]*>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/g)) {
      const i = [...spalte].reduce((s, z) => s * 26 + z.charCodeAt(0) - 64, 0) - 1;
      zeile[i] = t !== undefined ? t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : Number(v);
    }
    zeilen.push(Array.from(zeile, (w) => w ?? null));
  }
  return zeilen;
}

function totp(geheimnis) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, wert = 0;
  const aus = [];
  for (const z of geheimnis.replace(/\s/g, '')) {
    wert = (wert << 5) | A.indexOf(z);
    bits += 5;
    if (bits >= 8) { aus.push((wert >>> (bits - 8)) & 255); bits -= 8; }
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', Buffer.from(aus)).update(b).digest();
  const v = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(v) & 0x7fffffff) % 1e6).padStart(6, '0');
}

const STAFF = ['test-export@example.invalid', 'test-export-buero@example.invalid', 'test-export-tech@example.invalid'];
const HINWEIS = 'Steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.';

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Export%'`).map((r) => r.id);
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  if (praxen.length) {
    await sql.begin(async (tx) => {
      await tx`set local ddl.rechnungen_loeschen = 'qa'`;
      await tx`delete from ddl.invoices where practice_id in ${tx(praxen)} and bezug_id is not null`;
      await tx`delete from ddl.invoices where practice_id in ${tx(praxen)}`;
    });
    await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  }
  if (staff.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(staff)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(staff)}`;
    await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  }
}
await aufraeumen();

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
async function anmelden(email, name, rolle) {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${email}, ${name}, ${rolle}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-export-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-export-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => x.href.startsWith(`${CRM}/`) && !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

/** سند مستقیم در دیتابیس (فایل PDF برای خروجی لازم نیست؛ trigger فقط تغییر و حذف را می‌بندد) */
async function beleg(praxis, w) {
  const [r] = await sql`insert into ddl.invoices (nummer, art, storno, practice_id, bezug_id, abrechnung, zeitraum_von, zeitraum_bis, ausgestellt_am, faellig_am,
      summe_cent, empfaenger, aussteller, grund, storage_key, sha256, size, ausgestellt_von_label)
    values (${w.nummer}, ${w.art ?? 'rechnung'}, ${w.storno ?? false}, ${praxis}, ${w.bezug ?? null}, ${w.art === 'gutschrift' ? 'gutschrift' : 'sammel'},
      ${w.von ?? null}, ${w.bis ?? null}, ${`${w.am} 10:00+01`}, ${w.faellig ?? null}, ${w.cent},
      ${sql.json({ name: 'QA · Export Ordination', zeilen: ['Exportgasse 1', '1010 Wien'], uid: 'ATU99999999', kundennummer: 'QA-EX1' })},
      ${sql.json({ name: 'Isar Pishan · Digital Dental Lab', hinweis: HINWEIS })}, ${w.grund ?? null},
      ${`qa-export/${w.nummer}`}, ${'0'.repeat(64)}, 1, 'QA') returning id`;
  return r.id;
}

try {
  const [P] = await sql`insert into ddl.practices (customer_no, name, billing_mode) values ('QA-EX1', 'QA · Export Ordination', 'sammel') returning id`;
  await beleg(P.id, { nummer: 'QA-EX-R0', am: '2020-02-10', faellig: '2020-02-24', cent: 3000, von: '2020-01-01', bis: '2020-01-31' });
  const r1 = await beleg(P.id, { nummer: 'QA-EX-R1', am: '2020-03-05', faellig: '2020-03-19', cent: 22000, von: '2020-02-01', bis: '2020-02-29' });
  const r2 = await beleg(P.id, { nummer: 'QA-EX-R2', am: '2020-03-20', faellig: '2020-04-03', cent: 10000, von: '2020-03-12', bis: '2020-03-12' });
  await beleg(P.id, { nummer: 'QA-EX-G1', art: 'gutschrift', bezug: r2, am: '2020-03-25', cent: -2000, grund: 'QA Kulanz' });
  await beleg(P.id, { nummer: 'QA-EX-R3', am: '2020-04-10', faellig: '2020-04-24', cent: 5000 });
  await sql`insert into ddl.payments (invoice_id, practice_id, betrag_cent, eingegangen_am, art, notiz, erfasst_von_label) values
    (${r1}, ${P.id}, 22000, '2020-03-18', 'ueberweisung', 'QA Auszug 3', 'QA'),
    (${r2}, ${P.id}, 5000, '2020-04-15', 'bar', null, 'QA')`;

  const { s } = await anmelden(STAFF[0], 'Test Export', 'inhaber');
  await s.goto(`${CRM}/abrechnung?tab=export`);
  const form = s.getByRole('form', { name: 'Export für die Steuerberatung' });
  const vm = new Date();
  vm.setDate(1);
  vm.setMonth(vm.getMonth() - 1);
  const monat = new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(vm);
  const vmVon = `${iso(vm).slice(0, 7)}-01`;
  pruefen((await form.getByLabel('Von').inputValue()) === vmVon, 'Formular: Vormonat vorausgewählt');
  const link = await s.getByRole('link', { name: monat }).getAttribute('href');
  pruefen(Boolean(link?.startsWith(`/api/abrechnung/export?von=${vmVon}&bis=`)), `Direkt-Link »${monat}« zeigt auf den Export des Vormonats`);

  // دورهٔ نادرست: پیش از ارسال گفته می‌شود، هیچ دانلودی
  await form.getByLabel('Von').fill('2020-03-31');
  await form.getByLabel('Bis').fill('2020-03-01');
  await form.getByRole('button', { name: 'Excel herunterladen' }).click();
  pruefen(await sichtbar(form.getByText('Das Von-Datum liegt nach dem Bis-Datum.')), 'Von nach Bis: Hinweis, kein Download');

  await form.getByLabel('Von').fill('2020-03-01');
  await form.getByLabel('Bis').fill('2020-03-31');
  const [dl] = await Promise.all([s.waitForEvent('download'), form.getByRole('button', { name: 'Excel herunterladen' }).click()]);
  const datei = path.join(tmpdir(), 'ddl-qa-export.xlsx');
  await dl.saveAs(datei);
  pruefen(dl.suggestedFilename() === 'DDL_Buchhaltung_2020-03-01_bis_2020-03-31.xlsx', `Download: ${dl.suggestedFilename()}`);
  if (BILDER) await s.screenshot({ path: path.join(BILDER, 'x1-export.png'), fullPage: true });

  const mappe = execFileSync('unzip', ['-p', datei, 'xl/workbook.xml']).toString('utf8');
  pruefen(['Übersicht', 'Rechnungen', 'Zahlungen', 'Offene Posten'].every((n) => mappe.includes(`name="${n}"`)), 'Excel: vier Blätter (Übersicht, Rechnungen, Zahlungen, Offene Posten)');

  const ueb = blatt(datei, 1);
  const zeile = (name) => ueb.find((z) => z[0] === name) ?? [];
  pruefen(zeile('Zeitraum (Belegdatum)')[1] === '01.03.2020 – 31.03.2020' && zeile('Stichtag für Zahlstand und offene Posten')[1] === '31.03.2020', 'Übersicht: Zeitraum und Stichtag (Ende des Zeitraums)');
  pruefen(
    zeile('Rechnungen')[2] === 2 && zeile('Rechnungen')[3] === 320 && zeile('Gutschriften und Stornorechnungen')[3] === -20 && zeile('Summe der Belege (netto)')[3] === 300 &&
      zeile('Zahlungseingänge')[2] === 1 && zeile('Zahlungseingänge')[3] === 220 && zeile('Offene Posten am Stichtag')[2] === 2 && zeile('Offene Posten am Stichtag')[3] === 110,
    'Übersicht: Rechnungen € 320, Gutschriften -€ 20, Summe € 300, Zahlungen € 220, offene Posten € 110',
  );
  pruefen(zeile('Aussteller')[1] === 'Isar Pishan · Digital Dental Lab' && zeile('Steuerhinweis auf den Rechnungen')[1] === HINWEIS, 'Übersicht: Aussteller und Steuerhinweis');

  const re = blatt(datei, 2);
  const k = re[0];
  const sp = (z, titel) => z[k.indexOf(titel)];
  const nr = re.slice(1).map((z) => z[0]);
  pruefen(nr.join() === 'QA-EX-R1,QA-EX-R2,QA-EX-G1', `Rechnungen: nur der Zeitraum, nach Datum (${nr.join(', ')})`);
  const [z1, z2, g] = re.slice(1);
  pruefen(
    sp(z1, 'Belegdatum') === serie('2020-03-05') && sp(z1, 'Leistung bis') === serie('2020-02-29') && sp(z1, 'Fällig am') === serie('2020-03-19') && sp(z1, 'Betrag (EUR)') === 220 && sp(z1, 'Kunde') === 'QA · Export Ordination' && sp(z1, 'UID Kunde') === 'ATU99999999',
    'Rechnungen: Datum als Excel-Datum, Betrag in Euro, Kunde und UID wie auf der Rechnung',
  );
  pruefen(sp(z1, 'Status am Stichtag') === 'bezahlt' && sp(z1, 'Bezahlt am Stichtag') === 220 && sp(z1, 'Offen am Stichtag') === 0, 'R1: am Stichtag bezahlt');
  pruefen(sp(z2, 'Status am Stichtag') === 'offen' && sp(z2, 'Bezahlt am Stichtag') === 0 && sp(z2, 'Offen am Stichtag') === 80, 'R2: Zahlung nach dem Stichtag zählt nicht, Gutschrift schon (offen € 80)');
  pruefen(sp(g, 'Belegart') === 'Gutschrift' && sp(g, 'Betrag (EUR)') === -20 && sp(g, 'Zu Rechnung') === 'QA-EX-R2' && sp(g, 'Grund') === 'QA Kulanz' && sp(g, 'Status am Stichtag') == null, 'Gutschrift: negativ, mit Bezug und Grund');
  pruefen(sp(z1, 'Steuerhinweis') === HINWEIS && !k.some((t) => /USt|MwSt|Steuer \(/.test(t)), 'Steuerhinweis je Beleg, keine Steuerspalte');

  const za = blatt(datei, 3);
  pruefen(za.length === 2 && za[1][0] === serie('2020-03-18') && za[1][1] === 220 && za[1][2] === 'Überweisung' && za[1][3] === 'QA-EX-R1' && za[1][7] === 'QA Auszug 3', 'Zahlungen: nur die im Zeitraum, mit Art, Rechnung und Notiz');

  const op = blatt(datei, 4);
  const ok = op[0];
  const r0 = op.find((z) => z[0] === 'QA-EX-R0');
  const o2 = op.find((z) => z[0] === 'QA-EX-R2');
  pruefen(
    op.length === 3 && r0 && r0[ok.indexOf('Offen')] === 30 && r0[ok.indexOf('Tage überfällig')] === 36 && o2 && o2[ok.indexOf('Gutschriften')] === -20 && o2[ok.indexOf('Tage überfällig')] === 0 && !op.some((z) => z[0] === 'QA-EX-R3'),
    'Offene Posten am Stichtag: R0 (36 Tage überfällig) und R2, nicht die spätere R3',
  );

  const [a] = await sql`select details from ddl.audit_log where action = 'buchhaltung_exportiert' order by created_at desc limit 1`;
  pruefen(a?.details?.von === '2020-03-01' && a.details.belege === 3 && a.details.zahlungen === 1, 'Audit: Export mit Zeitraum und Anzahl');
  const falsch = await s.request.get(`${CRM}/api/abrechnung/export?von=2020-02-30&bis=2020-03-01`);
  pruefen(falsch.status() === 400, 'ungültiges Datum direkt an die Adresse: 400');

  // نقش‌ها
  const { s: b } = await anmelden(STAFF[1], 'Test Büro', 'buero');
  const ab = await b.request.get(`${CRM}/api/abrechnung/export?von=2020-03-01&bis=2020-03-31`);
  pruefen(ab.ok() && /spreadsheetml/.test(ab.headers()['content-type'] ?? ''), 'Büro: Export erlaubt');
  const { s: t } = await anmelden(STAFF[2], 'Test Technik', 'techniker');
  const at = await t.request.get(`${CRM}/api/abrechnung/export?von=2020-03-01&bis=2020-03-31`);
  pruefen(at.status() === 401, 'Techniker: kein Export (401)');

  // موبایل
  const zuBreit = [];
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 800 });
    await s.goto(`${CRM}/abrechnung?tab=export`, { waitUntil: 'networkidle' });
    const w = await s.evaluate(() => document.documentElement.scrollWidth);
    if (w > breite + 1) zuBreit.push(`${breite}px: ${w}px`);
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (390 und 320 px)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
