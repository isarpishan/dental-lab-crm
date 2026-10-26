// آزمون فرم «Neuer Auftrag» (قدم ۵) مثل یک کاربر واقعی، در Chrome:
// بیمار تازه، Brücke 14–16 با سه اسکن، Entwurf بعد از بارگذاری دوباره، ارسال؛ Krone با
// «Daten werden nachgereicht» ← Rückfrage؛ Entwurf verwerfen؛ جدایی Ordinationها؛ سفارش تلفنی
// از پنل داخلی؛ و ظاهر صفحه‌ها در چند اندازه.
// فقط با دادهٔ آزمایشی («QA · …»، @example.invalid). همه‌چیز (حتی فایل‌ها روی دیسک) پاک
// می‌شود و شمارندهٔ شمارهٔ سفارش دقیقاً به حالت قبل برمی‌گردد.
// اجرا: pnpm qa qa-auftrag  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
const BILDER = process.env.QA_BILDER ?? null; // Ordner für Screenshots (optional)
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

/* ── Testdateien: binäre STL; eine über 10 MB (größer als der Puffer des Proxys) ── */
const ordner = path.join(tmpdir(), 'ddl-qa-auftrag');
mkdirSync(ordner, { recursive: true });
function stl(name, dreiecke) {
  const b = Buffer.alloc(84 + dreiecke * 50);
  b.write('DDL QA', 0);
  b.writeUInt32LE(dreiecke, 80);
  randomBytes(dreiecke * 50).copy(b, 84);
  const p = path.join(ordner, name);
  writeFileSync(p, b);
  return p;
}
const DATEI = {
  ok: stl('OK_Prüfmann.stl', 240_000), // ≈ 12 MB
  uk: stl('UK.stl', 2_000),
  biss: stl('Biss.stl', 1_000),
  extra: stl('Extra.stl', 500),
  exe: path.join(ordner, 'setup.exe'),
};
writeFileSync(DATEI.exe, 'MZ');
const hashVon = (p) => sha(readFileSync(p));

