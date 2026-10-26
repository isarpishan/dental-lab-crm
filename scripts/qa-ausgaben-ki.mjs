// آزمون «Ausgaben» قدم ۲ در Chrome (۲۴ اکتبر ۲۰۲۶): «Beleg hochladen» ← خواندن با Claude ← «Zu prüfen» ← «Übernehmen».
// Anthropic واقعی صدا زده نمی‌شود: یک API ساختگی روی پورت ۳۱۹۸ (`KI_API_URL` در `scripts/qa.mjs`) همان شکل جواب
// Messages API را می‌دهد و هر درخواست را نگه می‌دارد تا ببینیم چه چیزی بیرون رفت.
// بررسی‌ها: بدون کلید (بالا می‌رود، خوانده نمی‌شود)، «Einstellungen → KI» (کلید بد، کلید ردشده، کلید درست، رمزگذاری،
// Verbindung testen، Schlüssel löschen)، خواندن PDF و عکس، فیلدهای unsicher، Übernehmen با انتقال Beleg، Verwerfen،
// همان فایل دوباره، همان Rechnung با فایل دیگر، خطای Anthropic، مصرف، نقش Büro، موبایل.
// دادهٔ آزمایشی: «QA · …»، @example.invalid؛ بعد کامل پاک می‌شود (با فایل‌ها).
// اجرا: pnpm qa qa-ausgaben-ki  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM } from './qa-umgebung.mjs';

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
const warten = async (f, ms = 15000) => {
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    const r = await f();
    if (r) return r;
    await new Promise((x) => setTimeout(x, 200));
  }
  return null;
};
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);

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

