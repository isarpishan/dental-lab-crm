// آزمون قدم ۶ در Chrome: فهرست‌های پورتال (Aufträge، Patienten)، صفحهٔ هر سفارش با ۴ تب،
// پیام‌ها (پیام intern هرگز در پورتال نیست)، Daten nachreichen، Storno، نمایش سه‌بعدی،
// فهرست و داشبورد داخلی، «Name anzeigen»، جدایی Ordinationها، و ظاهر در چند اندازه.
// دادهٔ آزمایشی مستقیم در دیتابیس ساخته می‌شود («QA · …»، @example.invalid، شماره‌های «QA-…»)
// و بعد کامل پاک می‌شود، با فایل‌ها روی دیسک.
// اجرا: pnpm qa qa-portal  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
const BILDER = process.env.QA_BILDER ?? null;
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
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

/** wie `lib/crypto.ts`: v1.<iv>.<tag>.<daten>, AES-256-GCM */
function verschluesseln(text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64'), iv);
  const d = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), d.toString('base64url')].join('.');
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

/** binäres STL eines Würfels (12 Dreiecke), damit die 3D-Ansicht etwas zeigt */
function wuerfelStl() {
  const p = [[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const b = Buffer.alloc(84 + f.length * 50);
  b.writeUInt32LE(f.length, 80);
  f.forEach((t, i) => {
    const o = 84 + i * 50 + 12;
    t.forEach((k, j) => p[k].forEach((w, a) => b.writeFloatLE(w, o + j * 12 + a * 4)));
  });
  return b;
}

const ordner = path.join(tmpdir(), 'ddl-qa-portal');
mkdirSync(ordner, { recursive: true });
const BISS = path.join(ordner, 'Biss.stl');
writeFileSync(BISS, wuerfelStl());

const STAFF_MAIL = 'test-portal@example.invalid';
async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Portal%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email = ${STAFF_MAIL}`).map((r) => r.id);
  if (praxen.length) {
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      for (const f of await sql`select storage_key from ddl.order_files where order_id in ${sql(auftraege)}`) await rm(path.join(SPEICHER, f.storage_key), { force: true });
      await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
    }
    await sql`delete from ddl.patients where practice_id in ${sql(praxen)}`;
  }
  const akteure = [...nutzer, ...staff];
  if (akteure.length) {
    await sql`delete from ddl.data_access_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.message_reads where reader_id in ${sql(akteure)}`;
  }
  await vereinbarungenLoeschen(sql, praxen);
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
}

/* ── Testdaten ── */
async function datei(orderId, slot, name, inhalt, { origin = 'praxis', vonId }) {
  const id = randomUUID();
  const key = `${id.slice(0, 2)}/${id}`;
  mkdirSync(path.join(SPEICHER, id.slice(0, 2)), { recursive: true });
  writeFileSync(path.join(SPEICHER, key), inhalt);
  // vor dem Statusverlauf, wie beim echten Absenden
  const [f] = await sql`insert into ddl.order_files (order_id, origin, kind, slot, storage_key, filename_enc, mime, size, sha256, uploaded_by_kind, uploaded_by_id, created_at)
    values (${orderId}, ${origin}, 'scan', ${slot}, ${key}, ${verschluesseln(name)}, 'model/stl', ${inhalt.length}, ${sha(inhalt)}, ${origin === 'praxis' ? 'practice' : 'staff'}, ${vonId}, now() - interval '3 days') returning id`;
  return f.id;
}

async function auftrag({ praxis, patient, nr, behandlung, status, verlauf, lieferart = 'fertigung', config = {}, wunsch = null, tempo = 'standard', nutzer }) {
  const [o] = await sql`insert into ddl.orders (order_no, practice_id, patient_id, work_type_key, delivery_kind, config, status, source, tempo, desired_date,
      submitted_at, created_by_kind, created_by_id, price_snapshot)
    values (${nr}, ${praxis}, ${patient}, ${behandlung}, ${lieferart}, ${sql.json(config)}, ${status}, 'portal', ${tempo}, ${wunsch}, now() - interval '2 days',
      'practice', ${nutzer}, ${sql.json({ lieferart, preisAb: null, einheit: 'Zahn', zuschlag: null, bearbeitungszeit: 'nach Prüfung' })}) returning id`;
  let t = 0;
  for (const s of verlauf) {
    await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, ${s}, now() - interval '2 days' + ${`${t++} hours`}::interval, 'system')`;
  }
  return o.id;
}

