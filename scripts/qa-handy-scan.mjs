// آزمون «Handy-Scanner» (۲۴ اکتبر ۲۰۲۶): Kurzbefehl آیفون Beleg را با کلید دستگاه به `api/ausgaben/scan` می‌فرستد.
// بررسی‌ها: «Einstellungen → Handy-Scanner» (تب، ساختن Zugang، کلید فقط یک بار و فقط hash در دیتابیس)، فرستادن PDF با
// کلید (بدون کلید KI ← «nicht gelesen»؛ با API ساختگی Anthropic ← «Gelesen: …»)، همان فایل دوباره، فایل نادرست، کلید
// غلط، کوکی بدون کلید، host پورتال، Sperren، نقش Büro، موبایل.
// Anthropic واقعی صدا زده نمی‌شود (API ساختگی روی `KI_API_URL`، مثل qa-ausgaben-ki).
// دادهٔ آزمایشی: «QA · …»، @example.invalid؛ بعد کامل پاک می‌شود (با فایل‌ها).
// اجرا: pnpm qa qa-handy-scan
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
const BILDER = process.env.QA_BILDER ?? null;
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};
const sichtbar = async (loc, timeout = 15000) => {
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

const INHABER = 'test-handy-scan@example.invalid';
const BUERO = 'test-handy-scan-buero@example.invalid';
const KI_SCHLUESSEL = 'sk-ant-qa-handy-0123456789abcdefWXYZ';
const pdf = (marke) => Buffer.from(`%PDF-1.4\n% ${marke}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const PDF_EINS = pdf('qa-handy-eins');
const PDF_ZWEI = pdf('qa-handy-zwei');
const PDF_DREI = pdf('qa-handy-drei');

// ════ nachgebaute Anthropic-API ════
let kiAnfragen = 0;
const json = (res, status, daten) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'request-id': 'req_qa' });
  res.end(JSON.stringify(daten));
};
const api = http.createServer(async (req, res) => {
  const teile = [];
  for await (const t of req) teile.push(t);
  const schluessel = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
  if (schluessel !== KI_SCHLUESSEL) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    return json(res, 200, { type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' });
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const body = JSON.parse(Buffer.concat(teile).toString('utf8'));
    kiAnfragen++;
    const antwort = {
      istRechnung: true,
      lieferant: 'QA · Henry Schein',
      rechnungsnummer: 'QA-HANDY-1',
      rechnungsdatum: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(new Date()),
      waehrung: 'EUR',
      netto: 70.17,
      mwst: 14.03,
      brutto: 84.2,
      mwstSatz: '20',
      bereich: 'ddl',
      kategorie: 'material',
      privatKategorie: null,
      beschreibung: 'Handschuhe',
      unsicher: [],
      hinweis: null,
    };
    return json(res, 200, {
      id: 'msg_qa',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: JSON.stringify(antwort) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1500, output_tokens: 200 },
    });
  }
  json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
});
const KI_URL = new URL(process.env.KI_API_URL ?? 'http://127.0.0.1:3198');
await new Promise((ok) => api.listen(Number(KI_URL.port), '127.0.0.1', ok));
const start = new Date();

async function aufraeumen() {
  const staff = (await sql`select id from ddl.staff_users where email in ${sql([INHABER, BUERO])}`).map((r) => r.id);
  const eingang = staff.length ? await sql`select id, beleg_key from ddl.beleg_eingang where hochgeladen_von in ${sql(staff)}` : [];
  for (const e of eingang) await rm(path.join(SPEICHER, e.beleg_key), { force: true });
  if (eingang.length) await sql`delete from ddl.beleg_eingang where id in ${sql(eingang.map((e) => e.id))}`;
  await sql`delete from ddl.ki_nutzung where am >= ${start}`;
  await sql`delete from ddl.settings where key = 'ki'`;
  await sql`delete from ddl.rate_limits where key like 'scan:%'`;
  if (staff.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(staff)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(staff)}`;
    // scan_zugaenge gehen mit dem Benutzer (on delete cascade)
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-handy-scan-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-handy-scan-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

// so wie der Kurzbefehl: nur der Schlüssel, kein Cookie, keine Herkunft
const scan = (basis, daten, kopf = {}) =>
  fetch(`${basis}/api/ausgaben/scan`, { method: 'POST', body: daten, headers: { 'Content-Type': 'application/pdf', ...kopf } }).then(async (r) => ({ status: r.status, text: await r.text(), typ: r.headers.get('content-type') }));

try {
  const { s, id: inhaberId } = await anmelden(INHABER, 'Test Handy-Scan', 'inhaber');

  // ════ Einstellungen → Handy-Scanner ════
  await s.goto(`${CRM}/einstellungen/handy-scanner`);
  const tabs = s.getByRole('navigation', { name: 'Einstellungen' });
  pruefen((await tabs.getByRole('link', { name: 'Handy-Scanner' }).getAttribute('aria-current')) === 'page', 'Tab »Handy-Scanner« aktiv');
  pruefen(await sichtbar(s.getByText('Noch kein Zugang angelegt.')), 'noch kein Zugang');
  await s.getByText('Für Fachleute: Adresse und Aufbau …').click();
  pruefen(await sichtbar(s.getByText(`${CRM}/api/ausgaben/scan`, { exact: true })), 'Anleitung: Adresse des CRM');

  // ── fertiger Kurzbefehl zum Laden ──
  const [dl] = await Promise.all([s.waitForEvent('download'), s.getByRole('link', { name: 'Kurzbefehl »Beleg scannen« laden' }).click()]);
  const kurz = readFileSync(await dl.path());
  pruefen(
    dl.suggestedFilename().endsWith('.shortcut') && kurz.subarray(0, 4).toString() === 'AEA1' && kurz.equals(readFileSync('src/lib/ausgaben/kurzbefehle/Beleg-scannen.shortcut')),
    '»Kurzbefehl laden«: signierte Datei',
  );
  pruefen((await fetch(`${CRM}/api/ausgaben/scan/kurzbefehl`)).status === 401, 'Kurzbefehl laden ohne Anmeldung: 401');
  const neu = s.getByRole('form', { name: 'Neuer Zugang' });
  await neu.getByRole('button', { name: 'Zugang anlegen' }).click();
  pruefen((await sql`select count(*)::int as n from ddl.scan_zugaenge where staff_user_id = ${inhaberId}`)[0].n === 0, 'ohne Namen nichts angelegt');
  await neu.getByLabel('Name des Geräts').fill('QA · iPhone');
  await neu.getByRole('button', { name: 'Zugang anlegen' }).click();
  const schluesselText = s.getByText(/^Bearer ddls_/);
  pruefen(await sichtbar(schluesselText), 'Schlüssel einmal angezeigt');
  const kopfWert = (await schluesselText.innerText()).trim();
  const schluessel = kopfWert.replace(/^Bearer /, '');
  await s.getByRole('button', { name: 'Schlüssel kopieren' }).click();
  pruefen((await s.evaluate(() => navigator.clipboard.readText())) === kopfWert, '»Schlüssel kopieren«: »Bearer …« in der Zwischenablage');
  const [zeile] = await sql`select * from ddl.scan_zugaenge where staff_user_id = ${inhaberId}`;
  pruefen(zeile?.name === 'QA · iPhone' && zeile.token_hash === sha(schluessel) && !JSON.stringify(zeile).includes(schluessel), 'Datenbank: nur sha256 des Schlüssels');
  const protokoll = await sql`select details from ddl.audit_log where action = 'scan_zugang_angelegt' and actor_id = ${inhaberId}`;
  pruefen(protokoll.length === 1 && !JSON.stringify(protokoll).includes(schluessel), 'Protokoll: angelegt, ohne Schlüssel');
  await bild(s, 'scan1-angelegt');
  await s.reload();
  pruefen(!(await s.content()).includes(schluessel), 'nach Neuladen: Schlüssel nicht mehr in der Seite');
  const liste = s.getByRole('list', { name: 'Zugänge' });
  pruefen(await sichtbar(liste.getByText(/noch nicht benutzt/)), 'Liste: »noch nicht benutzt«');

  // ════ Hochladen wie der Kurzbefehl ════
  const r1 = await scan(CRM, PDF_EINS, { Authorization: kopfWert });
  pruefen(r1.status === 201 && r1.typ?.startsWith('text/plain'), `ohne KI-Schlüssel: 201, Text (${r1.status})`);
  pruefen(r1.text === 'Hochgeladen, aber nicht gelesen. Bitte unter »Zu prüfen« von Hand eintragen.', `Antwort: »${r1.text}«`);
  const [e1] = await sql`select * from ddl.beleg_eingang where beleg_sha256 = ${sha(PDF_EINS)}`;
  pruefen(e1?.hochgeladen_von === inhaberId && e1.beleg_name === 'Beleg.pdf', 'Datenbank: unter »Zu prüfen«, im Namen des Inhabers');
  const [a1] = await sql`select details from ddl.audit_log where action = 'beleg_eingang' and target_id = ${e1?.id}`;
  pruefen(a1?.details?.quelle === 'handy' && a1.details.zugang === 'QA · iPhone', 'Protokoll: Quelle Handy, Zugang');
  const [z1] = await sql`select last_used_at from ddl.scan_zugaenge where id = ${zeile.id}`;
  pruefen(Boolean(z1.last_used_at), '»zuletzt benutzt« gesetzt');

  const doppelt = await scan(CRM, PDF_EINS, { Authorization: kopfWert });
  pruefen(doppelt.status === 400 && doppelt.text === 'Dieser Beleg liegt schon unter »Zu prüfen«.', `gleiche Datei: ${doppelt.text}`);
  const falschTyp = await scan(CRM, Buffer.from('kein beleg'), { Authorization: kopfWert, 'Content-Type': 'text/plain' });
  pruefen(falschTyp.status === 400 && /Foto .* oder ein PDF/.test(falschTyp.text), 'keine Datei eines Belegs: abgelehnt');
  const leer = await scan(CRM, Buffer.alloc(0), { Authorization: kopfWert });
  pruefen(leer.status === 400, 'leerer Inhalt: abgelehnt');

  // ── mit Schlüssel bei Anthropic: gelesen ──
  await s.goto(`${CRM}/einstellungen/ki`);
  const ki = s.getByRole('form', { name: 'KI-Einstellungen' });
  await ki.getByLabel('API-Schlüssel von Anthropic').fill(KI_SCHLUESSEL);
  await ki.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(ki.getByText('Gespeichert. Die Verbindung zu Anthropic funktioniert.')), 'KI-Schlüssel gespeichert');
  // so wie am iPhone eingefügt: ohne »Bearer«, mit Zeilenumbruch
  const r2 = await scan(CRM, PDF_ZWEI, { Authorization: ` ${schluessel}\n`.trim() + ' ' });
  pruefen(r2.status === 201 && /^Gelesen: QA · Henry Schein, €\s84,20\. Liegt unter »Zu prüfen«\.$/.test(r2.text), `mit KI: »${r2.text}«`);
  pruefen(kiAnfragen === 1, 'ein Beleg an die (nachgebaute) KI');
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  pruefen(await sichtbar(s.getByRole('list', { name: 'Belege zu prüfen' }).getByText(/QA · Henry Schein/)), 'unter »Zu prüfen« sichtbar');
  await bild(s, 'scan2-zu-pruefen');

  // ════ abgelehnt ════
  const ohne = await scan(CRM, PDF_DREI);
  const falsch = await scan(CRM, PDF_DREI, { Authorization: 'Bearer ddls_falsch0123456789' });
  const ohnePraefix = await scan(CRM, PDF_DREI, { Authorization: `Bearer ${schluessel.slice(5)}` });
  pruefen(ohne.status === 401 && falsch.status === 401 && ohnePraefix.status === 401, 'ohne / falscher Schlüssel: 401');
  pruefen(/Handy-Scanner ist nicht \(mehr\) freigeschaltet/.test(falsch.text), 'Antwort erklärt, was zu tun ist');
  const cookie = await s.request.post(`${CRM}/api/ausgaben/scan`, { data: PDF_DREI, headers: { Origin: CRM, 'Content-Type': 'application/pdf' } });
  pruefen(cookie.status() === 401, 'Cookie der Sitzung allein reicht nicht');
  const portal = await scan(PORTAL, PDF_DREI, { Authorization: kopfWert });
  pruefen(portal.status === 404, `auf der Adresse des Portals: 404 (${portal.status})`);
  pruefen((await sql`select count(*)::int as n from ddl.beleg_eingang where beleg_sha256 = ${sha(PDF_DREI)}`)[0].n === 0, 'Datenbank: nichts davon gespeichert');

  // ════ Büro: kein Zugang zur Seite; Schlüssel eines Büro-Kontos gilt nicht ════
  const { s: b, id: bueroId } = await anmelden(BUERO, 'Test Büro Scan', 'buero');
  await b.goto(`${CRM}/einstellungen/handy-scanner`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Seite gesperrt');
  pruefen(!(await b.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link', { name: 'Handy-Scanner' }).count()), 'Büro: kein Tab »Handy-Scanner«');
  const bueroSchluessel = `ddls_${randomBytes(32).toString('base64url')}`;
  await sql`insert into ddl.scan_zugaenge (name, token_hash, staff_user_id) values ('QA · Büro', ${sha(bueroSchluessel)}, ${bueroId})`;
  pruefen((await scan(CRM, PDF_DREI, { Authorization: `Bearer ${bueroSchluessel}` })).status === 401, 'Schlüssel eines Kontos ohne Recht: 401');
  pruefen((await b.request.get(`${CRM}/api/ausgaben/scan/kurzbefehl`)).status() === 401, 'Büro: Kurzbefehl laden 401');

  // ════ Sperren ════
  await s.goto(`${CRM}/einstellungen/handy-scanner`);
  pruefen(await sichtbar(liste.getByRole('listitem').filter({ hasText: 'QA · iPhone' }).getByText(/zuletzt benutzt/)), 'Liste: »zuletzt benutzt«');
  s.once('dialog', (d) => d.accept());
  await liste.getByRole('listitem').filter({ hasText: 'QA · iPhone' }).getByRole('button', { name: 'Sperren' }).click();
  pruefen(await sichtbar(s.getByText('Zugang »QA · iPhone« gesperrt. Dieser Kurzbefehl kann nichts mehr hochladen.')), 'gesperrt');
  pruefen(await sichtbar(liste.getByRole('listitem').filter({ hasText: 'QA · iPhone' }).getByText(/gesperrt \d/)), 'Liste: gesperrt mit Zeit');
  const nachSperre = await scan(CRM, PDF_DREI, { Authorization: kopfWert });
  pruefen(nachSperre.status === 401, 'nach dem Sperren: 401');
  pruefen((await sql`select count(*)::int as n from ddl.audit_log where action = 'scan_zugang_gesperrt' and actor_id = ${inhaberId}`)[0].n === 1, 'Protokoll: gesperrt');

  // ── gesperrten Zugang entfernen ──
  const iphone = liste.getByRole('listitem').filter({ hasText: 'QA · iPhone' });
  pruefen(!(await iphone.getByRole('button', { name: 'Sperren' }).count()), 'gesperrt: kein »Sperren« mehr');
  s.once('dialog', (d) => d.accept());
  await iphone.getByRole('button', { name: 'Entfernen' }).click();
  pruefen(await sichtbar(s.getByText('Zugang »QA · iPhone« entfernt.')), 'gesperrten Zugang entfernt');
  // die Liste wird kurz nach der Meldung neu geladen: bis zu 5 Sekunden warten
  let nochDa = true;
  for (let i = 0; i < 25 && nochDa; i++) {
    nochDa = (await liste.getByText('QA · iPhone').count()) > 0;
    if (nochDa) await s.waitForTimeout(200);
  }
  pruefen(!nochDa, 'Liste: nicht mehr da');
  pruefen((await sql`select count(*)::int as n from ddl.scan_zugaenge where id = ${zeile.id}`)[0].n === 0, 'Datenbank: Zeile gelöscht');
  pruefen((await sql`select count(*)::int as n from ddl.audit_log where action = 'scan_zugang_entfernt' and actor_id = ${inhaberId}`)[0].n === 1, 'Protokoll: entfernt');
  pruefen(!(await liste.getByRole('listitem').filter({ hasText: 'QA · Büro' }).getByRole('button', { name: 'Entfernen' }).count()), 'aktiver Zugang: kein »Entfernen«');

  // ── Handy ──
  await s.setViewportSize({ width: 390, height: 844 });
  await s.goto(`${CRM}/einstellungen/handy-scanner`);
  pruefen((await s.evaluate(() => document.documentElement.scrollWidth)) <= 391, 'Handy: kein horizontales Scrollen');
  await bild(s, 'scan3-handy');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
  api.close();
}
process.exit(fehler ? 1 : 0);
