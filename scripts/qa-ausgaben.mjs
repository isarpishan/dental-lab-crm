// آزمون «Ausgaben» در Chrome (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶): تب‌های Einnahmen و Ausgaben (فقط Inhaber)، فرم با
// حساب Netto/MwSt/Brutto از هر طرف، Beleg (عکس و PDF) با تشخیص نوع از بایت‌ها، Rechnung تکراری، «Anderer Betrag»،
// «Ohne Beleg» و نشان‌دادن Beleg، قفل Beleg در دیتابیس، تغییر با «AfA prüfen»، ماه بر اساس «Bezahlt am»، حذف نرم،
// Export ZIP، نقش Büro، موبایل.
// دادهٔ آزمایشی: «QA · …»، @example.invalid؛ بعد کامل پاک می‌شود (با فایل‌ها).
// اجرا: pnpm qa qa-ausgaben  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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

const INHABER = 'test-ausgaben@example.invalid';
const BUERO = 'test-ausgaben-buero@example.invalid';
// kleines, gültiges PNG (1×1) und ein Mini-PDF
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function aufraeumen() {
  const zeilen = await sql`select id, beleg_key from ddl.expenses where lieferant like 'QA · %'`;
  for (const z of zeilen) if (z.beleg_key) await rm(path.join(SPEICHER, z.beleg_key), { force: true });
  if (zeilen.length) {
    await sql`delete from ddl.audit_log where target_id in ${sql(zeilen.map((z) => z.id))}`;
    await sql.begin(async (tx) => {
      await tx`set local ddl.ausgaben_loeschen = 'qa'`;
      await tx`delete from ddl.expenses where lieferant like 'QA · %'`;
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-ausgaben-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-ausgaben-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

try {
  const heute = iso(new Date());
  const jetzt = new Date();
  const vormonat = iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15, 12));
  const { s } = await anmelden(INHABER, 'Test Ausgaben', 'inhaber');

  // ════ Tabs ════
  await s.goto(`${CRM}/abrechnung`);
  const tabs = s.getByRole('navigation', { name: 'Einnahmen und Ausgaben' });
  pruefen((await tabs.getByRole('link', { name: 'Einnahmen' }).getAttribute('aria-current')) === 'page', 'Abrechnung: Tab »Einnahmen« aktiv');
  await tabs.getByRole('link', { name: 'Ausgaben' }).click();
  await s.waitForURL(`${CRM}/abrechnung/ausgaben`);
  pruefen(
    (await tabs.getByRole('link', { name: 'Ausgaben' }).getAttribute('aria-current')) === 'page' && !(await tabs.getByRole('link', { name: 'Einnahmen' }).getAttribute('aria-current')),
    'Ausgaben: nur Tab »Ausgaben« aktiv',
  );
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Ausgaben', level: 1 })), 'Seite »Ausgaben«');

  // ════ Neue Ausgabe: Brutto eingeben, Netto und MwSt rechnen sich aus; Foto als Beleg ════
  await s.getByRole('button', { name: '+ Neue Ausgabe' }).click();
  const neu = s.getByRole('form', { name: 'Neue Ausgabe' });
  await neu.getByLabel('Lieferant').fill('QA · SprintRay Europe');
  await neu.getByLabel('Rechnungsnummer').fill('QA-INV-1001');
  await neu.getByLabel('Kategorie').selectOption('material');
  await neu.getByLabel('Wofür?').fill('2 Flaschen Crown HT A2');
  await neu.getByLabel('Brutto (€)').fill('240,00');
  pruefen((await neu.getByLabel('Netto (€)').inputValue()) === '200,00' && (await neu.getByLabel('MwSt (€)').inputValue()) === '40,00', 'Brutto 240 → Netto 200,00 und MwSt 40,00');
  await neu.getByLabel('Netto (€)').fill('100');
  pruefen((await neu.getByLabel('Brutto (€)').inputValue()) === '120,00', 'Netto 100 → Brutto 120,00');
  await neu.getByLabel('MwSt-Satz').selectOption('10');
  pruefen((await neu.getByLabel('MwSt (€)').inputValue()) === '10,00' && (await neu.getByLabel('Brutto (€)').inputValue()) === '110,00', 'Satz 10 % → MwSt 10,00, Brutto 110,00');
  await neu.getByLabel('MwSt-Satz').selectOption('20');
  await neu.getByLabel('Brutto (€)').fill('240,00');
  await neu.getByLabel('Beleg (Foto oder PDF)').setInputFiles({ name: 'rechnung.png', mimeType: 'image/png', buffer: PNG });
  await neu.getByRole('button', { name: 'Ausgabe speichern' }).click();
  pruefen(await sichtbar(neu.getByText('Ausgabe erfasst: QA · SprintRay Europe, € 240,00. Beleg gespeichert.')), 'gespeichert mit Beleg');
  const [a1] = await sql`select *, bezahlt_am::text as bezahlt from ddl.expenses where lieferant = 'QA · SprintRay Europe'`;
  pruefen(
    a1?.netto_cent === 20000 && a1.mwst_cent === 4000 && a1.brutto_cent === 24000 && a1.mwst_satz === 20 && a1.bezahlt === heute && a1.kategorie === 'material',
    'Datenbank: Netto 200, MwSt 40, Brutto 240, 20 %, bezahlt heute',
  );
  pruefen(
    a1?.beleg_typ === 'image/png' && a1.beleg_name === 'rechnung.png' && existsSync(path.join(SPEICHER, a1.beleg_key)) && sha(readFileSync(path.join(SPEICHER, a1.beleg_key))) === a1.beleg_sha256,
    'Beleg: PNG gespeichert, sha256 stimmt',
  );
  pruefen((await neu.getByLabel('Lieferant').inputValue()) === '', 'Formular nach dem Speichern leer (nächste Rechnung)');

  // ── doppelte Rechnung ──
  await neu.getByLabel('Lieferant').fill('qa ·  sprintray europe');
  await neu.getByLabel('Rechnungsnummer').fill('qa-inv-1001');
  await neu.getByLabel('Kategorie').selectOption('material');
  await neu.getByLabel('Netto (€)').fill('10');
  await neu.getByRole('button', { name: 'Ausgabe speichern' }).click();
  pruefen(await sichtbar(neu.getByText(/Diese Rechnung ist schon erfasst: QA · SprintRay Europe, Nr\. qa-inv-1001/)), 'gleiche Rechnung (andere Schreibweise) abgelehnt');

  // ── anderer Betrag (mehrere Sätze), ohne Beleg, im Vormonat bezahlt ──
  await neu.getByLabel('Lieferant').fill('QA · Metro');
  await neu.getByLabel('Rechnungsnummer').fill('');
  await neu.getByLabel('Kategorie').selectOption('buero');
  await neu.getByLabel(/^Rechnungsdatum/).fill(vormonat);
  await neu.getByLabel('MwSt-Satz').selectOption('anders');
  await neu.getByLabel('Netto (€)').fill('100,00');
  await neu.getByLabel('MwSt (€)').fill('15,00');
  pruefen((await neu.getByLabel('Brutto (€)').inputValue()) === '115,00', 'Anderer Betrag: Netto 100 + MwSt 15 → Brutto 115,00');
  await neu.getByRole('button', { name: 'Ausgabe speichern' }).click();
  pruefen(await sichtbar(neu.getByText('Ausgabe erfasst: QA · Metro, € 115,00.')), 'zweite Ausgabe ohne Beleg gespeichert');
  const [a2] = await sql`select *, bezahlt_am::text as bezahlt from ddl.expenses where lieferant = 'QA · Metro'`;
  pruefen(a2?.mwst_satz === null && a2.brutto_cent === 11500 && a2.bezahlt === vormonat && a2.beleg_key === null, 'Datenbank: gemischt, 115, bezahlt im Vormonat, ohne Beleg');
  await s.keyboard.press('Escape');

  // ── Liste und Kennzahlen ──
  await s.reload();
  const monate = s.getByRole('region', { name: /\d{4}$/ });
  pruefen((await monate.count()) >= 2, 'Liste nach Monaten (heute und Vormonat getrennt)');
  const zeile1 = s.getByRole('button', { name: /QA · SprintRay Europe/ });
  const z1 = (await zeile1.innerText()).replace(/\s/g, ' ');
  pruefen(z1.includes('€ 240,00') && z1.includes('Material & Resin'), 'Zeile: Brutto und Kategorie');
  const ohne = s.getByRole('navigation', { name: 'Bereiche der Ausgaben' }).getByRole('link', { name: /Ohne Beleg/ });
  pruefen((await ohne.innerText()).includes('1'), 'Kennzahl »Ohne Beleg«: 1');
  await bild(s, 'au1-liste');

  // ── Beleg nachreichen: erst HTML (abgelehnt), dann PDF ──
  await ohne.click();
  await s.waitForURL(/tab=ohne/);
  await s.getByRole('region', { name: 'Ausgaben ohne Beleg' }).waitFor();
  await s.getByRole('button', { name: /QA · Metro/ }).click();
  const f2 = s.getByRole('form', { name: 'Ausgabe ändern: QA · Metro' });
  pruefen(await sichtbar(s.getByText('Beleg fehlt. Unten ein Foto oder PDF wählen.')), 'Fenster: »Beleg fehlt«');
  await f2.getByLabel('Beleg (Foto oder PDF)').setInputFiles({ name: 'boese.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html><script>alert(1)</script></html>') });
  await f2.getByRole('button', { name: 'Änderungen speichern' }).click();
  pruefen(await sichtbar(f2.getByText(/Bitte ein Foto \(JPG, PNG, HEIC\) oder ein PDF wählen\./)), 'HTML als »PDF« abgelehnt');
  const [ohneDatei] = await sql`select beleg_key from ddl.expenses where id = ${a2.id}`;
  pruefen(ohneDatei.beleg_key === null, 'abgelehnte Datei nicht gespeichert');
  await f2.getByLabel('Beleg (Foto oder PDF)').setInputFiles({ name: 'metro.pdf', mimeType: 'application/pdf', buffer: PDF });
  await f2.getByRole('button', { name: 'Änderungen speichern' }).click();
  pruefen(await sichtbar(f2.getByText('Ausgabe QA · Metro gespeichert. Beleg gespeichert.')), 'PDF nachgereicht');
  pruefen(await sichtbar(s.getByRole('link', { name: 'Beleg öffnen (metro.pdf) ↗' })), 'Fenster zeigt »Beleg öffnen«');
  const pdfAntwort = await s.request.get(`${CRM}/api/ausgaben/${a2.id}/beleg`);
  pruefen(pdfAntwort.ok() && pdfAntwort.headers()['content-type'] === 'application/pdf' && !pdfAntwort.headers()['content-security-policy'], 'PDF im Browser (ohne Sandbox)');
  const pngAntwort = await s.request.get(`${CRM}/api/ausgaben/${a1.id}/beleg`);
  pruefen(pngAntwort.headers()['content-type'] === 'image/png' && pngAntwort.headers()['content-security-policy'] === 'sandbox', 'Foto mit Sandbox');
  const nochmal = await s.request.post(`${CRM}/api/ausgaben/${a2.id}/beleg?name=x.pdf`, { data: PDF, headers: { Origin: CRM, 'Content-Type': 'application/pdf' } });
  pruefen(nochmal.status() === 400 && (await nochmal.json()).fehler === 'Diese Ausgabe hat schon einen Beleg.', 'zweiter Beleg abgelehnt');
  let gesperrt = false;
  try {
    await sql`update ddl.expenses set beleg_name = 'anders.pdf' where id = ${a2.id}`;
  } catch (e) {
    gesperrt = /unveränderlich/.test(e.message);
  }
  pruefen(gesperrt, 'Datenbank: Beleg unveränderlich (Trigger)');
  await s.keyboard.press('Escape');

  // ── ändern: Geräte über € 1.000 → AfA prüfen ──
  await s.goto(`${CRM}/abrechnung/ausgaben`);
  await s.getByRole('button', { name: /QA · SprintRay Europe/ }).click();
  const f1 = s.getByRole('form', { name: 'Ausgabe ändern: QA · SprintRay Europe' });
  pruefen(await sichtbar(s.getByRole('img', { name: 'Beleg QA · SprintRay Europe' })), 'Fenster zeigt das Foto');
  await f1.getByLabel('Kategorie').selectOption('geraete');
  await f1.getByLabel('Brutto (€)').fill('1.560,00');
  await f1.getByRole('button', { name: 'Änderungen speichern' }).click();
  pruefen(await sichtbar(f1.getByText('Ausgabe QA · SprintRay Europe gespeichert.')), 'Änderung gespeichert');
  await s.keyboard.press('Escape');
  pruefen(await sichtbar(s.getByRole('button', { name: /QA · SprintRay Europe/ }).getByText('AfA prüfen')), 'Zeile: »AfA prüfen« über € 1.000');
  const [geaendert] = await sql`select netto_cent, mwst_cent, kategorie, beleg_key from ddl.expenses where id = ${a1.id}`;
  const [log] = await sql`select details from ddl.audit_log where action = 'ausgabe_geaendert' and target_id = ${a1.id}`;
  pruefen(geaendert.netto_cent === 130000 && geaendert.mwst_cent === 26000 && geaendert.kategorie === 'geraete' && geaendert.beleg_key === a1.beleg_key, 'Datenbank: 1.300 + 260, Geräte, Beleg unverändert');
  pruefen(Boolean(log?.details?.aenderungen?.bruttoCent) && log.details.aenderungen.kategorie?.zu === 'geraete', 'Audit: Änderungen mit vorher/nachher');

  // ── Export ──
  const exp = await s.request.get(`${CRM}/api/ausgaben/export?von=${vormonat.slice(0, 7)}-01&bis=${heute}`);
  const zip = await exp.body();
  pruefen(exp.ok() && exp.headers()['content-type'] === 'application/zip' && zip.subarray(0, 2).toString() === 'PK', 'Export: ZIP');
  const inhalt = zip.toString('latin1');
  pruefen(
    inhalt.includes(`Ausgaben_${vormonat.slice(0, 7)}-01_bis_${heute}.xlsx`) && inhalt.includes(`Belege/${heute}_QA · SprintRay Europe_QA-INV-1001.png`.replace('·', 'Â·')) && inhalt.includes(`Belege/${vormonat}_QA · Metro.pdf`.replace('·', 'Â·')),
    'ZIP: Excel und beide Belege mit Datum, Lieferant und Nummer',
  );

  // ── löschen ──
  await s.getByRole('button', { name: /QA · Metro/ }).click();
  await s.getByText('Ausgabe löschen …').click();
  await s.getByRole('button', { name: 'Wirklich löschen: QA · Metro' }).click();
  pruefen(await sichtbar(s.getByText('Ausgabe QA · Metro gelöscht.')), 'gelöscht');
  await s.goto(`${CRM}/abrechnung/ausgaben`);
  pruefen((await s.getByRole('button', { name: /QA · Metro/ }).count()) === 0, 'gelöschte Ausgabe nicht mehr in der Liste');
  const [weg] = await sql`select geloescht_am, beleg_key from ddl.expenses where id = ${a2.id}`;
  pruefen(Boolean(weg.geloescht_am) && Boolean(weg.beleg_key) && existsSync(path.join(SPEICHER, weg.beleg_key)), 'Datenbank: nur markiert, Beleg bleibt');
  let nichtLoeschbar = false;
  try {
    await sql`delete from ddl.expenses where id = ${a2.id}`;
  } catch (e) {
    nichtLoeschbar = /nicht gelöscht/.test(e.message);
  }
  pruefen(nichtLoeschbar, 'Datenbank: Ausgaben lassen sich nicht löschen (Trigger)');

  // ── Handy ──
  await s.setViewportSize({ width: 390, height: 844 });
  await s.reload();
  const breit = await s.evaluate(() => document.documentElement.scrollWidth);
  pruefen(breit <= 391, `Handy: kein horizontales Scrollen (${breit}px)`);
  await bild(s, 'au2-handy');
  await s.getByRole('button', { name: '+ Neue Ausgabe' }).click();
  const breitFenster = await s.evaluate(() => document.documentElement.scrollWidth);
  pruefen(breitFenster <= 391, 'Handy: Formular passt');
  await bild(s, 'au3-handy-formular');

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/abrechnung`);
  pruefen((await b.getByRole('navigation', { name: 'Einnahmen und Ausgaben' }).count()) === 0, 'Büro: keine Tabs Einnahmen/Ausgaben');
  await b.goto(`${CRM}/abrechnung/ausgaben`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Ausgaben gesperrt');
  const bBeleg = await b.request.get(`${CRM}/api/ausgaben/${a1.id}/beleg`);
  const bExport = await b.request.get(`${CRM}/api/ausgaben/export?von=${heute}&bis=${heute}`);
  pruefen(bBeleg.status() === 401 && bExport.status() === 401, 'Büro: kein Beleg, kein Export');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
