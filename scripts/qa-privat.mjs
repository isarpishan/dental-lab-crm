// آزمون «Privat» در Chrome (Spec فاز ۵، قدم ۲): منو فقط برای Inhaber، Übersicht خالی و پر («Gespart»، «Sparquote»،
// بدون «fakturiert»)، Buchung دستی (Einnahme و Ausgabe با Beleg)، ورودی نادرست، تغییر، حذف نرم، جدایی کامل از دفتر DDL،
// «Zu prüfen» با KI ساختگی: Beleg از Privat ← Privat، Beleg از Ausgaben که KI «privat» می‌داند ← Privat، PDF لابراتوار
// با کلید «Privat» به Privat، Beleg تکراری، Büro بدون دسترسی (صفحه و API)، موبایل ۳۹۰ و ۳۲۰.
// دادهٔ آزمایشی: «QA · …»، @example.invalid؛ بعد کامل پاک می‌شود (با فایل‌ها). API ساختگی Anthropic، هیچ هزینه‌ای.
// اجرا: pnpm qa qa-privat  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import { rm } from 'node:fs/promises';
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

const INHABER = 'test-privat@example.invalid';
const BUERO = 'test-privat-buero@example.invalid';
const SCHLUESSEL = 'sk-ant-qa-privat-0123456789abcdefPRIV';
// 1×1-PNG; mit Anhang hinter IEND, damit jede Datei einen eigenen sha256 hat
const PNG0 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const png = (marke) => Buffer.concat([PNG0, Buffer.from(marke)]);
const PNG_HAND = png('qa-privat-hand');
const PNG_BILLA = png('qa-privat-billa');
const PNG_SPAR = png('qa-privat-spar');
const PDF_LABOR = Buffer.from('%PDF-1.4\n% qa-privat-labor\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

// ════ nachgebaute Anthropic-API: Fotos = privater Kassabon, PDF = Rechnung des Labors ════
const heute = iso(new Date());
const BILLA = {
  istRechnung: true,
  lieferant: 'QA · BILLA Filiale',
  rechnungsnummer: null,
  rechnungsdatum: heute,
  waehrung: 'EUR',
  netto: null,
  mwst: null,
  brutto: 23.4,
  mwstSatz: '10',
  bereich: 'privat',
  kategorie: null,
  privatKategorie: 'lebensmittel',
  beschreibung: 'Einkauf',
  unsicher: [],
  hinweis: null,
};
const LABOR = {
  istRechnung: true,
  lieferant: 'QA · Privat Formlabs GmbH',
  rechnungsnummer: 'QA-PRIV-1',
  rechnungsdatum: heute,
  waehrung: 'EUR',
  netto: 100,
  mwst: 20,
  brutto: 120,
  mwstSatz: '20',
  bereich: 'ddl',
  kategorie: 'material',
  privatKategorie: null,
  beschreibung: 'Resin',
  unsicher: [],
  hinweis: null,
};
const json = (res, status, daten) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'request-id': 'req_qa' });
  res.end(JSON.stringify(daten));
};
const api = http.createServer(async (req, res) => {
  const teile = [];
  for await (const t of req) teile.push(t);
  const schluessel = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
  if (schluessel !== SCHLUESSEL) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) {
    const id = decodeURIComponent(url.pathname.split('/').pop());
    return json(res, 200, { type: 'model', id, display_name: id, created_at: '2026-01-01T00:00:00Z' });
  }
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const body = JSON.parse(Buffer.concat(teile).toString('utf8'));
    const datei = body.messages?.[0]?.content?.[0];
    return json(res, 200, {
      id: 'msg_qa',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: JSON.stringify(datei?.type === 'image' ? BILLA : LABOR) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 150 },
    });
  }
  json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
});
const KI_URL = new URL(process.env.KI_API_URL ?? 'http://127.0.0.1:3198');
await new Promise((ok) => api.listen(Number(KI_URL.port), '127.0.0.1', ok));
const start = new Date();

