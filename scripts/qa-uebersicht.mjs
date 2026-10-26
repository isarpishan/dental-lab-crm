// آزمون «Übersicht» در Chrome (Spec فاز ۵، قدم ۱): تب «Übersicht» فقط برای Inhaber، چهار عدد ماه برابر جمع خود
// دیتابیس (Ausgaben حذف‌نشده بر اساس «Bezahlt am»، پرداخت‌ها بر اساس «eingegangen am»)، ماه قبل با «‹»، نه ماه آینده،
// تب «Kategorien»، ماه نامعتبر در نشانی، Büro بدون دسترسی، موبایل ۳۹۰ و ۳۲۰ پیکسل.
// دادهٔ آزمایشی: «QA · …»، @example.invalid؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-uebersicht  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
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
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
const euro = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const centText = (c) => euro.format(c / 100);
const normal = (t) => (t ?? '').replace(/\s+/g, ' ').trim();

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

const INHABER = 'test-uebersicht@example.invalid';
const BUERO = 'test-uebersicht-buero@example.invalid';

async function aufraeumen() {
  await sql.begin(async (tx) => {
    await tx`set local ddl.rechnungen_loeschen = 'qa'`;
    await tx`delete from ddl.invoices where nummer like 'QA-UE-%' and bezug_id is not null`;
    await tx`delete from ddl.invoices where nummer like 'QA-UE-%'`;
  });
  const zeilen = await sql`select id from ddl.expenses where lieferant like 'QA · Übersicht%'`;
  if (zeilen.length) {
    await sql`delete from ddl.audit_log where target_id in ${sql(zeilen.map((z) => z.id))}`;
    await sql.begin(async (tx) => {
      await tx`set local ddl.ausgaben_loeschen = 'qa'`;
      await tx`delete from ddl.expenses where lieferant like 'QA · Übersicht%'`;
    });
  }
  const staff = (await sql`select id from ddl.staff_users where email in ${sql([INHABER, BUERO])}`).map((r) => r.id);
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-uebersicht-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-uebersicht-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s };
}

const ausgabe = (bezahlt, brutto, kategorie, geloescht = false) =>
  sql`insert into ddl.expenses (rechnungsdatum, bezahlt_am, lieferant, kategorie, netto_cent, mwst_satz, mwst_cent, brutto_cent, erfasst_von_label, geloescht_am)
      values (${bezahlt}, ${bezahlt}, ${'QA · Übersicht ' + kategorie}, ${kategorie}, ${brutto}, 0, 0, ${brutto}, 'QA', ${geloescht ? new Date() : null})`;

/** Rechnung یا Gutschrift آزمایشی (فایل PDF لازم نیست؛ فقط عددها خوانده می‌شوند) */
async function rechnung(nummer, praxis, cent, bezug = null) {
  const [r] = await sql`insert into ddl.invoices (nummer, art, practice_id, bezug_id, abrechnung, ausgestellt_am, summe_cent, empfaenger, aussteller, storage_key, sha256, size, ausgestellt_von_label)
    values (${nummer}, ${bezug ? 'gutschrift' : 'rechnung'}, ${praxis}, ${bezug}, ${bezug ? 'gutschrift' : 'sammel'}, now(), ${cent},
      ${sql.json({ name: 'QA · Übersicht Ordination', zeilen: [], uid: null, kundennummer: 'QA-UE' })}, ${sql.json({ name: 'QA' })},
      ${`qa-uebersicht/${nummer}`}, ${'0'.repeat(64)}, 1, 'QA') returning id`;
  return r.id;
}

/** جمع‌های خود دیتابیس برای یک ماه («2026-10»)، به وقت وین */
async function sollWerte(monat) {
  const [a] = await sql`select coalesce(sum(brutto_cent), 0)::int as c from ddl.expenses where geloescht_am is null and to_char(bezahlt_am, 'YYYY-MM') = ${monat}`;
  const [e] = await sql`select coalesce(sum(betrag_cent), 0)::int as c from ddl.payments where to_char(eingegangen_am, 'YYYY-MM') = ${monat}`;
  const [f] = await sql`select coalesce(sum(summe_cent), 0)::int as c from ddl.invoices where to_char(ausgestellt_am at time zone 'Europe/Vienna', 'YYYY-MM') = ${monat}`;
  return { ausgaben: a.c, einnahmen: e.c, fakturiert: f.c };
}

/** مقدار یک خانهٔ نوار عددها («Einnahmen»، «Ausgaben» …) */
async function zelle(s, titel) {
  const leiste = s.getByRole('region', { name: /^Zahlen / });
  const z = leiste.locator('div').filter({ has: s.locator('span', { hasText: new RegExp(`^${titel}$`) }) }).first();
  return normal(await z.locator('span').nth(1).textContent());
}