/* ── Aufräumen ── */
const STAFF_MAIL = 'test-auftrag@example.invalid';
async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Auftrag%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email = ${STAFF_MAIL}`).map((r) => r.id);
  if (praxen.length) {
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      for (const f of await sql`select storage_key from ddl.order_files where order_id in ${sql(auftraege)}`) {
        await rm(path.join(SPEICHER, f.storage_key), { force: true });
      }
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
  }
  await vereinbarungenLoeschen(sql, praxen);
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
}

await aufraeumen();
const jahr = Number(new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'Europe/Vienna' }).format(new Date()));
const [zaehlerVorher] = await sql`select last_value from ddl.number_sequences where scope = 'auftrag' and year = ${jahr}`;
const qaNummern = [];
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];

async function portalZugang(name, email, praxisId) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const seite = await ctx.newPage();
  seite.on('pageerror', (e) => konsole.push(String(e)));
  seite.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  await seite.goto(`${PORTAL}/einladung/${token}`);
  await seite.getByLabel('Neues Passwort').fill('test-passwort-auftrag-1');
  await seite.getByLabel('Passwort wiederholen').fill('test-passwort-auftrag-1');
  await seite.getByRole('button', { name: 'Zugang einrichten' }).click();
  await seite.waitForURL(`${PORTAL}/`);
  return { seite, id: u.id };
}

const kachel = (s, name) => s.getByRole('button', { name: new RegExp(`^${name}`) });
const schritt = (s, id) => s.locator(`#schritt-${id}`);
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
/** wartet, bis der Entwurf in der Datenbank den erwarteten Stand hat (Autosave). */
async function gespeichert(id, pruef) {
  for (let i = 0; i < 50; i++) {
    const [o] = await sql`select * from ddl.orders where id = ${id}`;
    if (o && pruef(o)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

try {
  // ── Testdaten: zwei Ordinationen, zwei Behandler in A ──
  const [A] = await sql`insert into ddl.practices (customer_no, name, city) values ('QA-A', 'QA · Auftrag Ordination A', 'Wien') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name) values ('QA-B', 'QA · Auftrag Ordination B') returning id`;
  await sql`insert into ddl.dentists (practice_id, title, first_name, last_name) values (${A.id}, 'Dr.', 'Anna', 'Prüf'), (${A.id}, 'Dr.', 'Bernd', 'Test')`;
  const { seite: p, id: nutzerA } = await portalZugang('QA Praxis A', 'qa-auftrag-a@example.invalid', A.id);

  // ════ 1. Brücke 14–16 mit neuem Patienten und drei Scans ════
  await p.getByRole('main').getByRole('link', { name: 'Neuer Auftrag' }).click();
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Für welchen Patienten?' })), 'Schritt 1 ist der Patient');
  pruefen(await sichtbar(p.getByText('Noch keine Patienten angelegt.')), 'ohne Patienten gleich das Formular »Neuer Patient«');
  await bild(p, '01-patient-leer');
  await p.getByRole('button', { name: 'Anlegen und weiter' }).click();
  pruefen((await p.locator('input[name="vorname"]:invalid').count()) === 1 && (await p.getByRole('heading', { name: 'Was möchten Sie bestellen?' }).count()) === 0, 'Patient ohne Namen: Formular hält an');
  await p.getByLabel('Vorname').fill('Erika');
  await p.getByLabel('Nachname').fill('Prüfmann');
  await p.getByLabel('Geburtsdatum').fill('1980-03-12');
  await p.getByRole('button', { name: 'Anlegen und weiter' }).click();
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Was möchten Sie bestellen?' })), 'nach dem Patienten: Behandlung');
  pruefen(await schritt(p, 'patient').getByText(/^Erika Prüfmann · P-[2-9A-Z]{4}$/).isVisible(), 'Patient eingeklappt mit Patienten-ID');
  pruefen(/\?entwurf=[0-9a-f-]{36}$/.test(p.url()), 'Entwurf angelegt, Adresse enthält ihn');
  const entwurf1 = p.url().split('entwurf=')[1];
  const [patient] = await sql`select id, code, first_name_enc, last_name_enc, birth_date_enc from ddl.patients where practice_id = ${A.id}`;
  pruefen(patient && !/Erika|Prüfmann|1980/.test(patient.first_name_enc + patient.last_name_enc + patient.birth_date_enc), 'Patientenname nur verschlüsselt in der Datenbank');
  const [anlage] = await sql`select details from ddl.audit_log where action = 'patient_angelegt' and actor_id = ${nutzerA}`;
  pruefen(anlage && !JSON.stringify(anlage.details).includes('Erika') && anlage.details.code === patient.code, 'Audit-Log: Patient angelegt, nur mit ID');

  await kachel(p, 'Brücke').click();
  const zaehne = schritt(p, 'b-zaehne');
  await zaehne.getByRole('button', { name: /^Zahn 14:/ }).click();
  await zaehne.getByRole('button', { name: /^Zahn 16:/ }).click();
  await zaehne.getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(p, 'b-versorgung').getByRole('button', { name: 'Definitiv' }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'A2', exact: true }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'Weiter', exact: true }).click();
  await kachel(p, 'Fertige Arbeit').click();
  await schritt(p, 'tempo').getByRole('button', { name: /^Standard/ }).click();
  const dateien = schritt(p, 'dateien');
  pruefen(await sichtbar(dateien.getByRole('heading', { name: 'Dateien hochladen' })), 'nach dem Tempo: Dateien');
  pruefen(
    (await dateien.getByRole('heading', { level: 3 }).allTextContents()).map((t) => t.replace('*', '').trim()).join('|') === 'Oberkiefer-Scan|Unterkiefer-Scan|Bissregistrierung|Weitere Dateien',
    'eigene Plätze für OK, UK, Biss und »Weitere Dateien«',
  );

  // Entwurf: neu laden, alles ist noch da
  pruefen(await gespeichert(entwurf1, (o) => o.work_type_key === 'bruecke' && o.tempo === 'standard' && o.delivery_kind === 'fertigung'), 'Entwurf automatisch gespeichert');
  await p.reload();
  pruefen(await sichtbar(schritt(p, 'dateien').getByRole('heading', { name: 'Dateien hochladen' })), 'nach Neuladen: derselbe Schritt offen');
  pruefen(await schritt(p, 'b-zaehne').getByText('Brücke 16–14: Anker 16, 14 · Glied 15').isVisible(), 'nach Neuladen: Zähne gespeichert');
  pruefen(await schritt(p, 'patient').getByText(/^Erika Prüfmann/).isVisible(), 'nach Neuladen: Patient gespeichert');

  await dateien.getByRole('button', { name: 'Weiter', exact: true }).click();
  pruefen(await sichtbar(dateien.getByRole('alert').getByText(/Es fehlen: Oberkiefer-Scan, Unterkiefer-Scan, Bissregistrierung/)), 'ohne Scans kein »Weiter«');
  await dateien.getByLabel('Weitere Dateien hochladen').setInputFiles(DATEI.exe);
  pruefen(await sichtbar(dateien.getByText(/Dieses Dateiformat wird nicht angenommen/)), '.exe wird abgelehnt');
  await dateien.getByRole('button', { name: 'setup.exe entfernen' }).click();
  await dateien.getByLabel('Oberkiefer-Scan hochladen').setInputFiles(DATEI.ok);
  await dateien.getByLabel('Unterkiefer-Scan hochladen').setInputFiles(DATEI.uk);
  await dateien.getByLabel('Bissregistrierung hochladen').setInputFiles(DATEI.biss);
  await dateien.getByLabel('Weitere Dateien hochladen').setInputFiles(DATEI.extra);
  await bild(p, '02-dateien');
  await dateien.getByRole('button', { name: 'Weiter', exact: true }).click();
  pruefen(await sichtbar(schritt(p, 'plan').getByRole('heading', { name: 'Noch etwas für uns?' })), 'mit Scans (auch noch beim Hochladen): weiter zu »Hinweise«');

  // »Weitere Datei« wieder entfernen
  await p.getByRole('button', { name: 'Dateien ändern' }).click();
  await schritt(p, 'dateien').getByText('Extra.stl').waitFor();
  await schritt(p, 'dateien').getByRole('button', { name: 'Extra.stl entfernen' }).waitFor();
  await p.waitForFunction(() => !document.querySelector('[role=progressbar]'), null, { timeout: 30000 });
  const extraVorher = await sql`select storage_key from ddl.order_files where order_id = ${entwurf1} and size = ${statSync(DATEI.extra).size}`;
  await schritt(p, 'dateien').getByRole('button', { name: 'Extra.stl entfernen' }).click();
  await schritt(p, 'dateien').getByText('Extra.stl').waitFor({ state: 'detached' });
  const extraNachher = await sql`select id from ddl.order_files where order_id = ${entwurf1} and size = ${statSync(DATEI.extra).size}`;
  pruefen(extraVorher.length === 1 && !extraNachher.length && !existsSync(path.join(SPEICHER, extraVorher[0].storage_key)), 'Datei entfernen: aus Datenbank und von der Festplatte');
  await schritt(p, 'dateien').getByRole('button', { name: 'Weiter', exact: true }).click();

  const plan = schritt(p, 'plan');
  await plan.getByRole('button', { name: 'Weiter', exact: true }).click();
  pruefen(await sichtbar(plan.getByRole('alert').getByText('Bitte die Behandlerin oder den Behandler wählen.')), 'zwei Behandler: Auswahl ist Pflicht');
  await plan.getByLabel('Behandler').selectOption({ label: 'Dr. Anna Prüf' });
  const termin = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  await plan.getByLabel('Wunschtermin').fill(termin);
  await plan.getByLabel('Behandlungsplan und Hinweise').fill('QA: Präparationsgrenze 15 leicht subgingival.');
  await bild(p, '03-hinweise');
  await plan.getByRole('button', { name: 'Weiter', exact: true }).click();
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Bereit zum Absenden.' })), 'alles beantwortet: »Bereit zum Absenden.«');
  pruefen(await p.getByText(/^Brücke · Fertige Arbeit · Standard · (Preis auf Anfrage|ab €)/).isVisible(), 'Zusammenfassung mit Behandlung, Lieferart, Tempo und Preis');
  pruefen(await sichtbar(p.getByRole('region', { name: 'Preis', exact: true }).getByText(/^(Preis auf Anfrage|€\s[\d.,]+)$/)), 'Zusammenfassung: Kasten »Preis« mit Summe');
  await bild(p, '04-zusammenfassung');
  const senden = p.getByRole('button', { name: 'Auftrag absenden' });
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Auftrag absenden' && !b.disabled), null, { timeout: 60000 });
  await senden.click();
  await p.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/, { timeout: 15000 });
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Auftrag eingegangen.' })), 'gesendet: »Auftrag eingegangen.«');
  const nr1 = (await p.getByText(/^Auftrag A-\d{4}-\d{4}$/).textContent()).replace('Auftrag ', '');
  qaNummern.push(nr1);
  const auftragsSeite = p.url();
  await p.goto(`${auftragsSeite}?tab=details`);
  pruefen((await sichtbar(p.getByRole('complementary', { name: 'Auftrag' }).getByText('Preis', { exact: true }))) && (await sichtbar(p.getByRole('region', { name: 'Preis', exact: true }))), 'Auftragsseite: Preis in der Seitenleiste und als Kasten in den Auftragsdetails');
  pruefen((await sichtbar(p.getByText('Brücke 16–14: Anker 16, 14 · Glied 15').last())) && (await p.getByText('Dr. Anna Prüf').first().isVisible()), 'Auftragsseite (Auftragsdetails) zeigt dieselben Angaben');
  await p.goto(auftragsSeite);
  await bild(p, '05-eingegangen');

  const [o1] = await sql`select *, desired_date::text as termin from ddl.orders where id = ${entwurf1}`;
  pruefen(
    o1.status === 'eingereicht' && o1.order_no === nr1 && o1.delivery_kind === 'fertigung' && o1.tempo === 'standard' && o1.shade === 'A2' && o1.draft_state === null && o1.price_snapshot && o1.submitted_at && o1.dentist_id && o1.termin === termin,
    `Datenbank: Auftrag ${nr1} eingereicht, mit Farbe, Behandler, Termin und Preisstand`,
  );
  const zaehneDb = (await sql`select fdi, treatment from ddl.order_teeth where order_id = ${entwurf1} order by fdi`).map((r) => `${r.fdi}:${r.treatment}`).join(' ');
  pruefen(zaehneDb === '14:bruecke_anker 15:bruecke_glied 16:bruecke_anker', 'Datenbank: Zähne 14–16 mit Anker und Glied');
  const verlauf = await sql`select status from ddl.order_status_history where order_id = ${entwurf1}`;
  const meldungen = await sql`select body from ddl.order_messages where order_id = ${entwurf1} and kind = 'ereignis'`;
  pruefen(verlauf.length === 1 && verlauf[0].status === 'eingereicht' && meldungen[0]?.body === 'Auftrag eingereicht', 'Statusverlauf und Ereignis »Auftrag eingereicht«');
  const dateienDb = await sql`select id, slot, size, sha256, storage_key, filename_enc from ddl.order_files where order_id = ${entwurf1} order by slot`;
  const erwartet = { ok: DATEI.ok, uk: DATEI.uk, biss: DATEI.biss };
  pruefen(
    dateienDb.length === 3 &&
      dateienDb.every((f) => f.sha256 === hashVon(erwartet[f.slot]) && statSync(path.join(SPEICHER, f.storage_key)).size === f.size && !f.filename_enc.includes('.stl')),
    'drei Scans vollständig gespeichert (auch 12 MB), Prüfsumme stimmt, Dateiname verschlüsselt',
  );

  // Download mit Data-Access-Log
  const okDatei = dateienDb.find((f) => f.slot === 'ok');
  const antwort = await p.request.get(`${PORTAL}/api/dateien/${okDatei.id}`);
  pruefen(
    antwort.status() === 200 && sha(await antwort.body()) === okDatei.sha256 && /attachment; filename="OK_Pr_fmann\.stl"; filename\*=UTF-8''OK_Pr%C3%BCfmann\.stl/.test(antwort.headers()['content-disposition']),
    'Download: dieselbe Datei, mit Originalnamen, als Anhang',
  );
  const [log] = await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${nutzerA} and action = 'herunterladen' and file_id = ${okDatei.id} and patient_id = ${patient.id}`;
  pruefen(log.n === 1, 'Data-Access-Log: Download mit Patient und Datei');

  // ════ 2. Krone, vorhandener Patient, Biss fehlt → Rückfrage ════
  await p.goto(`${PORTAL}/auftraege/neu`);
  await p.getByLabel('Patient suchen').fill('prüf');
  const treffer = p.getByRole('group', { name: 'Patienten' }).getByRole('button', { name: /Erika Prüfmann/ });
  pruefen(await sichtbar(treffer), 'Patientensuche findet »prüf« → Erika Prüfmann (ohne Umlaut-Probleme)');
  pruefen(await treffer.getByText(/zuletzt Brücke · \d{2}\.\d{2}\.\d{4}/).isVisible(), 'Treffer zeigt die letzte Behandlung');
  await treffer.click();
  await kachel(p, 'Krone').click();
  await schritt(p, 'b-zaehne').getByRole('button', { name: /^Zahn 26:/ }).click();
  await schritt(p, 'b-zaehne').getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(p, 'b-versorgung').getByRole('button', { name: 'Definitiv' }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'Farbe folgt' }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'Weiter', exact: true }).click();
  await kachel(p, 'Fertige Arbeit').click();
  const stufen = await schritt(p, 'tempo').getByRole('group', { name: 'Tempo' }).getByRole('button').allTextContents();
  pruefen(stufen.length === 3 && stufen[1].startsWith('Express < 24 Stunden') && stufen[2].startsWith('Same-Day'), `Krone: Standard, Express < 24 Stunden und Same-Day (${stufen.length})`);
  await schritt(p, 'tempo').getByRole('button', { name: /^Same-Day/ }).click();
  await schritt(p, 'dateien').getByLabel('Oberkiefer-Scan hochladen').setInputFiles(DATEI.uk);
  await schritt(p, 'dateien').getByRole('button', { name: 'Weiter', exact: true }).click();
  pruefen(await sichtbar(schritt(p, 'dateien').getByRole('alert').getByText(/Es fehlen: Unterkiefer-Scan, Bissregistrierung/)), 'fehlender Biss: kein »Weiter«');
  await schritt(p, 'dateien').getByLabel('Daten werden nachgereicht').check();
  await schritt(p, 'dateien').getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(p, 'plan').getByLabel('Behandler').selectOption({ label: 'Dr. Bernd Test' });
  await schritt(p, 'plan').getByRole('button', { name: 'Weiter', exact: true }).click();
  pruefen(await sichtbar(p.getByText(/Noch nicht hochgeladen: Unterkiefer-Scan, Bissregistrierung/)), 'Zusammenfassung nennt die fehlenden Daten');
  pruefen(await p.getByText(/Same-Day-Zuschlag/).first().isVisible() && (await p.getByText(/Expresszuschlag/).count()) === 0, 'Zusammenfassung zeigt den Same-Day-Zuschlag, nicht den Expresszuschlag');
  await p.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Auftrag absenden' && !b.disabled), null, { timeout: 30000 });
  await p.getByRole('button', { name: 'Auftrag absenden' }).click();
  await p.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/, { timeout: 15000 });
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Wir benötigen noch Informationen.' })), 'mit »nachgereicht«: »Wir benötigen noch Informationen.«');
  pruefen(await p.getByText(/Es fehlen noch: Unterkiefer-Scan, Bissregistrierung/).first().isVisible(), 'automatische Meldung nennt, was fehlt');
  const id2 = p.url().split('/').pop();
  const [o2] = await sql`select status, order_no, tempo, price_snapshot, shade from ddl.orders where id = ${id2}`;
  qaNummern.push(o2.order_no);
  pruefen(
    o2.status === 'rueckfrage' && o2.tempo === 'same_day' && o2.price_snapshot.zuschlag && o2.price_snapshot.bearbeitungszeit === 'am selben Werktag' && o2.shade === 'Farbe folgt',
    'Datenbank: Status »Rückfrage«, Same-Day mit eigenem Zuschlag im Preisstand',
  );
  pruefen(await p.getByText('Same-Day', { exact: true }).first().isVisible(), 'Auftragsseite: Kennzeichnung »Same-Day«');
  pruefen(Number(o2.order_no.slice(-4)) === Number(nr1.slice(-4)) + 1, `Auftragsnummern fortlaufend (${nr1} → ${o2.order_no})`);

  // ════ 3. Entwurf verwerfen ════
  await p.goto(`${PORTAL}/auftraege/neu`);
  await p.getByRole('group', { name: 'Patienten' }).getByRole('button', { name: /Erika Prüfmann/ }).click();
  await p.waitForURL(/entwurf=/);
  const entwurf3 = p.url().split('entwurf=')[1];
  await kachel(p, 'Krone').click();
  await p.goto(`${PORTAL}/`); // sofort weg: der letzte Stand geht mit keepalive hinaus
  pruefen(await gespeichert(entwurf3, (o) => o.work_type_key === 'krone'), 'Entwurf auch beim sofortigen Verlassen der Seite gespeichert');
  await p.reload();
  pruefen(await sichtbar(p.getByRole('link', { name: /Erika Prüfmann.*Entwurf · Krone/ })), 'Übersicht: Entwurf mit Behandlung und Patient');
  pruefen(await p.getByRole('link', { name: new RegExp(`${nr1}.*Brücke.*Eingereicht`) }).isVisible(), `Übersicht: ${nr1} mit Status`);
  await bild(p, '06-uebersicht');
  await p.getByRole('link', { name: /Entwurf · Krone/ }).click();
  pruefen(await sichtbar(schritt(p, 'b-zaehne').getByRole('heading', { name: 'Welche Zähne?' })), 'Entwurf öffnet beim nächsten offenen Schritt');
  p.once('dialog', (d) => d.accept());
  await p.getByRole('button', { name: 'Entwurf verwerfen' }).click();
  await p.waitForURL(`${PORTAL}/`);
  const [weg] = await sql`select count(*)::int as n from ddl.orders where id = ${entwurf3}`;
  pruefen(weg.n === 0, 'Entwurf verworfen: aus der Datenbank gelöscht');

  // ════ 4. Trennung der Ordinationen ════
  const { seite: q } = await portalZugang('QA Praxis B', 'qa-auftrag-b@example.invalid', B.id);
  const fremd = [
    (await q.request.get(`${PORTAL}/api/dateien/${okDatei.id}`)).status(),
    (await q.goto(`${PORTAL}/auftraege/${entwurf1}`)).status(),
    (await q.goto(`${PORTAL}/auftraege/neu?entwurf=${entwurf1}`)).status(),
  ];
  const fremdHochladen = await q.evaluate(async (id) => (await fetch(`/api/auftraege/${id}/dateien?platz=ok&name=x.stl`, { method: 'POST', body: 'solid x' })).status, entwurf1);
  pruefen(fremd.every((s) => s === 404) && fremdHochladen === 404, `Ordination B sieht nichts von A (Datei, Auftrag, Entwurf, Upload: ${[...fremd, fremdHochladen].join('/')})`);
  await q.goto(`${PORTAL}/auftraege/neu`);
  pruefen(await sichtbar(q.getByText('Noch keine Patienten angelegt.')), 'Ordination B findet keine Patienten von A');
  const ohneUrsprung = await p.request.post(`${PORTAL}/api/auftraege/${entwurf1}/dateien?platz=ok&name=x.stl`, { data: 'x', headers: { origin: 'http://evil.example' } });
  const ohneSitzung = await fetch(`${PORTAL}/api/dateien/${okDatei.id}`);
  pruefen(ohneUrsprung.status() === 403 && ohneSitzung.status === 401, 'Upload von fremder Seite abgelehnt (403), Download ohne Anmeldung abgelehnt (401)');

  // ════ 5. Telefonauftrag im Labor ════
  const [ich] = await sql`insert into ddl.staff_users (email, name, role) values (${STAFF_MAIL}, 'Test Auftrag', 'buero') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${ich.id}, now() + interval '1 hour')`;
  const s = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-auftrag-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-auftrag-2');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${CRM}/`);
  // »Bereiche« ist ein Tab der Übersicht (seit 25.10.2026)
  await s.goto(`${CRM}/?tab=bereiche`);
  await s.getByRole('main').getByRole('link', { name: /^Neuer Auftrag Für eine Ordination/ }).click();
  await s.waitForURL(`${CRM}/auftraege/neu`);
  await s.getByRole('link', { name: /QA · Auftrag Ordination A/ }).click();
  await s.getByLabel('Patient suchen').fill('erika');
  await s.getByRole('group', { name: 'Patienten' }).getByRole('button', { name: /Erika Prüfmann/ }).click();
  await kachel(s, 'Schiene').click();
  await schritt(s, 'b-kiefer').getByRole('button', { name: 'Oberkiefer', exact: true }).click();
  await schritt(s, 'b-schienenart').getByRole('button', { name: /^Flexibel/ }).click();
  await kachel(s, 'Fertige Arbeit').click();
  await schritt(s, 'tempo').getByRole('button', { name: /^Standard/ }).click();
  await schritt(s, 'dateien').getByLabel('Oberkiefer-Scan hochladen').setInputFiles(DATEI.uk);
  await schritt(s, 'dateien').getByLabel('Unterkiefer-Scan hochladen').setInputFiles(DATEI.biss);
  await schritt(s, 'dateien').getByLabel('Bissregistrierung hochladen').setInputFiles(DATEI.extra);
  await schritt(s, 'dateien').getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(s, 'plan').getByLabel('Behandler').selectOption({ label: 'Dr. Anna Prüf' });
  await schritt(s, 'plan').getByRole('button', { name: 'Weiter', exact: true }).click();
  await s.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Auftrag absenden' && !b.disabled), null, { timeout: 30000 });
  await s.getByRole('button', { name: 'Auftrag absenden' }).click();
  await s.waitForURL(/\/auftraege\/[0-9a-f-]{36}$/, { timeout: 15000 });
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Eingereicht.' })), 'Labor: Telefonauftrag gesendet');
  const id3 = s.url().split('/').pop();
  pruefen((await s.getByText('Erika').count()) === 0 && (await s.getByText(patient.code).count()) > 0, 'Labor-Auftragsseite: nur Patienten-ID, kein Name');
  const [o3] = await sql`select source, created_by_kind, order_no, status from ddl.orders where id = ${id3}`;
  qaNummern.push(o3.order_no);
  pruefen(o3.source === 'labor' && o3.created_by_kind === 'staff' && o3.status === 'eingereicht', 'Datenbank: Quelle »Labor«');
  await s.goto(`${CRM}/`);
  pruefen(await sichtbar(s.getByRole('link', { name: new RegExp(`${o3.order_no}.*Schiene`) })) && (await s.getByText('Erika').count()) === 0, 'interne Übersicht: neue Aufträge ohne Patientennamen');
  await p.goto(`${PORTAL}/`);
  pruefen(await sichtbar(p.getByRole('link', { name: new RegExp(`${o3.order_no}.*Schiene`) })), 'Ordination sieht den Telefonauftrag in ihrer Liste');

  // ════ 6. Ansicht: kein horizontales Scrollen, keine Konsolenfehler ════
  await p.goto(`${PORTAL}/auftraege/neu`);
  await p.getByRole('group', { name: 'Patienten' }).getByRole('button', { name: /Erika Prüfmann/ }).click();
  await p.waitForURL(/entwurf=/);
  await kachel(p, 'Inlay').click();
  await schritt(p, 'b-zaehne').getByRole('button', { name: /^Zahn 36:/ }).click();
  await schritt(p, 'b-zaehne').getByRole('button', { name: 'Weiter', exact: true }).click();
  await schritt(p, 'b-art').getByRole('button', { name: 'Onlay' }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'Farbe folgt' }).click();
  await schritt(p, 'b-farbe').getByRole('button', { name: 'Weiter', exact: true }).click();
  await kachel(p, 'Fertige Arbeit').click();
  await schritt(p, 'tempo').getByRole('button', { name: /^Standard/ }).click();
  await schritt(p, 'dateien').getByLabel('Oberkiefer-Scan hochladen').setInputFiles(DATEI.uk);
  await schritt(p, 'dateien').getByText('UK.stl').waitFor();
  await gespeichert(p.url().split('entwurf=')[1], (o) => o.work_type_key === 'inlay' && o.tempo === 'standard');
  const entwurf4 = p.url().replace(PORTAL, '');
  const zuBreit = [];
  for (const [breite, hoehe] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
    await p.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of ['/', '/auftraege/neu', entwurf4, `/auftraege/${entwurf1}`, `/auftraege/${id2}`]) {
      await p.goto(`${PORTAL}${pfad}`, { waitUntil: 'networkidle' });
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${pfad} ${breite}px: ${w}px`);
    }
    if (breite === 390) {
      await p.goto(`${PORTAL}/auftraege/${entwurf1}`, { waitUntil: 'networkidle' });
      await bild(p, '07-eingegangen-390');
      await p.goto(`${PORTAL}${entwurf4}`, { waitUntil: 'networkidle' });
      await bild(p, '08-dateien-390');
      await p.goto(`${PORTAL}/auftraege/neu`, { waitUntil: 'networkidle' });
      await p.getByLabel('Patient suchen').fill('eri');
      await p.getByRole('group', { name: 'Patienten' }).getByRole('button', { name: /Erika/ }).waitFor();
      await bild(p, '09-patient-390');
    }
  }
  await s.setViewportSize({ width: 390, height: 844 });
  for (const pfad of ['/', '/auftraege/neu', `/auftraege/${id3}`]) {
    await s.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
    const w = await s.evaluate(() => document.documentElement.scrollWidth);
    if (w > 391) zuBreit.push(`intern ${pfad} 390px: ${w}px`);
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (1440 bis 320 px)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 160) : ''}`);
} finally {
  await browser.close();
  // Auftragszähler wie vorher, wenn seither nur QA-Aufträge gezählt wurden
  const hoechste = Math.max(0, ...qaNummern.map((n) => Number(n.slice(-4))));
  if (hoechste) {
    if (zaehlerVorher) await sql`update ddl.number_sequences set last_value = ${zaehlerVorher.last_value} where scope = 'auftrag' and year = ${jahr} and last_value = ${hoechste}`;
    else await sql`delete from ddl.number_sequences where scope = 'auftrag' and year = ${jahr} and last_value = ${hoechste}`;
  }
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
