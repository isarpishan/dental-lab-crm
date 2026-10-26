// آزمون قدم ۱۰ در Chrome: اسناد (Konformitätserklärung، Lieferschein)، Reklamation و داشبورد.
// Techniker روی تبلت «Qualitätskontrolle erledigt» ← دو سند با شماره، sha256 و قفل دیتابیس؛ متن PDF با PDFKit؛
// دستکاری فایل ← 500؛ Ordination A سند خودش را می‌گیرد، B نه. «Geliefert» ← Ordination «Reklamation melden» با عکس؛
// Reklamation دوم هم‌زمان ← رد؛ Büro: Abgelehnt بدون دلیل ← پیام، Neuanfertigung (سفارش تازه با اسکن‌ها، ohne Berechnung)؛
// Reklamation تلفنی بعد از Gewährleistung ← Reparatur ← «Reparatur erledigt»؛ Ablehnung با دلیل؛ صفحهٔ «Reklamationen»
// با فیلتر و آمار؛ داشبورد؛ بدون نام بیمار؛ ظاهر در ۵ اندازه.
// دادهٔ آزمایشی («QA · …»، @example.invalid) در پایان کامل پاک می‌شود و شمارنده‌ها دقیقاً برمی‌گردند.
// اجرا: pnpm qa qa-reklamation  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { belegeLoeschen, belegZaehlerZurueck, zaehlerStand } from './qa-belege.mjs';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const BILDER = process.env.QA_BILDER ?? null;
const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};
const sichtbar = async (loc, timeout = 8000) => {
  try {
    await loc.first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
};
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
async function warten(f, timeout = 10000) {
  const ende = Date.now() + timeout;
  while (Date.now() < ende) {
    if (await f()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
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
const iso = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' });
const heute = iso.format(new Date());
const deDatum = (d) => d.split('-').reverse().join('.');
const plusMonate = (d, m) => {
  const [j, mo, t] = d.split('-').map(Number);
  const z = mo - 1 + m;
  const jj = j + Math.floor(z / 12);
  const mm = ((z % 12) + 12) % 12;
  const letzter = new Date(Date.UTC(jj, mm + 1, 0)).getUTCDate();
  return `${jj}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(t, letzter)).padStart(2, '0')}`;
};

const ordner = path.join(tmpdir(), 'ddl-qa-reklamation');
mkdirSync(ordner, { recursive: true });
const STAFF = ['test-reklamation-technik@example.invalid', 'test-reklamation-buero@example.invalid'];
const NAME = { vor: 'Rita', nach: 'Rissig' };
const pdfLesen = (datei) => JSON.parse(execFileSync('swift', ['scripts/qa-pdf.swift', datei], { maxBuffer: 10_000_000 }).toString());
const flach = (t) => t.replace(/\s+/g, ' ');

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Reklamation%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  if (praxen.length) {
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      for (const f of await sql`select storage_key from ddl.order_files where order_id in ${sql(auftraege)}`) await rm(path.join(SPEICHER, f.storage_key), { force: true });
      await belegeLoeschen(sql, auftraege);
      await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
    }
    await sql`delete from ddl.patients where practice_id in ${sql(praxen)}`;
  }
  await sql`delete from ddl.material_lots where lot_no like 'QA-RK-LOT-%'`;
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

await aufraeumen();
const zaehlerVorher = await zaehlerStand(sql);
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async (breite = 1440) => {
  const ctx = await browser.newContext({ viewport: { width: breite, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  return s;
};
async function mitarbeiter(email, name, rolle, breite) {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${email}, ${name}, ${rolle}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite(breite);
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-reklamation-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-reklamation-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((u) => u.href.startsWith(`${CRM}/`) && !u.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}
async function portalZugang(name, email, praxisId) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-reklamation-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-reklamation-2');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}
const zeile = async (id) => (await sql`select * from ddl.orders where id = ${id}`)[0];

try {
  // ── Daten ──
  const [A] = await sql`insert into ddl.practices (customer_no, name, street, zip, city) values ('QA-RA', 'QA · Reklamation Ordination A', 'Teststraße 5', '1200', 'Wien') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name) values ('QA-RB', 'QA · Reklamation Ordination B') returning id`;
  const [arzt] = await sql`insert into ddl.dentists (practice_id, title, first_name, last_name) values (${A.id}, 'Dr.', 'Clara', 'Quell') returning id`;
  const { s: p, id: nutzerA } = await portalZugang('Dr. Qa Reklamation', 'qa-reklamation-a@example.invalid', A.id);
  const { s: pB } = await portalZugang('Dr. Qa Andere', 'qa-reklamation-b@example.invalid', B.id);
  const [pat] = await sql`insert into ddl.patients (practice_id, code, first_name_enc, last_name_enc, created_by_kind, created_by_id)
    values (${A.id}, 'P-QAR1', ${verschluesseln(NAME.vor)}, ${verschluesseln(NAME.nach)}, 'practice', ${nutzerA}) returning id`;
  const [lot] = await sql`insert into ddl.material_lots (material_key, lot_no, expiry_date, received_at) values ('sr_crown', 'QA-RK-LOT-1', ${plusMonate(heute, 12)}, ${heute}) returning id`;
  const krone = { zaehne: { 16: { art: 'krone' } }, versorgung: 'definitiv', farbe: { system: 'vita_classical', farbe: 'A2' } };
  const auftrag = async ({ nr, st, schritt = null, geliefert = null }) => {
    const [o] = await sql`insert into ddl.orders (order_no, practice_id, dentist_id, patient_id, work_type_key, delivery_kind, config, shade, status, current_step_key, source, tempo, submitted_at, approved_at, delivered_at, created_by_kind, created_by_id, price_snapshot)
      values (${nr}, ${A.id}, ${arzt.id}, ${pat.id}, 'krone', 'fertigung', ${sql.json(krone)}, 'A2', ${st}, ${schritt}, 'portal', 'standard', now() - interval '6 days', now() - interval '4 days', ${geliefert}, 'practice', ${nutzerA},
        ${sql.json({ lieferart: 'fertigung', preisAb: 120, einheit: 'Zahn', zuschlag: null, bearbeitungszeit: '3 Werktage' })}) returning id`;
    await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, ${st}, now() - interval '1 day', 'staff')`;
    await sql`insert into ddl.order_teeth (order_id, fdi, treatment) values (${o.id}, 16, 'krone')`;
    return o.id;
  };
  const r1 = await auftrag({ nr: 'QA-R-0001', st: 'fertig', schritt: 'qualitaetskontrolle' });
  const r3 = await auftrag({ nr: 'QA-R-0003', st: 'abgeschlossen', geliefert: new Date(Date.now() - 3 * 365 * 86400000) });
  await sql`insert into ddl.order_steps (order_id, step_key, device_key, started_at, done_at) values (${r1}, 'druck', 'sprintray_midas', now() - interval '2 days', now() - interval '2 days')`;
  await sql`insert into ddl.order_steps (order_id, step_key, started_at) values (${r1}, 'qualitaetskontrolle', now() - interval '1 hour')`;
  // Scan der Ordination (wird bei der Neuanfertigung kopiert)
  const scanInhalt = Buffer.from(`solid qa\n${'facet normal 0 0 1\n'.repeat(40)}endsolid qa\n`);
  const scanId = randomUUID();
  const scanKey = `${scanId.slice(0, 2)}/${scanId}`;
  mkdirSync(path.join(SPEICHER, scanId.slice(0, 2)), { recursive: true });
  writeFileSync(path.join(SPEICHER, scanKey), scanInhalt);
  await sql`insert into ddl.order_files (order_id, origin, kind, slot, storage_key, filename_enc, mime, size, sha256, uploaded_by_kind, uploaded_by_id, created_at)
    values (${r1}, 'praxis', 'scan', 'ok', ${scanKey}, ${verschluesseln('oberkiefer.stl')}, 'model/stl', ${scanInhalt.length}, ${sha(scanInhalt)}, 'practice', ${nutzerA}, now() - interval '6 days')`;
  await sql`insert into ddl.order_materials (order_id, lot_id, step_key, created_by) values (${r1}, ${lot.id}, 'druck', ${nutzerA})`;

  const { s: t, id: technik } = await mitarbeiter(STAFF[0], 'Test Technik', 'techniker');
  const { s: bu } = await mitarbeiter(STAFF[1], 'Test Büro', 'buero');

  // ── Qualitätskontrolle → Dokumente ──
  await t.goto(`${CRM}/s/QA-R-0001`);
  await t.getByRole('button', { name: 'Qualitätskontrolle erledigt' }).click();
  pruefen(await warten(async () => (await zeile(r1)).status === 'versendet'), 'Tablet: »Qualitätskontrolle erledigt« → Übergabe');
  const belege = await sql`select * from ddl.documents where order_id = ${r1} order by kind`;
  const ke = belege.find((d) => d.kind === 'konformitaet');
  const ls = belege.find((d) => d.kind === 'lieferschein');
  pruefen(belege.length === 2 && /^KE-\d{4}-\d{4}$/.test(ke?.doc_no) && /^LS-\d{4}-\d{4}$/.test(ls?.doc_no) && ke.issued_by === technik, 'Konformitätserklärung und Lieferschein ausgestellt (Nummer, Person)');
  pruefen(belege.every((d) => sha(readFileSync(path.join(SPEICHER, d.storage_key))) === d.sha256), 'PDF auf der Platte passt zu sha256');
  await t.reload();
  pruefen(await sichtbar(t.getByRole('link', { name: `Lieferschein ${ls.doc_no} ↗` })) && (await t.getByRole('link', { name: `Konformitätserklärung ${ke.doc_no} ↗` }).count()) === 1, 'Tablet: Links zu Lieferschein und Konformitätserklärung');
  await bild(t, '60-tablet-uebergabe');

  // Inhalt der PDFs
  const keDatei = path.join(ordner, 'ke.pdf');
  const lsDatei = path.join(ordner, 'ls.pdf');
  const keAntwort = await t.request.get(`${CRM}/api/dokumente/${ke.id}`);
  writeFileSync(keDatei, await keAntwort.body());
  writeFileSync(lsDatei, await (await t.request.get(`${CRM}/api/dokumente/${ls.id}`)).body());
  pruefen(keAntwort.status() === 200 && keAntwort.headers()['content-type'] === 'application/pdf', 'Labor: Konformitätserklärung als PDF');
  const keText = pdfLesen(keDatei);
  const kt = flach(keText.text);
  pruefen(
    keText.seiten === 1 &&
      ['Konformitätserklärung', ke.doc_no, 'P-QAR1', 'QA-R-0001', 'Krone', 'Dr. Clara Quell', 'QA · Reklamation Ordination A', 'QA-RK-LOT-1', 'SprintRay MIDAS', 'Test Technik', 'Isar Pishan · Digital Dental Lab', '1200 Wien', 'Anhang I', 'Sonderanfertigung'].every((x) =>
        kt.includes(x),
      ),
    'Konformitätserklärung: eine Seite, Hersteller, Produkt, Patienten-ID, Behandler, Charge, Gerät, Freigabe',
  );
  const lsText = pdfLesen(lsDatei);
  const lt = flach(lsText.text);
  pruefen(lsText.seiten === 1 && [ls.doc_no, 'Lieferschein', 'Teststraße 5', '1200 Wien', 'QA-RA', `Konformitätserklärung ${ke.doc_no}`, 'P-QAR1', 'Krone'].every((x) => lt.includes(x)), 'Lieferschein: Empfänger, Kundennummer, Leistung, Beilage');
  pruefen(!kt.includes(NAME.nach) && !lt.includes(NAME.nach) && !kt.includes(NAME.vor), 'kein Patientenname auf den Dokumenten');

  // unveränderlich
  let gesperrt = 0;
  for (const versuch of [() => sql`update ddl.documents set doc_no = 'X' where id = ${ke.id}`, () => sql`delete from ddl.documents where id = ${ke.id}`]) {
    try {
      await versuch();
    } catch (e) {
      if (/unveränderlich/.test(String(e.message))) gesperrt++;
    }
  }
  pruefen(gesperrt === 2, 'Datenbank: Ändern und Löschen eines Dokuments abgelehnt');
  const original = readFileSync(path.join(SPEICHER, ls.storage_key));
  appendFileSync(path.join(SPEICHER, ls.storage_key), 'x');
  const manipuliert = await t.request.get(`${CRM}/api/dokumente/${ls.id}`);
  writeFileSync(path.join(SPEICHER, ls.storage_key), original);
  pruefen(manipuliert.status() === 500 && (await t.request.get(`${CRM}/api/dokumente/${ls.id}`)).status() === 200, 'veränderte Datei wird nicht ausgeliefert (sha256)');

  // Ordination A und B
  await p.goto(`${PORTAL}/auftraege/${r1}`);
  pruefen(await sichtbar(p.getByRole('complementary', { name: 'Auftrag' }).getByRole('link', { name: /Konformitätserklärung/ })), 'Portal: Dokumente in der Seitenleiste');
  const vorher = (await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${nutzerA} and action = 'herunterladen'`)[0].n;
  const pAntwort = await p.request.get(`${PORTAL}/api/dokumente/${ls.id}`);
  const nachher = (await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${nutzerA} and action = 'herunterladen' and patient_id = ${pat.id}`)[0].n;
  pruefen(pAntwort.status() === 200 && nachher === vorher + 1, 'Ordination lädt ihren Lieferschein, im Data-Access-Log');
  pruefen((await pB.request.get(`${PORTAL}/api/dokumente/${ls.id}`)).status() === 404, 'andere Ordination: Dokument nicht gefunden (404)');

  // ── Geliefert → Reklamation melden ──
  await t.getByRole('button', { name: 'Geliefert' }).click();
  pruefen(await warten(async () => (await zeile(r1)).status === 'geliefert'), 'Übergabe → Geliefert');
  await p.goto(`${PORTAL}/auftraege/${r1}`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Geliefert.' })) && (await sichtbar(p.getByText(`Am ${deDatum(heute)}.`))), 'Portal: »Geliefert.« mit Datum');
  const p2 = await p.context().newPage();
  await p2.goto(`${PORTAL}/auftraege/${r1}`);
  for (const s of [p, p2]) {
    const bereich = s.getByRole('region', { name: 'Reklamation' });
    await bereich.getByRole('button', { name: 'Reklamation melden' }).click();
  }
  const form = p.getByRole('form', { name: 'Reklamation melden' });
  await form.getByLabel('Beschreibung').fill('Krone 16 sitzt approximal zu stramm.');
  await form.getByRole('button', { name: 'Reklamation senden' }).click();
  pruefen(await sichtbar(form.getByText('Bitte einen Grund wählen.')), 'ohne Grund: Hinweis');
  await form.getByRole('radio', { name: 'Passung' }).click();
  await form.getByRole('button', { name: 'Zahn 16' }).click();
  const foto = path.join(ordner, 'kontakt.png');
  writeFileSync(foto, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await form.getByLabel('Fotos anhängen').setInputFiles(foto);
  await form.getByText('✓ kontakt.png').waitFor({ timeout: 15000 });
  await bild(p, '61-portal-reklamation-melden');
  await form.getByRole('button', { name: 'Reklamation senden' }).click();
  const bereich = p.getByRole('region', { name: 'Reklamation' });
  pruefen(await sichtbar(bereich.getByText(/^RK-\d{4}-\d{4}$/)), 'Reklamation gemeldet: Nummer sichtbar');
  const [rk1] = await sql`select * from ddl.complaints where order_id = ${r1}`;
  const garantieBis = plusMonate(heute, 24);
  pruefen(rk1 && rk1.reason === 'passung' && rk1.warranty_valid === true && iso.format(rk1.warranty_until) === garantieBis && rk1.decision === 'offen', 'Datenbank: Grund, Gewährleistung 24 Monate ab Lieferung, offen');
  pruefen(await sichtbar(bereich.getByText(`Innerhalb der Gewährleistung (bis ${deDatum(garantieBis)})`)) && (await bereich.getByText('In Prüfung', { exact: true }).count()) === 1, 'Portal: »In Prüfung«, Gewährleistung bis …');
  const [{ n: anh }] = await sql`select count(*)::int as n from ddl.message_files where message_id = ${rk1.message_id}`;
  pruefen(anh === 1, 'Foto als Anhang der Reklamation');
  pruefen((await bereich.getByRole('button', { name: 'Reklamation melden' }).count()) === 0, 'zweite Reklamation erst nach der Entscheidung');
  // gleichzeitig aus dem zweiten Tab
  const form2 = p2.getByRole('form', { name: 'Reklamation melden' });
  await form2.getByRole('radio', { name: 'Farbe' }).click();
  await form2.getByLabel('Beschreibung').fill('Farbe zu hell im Vergleich.');
  await form2.getByRole('button', { name: 'Reklamation senden' }).click();
  pruefen(await sichtbar(form2.getByText('Für diesen Auftrag ist bereits eine Reklamation in Prüfung.')), 'zweiter Tab: »bereits eine Reklamation in Prüfung«');
  await p2.close();
  await p.goto(`${PORTAL}/auftraege/${r1}?tab=kommunikation`);
  pruefen(await sichtbar(p.getByText(`${rk1.complaint_no} · Passung · Zahn 16`)) && (await sichtbar(p.getByText('kontakt.png'))), 'Kommunikation: Reklamation mit Foto');
  await bild(p, '62-portal-kommunikation');

  // ── Labor ──
  await t.goto(`${CRM}/reklamationen`);
  const tListe = t.getByRole('list', { name: 'Reklamationen' });
  pruefen(await sichtbar(tListe.getByText(rk1.complaint_no)) && !(await t.content()).includes(NAME.nach), 'Techniker: »Reklamationen« mit der neuen, ohne Patientennamen');
  await t.goto(`${CRM}/auftraege/${r1}`);
  pruefen((await sichtbar(t.getByRole('region', { name: 'Reklamation' }).getByText(rk1.complaint_no))) && (await t.getByRole('form', { name: 'Reklamation entscheiden' }).count()) === 0, 'Techniker sieht die Reklamation, entscheidet aber nicht');

  await bu.goto(`${CRM}/`);
  const kachel = bu.getByRole('region', { name: 'Auf einen Blick' }).getByRole('link', { name: /Offene Reklamationen/ });
  pruefen(await sichtbar(kachel) && Number((await kachel.locator('span').first().textContent()).trim()) >= 1, 'Übersicht: Kachel »Offene Reklamationen«');
  const kachelnDa = (await sichtbar(bu.getByRole('link', { name: /Heute fällig/ }))) && (await sichtbar(bu.getByRole('link', { name: /In Übergabe/ })));
  await bu.goto(`${CRM}/?tab=produktion`);
  pruefen(
    kachelnDa && (await sichtbar(bu.getByRole('list', { name: 'Aufträge je Schritt' }))),
    'Übersicht: »Heute fällig«, »In Übergabe«, Produktion je Schritt',
  );
  await bild(bu, '63-uebersicht');
  await kachel.click();
  await bu.waitForURL(`${CRM}/reklamationen`);
  pruefen(await sichtbar(bu.getByRole('list', { name: 'Reklamationen' }).getByText(rk1.complaint_no)), 'Kachel führt zur Liste');
  await bu.goto(`${CRM}/auftraege/${r1}`);
  const ent = bu.getByRole('form', { name: 'Reklamation entscheiden' });
  await ent.getByLabel('Abgelehnt').check();
  await ent.getByRole('button', { name: 'Entscheidung senden' }).click();
  const begruendung = ent.getByRole('textbox', { name: 'Begründung für die Ordination' });
  pruefen(
    (await begruendung.evaluate((el) => el.validity.valueMissing)) && (await sql`select decision from ddl.complaints where id = ${rk1.id}`)[0].decision === 'offen',
    'Ablehnung ohne Begründung: Pflichtfeld, nichts gespeichert',
  );
  await ent.getByLabel('Neuanfertigung').check();
  pruefen(await ent.getByLabel('Ohne Berechnung (Gewährleistung oder Kulanz)').isChecked(), 'innerhalb der Gewährleistung: »Ohne Berechnung« vorausgewählt');
  await ent.getByLabel('Nachricht an die Ordination (optional)').fill('Wir fertigen neu an.');
  await bild(bu, '64-labor-entscheiden');
  await ent.getByRole('button', { name: 'Entscheidung senden' }).click();
  pruefen(await sichtbar(bu.getByRole('link', { name: /^Auftrag A-\d{4}-\d{4} ↗$/ })), 'Neuanfertigung: Link zum neuen Auftrag');
  const [rk1b] = await sql`select * from ddl.complaints where id = ${rk1.id}`;
  const neu = await zeile(rk1b.new_order_id);
  pruefen(
    rk1b.decision === 'neuanfertigung' && rk1b.free_of_charge === true && neu && neu.status === 'eingereicht' && neu.remake_of_id === r1 && neu.work_type_key === 'krone' && neu.shade === 'A2' && /^A-\d{4}-\d{4}$/.test(neu.order_no),
    'Datenbank: neuer Auftrag »Eingereicht«, verknüpft, gleiche Behandlung und Farbe',
  );
  pruefen(neu.price_snapshot?.neuanfertigung?.kostenlos === true && JSON.stringify(neu.config) === JSON.stringify((await zeile(r1)).config), 'neuer Auftrag: gleiche Angaben, ohne Berechnung');
  const [kopie] = await sql`select storage_key, sha256 from ddl.order_files where order_id = ${neu.id}`;
  const [{ n: zaehne }] = await sql`select count(*)::int as n from ddl.order_teeth where order_id = ${neu.id} and fdi = 16`;
  pruefen(kopie && kopie.storage_key !== scanKey && kopie.sha256 === sha(scanInhalt) && sha(readFileSync(path.join(SPEICHER, kopie.storage_key))) === kopie.sha256 && zaehne === 1, 'Scans als eigene Kopie, Zähne übernommen');

  await p.goto(`${PORTAL}/auftraege/${r1}`);
  const neuLink = p.getByRole('region', { name: 'Reklamation' }).getByRole('link', { name: `Auftrag ${neu.order_no} ↗` });
  pruefen((await sichtbar(neuLink)) && (await sichtbar(p.getByText('Wir fertigen neu an.'))), 'Portal: Entscheidung mit Link zum neuen Auftrag');
  await neuLink.click();
  await p.waitForURL(`${PORTAL}/auftraege/${neu.id}`);
  pruefen(await sichtbar(p.getByRole('complementary', { name: 'Auftrag' }).getByRole('link', { name: 'von QA-R-0001' })), 'neuer Auftrag: »Neuanfertigung von QA-R-0001«');
  await p.goto(`${PORTAL}/auftraege/${neu.id}?tab=details`);
  const preisNeu = p.getByRole('main').getByRole('region', { name: /Preis/ }).first();
  pruefen((await sichtbar(preisNeu.getByText('Ohne Berechnung', { exact: true }))) && (await preisNeu.getByText(`Neuanfertigung (Reklamation ${rk1.complaint_no}), kostenlos`, { exact: false }).isVisible()), 'Auftragsdetails: »Ohne Berechnung« (Neuanfertigung, kostenlos)');
  await p.goto(`${PORTAL}/auftraege/${neu.id}?tab=dateien`);
  pruefen(await sichtbar(p.getByText('oberkiefer.stl')), 'Dateien: Scan im neuen Auftrag');

  // zweite Reklamation am selben Auftrag → Ablehnung mit Begründung
  await p.goto(`${PORTAL}/auftraege/${r1}`);
  await p.getByRole('region', { name: 'Reklamation' }).getByRole('button', { name: 'Reklamation melden' }).click();
  const form3 = p.getByRole('form', { name: 'Reklamation melden' });
  await form3.getByRole('radio', { name: 'Form' }).click();
  await form3.getByLabel('Beschreibung').fill('Höcker zu flach gestaltet.');
  await form3.getByRole('button', { name: 'Reklamation senden' }).click();
  await p.getByText('In Prüfung', { exact: true }).waitFor();
  const [rk2] = await sql`select * from ddl.complaints where order_id = ${r1} and decision = 'offen'`;
  await bu.goto(`${CRM}/auftraege/${r1}`);
  const ent2 = bu.getByRole('form', { name: 'Reklamation entscheiden' });
  await ent2.getByLabel('Abgelehnt').check();
  await ent2.getByRole('textbox', { name: 'Begründung für die Ordination' }).fill('Die Form entspricht dem freigegebenen Design.');
  await ent2.getByRole('button', { name: 'Entscheidung senden' }).click();
  await bu.getByRole('form', { name: 'Reklamation entscheiden' }).waitFor({ state: 'detached' });
  await p.reload();
  pruefen(await sichtbar(p.getByText('Begründung: Die Form entspricht dem freigegebenen Design.')), 'Portal: »Abgelehnt« mit Begründung');
  pruefen((await sql`select decision from ddl.complaints where id = ${rk2.id}`)[0].decision === 'abgelehnt', 'Datenbank: abgelehnt');

  // telefonisch im Labor, Gewährleistung abgelaufen → Reparatur
  await bu.goto(`${CRM}/auftraege/${r3}`);
  await bu.getByRole('region', { name: 'Reklamation' }).getByRole('button', { name: 'Reklamation erfassen' }).click();
  const form4 = bu.getByRole('form', { name: 'Reklamation erfassen' });
  await form4.getByRole('radio', { name: 'Bruch' }).click();
  await form4.getByLabel('Beschreibung').fill('Telefonisch: Krone 16 gebrochen.');
  await form4.getByRole('button', { name: 'Reklamation senden' }).click();
  const r3Bereich = bu.getByRole('region', { name: 'Reklamation' });
  pruefen(await sichtbar(r3Bereich.getByText(/Gewährleistung abgelaufen am/)), 'Labor erfasst Reklamation: Gewährleistung abgelaufen');
  const ent3 = bu.getByRole('form', { name: 'Reklamation entscheiden' });
  await ent3.getByLabel('Neuanfertigung').check();
  pruefen(!(await ent3.getByLabel('Ohne Berechnung (Gewährleistung oder Kulanz)').isChecked()), 'abgelaufen: »Ohne Berechnung« nicht vorausgewählt');
  await ent3.getByLabel('Reparatur').check();
  await ent3.getByRole('button', { name: 'Entscheidung senden' }).click();
  await r3Bereich.getByRole('button', { name: 'Reparatur erledigt' }).click();
  pruefen(await sichtbar(r3Bereich.getByText(`Repariert am ${deDatum(heute)}`)), 'Reparatur erledigt → »Repariert am …«');
  const [rk3] = await sql`select * from ddl.complaints where order_id = ${r3}`;
  pruefen(rk3.reported_by_kind === 'staff' && rk3.warranty_valid === false && rk3.decision === 'reparatur' && rk3.repaired_at, 'Datenbank: vom Labor, außerhalb der Gewährleistung, repariert');

  // Liste, Filter, Zahlen
  await bu.goto(`${CRM}/reklamationen`);
  const offeneQa = bu.getByRole('list', { name: 'Reklamationen' }).getByText(/QA-R-000/);
  pruefen((await offeneQa.count()) === 0, 'Filter »Offen«: keine offene QA-Reklamation mehr');
  await bu.goto(`${CRM}/reklamationen?status=alle&ordination=${A.id}`);
  pruefen((await bu.getByRole('list', { name: 'Reklamationen' }).getByRole('listitem').count()) === 3, 'Filter »Alle« + Ordination: 3 Reklamationen');
  await bu.goto(`${CRM}/reklamationen?status=alle&grund=bruch&ordination=${A.id}`);
  pruefen((await bu.getByRole('list', { name: 'Reklamationen' }).getByRole('listitem').count()) === 1, 'Filter Grund »Bruch«: 1');
  await bu.goto(`${CRM}/reklamationen?status=alle&suche=${rk2.complaint_no}`);
  pruefen((await bu.getByRole('list', { name: 'Reklamationen' }).getByRole('listitem').count()) === 1, 'Suche nach RK-Nummer');
  await bu.goto(`${CRM}/reklamationen?tab=auswertung`);
  const statText = flach(await bu.locator('main').innerText());
  pruefen(/QA · Reklamation Ordination A\s*3 · 2 von 2 Arbeiten \(100 %\)/.test(statText), 'Zahlen »Nach Ordination«: 3 Reklamationen an 2 von 2 gelieferten Arbeiten');
  pruefen(!statText.includes(NAME.nach), 'Liste ohne Patientennamen');
  await bild(bu, '65-reklamationen');

  // ── Ansicht in 5 Größen ──
  const zuBreit = [];
  for (const [breite, hoehe] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
    await bu.setViewportSize({ width: breite, height: hoehe });
    await p.setViewportSize({ width: breite, height: hoehe });
    for (const [s, url] of [[bu, `${CRM}/reklamationen?status=alle`], [bu, `${CRM}/auftraege/${r1}`], [bu, `${CRM}/`], [p, `${PORTAL}/auftraege/${r1}`]]) {
      await s.goto(url, { waitUntil: 'networkidle' });
      const w = await s.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${url.replace(/^https?:\/\/[^/]+/, '')} ${breite}px: ${w}px`);
    }
    if (breite === 390) {
      await bild(p, '66-portal-reklamation-390');
      await bild(bu, '67-portal-uebersicht-390');
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (1440 bis 320 px)${zuBreit.length ? ' → ' + zuBreit.slice(0, 6).join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await belegZaehlerZurueck(sql, zaehlerVorher);
  pruefen(JSON.stringify(zaehlerVorher) === JSON.stringify(await zaehlerStand(sql)), 'Zähler (Auftrags-, Beleg- und Reklamationsnummern) unverändert');
  const [{ n: rest }] = await sql`select count(*)::int as n from ddl.documents d join ddl.orders o on o.id = d.order_id where o.order_no like 'QA-%'`;
  pruefen(rest === 0, 'Testdokumente entfernt');
  await sql.end();
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fehler ? 1 : 0);