try {
  const jetzt = new Date();
  const heute = iso(jetzt);
  const monat = heute.slice(0, 7);
  const vormonatTag = iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15, 12));
  const vormonat = vormonatTag.slice(0, 7);

  await ausgabe(heute, 12345, 'material');
  await ausgabe(heute, 1000, 'software');
  await ausgabe(heute, 99900, 'geraete', true); // gelöscht: zählt nicht
  await ausgabe(vormonatTag, 5000, 'buero');
  const [praxis] = await sql`select id from ddl.practices order by name limit 1`;
  const r1 = await rechnung('QA-UE-R001', praxis.id, 250_000);
  await rechnung('QA-UE-G001', praxis.id, -20_000, r1);
  await sql`insert into ddl.payments (invoice_id, practice_id, betrag_cent, eingegangen_am, erfasst_von_label) values (${r1}, ${praxis.id}, 120000, ${heute}, 'QA')`;

  const { s } = await anmelden(INHABER, 'Test Übersicht', 'inhaber');

  // ════ Tab ════
  await s.goto(`${CRM}/abrechnung`);
  const tabs = s.getByRole('navigation', { name: 'Einnahmen und Ausgaben' });
  pruefen((await tabs.getByRole('link', { name: 'Einnahmen' }).getAttribute('aria-current')) === 'page', 'Abrechnung bleibt Startseite: »Einnahmen« aktiv');
  await tabs.getByRole('link', { name: 'Übersicht' }).click();
  await s.waitForURL(`${CRM}/abrechnung/uebersicht`);
  pruefen(
    (await tabs.getByRole('link', { name: 'Übersicht' }).getAttribute('aria-current')) === 'page' && !(await tabs.getByRole('link', { name: 'Einnahmen' }).getAttribute('aria-current')),
    'Übersicht: nur Tab »Übersicht« aktiv',
  );
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Übersicht', level: 1 })), 'Seite »Übersicht«');
  await bild(s, 'ue1-monat');

  // ════ Zahlen = Datenbank ════
  const soll = await sollWerte(monat);
  pruefen((await zelle(s, 'Ausgaben')) === normal(centText(soll.ausgaben)), `Ausgaben = Summe der nicht gelöschten Ausgaben im Monat (${centText(soll.ausgaben)})`);
  pruefen((await zelle(s, 'Einnahmen')) === normal(centText(soll.einnahmen)), `Einnahmen = eingegangene Zahlungen im Monat (${centText(soll.einnahmen)})`);
  pruefen(soll.einnahmen >= 120_000, 'Testdaten: Zahlung vorhanden');
  pruefen((await zelle(s, 'Überschuss')) === normal(centText(soll.einnahmen - soll.ausgaben)), 'Überschuss = Einnahmen − Ausgaben');
  pruefen(await sichtbar(s.getByText(`fakturiert ${centText(soll.fakturiert)}`)), `fakturiert = Rechnungen − Gutschriften im Monat (${centText(soll.fakturiert)})`);
  pruefen(!(await s.getByRole('link', { name: 'Nächster Monat' }).count()), 'kein Link in einen künftigen Monat');

  // ════ Verlauf ════
  const tabelle = s.getByRole('table', { name: /je Monat/ });
  pruefen((await tabelle.getByRole('row').count()) === 7, 'Verlauf: Tabelle mit sechs Monaten');

  // ════ Vormonat ════
  await s.getByRole('link', { name: 'Vormonat' }).click();
  await s.waitForURL((u) => u.searchParams.get('monat') === vormonat);
  const sollV = await sollWerte(vormonat);
  pruefen((await zelle(s, 'Ausgaben')) === normal(centText(sollV.ausgaben)), `Vormonat: Ausgaben ${centText(sollV.ausgaben)}`);
  pruefen(await sichtbar(s.getByRole('link', { name: 'Nächster Monat' })), 'Vormonat: »›« führt zurück');
  await s.getByRole('link', { name: 'Zum aktuellen Monat' }).click();
  await s.waitForURL(`${CRM}/abrechnung/uebersicht`);

  // ════ Kategorien ════
  await s.getByRole('navigation', { name: 'Bereiche der Übersicht' }).getByRole('link', { name: 'Kategorien' }).click();
  await s.waitForURL((u) => u.searchParams.get('tab') === 'kategorien');
  const liste = s.getByRole('list', { name: 'Ausgaben nach Kategorie' });
  pruefen(await sichtbar(liste.getByText('Material & Resin')), 'Kategorien: »Material & Resin«');
  await s.getByRole('navigation', { name: 'Zeitraum' }).getByRole('link', { name: / bis / }).click();
  await s.waitForURL((u) => u.searchParams.get('k') === 'jahr');
  pruefen(await sichtbar(s.getByRole('list', { name: 'Ausgaben nach Kategorie' })), 'Kategorien: Jahr bis heute');
  await s.getByRole('list', { name: 'Ausgaben nach Kategorie' }).getByRole('listitem').nth(1).hover();
  await s.waitForTimeout(400);
  await bild(s, 'ue2-kategorien');

  // ════ ungültiger Monat ════
  await s.goto(`${CRM}/abrechnung/uebersicht?monat=2099-01`);
  pruefen((await zelle(s, 'Ausgaben')) === normal(centText(soll.ausgaben)), 'künftiger Monat in der Adresse ← aktueller Monat');
  await s.goto(`${CRM}/abrechnung/uebersicht?monat=quatsch&tab=nix`);
  pruefen(await sichtbar(s.getByRole('table', { name: /je Monat/ })), 'ungültige Adresse ← aktueller Monat, Verlauf');

  // ════ Handy ════
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 844 });
    for (const q of ['', '?tab=kategorien']) {
      await s.goto(`${CRM}/abrechnung/uebersicht${q}`);
      const breit = await s.evaluate(() => document.documentElement.scrollWidth);
      pruefen(breit <= breite + 1, `Handy ${breite}px${q ? ' Kategorien' : ''}: kein horizontales Scrollen (${breit}px)`);
    }
    await bild(s, `ue3-handy-${breite}`);
  }

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/abrechnung`);
  pruefen((await b.getByRole('link', { name: 'Übersicht', exact: true }).count()) === 0 || (await b.getByRole('navigation', { name: 'Einnahmen und Ausgaben' }).count()) === 0, 'Büro: kein Tab »Übersicht«');
  await b.goto(`${CRM}/abrechnung/uebersicht`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Übersicht gesperrt');
  pruefen(!(await b.getByText(centText(soll.ausgaben)).count()), 'Büro: keine Beträge');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
