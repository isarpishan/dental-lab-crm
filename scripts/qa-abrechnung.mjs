// آزمون قدم ۱ فاز ۲ (Abrechnung) در Chrome: پیشنهاد پوزیشن‌ها از قیمت لحظهٔ سفارش (Zahn، Glied،
// Express، «Preis fehlt»)، Leistungsdatum و ماه، ویرایش و برگشت به پیشنهاد با audit، ورودی نادرست،
// «Konto» یک Ordination ماه‌به‌ماه، صفحهٔ کلی «Abrechnung»، بخش Konto در صفحهٔ Ordination، اینکه
// Techniker هیچ‌کدام را نمی‌بیند، و ظاهر در موبایل.
// دادهٔ آزمایشی: «QA · Abrechnung …»، @example.invalid، شماره‌های «QA-AB-…»؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-abrechnung  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const BILDER = process.env.QA_BILDER ?? null;
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
// «€ 1.234,50» مثل خود برنامه (فاصلهٔ ثابت یکسان می‌شود)
const euro = (cent) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(cent / 100).replace(/\s/g, ' ');
const monat = (d) => new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(d);
const text = async (loc) => (await loc.innerText()).replace(/\s/g, ' ');

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

const BUERO = 'test-abrechnung@example.invalid';
const TECHNIKER = 'test-abrechnung-tech@example.invalid';

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Abrechnung%'`).map((r) => r.id);
  const staff = (await sql`select id from ddl.staff_users where email in ${sql([BUERO, TECHNIKER])}`).map((r) => r.id);
  if (praxen.length) {
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      await sql`delete from ddl.audit_log where target_id in ${sql(auftraege)}`;
      await sql`delete from ddl.data_access_log where order_id in ${sql(auftraege)}`;
      await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
    }
  }
  if (staff.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.data_access_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(staff)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(staff)}`;
  }
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-abrechnung-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-abrechnung-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

/** سفارش مستقیم در دیتابیس، با قیمت لحظهٔ ثبت و دندان‌ها، مثل یک سفارش واقعی پورتال */
async function auftrag({ praxis, nr, behandlung, lieferart, status, stand, zaehne = [], tempo = 'standard', approved = null, delivered = null, verlauf = [] }) {
  const [o] = await sql`insert into ddl.orders (order_no, practice_id, work_type_key, delivery_kind, config, status, source, tempo, submitted_at,
      created_by_kind, created_by_id, price_snapshot, approved_at, delivered_at)
    values (${nr}, ${praxis}, ${behandlung}, ${lieferart}, ${sql.json({})}, ${status}, 'labor', ${tempo}, now() - interval '40 days',
      'staff', gen_random_uuid(), ${sql.json(stand)}, ${approved}, ${delivered}) returning id`;
  for (const [fdi, treatment, span] of zaehne) await sql`insert into ddl.order_teeth (order_id, fdi, treatment, span_id) values (${o.id}, ${fdi}, ${treatment}, ${span ?? null})`;
  for (const [s, at] of verlauf) await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, ${s}, ${at}, 'system')`;
  return o.id;
}