const INHABER = 'test-ausgaben-ki@example.invalid';
const BUERO = 'test-ausgaben-ki-buero@example.invalid';
const SCHLUESSEL_FALSCH = 'sk-ant-qa-falsch-0123456789abcdefghij';
const SCHLUESSEL = 'sk-ant-qa-richtig-0123456789abcdefWXYZ';
// Mini-PDFs (verschiedene Bytes, damit jede Datei ein eigener Beleg ist) und ein kleines PNG
const pdf = (marke) => Buffer.from(`%PDF-1.4\n% ${marke}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const PDF_SPRINTRAY = pdf('qa-ki-sprintray');
const PDF_ZWEITE = pdf('qa-ki-zweite-datei');
const PDF_FEHLER = pdf('qa-ki-fehler');
const PDF_USD = pdf('qa-ki-usd');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

// ════ nachgebaute Anthropic-API ════
const heute = iso(new Date());
const gestern = iso(new Date(Date.now() - 86_400_000));
const anfragen = [];
let modus = 'normal';
const RECHNUNG = {
  istRechnung: true,
  lieferant: 'QA · SprintRay Europe GmbH',
  rechnungsnummer: 'QA-KI-2001',
  rechnungsdatum: gestern,
  waehrung: 'EUR',
  netto: 300,
  mwst: 60,
  brutto: 360,
  mwstSatz: '20',
  bereich: 'ddl',
  kategorie: 'material',
  privatKategorie: null,
  beschreibung: 'Crown HT A2, 2 Flaschen',
  unsicher: [],
  hinweis: null,
};
const KASSABON = {
  istRechnung: true,
  lieferant: 'QA · Libro',
  rechnungsnummer: null,
  rechnungsdatum: heute,
  waehrung: 'EUR',
  netto: null,
  mwst: null,
  brutto: 23.4,
  mwstSatz: '20',
  bereich: 'ddl',
  kategorie: 'buero',
  privatKategorie: null,
  beschreibung: 'Druckerpapier',
  unsicher: ['rechnungsnummer'],
  hinweis: null,
};
const DOLLAR = { ...RECHNUNG, lieferant: 'QA · Anthropic Ireland', rechnungsnummer: 'QA-USD-1', waehrung: 'USD', netto: 10, mwst: 2, brutto: 12, kategorie: 'software', beschreibung: 'API-Guthaben' };
const json = (res, status, daten, kopf = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'request-id': 'req_qa', ...kopf });
  res.end(JSON.stringify(daten));
};
const api = http.createServer(async (req, res) => {
  const teile = [];
  for await (const t of req) teile.push(t);
  // das SDK schickt den Schlüssel als »Authorization: Bearer …« (ältere Fassungen als »x-api-key«)
  const schluessel = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
  if (schluessel !== SCHLUESSEL) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    return json(res, 200, { type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' });
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const body = JSON.parse(Buffer.concat(teile).toString('utf8'));
    anfragen.push(body);
    if (modus === 'ueberlastet') return json(res, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }, { 'retry-after-ms': '10' });
    const datei = body.messages?.[0]?.content?.[0];
    const antwort = datei?.type === 'image' ? KASSABON : modus === 'usd' ? DOLLAR : RECHNUNG;
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
  const zeilen = await sql`select id, beleg_key from ddl.expenses where lieferant like 'QA · %'`;
  for (const z of zeilen) if (z.beleg_key) await rm(path.join(SPEICHER, z.beleg_key), { force: true });
  if (zeilen.length) {
    await sql`delete from ddl.audit_log where target_id in ${sql(zeilen.map((z) => z.id))}`;
    await sql.begin(async (tx) => {
      await tx`set local ddl.ausgaben_loeschen = 'qa'`;
      await tx`delete from ddl.expenses where lieferant like 'QA · %'`;
    });
  }
  await sql`delete from ddl.ki_nutzung where am >= ${start}`;
  await sql`delete from ddl.settings where key = 'ki'`;
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-ausgaben-ki-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-ausgaben-ki-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

try {
  const { s, id: inhaberId } = await anmelden(INHABER, 'Test Ausgaben KI', 'inhaber');
  const kennzahl = () => s.getByRole('navigation', { name: 'Bereiche der Ausgaben' }).getByRole('link', { name: /Zu prüfen/ });
  const hochladen = (name, mimeType, buffer) => s.getByLabel('Belege wählen (Foto oder PDF)').setInputFiles({ name, mimeType, buffer });
  const hochgeladen = s.getByRole('list', { name: 'Hochgeladene Belege' });
  const zeile = (name) => s.getByRole('list', { name: 'Belege zu prüfen' }).getByRole('button', { name: new RegExp(name.replace(/[.·]/g, '\\$&')) });
  const formular = s.getByRole('form', { name: 'Beleg übernehmen' });

  // ════ ohne Schlüssel: hochladen geht, lesen nicht ════
  await s.goto(`${CRM}/abrechnung/ausgaben`);
  pruefen(await sichtbar(s.getByRole('button', { name: 'Beleg hochladen' })), 'Knopf »Beleg hochladen«');
  const k0 = await kennzahl().innerText();
  pruefen(k0.includes('0') && k0.includes('KI aus'), 'Kennzahl »Zu prüfen«: 0, KI aus');
  await hochladen('sprintray-rechnung.pdf', 'application/pdf', PDF_SPRINTRAY);
  pruefen(await sichtbar(hochgeladen.getByText(/sprintray-rechnung\.pdf · hochgeladen\. Bitte die Angaben von Hand eintragen\./)), 'ohne Schlüssel: hochgeladen, Hinweis »von Hand«');
  await s.waitForURL(/tab=pruefen/);
  pruefen(anfragen.length === 0, 'ohne Schlüssel: nichts an Anthropic geschickt');
  const [e0] = await sql`select * from ddl.beleg_eingang where hochgeladen_von = ${inhaberId}`;
  pruefen(e0?.status === 'fehler' && /Automatisches Lesen ist aus/.test(e0.fehler) && e0.beleg_sha256 === sha(PDF_SPRINTRAY), 'Datenbank: Beleg unter »Zu prüfen«, nicht gelesen');
  pruefen(await sichtbar(zeile('sprintray-rechnung.pdf')), 'Zeile unter »Zu prüfen«');
  pruefen((await kennzahl().innerText()).includes('1'), 'Kennzahl »Zu prüfen«: 1');

  // ════ Einstellungen → KI ════
  await s.getByRole('link', { name: 'Einstellungen → KI' }).click();
  await s.waitForURL(`${CRM}/einstellungen/ki`);
  const tabs = s.getByRole('navigation', { name: 'Einstellungen' });
  pruefen((await tabs.getByRole('link', { name: 'KI', exact: true }).getAttribute('aria-current')) === 'page' && !(await tabs.getByRole('link', { name: 'Aussteller & Rechnungen' }).getAttribute('aria-current')), 'Einstellungen: nur Tab »KI« aktiv');
  const ki = s.getByRole('form', { name: 'KI-Einstellungen' });
  pruefen(await sichtbar(ki.getByText('Noch kein Schlüssel eingetragen.', { exact: false })), 'KI: noch kein Schlüssel');
  await ki.getByLabel('API-Schlüssel von Anthropic').fill('abc');
  await ki.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(ki.getByText(/sieht nicht nach einem API-Schlüssel von Anthropic aus/)), 'KI: falsches Format abgelehnt');
  pruefen((await ki.getByLabel('API-Schlüssel von Anthropic').inputValue()) === 'abc', 'KI: Eingabe bleibt nach dem Fehler stehen');
  await ki.getByLabel('API-Schlüssel von Anthropic').fill(SCHLUESSEL_FALSCH);
  await ki.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(ki.getByText(/Gespeichert, aber: Der KI-Schlüssel wird von Anthropic nicht angenommen/)), 'KI: von Anthropic abgelehnter Schlüssel gemeldet');
  await s.reload();
  await ki.getByLabel('Neuer API-Schlüssel').fill(SCHLUESSEL);
  await ki.getByLabel(/Claude Sonnet 5\.5/).check();
  await ki.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(ki.getByText('Gespeichert. Die Verbindung zu Anthropic funktioniert.')), 'KI: Schlüssel gespeichert und Verbindung geprüft');
  pruefen((await ki.getByLabel('Neuer API-Schlüssel').inputValue()) === '', 'KI: Feld nach dem Speichern leer');
  await s.reload();
  pruefen(await sichtbar(ki.getByText('(endet auf …WXYZ)')), 'KI: nur die letzten vier Zeichen sichtbar');
  pruefen(!(await s.content()).includes(SCHLUESSEL), 'KI: Schlüssel nicht in der Seite');
  const [eintrag] = await sql`select value, value_enc from ddl.settings where key = 'ki'`;
  pruefen(eintrag?.value?.modell === 'claude-sonnet-5-5' && eintrag.value_enc && !String(eintrag.value_enc).includes('sk-ant'), 'Datenbank: Modell Sonnet, Schlüssel verschlüsselt');
  const protokoll = await sql`select details from ddl.audit_log where action = 'ki_einstellungen_geaendert' and actor_id = ${inhaberId}`;
  pruefen(protokoll.length >= 2 && !JSON.stringify(protokoll).includes('sk-ant'), 'Protokoll: Änderungen ohne Schlüssel');
  await ki.getByRole('button', { name: 'Verbindung testen' }).click();
  pruefen(await sichtbar(ki.getByText('Die Verbindung zu Anthropic funktioniert.')), 'KI: »Verbindung testen«');
  await bild(s, 'ki1-einstellungen');

  // ════ Zu prüfen: erneut lesen, prüfen, übernehmen ════
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  await zeile('sprintray-rechnung.pdf').click();
  const fenster = s.getByRole('dialog', { name: 'Beleg prüfen: sprintray-rechnung.pdf' });
  pruefen(await sichtbar(fenster.locator('iframe[title="Beleg sprintray-rechnung.pdf"]')), 'Fenster: PDF neben dem Formular');
  pruefen((await formular.getByLabel('Lieferant').inputValue()) === '', 'vor dem Lesen: Formular leer');
  await fenster.getByRole('button', { name: 'Erneut lesen lassen' }).click();
  pruefen(Boolean(await warten(async () => (await formular.getByLabel('Lieferant').inputValue()) === 'QA · SprintRay Europe GmbH')), 'gelesen: Lieferant im Formular');
  pruefen(
    (await formular.getByLabel('Netto (€)').inputValue()) === '300,00' &&
      (await formular.getByLabel('MwSt (€)').inputValue()) === '60,00' &&
      (await formular.getByLabel('Brutto (€)').inputValue()) === '360,00' &&
      (await formular.getByLabel('MwSt-Satz').inputValue()) === '20',
    'gelesen: Netto 300, MwSt 60, Brutto 360, 20 %',
  );
  pruefen(
    (await formular.getByLabel(/^Rechnungsdatum/).inputValue()) === gestern &&
      (await formular.getByLabel('Rechnungsnummer').inputValue()) === 'QA-KI-2001' &&
      (await formular.getByLabel('Kategorie').inputValue()) === 'material' &&
      (await formular.getByLabel('Wofür?').inputValue()) === 'Crown HT A2, 2 Flaschen',
    'gelesen: Datum, Nummer, Kategorie, Beschreibung',
  );
  const a1 = anfragen.at(-1);
  const datei = a1?.messages?.[0]?.content?.[0];
  pruefen(a1?.model === 'claude-sonnet-5-5' && datei?.type === 'document' && datei.source?.data === PDF_SPRINTRAY.toString('base64'), 'an Anthropic: gewähltes Modell, genau dieses PDF');
  pruefen(anfragen.length === 1 && a1.messages.length === 1 && a1.messages[0].content.length === 2 && /Dentallabor/.test(a1.system), 'an Anthropic: nur Beleg und Anweisung, sonst nichts');
  pruefen(Boolean(a1?.output_config?.format), 'an Anthropic: feste Antwortform (Structured Output)');
  await bild(s, 'ki2-pruefen');
  await formular.getByRole('button', { name: 'Übernehmen' }).click();
  pruefen(await sichtbar(formular.getByText('Ausgabe erfasst: QA · SprintRay Europe GmbH, € 360,00.')), 'übernommen');
  const [aus] = await sql`select *, rechnungsdatum::text as rd from ddl.expenses where lieferant = 'QA · SprintRay Europe GmbH'`;
  pruefen(
    aus?.beleg_sha256 === sha(PDF_SPRINTRAY) && aus.beleg_name === 'sprintray-rechnung.pdf' && aus.beleg_key === e0.beleg_key && existsSync(path.join(SPEICHER, aus.beleg_key)) && sha(readFileSync(path.join(SPEICHER, aus.beleg_key))) === aus.beleg_sha256,
    'Datenbank: Ausgabe mit dem Beleg aus »Zu prüfen« (dieselbe Datei)',
  );
  pruefen(aus?.brutto_cent === 36000 && aus.rd === gestern && aus.rechnungsnummer === 'QA-KI-2001', 'Datenbank: Betrag, Datum, Nummer');
  pruefen((await sql`select count(*)::int as n from ddl.beleg_eingang where id = ${e0.id}`)[0].n === 0, 'Datenbank: Eintrag unter »Zu prüfen« weg');
  const [prot] = await sql`select details from ddl.audit_log where action = 'ausgabe_erfasst' and target_id = ${aus.id}`;
  pruefen(prot?.details?.ausZuPruefen === true, 'Protokoll: »aus Zu prüfen«');
  const [nutz] = await sql`select * from ddl.ki_nutzung where am >= ${start} order by am limit 1`;
  pruefen(nutz?.modell === 'claude-sonnet-5-5' && nutz.eingabe_tokens === 1500 && nutz.ausgabe_tokens === 200 && nutz.erfolgreich, 'Verbrauch gespeichert');
  await warten(async () => !(await fenster.isVisible()), 4000);
  pruefen(!(await fenster.isVisible()), 'Fenster schließt nach dem Übernehmen');

  // ════ Kassabon als Foto: unsichere Felder, verwerfen ════
  await hochladen('kassabon.png', 'image/png', Buffer.concat([PNG, Buffer.from('qa-ki')]));
  pruefen(await sichtbar(hochgeladen.getByText('kassabon.png · gelesen: QA · Libro, € 23,40')), 'Foto gelesen: Lieferant und Betrag in der Liste');
  pruefen(anfragen.at(-1)?.messages?.[0]?.content?.[0]?.source?.media_type === 'image/png', 'an Anthropic: Foto als Bild');
  await zeile('QA · Libro').click();
  const nr = formular.getByLabel('Rechnungsnummer');
  pruefen((await nr.getAttribute('class')).includes('border-rose!') && (await sichtbar(formular.getByText('Unsicher gelesen. Bitte prüfen.'))), 'unsicheres Feld rot umrandet mit Hinweis');
  pruefen((await formular.getByLabel('Netto (€)').inputValue()) === '19,50' && (await formular.getByLabel('MwSt (€)').inputValue()) === '3,90', 'nur Brutto gelesen: Netto 19,50 und MwSt 3,90 gerechnet');
  const [e2] = await sql`select * from ddl.beleg_eingang where beleg_name = 'kassabon.png'`;
  const dialogBon = s.getByRole('dialog', { name: 'Beleg prüfen: kassabon.png' });
  await dialogBon.getByText('Beleg verwerfen …').click();
  await dialogBon.getByRole('button', { name: 'Wirklich verwerfen: kassabon.png' }).click();
  pruefen(await sichtbar(dialogBon.getByText('kassabon.png verworfen.')), 'verworfen');
  pruefen((await sql`select count(*)::int as n from ddl.beleg_eingang where id = ${e2.id}`)[0].n === 0 && !existsSync(path.join(SPEICHER, e2.beleg_key)), 'Datenbank: Eintrag und Datei weg');
  await s.keyboard.press('Escape');

  // ════ doppelt ════
  await hochladen('nochmal.pdf', 'application/pdf', PDF_SPRINTRAY);
  pruefen(await sichtbar(hochgeladen.getByText(/nochmal\.pdf · Dieser Beleg ist schon erfasst: QA · SprintRay Europe GmbH/)), 'gleiche Datei noch einmal: abgelehnt');
  await hochladen('zweite-datei.pdf', 'application/pdf', PDF_ZWEITE);
  pruefen(await sichtbar(hochgeladen.getByText(/zweite-datei\.pdf · gelesen/)), 'andere Datei derselben Rechnung: gelesen');
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  const zweite = zeile('zweite-datei.pdf');
  pruefen((await zweite.innerText()).includes('schon erfasst?'), 'Zeile: »schon erfasst?«');
  await zweite.click();
  const dialogZweite = s.getByRole('dialog', { name: 'Beleg prüfen: zweite-datei.pdf' });
  pruefen(await sichtbar(dialogZweite.getByText(/Diese Rechnung scheint schon erfasst: QA · SprintRay Europe GmbH vom/)), 'Fenster: Warnung »schon erfasst«');
  await formular.getByRole('button', { name: 'Übernehmen' }).click();
  pruefen(await sichtbar(formular.getByText(/Diese Rechnung ist schon erfasst: QA · SprintRay Europe GmbH, Nr\. QA-KI-2001/)), 'Übernehmen derselben Rechnung abgelehnt');
  await s.keyboard.press('Escape');

  // ════ Rechnung in Dollar: Beträge bleiben leer, Original unter »Wofür?« ════
  modus = 'usd';
  await hochladen('anthropic-usd.pdf', 'application/pdf', PDF_USD);
  pruefen(await sichtbar(hochgeladen.getByText(/anthropic-usd\.pdf · gelesen: QA · Anthropic Ireland, 12,00 USD/)), 'Dollar-Rechnung gelesen (Liste zeigt USD, nicht €)');
  modus = 'normal';
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  await zeile('anthropic-usd.pdf').click();
  pruefen(
    (await formular.getByLabel('Netto (€)').inputValue()) === '' && (await formular.getByLabel('Brutto (€)').inputValue()) === '' && (await formular.getByLabel('MwSt (€)').inputValue()) === '',
    'Dollar: Beträge leer',
  );
  pruefen((await formular.getByLabel('Brutto (€)').getAttribute('class')).includes('border-rose!'), 'Dollar: Brutto rot umrandet');
  pruefen(await sichtbar(s.getByText(/Rechnung in USD \(12,00 USD\): bitte den Euro-Betrag laut Kontoauszug/)), 'Dollar: Hinweis Euro-Betrag');
  pruefen((await formular.getByLabel('Wofür?').inputValue()) === 'API-Guthaben (Original: USD 12,00)', 'Dollar: Originalbetrag unter »Wofür?«');
  await formular.getByRole('button', { name: 'Übernehmen' }).click();
  pruefen((await sql`select count(*)::int as n from ddl.expenses where lieferant = 'QA · Anthropic Ireland'`)[0].n === 0, 'Dollar: ohne Euro-Betrag nicht gespeichert');
  await formular.getByLabel('Brutto (€)').fill('11,20');
  await formular.getByRole('button', { name: 'Übernehmen' }).click();
  pruefen(await sichtbar(formular.getByText('Ausgabe erfasst: QA · Anthropic Ireland, € 11,20.')), 'Dollar: mit Euro-Betrag übernommen');
  const [usd] = await sql`select * from ddl.expenses where lieferant = 'QA · Anthropic Ireland'`;
  pruefen(usd?.brutto_cent === 1120 && usd.beschreibung === 'API-Guthaben (Original: USD 12,00)', 'Datenbank: € 11,20, Original in der Beschreibung');
  await s.keyboard.press('Escape');

  // ════ Anthropic überlastet ════
  modus = 'ueberlastet';
  await hochladen('ueberlastet.pdf', 'application/pdf', PDF_FEHLER);
  pruefen(await sichtbar(hochgeladen.getByText(/ueberlastet\.pdf · hochgeladen, nicht gelesen/)), 'Fehler von Anthropic: hochgeladen, nicht gelesen');
  modus = 'normal';
  const [e3] = await sql`select * from ddl.beleg_eingang where beleg_name = 'ueberlastet.pdf'`;
  pruefen(e3?.status === 'fehler' && /zu viele Anfragen/.test(e3.fehler), 'Datenbank: Fehlertext gespeichert');
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  pruefen((await zeile('ueberlastet.pdf').innerText()).includes('nicht gelesen'), 'Zeile: »nicht gelesen«');
  pruefen((await kennzahl().innerText()).includes('2'), 'Kennzahl »Zu prüfen«: 2');
  await bild(s, 'ki3-liste');

  // ── Verbrauch ──
  await s.goto(`${CRM}/einstellungen/ki?tab=verbrauch`);
  pruefen(await sichtbar(s.getByRole('list', { name: 'Verbrauch nach Monat' }).getByText(/4 Belege gelesen · Claude Sonnet 5\.5/)), 'Verbrauch: 4 Belege diesen Monat');

  // ── Handy ──
  await s.setViewportSize({ width: 390, height: 844 });
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  pruefen((await s.evaluate(() => document.documentElement.scrollWidth)) <= 391, 'Handy: kein horizontales Scrollen');
  await bild(s, 'ki4-handy');
  await zeile('ueberlastet.pdf').click();
  pruefen((await s.evaluate(() => document.documentElement.scrollWidth)) <= 391, 'Handy: Fenster passt');
  pruefen(await sichtbar(s.getByRole('link', { name: 'Beleg öffnen (ueberlastet.pdf) ↗' })), 'Handy: Link »Beleg öffnen«');
  await bild(s, 'ki5-handy-fenster');
  await s.keyboard.press('Escape');
  await s.setViewportSize({ width: 1440, height: 900 });

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro KI', 'buero');
  await b.goto(`${CRM}/einstellungen/ki`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: KI-Einstellungen gesperrt');
  const bHoch = await b.request.post(`${CRM}/api/ausgaben/eingang?name=x.pdf`, { data: PDF_FEHLER, headers: { Origin: CRM, 'Content-Type': 'application/pdf' } });
  const bSehen = await b.request.get(`${CRM}/api/ausgaben/eingang/${e3.id}`);
  pruefen(bHoch.status() === 401 && bSehen.status() === 401, 'Büro: kein Hochladen, kein Ansehen');
  const fremd = await s.request.post(`${CRM}/api/ausgaben/eingang?name=x.pdf`, { data: PDF_FEHLER, headers: { Origin: 'https://boese.example', 'Content-Type': 'application/pdf' } });
  pruefen(fremd.status() === 403, 'fremde Herkunft abgelehnt');

  // ── Schlüssel löschen ──
  await s.goto(`${CRM}/einstellungen/ki`);
  s.once('dialog', (d) => d.accept());
  await s.getByRole('form', { name: 'KI-Einstellungen' }).getByRole('button', { name: 'Schlüssel löschen' }).click();
  pruefen(await sichtbar(s.getByText('Schlüssel gelöscht. Belege werden nicht mehr automatisch gelesen.')), 'Schlüssel gelöscht');
  const [nachher] = await sql`select value_enc from ddl.settings where key = 'ki'`;
  pruefen(nachher && nachher.value_enc === null, 'Datenbank: kein Schlüssel mehr');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
  api.close();
}
process.exit(fehler ? 1 : 0);