async function aufraeumen() {
  const staff = (await sql`select id from ddl.staff_users where email in ${sql([INHABER, BUERO])}`).map((r) => r.id);
  if (staff.length) {
    const eingang = await sql`select id, beleg_key from ddl.beleg_eingang where hochgeladen_von in ${sql(staff)}`;
    for (const e of eingang) await rm(path.join(SPEICHER, e.beleg_key), { force: true });
    if (eingang.length) await sql`delete from ddl.beleg_eingang where id in ${sql(eingang.map((e) => e.id))}`;
    const privat = await sql`select id, beleg_key from ddl.privat_buchungen where erfasst_von in ${sql(staff)}`;
    for (const p of privat) if (p.beleg_key) await rm(path.join(SPEICHER, p.beleg_key), { force: true });
    if (privat.length) {
      await sql`delete from ddl.audit_log where target_id in ${sql(privat.map((p) => p.id))}`;
      await sql`delete from ddl.privat_buchungen where id in ${sql(privat.map((p) => p.id))}`;
    }
  }
  const ausgaben = await sql`select id, beleg_key from ddl.expenses where lieferant like 'QA · Privat%'`;
  for (const z of ausgaben) if (z.beleg_key) await rm(path.join(SPEICHER, z.beleg_key), { force: true });
  if (ausgaben.length) {
    await sql.begin(async (tx) => {
      await tx`set local ddl.ausgaben_loeschen = 'qa'`;
      await tx`delete from ddl.expenses where lieferant like 'QA · Privat%'`;
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-privat-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-privat-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

/** Wert einer Zelle der Zahlenleiste der Übersicht */
async function zelle(s, titel) {
  const z = s.getByRole('region', { name: /^Zahlen / }).locator('div').filter({ has: s.locator('span', { hasText: new RegExp(`^${titel}$`) }) }).first();
  return normal(await z.locator('span').nth(1).textContent());
}

try {
  const { s, id: inhaberId } = await anmelden(INHABER, 'Test Privat', 'inhaber');
  const neueBuchung = s.getByRole('form', { name: 'Neue Buchung' });

  // ════ Menü und leere Übersicht ════
  await s.goto(`${CRM}/`);
  const menue = s.getByRole('navigation').filter({ has: s.getByRole('link', { name: 'Abrechnung' }) }).first();
  await menue.getByRole('link', { name: 'Privat' }).click();
  await s.waitForURL(`${CRM}/privat`);
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Übersicht', level: 1 })), 'Menü »Privat« → Übersicht');
  pruefen(await sichtbar(s.getByText(/Noch keine Zahlen für/)), 'Übersicht: leer mit Hinweis');
  pruefen(!(await s.getByText(/fakturiert/).count()), 'Übersicht: kein »fakturiert«');

  // ════ Buchungen von Hand ════
  await s.getByRole('navigation', { name: 'Bereiche von Privat' }).getByRole('link', { name: 'Buchungen' }).click();
  await s.waitForURL(`${CRM}/privat/buchungen`);
  await s.getByRole('button', { name: '+ Neue Buchung' }).click();
  await neueBuchung.getByText('Einnahme', { exact: true }).click();
  pruefen(await sichtbar(neueBuchung.getByLabel('Von')), 'Einnahme: Feld heißt »Von«');
  const optionenEin = await neueBuchung.getByLabel('Kategorie').locator('option').allTextContents();
  pruefen(optionenEin.includes('Gehalt') && !optionenEin.includes('Restaurant & Café'), 'Einnahme: nur Einnahme-Kategorien');
  await neueBuchung.getByLabel('Betrag (€)').fill('abc');
  await neueBuchung.getByLabel('Kategorie').selectOption('gehalt');
  await neueBuchung.getByLabel('Von').fill('QA · Arbeitgeber');
  await neueBuchung.getByRole('button', { name: 'Buchung speichern' }).click();
  pruefen(await sichtbar(neueBuchung.getByText(/Betrag: »abc« ist kein gültiger Betrag/)), 'ungültiger Betrag abgelehnt');
  pruefen((await neueBuchung.getByLabel('Von').inputValue()) === 'QA · Arbeitgeber', 'Eingaben bleiben nach dem Fehler');
  await neueBuchung.getByLabel('Betrag (€)').fill('3.000');
  await neueBuchung.getByRole('button', { name: 'Buchung speichern' }).click();
  pruefen(await sichtbar(neueBuchung.getByText('Einnahme erfasst: QA · Arbeitgeber, € 3.000,00.')), 'Einnahme gespeichert');

  await neueBuchung.getByLabel('Betrag (€)').fill('45,90');
  pruefen(await sichtbar(neueBuchung.getByLabel('Händler')), 'Formular wieder leer, Art »Ausgabe«');
  await neueBuchung.getByLabel('Kategorie').selectOption('lebensmittel');
  await neueBuchung.getByLabel('Händler').fill('QA · BILLA');
  await neueBuchung.getByLabel('Beleg (optional, Foto oder PDF)').setInputFiles({ name: 'billa.png', mimeType: 'image/png', buffer: PNG_HAND });
  await neueBuchung.getByRole('button', { name: 'Buchung speichern' }).click();
  pruefen(await sichtbar(neueBuchung.getByText(/Ausgabe erfasst: QA · BILLA, €\s45,90\. Beleg gespeichert\./)), 'Ausgabe mit Beleg gespeichert');

  await neueBuchung.getByLabel('Betrag (€)').fill('10');
  await neueBuchung.getByLabel('Kategorie').selectOption('freizeit');
  await neueBuchung.getByLabel('Händler').fill('QA · Löschen');
  await neueBuchung.getByRole('button', { name: 'Buchung speichern' }).click();
  pruefen(await sichtbar(neueBuchung.getByText(/Ausgabe erfasst: QA · Löschen/)), 'dritte Buchung gespeichert');

  // zurückgezahltes verliehenes Geld: in der Liste, aber keine Einnahme
  await neueBuchung.getByText('Einnahme', { exact: true }).click();
  await neueBuchung.getByLabel('Betrag (€)').fill('500');
  await neueBuchung.getByLabel('Kategorie').selectOption('rueckzahlung');
  await neueBuchung.getByLabel('Von').fill('QA · Freund');
  await neueBuchung.getByRole('button', { name: 'Buchung speichern' }).click();
  pruefen(await sichtbar(neueBuchung.getByText(/Einnahme erfasst: QA · Freund/)), 'Rückzahlung (verliehenes Geld) gespeichert');
  await s.keyboard.press('Escape');

  const db1 = await sql`select art, betrag_cent, kategorie, haendler, quelle, beleg_sha256 from ddl.privat_buchungen where erfasst_von = ${inhaberId} order by erfasst_am`;
  pruefen(
    db1.length === 4 && db1[3].kategorie === 'rueckzahlung' && db1[0].art === 'einnahme' && db1[0].betrag_cent === 300000 && db1[1].betrag_cent === 4590 && db1[1].beleg_sha256 === sha(PNG_HAND) && db1[1].quelle === 'hand',
    'Datenbank: Einnahme 3.000, Ausgabe 45,90 mit Beleg',
  );
  const audit1 = await sql`select count(*)::int as n from ddl.audit_log where action = 'privat_erfasst' and actor_id = ${inhaberId}`;
  pruefen(audit1[0].n === 4, 'Protokoll: vier »Privat: Buchung erfasst«');

  // ── Liste, ändern, Beleg ──
  await s.reload();
  const liste = s.getByRole('section', { name: 'Buchungen nach Monat' }).or(s.locator('section[aria-label="Buchungen nach Monat"]'));
  pruefen(await sichtbar(liste.getByRole('button', { name: /QA · Arbeitgeber.*\+ € 3\.000,00/ })), 'Liste: Einnahme mit »+«');
  pruefen(await sichtbar(liste.getByRole('button', { name: /QA · Freund/ })), 'Liste: Rückzahlung steht drin');
  const leiste = await s.getByRole('navigation', { name: 'Bereiche der Buchungen' }).innerText();
  pruefen(new RegExp(`Einnahmen \\d{4}\\s*€\\s3\\.000,00`).test(leiste), 'Kennzahl »Einnahmen«: ohne Rückzahlung');
  await liste.getByRole('button', { name: /QA · BILLA/ }).click();
  const fenster = s.getByRole('dialog', { name: 'Buchung QA · BILLA' });
  pruefen(await sichtbar(fenster.getByRole('img', { name: 'Beleg QA · BILLA' })), 'Fenster: Beleg sichtbar');
  const aendern = fenster.getByRole('form', { name: 'Buchung ändern' });
  await aendern.getByLabel('Betrag (€)').fill('50');
  await aendern.getByRole('button', { name: 'Änderungen speichern' }).click();
  pruefen(await sichtbar(aendern.getByText('Buchung gespeichert.')), 'geändert');
  const [billa] = await sql`select id, betrag_cent from ddl.privat_buchungen where haendler = 'QA · BILLA' and erfasst_von = ${inhaberId}`;
  pruefen(billa.betrag_cent === 5000, 'Datenbank: Betrag 50,00');
  const belegAntwort = await s.request.get(`${CRM}/api/privat/${billa.id}/beleg`);
  pruefen(belegAntwort.ok() && sha(await belegAntwort.body()) === sha(PNG_HAND), 'Beleg über die API, unverändert');
  await s.keyboard.press('Escape');

  // ── löschen ──
  await liste.getByRole('button', { name: /QA · Löschen/ }).click();
  const loeschFenster = s.getByRole('dialog', { name: 'Buchung QA · Löschen' });
  await loeschFenster.getByText('Buchung löschen …').click();
  await loeschFenster.getByRole('button', { name: 'Wirklich löschen: QA · Löschen' }).click();
  pruefen(await sichtbar(loeschFenster.getByText('Buchung gelöscht.')), 'gelöscht');
  await s.goto(`${CRM}/privat/buchungen`);
  pruefen(!(await s.getByRole('button', { name: /QA · Löschen/ }).count()), 'gelöschte Buchung nicht mehr in der Liste');
  const [weg] = await sql`select geloescht_am from ddl.privat_buchungen where haendler = 'QA · Löschen'`;
  pruefen(Boolean(weg?.geloescht_am), 'Datenbank: nur als gelöscht markiert');
  await bild(s, 'pr1-buchungen');

  // ════ Übersicht mit Zahlen ════
  await s.goto(`${CRM}/privat`);
  pruefen((await zelle(s, 'Einnahmen')) === normal(centText(300000)), 'Übersicht: Einnahmen € 3.000,00 (Rückzahlung zählt nicht)');
  pruefen((await zelle(s, 'Ausgaben')) === normal(centText(5000)), 'Übersicht: Ausgaben € 50,00 (ohne gelöschte)');
  pruefen((await zelle(s, 'Gespart')) === normal(centText(295000)), 'Übersicht: »Gespart« € 2.950,00');
  pruefen((await zelle(s, 'Sparquote')).startsWith('98'), 'Übersicht: »Sparquote« 98 %');
  await s.getByRole('navigation', { name: 'Bereiche der Übersicht' }).getByRole('link', { name: 'Kategorien' }).click();
  pruefen(await sichtbar(s.getByRole('list', { name: 'Ausgaben nach Kategorie' }).getByText('Lebensmittel & Supermarkt')), 'Kategorien: »Lebensmittel & Supermarkt«');
  await bild(s, 'pr2-uebersicht');

  // ════ getrennt von DDL ════
  const [ddlAusgabe] = await sql`select count(*)::int as n from ddl.expenses where lieferant like 'QA · BILLA%' or lieferant like 'QA · Arbeitgeber%'`;
  pruefen(ddlAusgabe.n === 0, 'DDL: keine private Buchung unter den Ausgaben des Labors');
  await s.goto(`${CRM}/abrechnung/ausgaben`);
  pruefen(!(await s.getByText('QA · BILLA').count()), 'DDL-Ausgaben zeigen nichts Privates');

  // ════ KI-Schlüssel ════
  await s.goto(`${CRM}/einstellungen/ki`);
  const ki = s.getByRole('form', { name: 'KI-Einstellungen' });
  await ki.getByLabel('API-Schlüssel von Anthropic').fill(SCHLUESSEL);
  await ki.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(ki.getByText('Gespeichert. Die Verbindung zu Anthropic funktioniert.')), 'KI: Schlüssel gespeichert');

  // ════ Zu prüfen: Beleg unter Privat hochgeladen ════
  const hochladen = (name, mimeType, buffer) => s.getByLabel('Belege wählen (Foto oder PDF)').setInputFiles({ name, mimeType, buffer });
  await s.goto(`${CRM}/privat/buchungen`);
  await hochladen('billa-kassabon.png', 'image/png', PNG_BILLA);
  pruefen(await sichtbar(s.getByRole('list', { name: 'Hochgeladene Belege' }).getByText(/billa-kassabon\.png · gelesen: QA · BILLA Filiale, €\s23,40/)), 'Privat: Beleg gelesen');
  await s.waitForURL(/\/privat\/buchungen\?tab=pruefen/);
  const [e1] = await sql`select bereich from ddl.beleg_eingang where beleg_sha256 = ${sha(PNG_BILLA)}`;
  pruefen(e1?.bereich === 'privat', 'Datenbank: Bereich »privat«');

  // ── unter Ausgaben hochgeladen: Foto (KI: privat) und PDF (KI: Labor) ──
  await s.goto(`${CRM}/abrechnung/ausgaben`);
  await hochladen('spar.png', 'image/png', PNG_SPAR);
  await s.waitForURL(/tab=pruefen/);
  await hochladen('formlabs.pdf', 'application/pdf', PDF_LABOR);
  pruefen(await sichtbar(s.getByRole('list', { name: 'Hochgeladene Belege' }).getByText(/formlabs\.pdf · gelesen/)), 'Ausgaben: PDF gelesen');
  await s.reload();
  const ddlListe = s.getByRole('list', { name: 'Belege zu prüfen' });
  pruefen(await sichtbar(ddlListe.getByRole('button', { name: /QA · Privat Formlabs GmbH/ })), 'DDL »Zu prüfen«: Rechnung des Labors');
  pruefen(!(await ddlListe.getByRole('button', { name: /BILLA/ }).count()), 'DDL »Zu prüfen«: private Kassabons nicht hier');
  const [e2] = await sql`select bereich from ddl.beleg_eingang where beleg_sha256 = ${sha(PNG_SPAR)}`;
  pruefen(e2?.bereich === 'privat', 'Foto unter Ausgaben, KI sagt privat ← Bereich »privat«');

  // ── Privat »Zu prüfen«: zwei Belege, Hinweis am Tab ──
  await s.goto(`${CRM}/privat/buchungen?tab=pruefen`);
  const privatTab = s.getByRole('navigation', { name: 'Bereiche von Privat' }).getByRole('link', { name: /Buchungen/ });
  pruefen(/2/.test(await privatTab.innerText()), 'Tab »Buchungen«: 2 zu prüfen');
  const privatListe = s.getByRole('list', { name: 'Belege zu prüfen' });
  pruefen((await privatListe.getByRole('button').count()) === 2, 'Privat »Zu prüfen«: zwei Belege');
  await privatListe.getByRole('button', { name: /billa-kassabon\.png/ }).click();
  const pruefFenster = s.getByRole('dialog', { name: 'Beleg prüfen: billa-kassabon.png' });
  pruefen((await pruefFenster.getByRole('button', { name: 'Privat' }).getAttribute('aria-pressed')) === 'true', 'Fenster: »Privat« vorgewählt');
  const privatForm = pruefFenster.getByRole('form', { name: 'Beleg übernehmen (Privat)' });
  pruefen(
    (await privatForm.getByLabel('Händler').inputValue()) === 'QA · BILLA Filiale' &&
      (await privatForm.getByLabel('Betrag (€)').inputValue()) === '23,40' &&
      (await privatForm.getByLabel('Kategorie').inputValue()) === 'lebensmittel' &&
      (await privatForm.getByLabel('Datum').inputValue()) === heute,
    'Formular: Händler, Betrag, Kategorie und Datum aus der KI',
  );
  await bild(s, 'pr3-zu-pruefen');
  const [eBilla] = await sql`select id, beleg_key from ddl.beleg_eingang where beleg_sha256 = ${sha(PNG_BILLA)}`;
  await privatForm.getByRole('button', { name: 'Übernehmen' }).click();
  pruefen(await sichtbar(privatForm.getByText(/Ausgabe erfasst: QA · BILLA Filiale, €\s23,40\./)), 'übernommen');
  const [pBilla] = await sql`select quelle, beleg_key, betrag_cent from ddl.privat_buchungen where beleg_sha256 = ${sha(PNG_BILLA)}`;
  const [nochDa] = await sql`select count(*)::int as n from ddl.beleg_eingang where id = ${eBilla.id}`;
  pruefen(pBilla?.quelle === 'beleg' && pBilla.beleg_key === eBilla.beleg_key && pBilla.betrag_cent === 2340 && nochDa.n === 0, 'Datenbank: Buchung mit demselben Beleg, Eingang leer');

  // ── Labor-PDF unter »Ausgaben« doch privat ──
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  await s.getByRole('list', { name: 'Belege zu prüfen' }).getByRole('button', { name: /QA · Privat Formlabs GmbH/ }).click();
  const laborFenster = s.getByRole('dialog', { name: 'Beleg prüfen: formlabs.pdf' });
  pruefen((await laborFenster.getByRole('button', { name: 'DDL-Labor' }).getAttribute('aria-pressed')) === 'true', 'Labor-PDF: »DDL-Labor« vorgewählt');
  await laborFenster.getByRole('button', { name: 'Privat' }).click();
  pruefen(await sichtbar(laborFenster.getByText('Die KI hätte »DDL-Labor« gewählt.')), 'umgeschaltet: Hinweis auf die Wahl der KI');
  const umForm = laborFenster.getByRole('form', { name: 'Beleg übernehmen (Privat)' });
  pruefen((await umForm.getByLabel('Betrag (€)').inputValue()) === '120,00' && (await umForm.getByLabel('Kategorie').inputValue()) === '', 'Privat-Formular: Betrag übernommen, Kategorie zu wählen');
  await umForm.getByLabel('Kategorie').selectOption('sonstiges');
  await umForm.getByRole('button', { name: 'Übernehmen' }).click();
  pruefen(await sichtbar(umForm.getByText(/Ausgabe erfasst: QA · Privat Formlabs GmbH/)), 'Labor-PDF als Privat übernommen');
  const [alsAusgabe] = await sql`select count(*)::int as n from ddl.expenses where beleg_sha256 = ${sha(PDF_LABOR)}`;
  const [alsPrivat] = await sql`select count(*)::int as n from ddl.privat_buchungen where beleg_sha256 = ${sha(PDF_LABOR)}`;
  pruefen(alsAusgabe.n === 0 && alsPrivat.n === 1, 'Datenbank: nicht bei den Ausgaben, sondern unter Privat');

  // ── derselbe Beleg noch einmal ──
  await s.goto(`${CRM}/privat/buchungen`);
  await hochladen('billa-nochmal.png', 'image/png', PNG_BILLA);
  pruefen(await sichtbar(s.getByRole('list', { name: 'Hochgeladene Belege' }).getByText(/schon unter »Privat« erfasst/)), 'gleicher Beleg: abgelehnt mit Hinweis');

  // ════ Handy ════
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 844 });
    for (const pfad of ['/privat', '/privat/buchungen', '/privat/buchungen?tab=pruefen']) {
      await s.goto(`${CRM}${pfad}`);
      const breit = await s.evaluate(() => document.documentElement.scrollWidth);
      pruefen(breit <= breite + 1, `Handy ${breite}px ${pfad}: kein horizontales Scrollen (${breit}px)`);
    }
    await s.goto(`${CRM}/privat/buchungen`);
    await s.getByRole('button', { name: '+ Neue Buchung' }).click();
    const breitForm = await s.evaluate(() => document.documentElement.scrollWidth);
    pruefen(breitForm <= breite + 1, `Handy ${breite}px: Formular passt`);
    await bild(s, `pr4-handy-${breite}`);
  }

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/`);
  pruefen(!(await b.getByRole('link', { name: 'Privat', exact: true }).count()), 'Büro: kein Menü »Privat«');
  await b.goto(`${CRM}/privat`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Übersicht gesperrt');
  pruefen(!(await b.getByText('3.000,00').count()), 'Büro: keine Beträge');
  await b.goto(`${CRM}/privat/buchungen`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Buchungen gesperrt');
  const bBeleg = await b.request.get(`${CRM}/api/privat/${billa.id}/beleg`);
  const bHoch = await b.request.post(`${CRM}/api/ausgaben/eingang?bereich=privat&name=x.png`, { data: PNG0, headers: { 'Content-Type': 'image/png', Origin: CRM } });
  pruefen(bBeleg.status() === 401 && bHoch.status() === 401, 'Büro: kein Beleg, kein Hochladen nach Privat');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  api.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