await aufraeumen();
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebGL|GPU stall/.test(m.text()) && konsole.push(m.text()));
  return s;
};
async function portalZugang(name, email, praxisId) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-portal-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-portal-1');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}

try {
  const [A] = await sql`insert into ddl.practices (customer_no, name) values ('QA-PA', 'QA · Portal Ordination A') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name) values ('QA-PB', 'QA · Portal Ordination B') returning id`;
  const { s: p, id: nutzerA } = await portalZugang('QA Portal A', 'qa-portal-a@example.invalid', A.id);
  const [ich] = await sql`insert into ddl.staff_users (email, name, role) values (${STAFF_MAIL}, 'Test Portal', 'buero') returning id`;

  const patient = async (vor, nach, code) =>
    (await sql`insert into ddl.patients (practice_id, code, first_name_enc, last_name_enc, created_by_kind, created_by_id)
      values (${A.id}, ${code}, ${verschluesseln(vor)}, ${verschluesseln(nach)}, 'practice', ${nutzerA}) returning id`)[0].id;
  const erika = await patient('Erika', 'Prüfmann', 'P-QA2E');
  const max = await patient('Max', 'Muster', 'P-QA3M');
  await patient('Anna', 'Ohneauftrag', 'P-QA4A');

  const brueckeConfig = {
    zaehne: { 14: { art: 'bruecke_anker', spanne: 'b16-14' }, 15: { art: 'bruecke_glied', spanne: 'b16-14' }, 16: { art: 'bruecke_anker', spanne: 'b16-14' } },
    versorgung: 'definitiv',
    farbe: { system: 'vita_classical', farbe: 'A2' },
  };
  const o1 = await auftrag({ praxis: A.id, patient: erika, nr: 'QA-2026-0001', behandlung: 'bruecke', status: 'eingereicht', verlauf: ['eingereicht'], config: brueckeConfig, nutzer: nutzerA });
  for (const [slot, name] of [['ok', 'OK.stl'], ['uk', 'UK.stl'], ['biss', 'Biss.stl']]) await datei(o1, slot, name, wuerfelStl(), { vonId: nutzerA });
  await sql`insert into ddl.order_messages (order_id, author_kind, kind, body, created_at) values (${o1}, 'system', 'ereignis', 'Auftrag eingereicht', now() - interval '2 days')`;
  await sql`insert into ddl.order_messages (order_id, author_kind, author_id, kind, body) values (${o1}, 'labor', ${ich.id}, 'nachricht', 'Ist 15 als Glied richtig?') returning id`;
  const [intern] = await sql`insert into ddl.order_messages (order_id, author_kind, author_id, kind, body, is_internal) values (${o1}, 'labor', ${ich.id}, 'nachricht', 'INTERN-QA: Präparation knapp', true) returning id`;
  const internDatei = await datei(o1, 'nachricht', 'intern-skizze.stl', wuerfelStl(), { origin: 'labor', vonId: ich.id });
  await sql`insert into ddl.message_files (message_id, file_id) values (${intern.id}, ${internDatei})`;

  const o2 = await auftrag({ praxis: A.id, patient: erika, nr: 'QA-2026-0002', behandlung: 'krone', status: 'rueckfrage', verlauf: ['rueckfrage'], nutzer: nutzerA });
  await datei(o2, 'ok', 'OK.stl', wuerfelStl(), { vonId: nutzerA });
  await datei(o2, 'uk', 'UK.stl', wuerfelStl(), { vonId: nutzerA });
  await sql`insert into ddl.order_messages (order_id, author_kind, kind, body) values (${o2}, 'system', 'ereignis', 'Auftrag eingereicht. Es fehlen noch: Bissregistrierung. Bitte reichen Sie die Daten nach.')`;

  const bald = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const o3 = await auftrag({ praxis: A.id, patient: max, nr: 'QA-2026-0003', behandlung: 'teilprothese', status: 'in_produktion', verlauf: ['eingereicht', 'in_planung', 'design_freigabe', 'in_produktion'], config: { einprobe: true }, wunsch: bald, nutzer: nutzerA });
  await auftrag({ praxis: A.id, patient: max, nr: 'QA-2026-0004', behandlung: 'schiene', status: 'geliefert', verlauf: ['eingereicht', 'in_planung', 'design_freigabe', 'in_produktion', 'fertig', 'versendet', 'geliefert'], nutzer: nutzerA });
  const o5 = await auftrag({ praxis: A.id, patient: erika, nr: 'QA-2026-0005', behandlung: 'inlay', status: 'eingereicht', verlauf: ['eingereicht'], tempo: 'express', nutzer: nutzerA });

  // ════ Portal: Aufträge ════
  await p.reload();
  const zeile = (nr) => p.getByRole('link', { name: new RegExp(nr) });
  pruefen(await sichtbar(zeile('QA-2026-0001')), 'Aufträge: Liste mit eigenen Aufträgen');
  pruefen(await p.getByRole('link', { name: /Ihre Aktion erforderlich \(2\)/ }).isVisible(), '»Ihre Aktion erforderlich (2)«: Rückfrage und neue Nachricht');
  pruefen(await zeile('QA-2026-0003').getByText('In Produktion').last().isVisible() && (await zeile('QA-2026-0003').textContent()).includes('Schritt 4 von 7'), 'Fortschritt nur mit den Etappen dieses Auftrags (Teilprothese mit Einprobe: 7)');
  pruefen(await zeile('QA-2026-0001').getByText(/neue Nachricht/).count() === 1, 'Zeile zeigt neue Nachricht');
  await bild(p, '11-portal-auftraege');
  await p.getByRole('link', { name: /Ihre Aktion erforderlich/ }).click();
  await p.waitForURL(/status=aktion/);
  pruefen((await p.getByRole('main').getByRole('list').first().getByRole('link').count()) === 2, 'Filter »Ihre Aktion erforderlich«: genau 2 Aufträge');
  await p.goto(`${PORTAL}/`);
  await p.getByLabel('Suche').fill('max');
  await p.waitForURL(/suche=max/);
  await p.waitForTimeout(300);
  const nachSuche = await p.getByRole('main').locator('ul').first().getByRole('link').allTextContents();
  pruefen(nachSuche.length === 2 && nachSuche.every((t) => t.includes('Max Muster')), 'Suche nach Patientennamen (verschlüsselt gespeichert)');
  await p.goto(`${PORTAL}/`);
  await p.getByLabel('Behandlung').selectOption({ label: 'Krone' });
  await p.waitForURL(/behandlung=krone/);
  pruefen((await p.getByRole('main').locator('ul').first().getByRole('link').allTextContents()).join('|').includes('QA-2026-0002') && (await zeile('QA-2026-0001').count()) === 0, 'Filter nach Behandlung');
  await p.goto(`${PORTAL}/?sortierung=liefertermin`);
  pruefen((await p.getByRole('main').locator('ul').first().getByRole('link').first().textContent()).includes('QA-2026-0003'), 'Sortierung nach Liefertermin: nächster Termin zuerst');

  // ════ Portal: Patienten ════
  await p.goto(`${PORTAL}/?ansicht=patienten`);
  const erikaZeile = p.getByRole('link', { name: /Erika Prüfmann/ });
  pruefen(await sichtbar(erikaZeile) && (await erikaZeile.textContent()).includes('+2'), 'Patienten: Erika mit »+2« weiteren aktiven Aufträgen');
  pruefen(await p.getByRole('link', { name: /Anna Ohneauftrag/ }).getByText('Keine aktiven Aufträge').isVisible(), 'Patient ohne aktive Aufträge');
  await bild(p, '12-portal-patienten');
  await erikaZeile.click();
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Erika Prüfmann' })), 'Patientenseite');
  // Patientenseite mit Tabs (25.10.2026): »Aufträge« offen, »Alle Dateien« daneben
  const auftraegeAnzahl = await p.getByRole('region', { name: 'Aufträge' }).getByRole('link', { name: /QA-2026-000[125]/ }).count();
  await p.getByRole('navigation', { name: 'Bereiche des Patienten' }).getByRole('link', { name: /^Alle Dateien/ }).click();
  await p.waitForURL(/tab=dateien/);
  pruefen(auftraegeAnzahl === 3 && (await p.getByRole('region', { name: 'Alle Dateien' }).getByText('OK.stl').count()) === 2, 'Patientenseite: Tabs »Aufträge« und »Alle Dateien« des Patienten');
  pruefen((await p.getByText('intern-skizze.stl').count()) === 0, 'Patientenseite: keine Labor-Dateien');
  await p.getByRole('button', { name: 'Neuer Auftrag für diesen Patienten' }).click();
  await p.waitForURL(/\/auftraege\/neu\?entwurf=/);
  pruefen(await sichtbar(p.locator('#schritt-patient').getByText(/^Erika Prüfmann · P-QA2E$/)), '»Neuer Auftrag für diesen Patienten«: Formular mit Patient');
  p.once('dialog', (d) => d.accept());
  await p.getByRole('button', { name: 'Entwurf verwerfen' }).click();
  await p.waitForURL(`${PORTAL}/`);

  // ════ Portal: Auftragsseite ════
  await p.goto(`${PORTAL}/auftraege/${o1}`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Auftrag eingegangen.' })), 'Tab »Status«: Überschrift je nach Status');
  pruefen(await p.getByRole('complementary', { name: 'Auftrag' }).getByText('Erika Prüfmann').isVisible(), 'Seitenleiste mit Patient');
  pruefen(await p.getByRole('link', { name: /Kommunikation\s*1 ungelesen/ }).isVisible(), 'Tab »Kommunikation« zeigt 1 ungelesen');
  await bild(p, '13-auftrag-status');
  await p.getByRole('link', { name: /^Kommunikation/ }).click();
  await p.waitForURL(/tab=kommunikation/);
  pruefen(await sichtbar(p.getByText('Ist 15 als Glied richtig?')), 'Nachricht des Labors sichtbar, als »Digital Dental Lab«');
  pruefen((await p.getByText(/INTERN-QA/).count()) === 0 && (await p.getByText('intern-skizze.stl').count()) === 0, 'interne Notiz des Labors NICHT im Portal');
  pruefen((await p.request.get(`${PORTAL}/api/dateien/${internDatei}`)).status() === 404, 'Anhang der internen Notiz: Download im Portal gesperrt (404)');
  await p.getByLabel('Nachricht', { exact: true }).fill('Ja, 15 ist das Glied. QA-Antwort');
  await p.getByLabel('Datei anhängen').setInputFiles(BISS);
  await p.getByText('Biss.stl').waitFor();
  await p.waitForFunction(() => !document.body.textContent.includes(' %'), null, { timeout: 15000 });
  await p.getByRole('button', { name: 'Senden' }).click();
  pruefen(await sichtbar(p.getByRole('listitem').filter({ hasText: 'Ja, 15 ist das Glied. QA-Antwort' }).getByText('Biss.stl')), 'Antwort mit Anhang gesendet');
  pruefen((await p.getByRole('link', { name: /Kommunikation\s*\d+ ungelesen/ }).count()) === 0, 'nach dem Lesen: kein »ungelesen« mehr');
  await bild(p, '14-auftrag-kommunikation');

  await p.getByRole('link', { name: /^Dateien/ }).click();
  await p.waitForURL(/tab=dateien/);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Ihre Dateien' })) && (await p.getByText('OK.stl').isVisible()), 'Tab »Dateien« mit den Scans');
  pruefen((await p.getByRole('button', { name: 'OK.stl entfernen' }).count()) === 0, 'gesendete Dateien können nicht entfernt werden');
  await p.getByRole('button', { name: '3D-Ansicht OK.stl' }).click();
  const leinwand = p.getByRole('img', { name: '3D-Modell OK.stl' });
  pruefen(await sichtbar(leinwand, 15000), '3D-Ansicht: Modell wird gezeigt');
  await p.waitForTimeout(600);
  // hell genug? Mitte des Bildes: das Modell (Elfenbein), nicht nur Schwarz
  const aufnahme = await p.screenshot();
  if (BILDER) writeFileSync(path.join(BILDER, '15-3d-ansicht.png'), aufnahme);
  // Pixel in der Bildmitte: hell (Modell), nicht Schwarz
  const hell = await p.evaluate(async (png) => {
    const b = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
    const c = new OffscreenCanvas(b.width, b.height).getContext('2d');
    c.drawImage(b, 0, 0);
    const d = c.getImageData(Math.floor(b.width / 2) - 20, Math.floor(b.height / 2) - 20, 40, 40).data;
    let summe = 0;
    for (let i = 0; i < d.length; i += 4) summe += d[i] + d[i + 1] + d[i + 2];
    return summe / (d.length / 4) / 3;
  }, aufnahme.toString('base64'));
  pruefen(hell > 80, `3D-Ansicht: Modell hell beleuchtet (Helligkeit Mitte ${Math.round(hell)})`);
  await p.getByRole('button', { name: 'Schließen' }).click();
  const [ansicht] = await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${nutzerA} and action = 'ansehen' and order_id = ${o1}`;
  pruefen(ansicht.n >= 1, 'Data-Access-Log: 3D-Ansicht als »ansehen«');

  await p.getByRole('link', { name: 'Auftragsdetails' }).click();
  await p.waitForURL(/tab=details/);
  pruefen(
    (await sichtbar(p.getByRole('img', { name: 'Zahn 15: Brückenglied' }))) && (await p.getByText('Brücke 16–14: Anker 16, 14 · Glied 15').count()) >= 1 && (await p.getByText('VITA classical A2').isVisible()),
    'Tab »Auftragsdetails«: Zahnschema (nur lesen) und alle Angaben',
  );
  const markiert = await p.evaluate(() => [...document.querySelectorAll('nav[aria-label="Bereiche des Auftrags"] a')].filter((a) => a.className.includes('border-rose')).map((a) => a.textContent));
  pruefen((await p.getByRole('link', { name: 'Auftragsdetails' }).getAttribute('aria-current')) === 'page' && markiert.join() === 'Auftragsdetails', `aktiver Tab markiert (${markiert.join()})`);
  await bild(p, '16-auftrag-details');

  // Rückfrage → Daten nachreichen
  await p.goto(`${PORTAL}/auftraege/${o2}`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Wir benötigen noch Informationen.' })) && (await p.getByText(/Es fehlen noch: Bissregistrierung/).first().isVisible()), 'Rückfrage: was fehlt');
  await p.getByRole('button', { name: 'Daten senden' }).click();
  pruefen(await sichtbar(p.getByText('Bitte laden Sie die fehlenden Dateien hoch oder schreiben Sie eine Antwort.')), 'ohne Datei und Antwort: Hinweis');
  await p.getByLabel('Bissregistrierung hochladen').setInputFiles(BISS);
  await p.getByText('✓').first().waitFor();
  await p.waitForFunction(() => !document.querySelector('[role=progressbar]'), null, { timeout: 15000 });
  await p.getByRole('button', { name: 'Daten senden' }).click();
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Auftrag eingegangen.' })), 'nach dem Nachreichen: wieder »Eingereicht«');
  const [o2db] = await sql`select status from ddl.orders where id = ${o2}`;
  const [nachgereicht] = await sql`select body from ddl.order_messages where order_id = ${o2} order by created_at desc limit 1`;
  pruefen(o2db.status === 'eingereicht' && nachgereicht.body === 'Daten nachgereicht: Bissregistrierung', 'Datenbank: Status zurück, Ereignis »Daten nachgereicht: Bissregistrierung«');

  // Storno
  await p.goto(`${PORTAL}/auftraege/${o3}`);
  pruefen((await p.getByRole('button', { name: 'Auftrag stornieren' }).count()) === 0, 'in Produktion: kein »Auftrag stornieren«');
  await p.goto(`${PORTAL}/auftraege/${o5}`);
  await p.getByRole('button', { name: 'Auftrag stornieren' }).click();
  await p.getByLabel('Grund der Stornierung').fill('QA: Patient hat abgesagt');
  await p.getByRole('button', { name: 'Endgültig stornieren' }).click();
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Storniert.' })), 'Storno mit Grund');
  const [o5db] = await sql`select status, cancel_reason from ddl.orders where id = ${o5}`;
  pruefen(o5db.status === 'storniert' && o5db.cancel_reason === 'QA: Patient hat abgesagt', 'Datenbank: storniert, mit Grund');

  // ════ Labor ════
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${ich.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-portal-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-portal-2');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${CRM}/`);
  pruefen(await sichtbar(s.getByRole('region', { name: 'Auf einen Blick' })), 'Übersicht als Dashboard');
  const neuKachel = s.getByRole('link', { name: /Neu eingegangen/ });
  const neuZahl = Number((await neuKachel.textContent()).match(/^\d+/)?.[0]);
  const [echt] = await sql`select count(*)::int as n from ddl.orders where status = 'eingereicht'`;
  pruefen(neuZahl === echt.n, `Dashboard »Neu eingegangen« stimmt (${neuZahl})`);
  pruefen(Number((await s.getByRole('link', { name: /Neue Nachrichten/ }).textContent()).match(/^\d+/)?.[0]) >= 1, 'Dashboard zeigt die neue Nachricht der Ordination');
  await bild(s, '17-dashboard');
  await neuKachel.click();
  await s.waitForURL(/status=eingereicht/);
  pruefen(await sichtbar(s.getByRole('link', { name: /QA-2026-0001/ })), 'Kachel führt zur gefilterten Liste');
  pruefen((await s.getByText('Erika').count()) === 0, 'interne Liste: nur Patienten-ID');
  await s.getByLabel('Ordination').selectOption({ label: 'QA · Portal Ordination A' });
  await s.waitForURL(/ordination=/);
  await s.goto(`${CRM}/auftraege/${o1}?tab=kommunikation`);
  pruefen(await sichtbar(s.getByText('INTERN-QA: Präparation knapp')) && (await s.getByText('Ja, 15 ist das Glied. QA-Antwort').isVisible()), 'Labor sieht interne Notiz und die Antwort der Ordination');
  await s.getByLabel('Nachricht', { exact: true }).fill('QA intern zweite Notiz');
  await s.getByLabel('Intern (nur im Labor sichtbar)').check();
  await s.getByRole('button', { name: 'Senden' }).click();
  await s.getByText('QA intern zweite Notiz').waitFor();
  await p.goto(`${PORTAL}/auftraege/${o1}?tab=kommunikation`);
  pruefen((await p.getByText('QA intern zweite Notiz').count()) === 0, 'neue interne Notiz bleibt im Labor');
  await s.goto(`${CRM}/auftraege/${o1}`);
  pruefen((await s.getByText('Erika').count()) === 0, 'Labor-Auftragsseite: Name verborgen');
  await s.getByRole('button', { name: 'Name anzeigen' }).click();
  pruefen(await sichtbar(s.getByText('Erika Prüfmann')), '»Name anzeigen« zeigt den Namen');
  const [log] = await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${ich.id} and action = 'entschluesseln' and patient_id = ${erika}`;
  pruefen(log.n === 1, 'Data-Access-Log: »Name anzeigen« genau einmal');
  await bild(s, '18-labor-auftrag');

  // ════ Trennung ════
  const { s: q } = await portalZugang('QA Portal B', 'qa-portal-b@example.invalid', B.id);
  const fremd = [(await q.goto(`${PORTAL}/auftraege/${o1}`)).status(), (await q.goto(`${PORTAL}/patienten/${erika}`)).status(), (await q.goto(`${PORTAL}/auftraege/${o1}?tab=kommunikation`)).status()];
  pruefen(fremd.every((x) => x === 404), `Ordination B: fremder Auftrag und Patient nicht erreichbar (${fremd.join('/')})`);
  await q.goto(`${PORTAL}/?ansicht=patienten`);
  pruefen((await q.getByText('Erika').count()) === 0, 'Ordination B sieht keine Patienten von A');

  // ════ Ansicht ════
  const zuBreit = [];
  for (const [breite, hoehe] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
    await p.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of ['/', '/?ansicht=patienten', `/patienten/${erika}`, `/auftraege/${o1}`, `/auftraege/${o1}?tab=kommunikation`, `/auftraege/${o1}?tab=dateien`, `/auftraege/${o3}?tab=details`, '/patienten/neu']) {
      await p.goto(`${PORTAL}${pfad}`, { waitUntil: 'networkidle' });
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`portal ${pfad} ${breite}px: ${w}px`);
    }
    await s.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of ['/', '/auftraege', `/auftraege/${o1}`, `/auftraege/${o3}?tab=details`]) {
      await s.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
      const w = await s.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`intern ${pfad} ${breite}px: ${w}px`);
    }
    if (breite === 390) {
      await p.goto(`${PORTAL}/`, { waitUntil: 'networkidle' });
      await bild(p, '19-portal-390');
      await p.goto(`${PORTAL}/auftraege/${o3}`, { waitUntil: 'networkidle' });
      await bild(p, '20-auftrag-390');
      await s.goto(`${CRM}/`, { waitUntil: 'networkidle' });
      await bild(s, '21-dashboard-390');
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (1440 bis 320 px)${zuBreit.length ? ' → ' + zuBreit.slice(0, 6).join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
