// آزمون کامل از اول تا آخر (قدم ۱۲؛ سناریوی Verification در Spec فاز ۱)، فقط با رابط کاربری، مثل کار واقعی:
// Ordination با فرم «Neuer Auftrag» یک Brücke 14–16 روی Implantat (Hersteller، Scanbody) و یک Teilprothese
// (Kieferbogen، Flipper، Hufeisen) می‌فرستد؛ لابراتوار همان انتخاب‌ها را می‌بیند. Design ← Änderung anfordern ←
// Version 2 ← Freigeben (ZIP) ← Laufzettel با QR ← تبلت تا Qualitätskontrolle ← Lieferschein و Konformitätserklärung
// ← Tagesplan و «Zugestellt» راننده ← Reklamation ← Neuanfertigung ohne Berechnung. در طول راه: ایمیل‌ها در
// Mailpit بدون نام بیمار، Laufzettel فقط با کد، جدایی Ordinationها، Data-Access-Log.
// اجرا: pnpm qa qa-ablauf  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { belegeLoeschen, belegZaehlerZurueck, zaehlerStand } from './qa-belege.mjs';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const MAILPIT = process.env.QA_MAILPIT ?? 'http://localhost:8025';
const BILDER = process.env.QA_BILDER ?? null;
const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};
const sichtbar = async (loc, timeout = 10000) => {
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
async function warten(f, timeout = 20000) {
  const ende = Date.now() + timeout;
  while (Date.now() < ende) {
    const r = await f();
    if (r) return r;
    await new Promise((x) => setTimeout(x, 300));
  }
  return null;
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
/** binäres STL eines Quaders */
function quader(h = 10) {
  const p = [[0,0,0],[10,0,0],[10,8,0],[0,8,0],[0,0,h],[10,0,h],[10,8,h],[0,8,h]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const b = Buffer.alloc(84 + f.length * 50);
  b.writeUInt32LE(f.length, 80);
  f.forEach((t, i) => t.forEach((k, j) => p[k].forEach((w, a) => b.writeFloatLE(w, 84 + i * 50 + 12 + j * 12 + a * 4))));
  return b;
}
const ordner = path.join(tmpdir(), 'ddl-qa-ablauf');
mkdirSync(ordner, { recursive: true });
const datei = (name, h) => {
  const p = path.join(ordner, name);
  writeFileSync(p, quader(h));
  return p;
};
const D = {
  scanbody: datei('Scanbody 14-16.stl', 9),
  gegen: datei('Gegenkiefer.stl', 4),
  biss: datei('Biss.stl', 2),
  ok: datei('OK.stl', 5),
  uk: datei('UK.stl', 5),
  v1: datei('Bruecke 14-16 V1.stl', 7),
  v2: datei('Bruecke 14-16 V2.stl', 6),
};
const pdfLesen = (d) => JSON.parse(execFileSync('swift', ['scripts/qa-pdf.swift', d], { maxBuffer: 10_000_000 }).toString());

const NAME = { vor: 'Ottilie', nach: 'Ablaufer' };
const NAME2 = { vor: 'Gustav', nach: 'Gebissreich' };
const PRAXIS_MAIL = 'qa-ablauf-a@example.invalid';
const ANDERE_MAIL = 'qa-ablauf-b@example.invalid';
const STAFF = ['test-ablauf-technik@example.invalid', 'test-ablauf-buero@example.invalid', 'test-ablauf-fahrer@example.invalid'];

async function postfach(an) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${an}"`)}&limit=200`);
  return (await r.json()).messages ?? [];
}
const mailLesen = async (id) => (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
async function mailpitLeeren() {
  const ids = [];
  for (const a of [PRAXIS_MAIL, ANDERE_MAIL]) for (const m of await postfach(a)) ids.push(m.ID);
  if (ids.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
}

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Ablauf%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  if (praxen.length) {
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      for (const f of await sql`select storage_key from ddl.order_files where order_id in ${sql(auftraege)}`) await rm(path.join(SPEICHER, f.storage_key), { force: true });
      await belegeLoeschen(sql, auftraege);
      await sql`delete from ddl.jobs where type = 'benachrichtigung' and payload->>'orderId' in ${sql(auftraege)}`;
      await sql`update ddl.orders set remake_of_id = null where id in ${sql(auftraege)}`;
      await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
    }
    await sql`delete from ddl.patients where practice_id in ${sql(praxen)}`;
  }
  await sql`delete from ddl.jobs where type = 'email_senden' and payload->>'an' in ${sql([PRAXIS_MAIL, ANDERE_MAIL])}`;
  await sql`delete from ddl.material_lots where lot_no like 'QA-ABL-%'`;
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
  await sql`delete from ddl.tours where name = 'QA · Ablauf Tour'`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
  await mailpitLeeren();
}

await aufraeumen();
const zaehlerVorher = await zaehlerStand(sql);
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async (breite = 1440) => {
  const ctx = await browser.newContext({ viewport: { width: breite, height: 900 }, acceptDownloads: true });
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-ablauf-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-ablauf-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((u2) => u2.href.startsWith(`${CRM}/`) && !u2.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}
async function portalZugang(name, email, praxisId) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-ablauf-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-ablauf-2');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}
const zeile = async (id) => (await sql`select * from ddl.orders where id = ${id}`)[0];
const kachel = (s, name) => s.getByRole('button', { name: new RegExp(`^${name}`) });
const schritt = (s, id) => s.locator(`#schritt-${id}`);
const hochgeladen = (s) => s.waitForFunction(() => !document.body.textContent.match(/\d+ %/) && !document.querySelector('[role=progressbar]'), null, { timeout: 30000 });

/** «Neuer Auftrag» bis zum Absenden; gibt die Auftrags-ID zurück */
async function absenden(p) {
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Auftrag absenden' && !b.disabled), null, { timeout: 60000 });
  await p.getByRole('button', { name: 'Auftrag absenden' }).click();
  await p.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/, { timeout: 20000 });
  return p.url().split('/').pop();
}

try {
  // ── Daten: Ordination A mit Behandlerin und Tour, Ordination B, Labor ──
  const { s: t } = await mitarbeiter(STAFF[0], 'Test Technik', 'techniker');
  const { s: bu } = await mitarbeiter(STAFF[1], 'Test Büro', 'buero');
  const { s: f, id: fahrer } = await mitarbeiter(STAFF[2], 'Test Fahrer', 'fahrer', 390);
  const [tour] = await sql`insert into ddl.tours (name, weekdays, driver_id) values ('QA · Ablauf Tour', '{1,2,3,4,5,6,7}', ${fahrer}) returning id`;
  const [A] = await sql`insert into ddl.practices (customer_no, name, street, zip, city, tour_id, tour_position) values ('QA-AA', 'QA · Ablauf Ordination', 'Ablaufgasse 1', '1200', 'Wien', ${tour.id}, 1) returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name) values ('QA-AB', 'QA · Ablauf Ordination B') returning id`;
  await sql`insert into ddl.dentists (practice_id, title, first_name, last_name) values (${A.id}, 'Dr.', 'Ida', 'Ablauf')`;
  const ablauf = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
  await sql`insert into ddl.material_lots (material_key, lot_no, expiry_date) values ('sr_crown', 'QA-ABL-LOT-1', ${ablauf})`;
  const { s: p, id: nutzerA } = await portalZugang('Dr. Qa Ablauf', PRAXIS_MAIL, A.id);
  const { s: pB } = await portalZugang('Dr. Qa Fremd', ANDERE_MAIL, B.id);

  // ════ 1. Portal: Brücke 14–16 auf Implantaten ════
  await p.getByRole('main').getByRole('link', { name: 'Neuer Auftrag' }).click();
  await p.getByLabel('Vorname').fill(NAME.vor);
  await p.getByLabel('Nachname').fill(NAME.nach);
  await p.getByLabel('Geburtsdatum').fill('1961-07-04');
  await p.getByRole('button', { name: 'Anlegen und weiter' }).click();
  await kachel(p, 'Implantatkrone').click();
  const zaehne = schritt(p, 'b-zaehne');
  await zaehne.getByRole('radio', { name: /Brücke/ }).click();
  await zaehne.getByRole('button', { name: /^Zahn 14:/ }).click();
  await zaehne.getByRole('button', { name: /^Zahn 16:/ }).click();
  pruefen(await sichtbar(zaehne.getByText('Brücke 16–14: Anker 16, 14 · Glied 15')), 'Implantat-Brücke 14–16: Anker und Glied erkannt');
  await zaehne.getByRole('button', { name: 'Weiter', exact: true }).click();
  const impl = schritt(p, 'b-implantat');
  await impl.getByLabel('Implantathersteller').selectOption('Straumann');
  await impl.getByLabel('Implantatsystem / Plattform').fill('BLT RC');
  await impl.getByLabel('Scanbody-Hersteller').fill('Straumann');
  await impl.getByLabel('Scanbody-Typ').fill('CARES Mono Scanbody');
  await impl.getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'A2', exact: true }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'Weiter', exact: true }).click();
  await kachel(p, 'Fertige Arbeit').click();
  await schritt(p, 'tempo').getByRole('button', { name: /^Standard/ }).click();
  const dateien = schritt(p, 'dateien');
  await dateien.getByLabel('Scan mit Scanbody hochladen').setInputFiles(D.scanbody);
  await dateien.getByLabel('Gegenkiefer-Scan hochladen').setInputFiles(D.gegen);
  await dateien.getByLabel('Bissregistrierung hochladen').setInputFiles(D.biss);
  await hochgeladen(p);
  await dateien.getByRole('button', { name: 'Weiter', exact: true }).click();
  const plan = schritt(p, 'plan');
  await plan.getByLabel('Behandlungsplan und Hinweise').fill('Verschraubt, Emergenzprofil bitte natürlich.');
  await plan.getByRole('button', { name: 'Weiter', exact: true }).click();
  await bild(p, '80-ablauf-zusammenfassung');
  const o1 = await absenden(p);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Auftrag eingegangen.' })), 'Portal: Implantat-Brücke gesendet, »Auftrag eingegangen.«');
  const a1 = await zeile(o1);
  const nr1 = a1.order_no;
  pruefen(
    a1.work_type_key === 'implantatkrone' && a1.config.implantat?.hersteller === 'Straumann' && a1.config.implantat?.scanbodyTyp === 'CARES Mono Scanbody' && a1.status === 'eingereicht' && /^A-\d{4}-\d{4}$/.test(nr1),
    `Datenbank: ${nr1}, Implantat mit Hersteller und Scanbody`,
  );
  const [patient] = await sql`select id, code from ddl.patients where practice_id = ${A.id}`;

  // ════ 2. Portal: Teilprothese mit Flipper und Hufeisen ════
  await p.goto(`${PORTAL}/`);
  await p.getByRole('main').getByRole('link', { name: 'Neuer Auftrag' }).click();
  await p.getByRole('button', { name: 'Neuen Patienten anlegen' }).click().catch(() => null);
  await p.getByLabel('Vorname').fill(NAME2.vor);
  await p.getByLabel('Nachname').fill(NAME2.nach);
  await p.getByRole('button', { name: 'Anlegen und weiter' }).click();
  await kachel(p, 'Prothese').click();
  await kachel(p, 'Teilprothese').click();
  const bogen = schritt(p, 'b-zaehne');
  await bogen.getByRole('button', { name: /^Zahn 14:/ }).click();
  await bogen.getByRole('button', { name: /^Zahn 15:/ }).click();
  await bogen.getByRole('radio', { name: /Klammer/ }).click();
  await bogen.getByRole('button', { name: /^Zahn 13:/ }).click();
  await bogen.getByRole('button', { name: /^Zahn 16:/ }).click();
  await bogen.getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(p, 'b-prothesenform').getByRole('button', { name: /^Flipper/ }).click();
  await schritt(p, 'b-klammern').getByRole('button', { name: /^Mit Klammern/ }).click();
  await schritt(p, 'b-gaumen').getByRole('button', { name: /^Hufeisen/ }).click();
  await schritt(p, 'b-einprobe').getByRole('button', { name: 'Ja', exact: true }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'A3', exact: true }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'Weiter', exact: true }).click();
  await kachel(p, 'Fertige Arbeit').click();
  // Prothese: nur Standard, keine Tempo-Frage
  const dateien2 = schritt(p, 'dateien');
  await dateien2.getByLabel('Oberkiefer-Scan hochladen').setInputFiles(D.ok);
  await dateien2.getByLabel('Unterkiefer-Scan hochladen').setInputFiles(D.uk);
  await dateien2.getByLabel('Bissregistrierung hochladen').setInputFiles(D.biss);
  await hochgeladen(p);
  await dateien2.getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(p, 'plan').getByRole('button', { name: 'Weiter', exact: true }).click();
  const o2 = await absenden(p);
  const a2 = await zeile(o2);
  pruefen(
    a2.work_type_key === 'teilprothese' && a2.config.prothesenform === 'flipper' && a2.config.gaumen === 'hufeisen' && a2.config.einprobe === true && a2.config.zaehne?.['14']?.zahn === 'ersatzzahn' && a2.config.zaehne?.['13']?.klammer === true,
    'Teilprothese: Ersatzzähne 14, 15, Klammern 13, 16, Flipper, Hufeisen, Einprobe',
  );
  await t.goto(`${CRM}/auftraege/${o2}?tab=details`);
  const details = await t.locator('main').textContent();
  pruefen(['Flipper', 'Hufeisen', 'Mit Klammern', 'A3'].every((x) => details.includes(x)) && !details.includes(NAME2.nach), 'Labor sieht dieselben Angaben (Flipper, Hufeisen, Klammern, Farbe), ohne Patientennamen');

  // ════ 3. Labor: Eingang, Design Version 1 ════
  await t.goto(`${CRM}/auftraege/${o1}`);
  await t.getByRole('region', { name: 'Produktion' }).getByRole('button', { name: 'Eingang / Datenprüfung erledigt' }).click();
  await t.getByRole('heading', { name: 'In Planung.' }).waitFor();
  await t.getByLabel('Design-Dateien hochladen').setInputFiles(D.v1);
  await hochgeladen(t);
  await t.getByRole('button', { name: 'Zur Freigabe senden' }).click();
  await t.getByRole('heading', { name: 'Design zur Freigabe.' }).waitFor();
  pruefen((await zeile(o1)).status === 'design_freigabe', 'Labor: Design Version 1 zur Freigabe');

  // ════ 4. Portal: gesperrter Download, Änderung anfordern ════
  await p.goto(`${PORTAL}/auftraege/${o1}`);
  const [v1Datei] = await sql`select id from ddl.order_files where order_id = ${o1} and kind = 'design' and design_revision = 1`;
  pruefen((await p.request.get(`${PORTAL}/api/dateien/${v1Datei.id}`)).status() === 403, 'vor der Freigabe: Download des Designs gesperrt (403)');
  const karte = p.getByRole('region', { name: 'Design prüfen' });
  await karte.getByRole('button', { name: 'Änderung anfordern' }).click();
  const aend = p.getByRole('form', { name: 'Änderung anfordern' });
  await aend.getByRole('button', { name: 'Zahn 15' }).click();
  await aend.getByRole('button', { name: 'kürzer' }).click();
  await aend.getByLabel('Beschreibung').fill('Glied 15 basal etwas kürzer.');
  await aend.getByRole('button', { name: 'Änderung senden' }).click();
  await p.getByRole('heading', { name: 'Wir überarbeiten Ihr Design.' }).waitFor();
  pruefen((await zeile(o1)).status === 'in_ueberarbeitung', 'Änderung angefordert → »In Überarbeitung«');

  // ════ 5. Labor: Version 2; Portal: Freigeben & herunterladen ════
  await t.goto(`${CRM}/auftraege/${o1}`);
  await t.getByLabel('Design-Dateien hochladen').setInputFiles(D.v2);
  await hochgeladen(t);
  await t.getByRole('button', { name: 'Zur Freigabe senden' }).click();
  await t.getByRole('heading', { name: 'Design zur Freigabe.' }).waitFor();
  await p.goto(`${PORTAL}/auftraege/${o1}`);
  await p.getByRole('button', { name: 'Freigeben & herunterladen' }).click();
  const dialog = p.getByRole('dialog', { name: 'Design Version 2 freigeben' });
  await dialog.getByLabel('Ich habe das Design geprüft.').check();
  const [zip] = await Promise.all([p.waitForEvent('download'), dialog.getByRole('button', { name: 'Freigeben' }).click()]);
  await p.getByRole('heading', { name: 'In Produktion.' }).waitFor();
  const revs = await sql`select revision, status, decided_name from ddl.design_revisions where order_id = ${o1} order by revision`;
  pruefen(
    zip.suggestedFilename() === 'Bruecke 14-16 V2.stl' && revs.map((r) => r.status).join() === 'aenderung,freigegeben' && revs[1].decided_name === 'Dr. Qa Ablauf',
    `Freigabe: Datei von Version 2 (eine Datei, daher ohne ZIP), beide Versionen mit Entscheidung und Name (${zip.suggestedFilename()}; ${revs.map((r) => `${r.revision}:${r.status}:${r.decided_name ?? '–'}`).join(', ')})`,
  );
  const [{ n: zipLog }] = await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${nutzerA} and action = 'herunterladen' and patient_id = ${patient.id}`;
  pruefen(zipLog >= 1, 'Data-Access-Log: Download des Designs');

  // ════ 6. Laufzettel (nur Patienten-ID) ════
  const lzDatei = path.join(ordner, 'laufzettel.pdf');
  writeFileSync(lzDatei, await (await t.request.get(`${CRM}/api/auftraege/${o1}/laufzettel`)).body());
  const lz = pdfLesen(lzDatei);
  const qrZiel = `${CRM}/s/${nr1}`;
  pruefen(lz.qr.includes(qrZiel) && lz.text.includes(patient.code) && !lz.text.includes(NAME.nach), `Laufzettel: QR → ${qrZiel}, Patienten-ID, kein Name`);

  // ════ 7. Tablet: QR → Schritte bis Qualitätskontrolle ════
  const tab = await neueSeite(820);
  await tab.context().addCookies(await t.context().cookies());
  await tab.goto(lz.qr[0] ?? qrZiel);
  const erl = tab.getByRole('form', { name: 'Schritt erledigt' });
  await erl.getByLabel('SprintRay MIDAS').check();
  await erl.getByRole('checkbox', { name: /LOT QA-ABL-LOT-1/ }).check();
  await erl.getByRole('button', { name: '3D-Druck erledigt' }).click();
  for (const [knopf, st] of [
    ['Reinigung & Nachhärtung erledigt', 'in_produktion'],
    ['Ausarbeitung / Farbanpassung erledigt', 'fertig'],
    ['Qualitätskontrolle erledigt', 'versendet'],
  ]) {
    await tab.getByRole('button', { name: knopf }).click();
    pruefen(Boolean(await warten(async () => (await zeile(o1)).status === st)), `Tablet: »${knopf}« → ${st}`);
  }
  const [druck] = await sql`select s.device_key, l.lot_no from ddl.order_steps s join ddl.order_materials m on m.order_id = s.order_id join ddl.material_lots l on l.id = m.lot_id where s.order_id = ${o1} and s.step_key = 'druck'`;
  pruefen(druck?.device_key === 'sprintray_midas' && druck.lot_no === 'QA-ABL-LOT-1', 'Datenbank: Drucker und Charge beim Auftrag');
  const belege = await sql`select id, kind, doc_no from ddl.documents where order_id = ${o1} order by kind`;
  pruefen(belege.length === 2 && belege.some((b) => /^KE-/.test(b.doc_no)) && belege.some((b) => /^LS-/.test(b.doc_no)), 'Übergabe: Konformitätserklärung und Lieferschein ausgestellt');
  const keDatei = path.join(ordner, 'ke.pdf');
  writeFileSync(keDatei, await (await p.request.get(`${PORTAL}/api/dokumente/${belege.find((b) => b.kind === 'konformitaet').id}`)).body());
  const ke = pdfLesen(keDatei).text.replace(/\s+/g, ' ');
  pruefen(['Konformitätserklärung', nr1, patient.code, 'SprintRay MIDAS', 'QA-ABL-LOT-1', 'Straumann'].every((x) => ke.includes(x)) && !ke.includes(NAME.nach), 'Portal lädt die Konformitätserklärung: Gerät, Charge, Implantat, Patienten-ID, kein Name');

  // ════ 8. Tour: Tagesplan und »Zugestellt« ════
  await bu.goto(`${CRM}/touren`);
  const stopp = bu.getByRole('region', { name: 'QA · Ablauf Tour', exact: true }).locator('li[aria-label$="QA · Ablauf Ordination"]');
  pruefen((await sichtbar(stopp)) && (await stopp.textContent()).includes(nr1), 'Tagesplan: Stopp bei der Ordination mit der fertigen Arbeit');
  await f.goto(`${CRM}/meine-tour`);
  await f.getByRole('button', { name: 'Zugestellt: QA · Ablauf Ordination' }).click();
  pruefen(Boolean(await warten(async () => (await zeile(o1)).status === 'geliefert')), 'Fahrer: »Zugestellt« → Geliefert');

  // ════ 9. Reklamation → Neuanfertigung ohne Berechnung ════
  await p.goto(`${PORTAL}/auftraege/${o1}`);
  const rk = p.getByRole('region', { name: 'Reklamation' });
  await rk.getByRole('button', { name: 'Reklamation melden' }).click();
  const rkForm = p.getByRole('form', { name: 'Reklamation melden' });
  await rkForm.getByRole('radio', { name: 'Passung' }).click();
  await rkForm.getByRole('button', { name: 'Zahn 15' }).click();
  await rkForm.getByLabel('Beschreibung').fill('Glied 15 drückt auf die Schleimhaut.');
  await rkForm.getByRole('button', { name: 'Reklamation senden' }).click();
  pruefen(await sichtbar(rk.getByText(/^RK-\d{4}-\d{4}$/)), 'Portal: Reklamation gemeldet, mit Nummer');
  await bu.goto(`${CRM}/auftraege/${o1}`);
  const ent = bu.getByRole('form', { name: 'Reklamation entscheiden' });
  await ent.getByLabel('Neuanfertigung').check();
  pruefen(await ent.getByLabel('Ohne Berechnung (Gewährleistung oder Kulanz)').isChecked(), 'innerhalb der Gewährleistung: »Ohne Berechnung« vorausgewählt');
  await ent.getByRole('button', { name: 'Entscheidung senden' }).click();
  pruefen(await sichtbar(bu.getByRole('link', { name: /^Auftrag A-\d{4}-\d{4} ↗$/ })), 'Neuanfertigung angelegt');
  const [neu] = await sql`select * from ddl.orders where remake_of_id = ${o1}`;
  pruefen(neu?.status === 'eingereicht' && neu.price_snapshot?.neuanfertigung?.kostenlos === true && neu.work_type_key === 'implantatkrone', 'Datenbank: neuer Auftrag eingereicht, verknüpft, ohne Berechnung');

  // ════ 10. E-Mails an die Ordination ════
  const erwartet = [
    `Auftrag ${nr1} eingegangen`,
    `Auftrag ${a2.order_no} eingegangen`,
    `Design zur Freigabe: Auftrag ${nr1}`,
    `Auftrag ${nr1} versendet`,
  ];
  const ankunft = await warten(async () => {
    const l = await postfach(PRAXIS_MAIL);
    return erwartet.every((b) => l.some((m) => m.Subject === b)) && l.some((m) => /^Reklamation RK-\d{4}-\d{4} zu Auftrag /.test(m.Subject)) ? l : null;
  }, 30000);
  pruefen(Boolean(ankunft), `E-Mails an die Ordination: Eingang (2), Design zur Freigabe, Versendet, Reklamation entschieden${ankunft ? '' : ` (angekommen: ${(await postfach(PRAXIS_MAIL)).map((m) => m.Subject).join(' | ')})`}`);
  const designMails = (ankunft ?? []).filter((m) => m.Subject === `Design zur Freigabe: Auftrag ${nr1}`).length;
  pruefen(designMails === 2, `Design zur Freigabe: je eine E-Mail für Version 1 und 2 (${designMails})`);
  let sauber = true;
  for (const m of ankunft ?? []) {
    const x = await mailLesen(m.ID);
    if (`${x.Subject}${x.Text}${x.HTML}`.match(new RegExp(`${NAME.vor}|${NAME.nach}|${NAME2.vor}|${NAME2.nach}`))) sauber = false;
  }
  pruefen(sauber, 'keine E-Mail enthält einen Patientennamen');
  pruefen((await postfach(ANDERE_MAIL)).length === 0, 'andere Ordination: keine E-Mail');

  // ════ 11. Jede Ordination sieht nur ihres ════
  const [ls] = await sql`select id from ddl.documents where order_id = ${o1} and kind = 'lieferschein'`;
  const fremd = [
    (await pB.request.get(`${PORTAL}/auftraege/${o1}`)).status(),
    (await pB.request.get(`${PORTAL}/api/dateien/${v1Datei.id}?ansicht=1`)).status(),
    (await pB.request.get(`${PORTAL}/api/dokumente/${ls.id}`)).status(),
    (await pB.request.get(`${PORTAL}/patienten/${patient.id}`)).status(),
  ];
  pruefen(fremd.every((s) => s === 404), `Ordination B: Auftrag, Datei, Lieferschein und Patient von A nicht gefunden (${fremd.join('/')})`);
  pruefen(!konsole.length, `keine Fehler in der Browser-Konsole${konsole.length ? `: ${konsole.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('✗ Abbruch:', e);
  fehler++;
} finally {
  await browser.close();
  await aufraeumen();
  await belegZaehlerZurueck(sql, zaehlerVorher);
  const [{ n: reste }] = await sql`select count(*)::int as n from ddl.practices where name like 'QA · Ablauf%'`;
  pruefen(reste === 0, 'aufgeräumt');
  await sql.end();
}
console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fehler ? 1 : 0);