try {
  const jetzt = new Date();
  const vormonat = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15, 12);
  const heute = new Date(jetzt.getTime() - 60_000);
  const [A] = await sql`insert into ddl.practices (customer_no, name, billing_mode) values ('QA-AB1', 'QA · Abrechnung Ordination', 'sammel') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name, billing_mode) values ('QA-AB2', 'QA · Abrechnung Einzel', 'einzel') returning id`;

  // A: Krone (ماه قبل، Express برای کل سفارش)، Brücke (این ماه)، Design بدون قیمت، در جریان، storniert
  const krone = await auftrag({
    praxis: A.id, nr: 'QA-AB-0001', behandlung: 'krone', lieferart: 'fertigung', status: 'geliefert', tempo: 'express', delivered: vormonat,
    stand: { lieferart: 'fertigung', preisAb: 120, einheit: 'Zahn', zuschlag: { betrag: 40, einheit: 'Auftrag' } },
    zaehne: [[14, 'krone'], [15, 'krone']],
  });
  const bruecke = await auftrag({
    praxis: A.id, nr: 'QA-AB-0002', behandlung: 'bruecke', lieferart: 'fertigung', status: 'geliefert', delivered: heute,
    stand: { lieferart: 'fertigung', preisAb: 100, einheit: 'Glied', zuschlag: null },
    zaehne: [[14, 'pfeiler', 's1'], [15, 'glied', 's1'], [16, 'pfeiler', 's1']],
  });
  const design = await auftrag({
    praxis: A.id, nr: 'QA-AB-0003', behandlung: 'krone', lieferart: 'design', status: 'freigegeben', approved: heute,
    stand: { lieferart: 'design', preisAb: null, einheit: 'Zahn', zuschlag: null }, zaehne: [[21, 'krone']],
  });
  await auftrag({ praxis: A.id, nr: 'QA-AB-0004', behandlung: 'krone', lieferart: 'fertigung', status: 'in_produktion', stand: { lieferart: 'fertigung', preisAb: 120, einheit: 'Zahn' }, zaehne: [[11, 'krone']] });
  const storno = await auftrag({ praxis: A.id, nr: 'QA-AB-0005', behandlung: 'krone', lieferart: 'design', status: 'storniert', approved: heute, stand: { lieferart: 'design', preisAb: 50, einheit: 'Zahn' }, zaehne: [[22, 'krone']] });
  // B: Nur Design بدون approved_at، ولی با «freigegeben» در تاریخچه
  await auftrag({
    praxis: B.id, nr: 'QA-AB-0006', behandlung: 'krone', lieferart: 'design', status: 'abgeschlossen',
    stand: { lieferart: 'design', preisAb: 45, einheit: 'Zahn', zuschlag: null }, zaehne: [[36, 'krone']], verlauf: [['freigegeben', heute]],
  });

  const { s } = await anmelden(BUERO, 'Test Abrechnung', 'buero');

  // ════ صفحهٔ کلی ════
  pruefen(await s.getByRole('navigation').getByRole('link', { name: 'Abrechnung' }).isVisible(), 'Büro: Menüpunkt »Abrechnung«');
  await s.goto(`${CRM}/abrechnung`);
  const zeileA = s.getByRole('listitem').filter({ hasText: 'QA · Abrechnung Ordination' });
  const zeileB = s.getByRole('listitem').filter({ hasText: 'QA · Abrechnung Einzel' });
  pruefen(await sichtbar(zeileA), 'Übersicht: Ordination mit offenen Arbeiten');
  const tA = await text(zeileA);
  pruefen(tA.includes(euro(58000)) && tA.includes('3 Aufträge') && tA.includes(`seit ${monat(vormonat)}`) && tA.includes('1 aus Vormonaten') && tA.includes('1 ohne Preis') && tA.includes('Sammelrechnung'), `Übersicht A: ${euro(58000)}, 3 Aufträge, seit Vormonat, 1 ohne Preis`);
  pruefen((await text(zeileB)).includes(euro(4500)) && (await text(zeileB)).includes('Einzelrechnung'), 'Übersicht B: Nur Design mit »freigegeben« aus dem Verlauf');
  const leiste = s.getByRole('navigation', { name: 'Bereiche der Abrechnung' });
  pruefen(
    (await leiste.getByRole('link').count()) === 4 && (await leiste.locator('[aria-current="page"]').innerText()).startsWith('Noch nicht verrechnet'),
    'Übersicht: Leiste mit vier Bereichen, »Noch nicht verrechnet« offen',
  );
  await leiste.getByRole('link', { name: /^Offene Rechnungen/ }).click();
  await s.waitForURL(/tab=offen/);
  pruefen(await sichtbar(s.getByRole('region', { name: 'Offene Rechnungen' })), 'Tab »Offene Rechnungen« öffnet');
  await s.goBack();
  await bild(s, 'a1-uebersicht');

  // ════ Konto ════
  await zeileA.getByRole('link', { name: 'QA · Abrechnung Ordination' }).click();
  await s.waitForURL(`${CRM}/abrechnung/${A.id}`);
  pruefen(await sichtbar(s.getByRole('heading', { name: 'QA · Abrechnung Ordination' })), 'Konto der Ordination');
  const diesen = s.getByRole('region', { name: monat(heute) });
  const vorher = s.getByRole('region', { name: monat(vormonat) });
  pruefen((await text(diesen)).includes(euro(30000)) && (await text(diesen)).includes('1 ohne Preis') && (await text(diesen)).includes('QA-AB-0002') && (await text(diesen)).includes('QA-AB-0003'), `Konto: ${monat(heute)} mit Brücke und Design (ohne Preis)`);
  pruefen((await text(vorher)).includes(euro(28000)) && (await text(vorher)).includes('QA-AB-0001'), `Konto: ${monat(vormonat)} mit der Krone und Express`);
  pruefen(!(await text(s.getByRole('main'))).includes('QA-AB-0005'), 'Konto: stornierter Auftrag fehlt');
  pruefen(await s.getByText('1 Auftrag ist noch in Arbeit').isVisible(), 'Konto: Auftrag in Arbeit nur als Hinweis');
  await bild(s, 'a2-konto');

  // ════ تب Abrechnung سفارش ════
  await s.getByRole('link', { name: 'QA-AB-0001' }).click();
  await s.waitForURL(/tab=abrechnung/);
  const tabelle = s.getByRole('table', { name: 'Positionen' });
  pruefen(await sichtbar(tabelle), 'Auftrag: Tab »Abrechnung« mit Positionen');
  const tT = await text(tabelle);
  pruefen(tT.includes('Krone · Fertige Arbeit · Zähne 14, 15') && tT.includes(euro(24000)) && tT.includes('Expresszuschlag') && tT.includes(euro(4000)) && tT.includes(euro(28000)), 'Vorschlag: 2 Zähne × € 120 + Express € 40 = € 280');
  // ترتیب ستون‌ها مثل سرستون‌ها: Bezeichnung، Menge، Einzelpreis، Betrag
  const zellen = (await tabelle.getByRole('row').nth(1).getByRole('cell').allInnerTexts()).map((x) => x.replace(/\s/g, ' ').trim());
  pruefen(zellen[1].startsWith('2 Zahn') && zellen[2] === euro(12000) && zellen[3] === euro(24000), `Spalten in der richtigen Reihenfolge (${zellen.slice(1).join(' | ')})`);
  pruefen(await s.getByText(`gehört zur Abrechnung ${monat(vormonat)}`).isVisible(), 'Leistungsdatum und Monat');
  pruefen(await s.getByText(/Vorschlag aus den Preisen bei Auftragseingang/).isVisible(), 'Hinweis: Vorschlag aus den ab-Preisen');
  await bild(s, 'a3-positionen');

  // ورودی نادرست
  await s.getByRole('button', { name: 'Positionen bearbeiten' }).click();
  const form = s.getByRole('form', { name: 'Positionen bearbeiten' });
  await form.getByLabel('Einzelpreis (€)').first().fill('abc');
  await form.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(s.getByText(/Position 1: »abc« ist kein gültiger Betrag/)), 'ungültiger Preis wird abgelehnt');
  const [{ n: keine }] = await sql`select count(*)::int as n from ddl.order_positions where order_id = ${krone}`;
  pruefen(keine === 0, 'Datenbank: nichts gespeichert');

  // ویرایش: قیمت تازه و یک ردیف اضافه
  await form.getByLabel('Einzelpreis (€)').first().fill('110,50');
  await form.getByRole('button', { name: 'Position hinzufügen +' }).click();
  await form.getByLabel('Bezeichnung').last().fill('Modellherstellung');
  await form.getByLabel('Einzelpreis (€)').last().fill('15');
  pruefen((await text(form)).includes(euro(27600)), 'Summe rechnet beim Tippen mit (€ 276)');
  await bild(s, 'a4-bearbeiten');
  await form.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(s.getByText('Positionen gespeichert.')), 'Speichern → »Positionen gespeichert.«');
  pruefen((await text(tabelle)).includes(euro(27600)) && (await s.getByText('Von Hand angepasst.').isVisible()), 'Ansicht: neue Summe, »Von Hand angepasst.«');
  const pos = await sql`select position, bezeichnung, menge, einheit, einzelpreis_cent from ddl.order_positions where order_id = ${krone} order by position`;
  pruefen(pos.length === 3 && pos[0].einzelpreis_cent === 11050 && pos[1].einzelpreis_cent === 4000 && pos[2].bezeichnung === 'Modellherstellung' && pos[2].einzelpreis_cent === 1500, 'Datenbank: drei Positionen in Cent');
  const [audit] = await sql`select details from ddl.audit_log where action = 'positionen_geaendert' and target_id = ${krone}`;
  pruefen(audit?.details?.vorher?.summeCent === 28000 && audit.details.nachher?.summeCent === 27600, 'Audit: Positionen mit Vorher/Nachher');
  await s.goto(`${CRM}/abrechnung/${A.id}`);
  pruefen((await text(s.getByRole('region', { name: monat(vormonat) }))).includes('angepasst'), 'Konto: Auftrag als »angepasst« markiert');

  // Rabatt: درصد روی ردیف اول، مبلغ ثابت روی ردیف سوم، اول یک ورودی نادرست
  await s.goto(`${CRM}/auftraege/${krone}?tab=abrechnung`);
  await s.getByRole('button', { name: 'Positionen bearbeiten' }).click();
  await form.getByLabel('Rabatt', { exact: true }).first().fill('150');
  await form.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(s.getByText('Position 1: Ein Rabatt in Prozent ist höchstens 100 %.')), 'Rabatt über 100 % wird abgelehnt');
  await form.getByLabel('Rabatt', { exact: true }).first().fill('10');
  await form.getByLabel('Rabatt', { exact: true }).last().fill('20');
  await form.getByLabel('Rabatt in Prozent oder Euro').last().selectOption('betrag');
  await form.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(s.getByText(/Position 3: Der Rabatt ist höher als der Betrag der Position/)), 'Rabatt in Euro über dem Betrag der Position wird abgelehnt');
  await form.getByLabel('Rabatt', { exact: true }).last().fill('5');
  // 2 × 110,50 − 10 % = 198,90; Express 40; 15 − 5 = 10
  pruefen((await text(form)).includes(euro(24890)), 'Summe mit Rabatt rechnet beim Tippen mit (€ 248,90)');
  await bild(s, 'a4b-rabatt');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await sichtbar(s.getByText('Positionen gespeichert.'));
  const mitRabatt = await text(tabelle);
  // سرستون‌ها با CSS بزرگ نوشته می‌شوند («RABATT»)
  pruefen(
    /rabatt/i.test(mitRabatt) && ['10 %', `− ${euro(2210)}`, `− ${euro(500)}`, euro(19890), euro(24890)].every((t) => mitRabatt.includes(t)),
    'Ansicht: Spalte »Rabatt« mit 10 % (− € 22,10) und − € 5,00, Summe € 248,90',
  );
  const rab = await sql`select rabatt_art, rabatt_wert from ddl.order_positions where order_id = ${krone} order by position`;
  pruefen(rab[0]?.rabatt_art === 'prozent' && rab[0].rabatt_wert === 1000 && rab[1]?.rabatt_art === null && rab[2]?.rabatt_art === 'betrag' && rab[2].rabatt_wert === 500, 'Datenbank: Rabatt 10 % und € 5 an den richtigen Positionen');
  await bild(s, 'a4c-rabatt-ansicht');
  // موبایل: نما و فرم ویرایش با Rabatt بدون اسکرول افقی
  await s.setViewportSize({ width: 390, height: 844 });
  const breitAnsicht = await s.evaluate(() => document.documentElement.scrollWidth);
  await s.getByRole('button', { name: 'Positionen bearbeiten' }).click();
  const breitForm = await s.evaluate(() => document.documentElement.scrollWidth);
  await bild(s, 'a4d-rabatt-mobil');
  pruefen(breitAnsicht <= 391 && breitForm <= 391, `Handy (390 px): Positionen mit Rabatt ohne horizontales Scrollen (${breitAnsicht}/${breitForm} px)`);
  await form.getByRole('button', { name: 'Abbrechen' }).click();
  await s.setViewportSize({ width: 1440, height: 900 });

  // برگشت به پیشنهاد (صفحهٔ تازه، تا پیام «Positionen gespeichert.» قبلی نماند)
  await s.goto(`${CRM}/auftraege/${krone}?tab=abrechnung`);
  await s.getByRole('button', { name: 'Vorschlag wiederherstellen' }).click();
  pruefen(await sichtbar(s.getByText('Vorschlag wiederhergestellt.')), 'Vorschlag wiederhergestellt');
  const [{ n: weg }] = await sql`select count(*)::int as n from ddl.order_positions where order_id = ${krone}`;
  const [zurueck] = await sql`select count(*)::int as n from ddl.audit_log where action = 'positionen_zurueckgesetzt' and target_id = ${krone}`;
  pruefen(weg === 0 && zurueck.n === 1 && (await text(tabelle)).includes(euro(28000)), 'Datenbank und Ansicht: wieder der Vorschlag (€ 280), mit Audit');

  // Brücke, Design ohne Preis, storniert
  await s.goto(`${CRM}/auftraege/${bruecke}?tab=abrechnung`);
  pruefen((await text(tabelle)).includes('3 Glied') && (await text(tabelle)).includes(euro(30000)), 'Brücke: 3 Glieder × € 100');
  await s.goto(`${CRM}/auftraege/${design}?tab=abrechnung`);
  pruefen((await sichtbar(tabelle.getByText('Preis fehlt'))) && (await s.getByText('ohne fehlende Preise').isVisible()), 'Design ohne Preis: »Preis fehlt«');
  await s.goto(`${CRM}/auftraege/${storno}?tab=abrechnung`);
  pruefen((await sichtbar(s.getByText('Storniert: wird nicht verrechnet.'))) && (await s.getByRole('button', { name: 'Positionen bearbeiten' }).count()) === 0, 'storniert: nicht verrechenbar, nicht bearbeitbar');

  // صفحهٔ Ordination
  await s.goto(`${CRM}/ordinationen/${A.id}`);
  // تب‌ها؛ «Konto» درست بعد از «Behandler» (خواستهٔ کاربر)، پیش از Portal-Zugänge
  const reiter = s.getByRole('navigation', { name: 'Bereiche der Ordination' });
  const reihenfolge = (await reiter.getByRole('link').allTextContents()).map((x) => x.replace(/\s*\(\d+\)$/, '').replace(/offen$/, ''));
  await reiter.getByRole('link', { name: 'Konto', exact: true }).click();
  const kontoAbschnitt = s.getByRole('region', { name: 'Konto' });
  pruefen(
    (await sichtbar(kontoAbschnitt)) && (await text(kontoAbschnitt)).includes(euro(58000)) && reihenfolge.slice(0, 4).join() === 'Stammdaten,Behandler,Konto,Portal-Zugänge',
    `Ordination: Tab »Konto« gleich nach den Behandlern, mit offenem Betrag (${reihenfolge.join(', ')})`,
  );

  // موبایل
  const zuBreit = [];
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 800 });
    for (const pfad of ['/abrechnung', `/abrechnung/${A.id}`, `/auftraege/${krone}?tab=abrechnung`]) {
      await s.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
      const w = await s.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${pfad} ${breite}px: ${w}px`);
      if (breite === 390) await bild(s, `a5-mobil${pfad.replace(/[/?=]/g, '-')}`);
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (390 und 320 px)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);

  // ════ Techniker: هیچ‌کدام ════
  const { s: t } = await anmelden(TECHNIKER, 'Test Technik', 'techniker');
  pruefen((await t.getByRole('navigation').getByRole('link', { name: 'Abrechnung' }).count()) === 0, 'Techniker: kein Menüpunkt »Abrechnung«');
  await t.goto(`${CRM}/abrechnung`);
  pruefen(await sichtbar(t.getByRole('heading', { name: 'Kein Zugriff.' })), 'Techniker: Übersicht gesperrt');
  await t.goto(`${CRM}/abrechnung/${A.id}`);
  pruefen(await sichtbar(t.getByRole('heading', { name: 'Kein Zugriff.' })), 'Techniker: Konto gesperrt');
  await t.goto(`${CRM}/auftraege/${krone}?tab=abrechnung`);
  pruefen((await t.getByRole('link', { name: 'Abrechnung', exact: true }).count()) === 0 && (await t.getByRole('table', { name: 'Positionen' }).count()) === 0, 'Techniker: kein Tab »Abrechnung«');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
