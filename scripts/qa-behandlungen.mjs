// «Neue Behandlung» و عکس هر Behandlung در «Preise» (خواستهٔ کاربر، ۶ اکتبر ۲۰۲۶)، در Chrome:
// عکس «Modell»، ساختن Behandlung تازه با عکس و «Auftragsformular wie Modell»، نام تکراری، روشن‌کردن با قیمت،
// کاشی در فرم سفارش، «Bild ändern» (فایل قبلی پاک می‌شود)، فایل غیرعکس، دسترسی به عکس (بدون نشست، پورتال،
// uuid ناشناخته) و ظاهر در ۵ اندازه. با QA_BILDER=<پوشه> عکس صفحه‌ها هم ذخیره می‌شود.
// اجرا: pnpm qa qa-behandlungen
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/test-files');
const BILDER = process.env.QA_BILDER ?? null;
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};
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
const speicherPfad = (imageKey) => {
  const id = imageKey.replace(/^datei:/, '');
  return path.join(SPEICHER, id.slice(0, 2), id);
};

const STAFF = 'test-behandlungen@example.invalid';
const PRAXIS_MAIL = 'qa-behandlungen-praxis@example.invalid';
const NAME = 'QA · Kiefermodell';
async function aufraeumen() {
  for (const w of await sql`select key, image_key from ddl.work_types where name like 'QA · %'`) {
    if (w.image_key?.startsWith('datei:')) await rm(speicherPfad(w.image_key), { force: true });
    await sql`delete from ddl.work_types where key = ${w.key}`;
  }
  const praxen = (await sql`select id from ddl.practices where name = 'QA · Behandlungen Ordination'`).map((r) => r.id);
  const staff = (await sql`select id from ddl.staff_users where email = ${STAFF}`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const akteure = [...staff, ...nutzer];
  if (akteure.length) {
    await sql`delete from ddl.data_access_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
  }
  await vereinbarungenLoeschen(sql, praxen);
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
}

await aufraeumen();
const ordner = mkdtempSync(path.join(tmpdir(), 'ddl-qa-behandlungen-'));
const keinBild = path.join(ordner, 'kein-bild.png');
writeFileSync(keinBild, 'Das ist kein Bild.');
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
const geladen = (loc) => loc.evaluate((img) => (img.complete ? img.naturalWidth : new Promise((ok) => img.addEventListener('load', () => ok(img.naturalWidth), { once: true }))));

try {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${STAFF}, 'Test Behandlungen', 'inhaber') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(`${s.url()}: ${String(e)}`));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebGL|GPU stall/.test(m.text()) && konsole.push(`${s.url()}: ${m.text()}`));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-behandl-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-behandl-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${CRM}/`);

  // ── Modell hat jetzt ein Bild ──
  await s.goto(`${CRM}/preise`);
  const zeileModell = s.locator('li', { has: s.locator('#zeit_modell') });
  const modellBild = zeileModell.locator('img[src="/bilder/auswahl/modell.webp"]');
  pruefen((await modellBild.count()) === 1 && (await geladen(modellBild)) === 480, 'Preise: »Modell« zeigt das neue Bild (480 × 360)');
  pruefen(await zeileModell.getByRole('button', { name: 'Bild ändern: Modell' }).isVisible(), 'Preise: »Bild ändern« bei jeder Behandlung');
  const [modellDb] = await sql`select image_key from ddl.work_types where key = 'modell'`;
  pruefen(modellDb.image_key === 'modell.webp', 'Datenbank: Modell hat image_key »modell.webp«');

  // ── Neue Behandlung anlegen ──
  const neu = s.getByRole('form', { name: 'Neue Behandlung' });
  pruefen(await neu.isVisible(), 'Preise: Abschnitt »Neue Behandlung« unter der Preistabelle');
  await neu.getByRole('button', { name: 'Behandlung anlegen' }).click();
  pruefen((await neu.locator('input[name="name"]:invalid').count()) === 1, 'ohne Namen: Formular hält an');
  await neu.getByLabel('Name').fill(NAME);
  await neu.locator('input[name="bild"]').setInputFiles('public/bilder/auswahl/schiene.webp');
  const vorschau = neu.locator('img[src^="blob:"]');
  await vorschau.waitFor();
  pruefen((await geladen(vorschau)) === 480, 'Bild gewählt: Vorschau, im Browser auf 480 × 360 gebracht');
  await neu.getByLabel('Auftragsformular und Ablauf wie').selectOption({ label: 'Modell' });
  const uebersicht = await neu.getByText('Fragen im Auftragsformular:').locator('..').textContent();
  pruefen(uebersicht.includes('Kiefer · Hinweise'), `Vorlage »Modell«: Übersicht der Fragen (${uebersicht.trim()})`);
  pruefen((await neu.getByText('Nötige Scans:').locator('..').textContent()).includes('Oberkiefer-Scan, Unterkiefer-Scan, Bissregistrierung'), 'Vorlage »Modell«: nötige Scans');
  pruefen((await neu.getByLabel('Preis gilt pro').inputValue()) === 'Kiefer', 'Einheit von der Vorlage übernommen (Kiefer)');
  await neu.getByLabel('Nur Design').uncheck();
  await bild(s, 'behandlung-neu-formular');
  await neu.getByRole('button', { name: 'Behandlung anlegen' }).click();
  await neu.getByText(/ist angelegt und steht unter »Ausgeschaltet«/).waitFor();
  pruefen((await neu.getByLabel('Name').inputValue()) === '' && (await neu.locator('img[src^="blob:"]').count()) === 0, 'nach dem Anlegen: Formular leer, ohne Bildvorschau');

  const [w] = await sql`select * from ddl.work_types where name = ${NAME}`;
  const [modell] = await sql`select * from ddl.work_types where key = 'modell'`;
  const [{ hoechste }] = await sql`select max(position) as hoechste from ddl.work_types`;
  pruefen(w?.key === 'qa_kiefermodell' && w.is_active === false, `Datenbank: angelegt als »${w?.key}«, ausgeschaltet`);
  pruefen(
    JSON.stringify(w.form_schema) === JSON.stringify(modell.form_schema) && w.required_files.join() === modell.required_files.join() && w.step_keys.join() === modell.step_keys.join(),
    'Auftragsformular, nötige Scans und Produktionsschritte wie »Modell«',
  );
  pruefen(JSON.stringify(w.delivery_options) === JSON.stringify({ fertigung: { einheit: 'Kiefer', preisAb: null } }), 'nur »Fertige Arbeit«, pro Kiefer, Preis noch offen');
  pruefen(w.position === hoechste && w.same_day_available === false && w.group_key === null, 'ganz hinten eingereiht, ohne Same-Day, eigene Kachel');
  pruefen(/^datei:[0-9a-f-]{36}$/.test(w.image_key) && existsSync(speicherPfad(w.image_key)), 'Bild im Dateispeicher, nicht im Programmordner');
  const [audit] = await sql`select details from ddl.audit_log where action = 'behandlung_angelegt' and actor_id = ${u.id}`;
  pruefen(audit?.details.vorlage === 'Modell' && audit.details.bild === true, 'Audit-Log: »Behandlung angelegt« mit Vorlage');

  const aus = s.getByRole('list', { name: 'Ausgeschaltete Behandlungen' });
  const zeile = aus.locator('li', { has: s.locator(`#zeit_${w.key}`) });
  const zeilenBild = zeile.locator(`img[src="/api/behandlungsbilder/${w.image_key.slice(6)}"]`);
  pruefen((await zeilenBild.count()) === 1 && (await geladen(zeilenBild)) === 480, 'neue Behandlung unter »Ausgeschaltet«, mit Bild');
  pruefen((await zeile.getByText('Nur Design: nicht angeboten').count()) === 1, 'Zeile: »Nur Design: nicht angeboten«');

  // gleicher Name noch einmal
  await neu.getByLabel('Name').fill(NAME.toUpperCase());
  await neu.getByLabel('Auftragsformular und Ablauf wie').selectOption({ label: 'Krone' });
  await neu.getByRole('button', { name: 'Behandlung anlegen' }).click();
  await neu.getByText(/gibt es schon/).waitFor();
  pruefen((await sql`select count(*)::int as n from ddl.work_types where name ilike ${NAME}`)[0].n === 1, 'gleicher Name (andere Schreibweise): abgelehnt');
  await neu.getByLabel('Name').fill('');

  // ── Bild ändern: kein Bild, dann ein anderes Bild ──
  await zeile.locator('input[type="file"]').setInputFiles(keinBild);
  await zeile.getByRole('alert').waitFor();
  pruefen((await zeile.getByRole('alert').textContent()).includes('JPG, PNG oder WebP'), 'Bild ändern: Datei, die kein Bild ist, abgelehnt');
  const altesBild = w.image_key;
  await zeile.locator('input[type="file"]').setInputFiles('public/bilder/auswahl/modell.webp');
  await s.waitForFunction(
    ([sel, alt]) => {
      const img = document.querySelector(sel);
      return img && !img.getAttribute('src').endsWith(alt);
    },
    [`li:has(#zeit_${w.key}) img`, altesBild.slice(6)],
  );
  const [w2] = await sql`select image_key from ddl.work_types where key = ${w.key}`;
  pruefen(w2.image_key !== altesBild && existsSync(speicherPfad(w2.image_key)) && !existsSync(speicherPfad(altesBild)), 'Bild ändern: neues Bild gespeichert, altes gelöscht');
  pruefen((await sql`select count(*)::int as n from ddl.audit_log where action = 'behandlung_bild_geaendert' and actor_id = ${u.id}`)[0].n === 1, 'Audit-Log: »Bild einer Behandlung geändert«');

  // ── Zugriff auf das Bild ──
  const bildUrl = `/api/behandlungsbilder/${w2.image_key.slice(6)}`;
  const mit = await s.request.get(`${CRM}${bildUrl}`);
  pruefen(mit.status() === 200 && mit.headers()['content-type'] === 'image/webp', 'Bild mit Anmeldung: 200, image/webp');
  const fremd = await browser.newContext();
  pruefen((await fremd.request.get(`${CRM}${bildUrl}`)).status() === 401, 'Bild ohne Anmeldung: 401');
  await fremd.close();
  pruefen((await s.request.get(`${CRM}/api/behandlungsbilder/${altesBild.slice(6)}`)).status() === 404, 'altes Bild: 404');
  pruefen((await s.request.get(`${CRM}/api/behandlungsbilder/${randomUUID()}`)).status() === 404, 'unbekanntes Bild: 404');
  pruefen((await s.request.get(`${CRM}/api/behandlungsbilder/..%2F..%2Fetc%2Fpasswd`)).status() === 404, 'Pfad statt ID: 404');

  // ── Einschalten mit Preis ──
  await zeile.getByRole('checkbox', { name: NAME }).check();
  await zeile.locator(`#fertigung_${w.key}`).fill('45');
  await s.getByRole('button', { name: 'Speichern', exact: true }).click();
  await s.getByText(`Gespeichert: ${NAME}.`).waitFor();
  await s.reload();
  pruefen(
    (await s.getByRole('list', { name: 'Behandlungen im Auftragsformular' }).locator(`#zeit_${w.key}`).count()) === 1,
    'eingeschaltet: steht jetzt bei den Behandlungen im Auftragsformular',
  );

  // ── Auftragsformular: eigene Kachel mit Bild und Preis ──
  await s.goto(`${CRM}/vorschau`, { waitUntil: 'networkidle' });
  const kachel = s.getByRole('group', { name: 'Behandlung' }).getByRole('button', { name: new RegExp(`^${NAME}`) });
  pruefen((await kachel.count()) === 1, 'Auftragsformular: Kachel für die neue Behandlung');
  pruefen(/€\s45\b/.test(await kachel.textContent()), 'Kachel: Preis »ab € 45«');
  pruefen((await geladen(kachel.locator('img'))) === 480, 'Kachel: Bild geladen');
  await kachel.click();
  await s.getByRole('heading', { name: 'Welcher Kiefer?' }).waitFor();
  pruefen(await s.getByRole('button', { name: 'Ober- und Unterkiefer' }).isVisible(), 'Kachel gewählt: nächste Frage »Welcher Kiefer?« wie bei »Modell«');
  await bild(s, 'behandlung-neu-kachel');
  const modellKachel = s.getByRole('group', { name: 'Behandlung' }).getByRole('button', { name: /^Modell/ });
  pruefen((await modellKachel.count()) === 0, '»Modell« bleibt ausgeschaltet (keine Kachel)');

  // ── Portal: Bild mit Portal-Anmeldung ──
  const [praxis] = await sql`insert into ddl.practices (customer_no, name) values ('QA-BH', 'QA · Behandlungen Ordination') returning id`;
  const [pu] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxis.id}, ${PRAXIS_MAIL}, 'QA Praxis Behandlungen', 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, praxis.id, pu.id);
  const ptoken = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(ptoken)}, 'einladung', 'practice', ${pu.id}, now() + interval '1 hour')`;
  const pctx = await browser.newContext();
  const p = await pctx.newPage();
  await p.goto(`${PORTAL}/einladung/${ptoken}`);
  await p.getByLabel('Neues Passwort').fill('test-passwort-behandl-2');
  await p.getByLabel('Passwort wiederholen').fill('test-passwort-behandl-2');
  await p.getByRole('button', { name: 'Zugang einrichten' }).click();
  await p.waitForURL(`${PORTAL}/`);
  pruefen((await p.request.get(`${PORTAL}${bildUrl}`)).status() === 200, 'Portal: Bild mit Anmeldung der Ordination: 200');
  await pctx.close();

  // ── Darstellung ──
  const zuBreit = [];
  for (const [breite, hoehe] of [[1600, 900], [1280, 800], [1024, 768], [390, 844], [320, 640]]) {
    await s.setViewportSize({ width: breite, height: hoehe });
    await s.goto(`${CRM}/preise`, { waitUntil: 'networkidle' });
    const breit = await s.evaluate(() => document.documentElement.scrollWidth);
    if (breit > breite + 1) zuBreit.push(`${breite}px: ${breit}px`);
    if ([1600, 390].includes(breite)) {
      await bild(s, `behandlungen-preise-${breite}`);
      await s.getByRole('heading', { name: 'Neue Behandlung' }).scrollIntoViewIfNeeded();
      if (BILDER) await s.screenshot({ path: path.join(BILDER, `behandlungen-uebergang-${breite}.png`) });
      if (BILDER) await s.getByRole('region', { name: 'Neue Behandlung' }).screenshot({ path: path.join(BILDER, `behandlungen-neu-${breite}.png`) });
    }
  }
  pruefen(!zuBreit.length, `Preise mit »Neue Behandlung«: kein horizontales Scrollen (1600/1280/1024/390/320)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);
  pruefen(!konsole.length, `keine Fehler in der Browser-Konsole${konsole.length ? ' → ' + konsole.slice(0, 3).join(' | ') : ''}`);
} catch (e) {
  console.error(e);
  fehler++;
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
  await rm(ordner, { recursive: true, force: true });
}

console.log(fehler ? `\n✗ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✓ Alles in Ordnung');
process.exit(fehler ? 1 : 0);
