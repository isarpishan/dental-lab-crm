// آزمون «Vereinbarung zu Datenschutz und Portalnutzung» در Chrome، مثل یک مطب واقعی: پورتال تا پذیرش
// بسته است (صفحه‌ها و API)، Mitarbeiter فقط می‌خواند، Praxis-Admin بعد از خواندن تا انتها و تیک
// می‌پذیرد، متن دست‌کاری‌شده رد می‌شود، ثبت در دیتابیس و audit، ایمیل تأیید (Mailpit)، PDF در پورتال و
// CRM، جدایی Ordinationها، قفل دیتابیس، و ظاهر در موبایل.
// دادهٔ آزمایشی: «QA · Vereinbarung …»، @example.invalid؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-vereinbarung  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL, VEREINBARUNG_VERSION, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

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
const BILDER = process.env.QA_BILDER ?? null;
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
const pdfLesen = (datei) => JSON.parse(execFileSync('swift', ['scripts/qa-pdf.swift', datei], { maxBuffer: 10_000_000 }).toString());

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

const STAFF_MAIL = 'test-vereinbarung@example.invalid';
const ADMIN = 'qa-vereinbarung-admin@example.invalid';
const MITARBEITER = 'qa-vereinbarung-ma@example.invalid';
const PRAXIS_MAIL = 'qa-vereinbarung-praxis@example.invalid';
const BETREFF = 'Bestätigung: Vereinbarung zu Datenschutz und Portalnutzung';

const MAILPIT = process.env.QA_MAILPIT ?? 'http://localhost:8025';
/** ایمیل‌های قبلی همین آزمون در Mailpit، تا شمارش هر بار از صفر باشد. */
async function mailsLoeschen() {
  for (const an of [ADMIN, MITARBEITER, PRAXIS_MAIL]) {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${an}"`)}&limit=200`)).json();
    const ids = (r.messages ?? []).map((x) => x.ID);
    if (ids.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
  }
}

async function aufraeumen() {
  await mailsLoeschen();
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Vereinbarung%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email = ${STAFF_MAIL}`).map((r) => r.id);
  const akteure = [...nutzer, ...staff];
  if (akteure.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
  }
  await sql`delete from ddl.jobs where type = 'email_senden' and payload->>'an' in ${sql([ADMIN, MITARBEITER, PRAXIS_MAIL])}`;
  await vereinbarungenLoeschen(sql, praxen);
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
}
await aufraeumen();

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  return s;
};
/** دعوت و ساختن رمز؛ بعد از آن پورتال خودش به /vereinbarung می‌رود (مگر Ordination پذیرفته باشد). */
async function einrichten(praxisId, email, name, rolle, ziel = '/vereinbarung') {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, ${rolle}, now()) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-vereinbarung-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-vereinbarung-1');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  // server action به «/» می‌رود و «/» بعد به /vereinbarung؛ صبر تا مقصد نهایی
  await s.waitForURL(`${PORTAL}${ziel}`).catch(() => {});
  return { s, id: u.id };
}
async function mails(an) {
  for (let i = 0; i < 20; i++) {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${an} subject:"${BETREFF}"`)}`)).json();
    if (r.messages?.length) return r.messages;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return [];
}

try {
  const [A] = await sql`insert into ddl.practices (customer_no, name, street, zip, city, email) values ('QA-VA', 'QA · Vereinbarung Ordination', 'Vertragsgasse 4', '1200', 'Wien', ${PRAXIS_MAIL}) returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name) values ('QA-VB', 'QA · Vereinbarung Ordination B') returning id`;
  const [C] = await sql`insert into ddl.practices (customer_no, name) values ('QA-VC', 'QA · Vereinbarung Ordination C') returning id`;

  // ════ Mitarbeiter: liest nur, Portal bleibt zu ════
  const { s: m } = await einrichten(A.id, MITARBEITER, 'Qa Mitarbeiterin', 'mitarbeiter');
  pruefen(new URL(m.url()).pathname === '/vereinbarung', 'nach dem Einrichten: zuerst die Vereinbarung');
  pruefen(await sichtbar(m.getByRole('heading', { name: 'Bevor es losgeht.' })), 'Seite »Bevor es losgeht.«');
  pruefen(await m.getByRole('region', { name: 'Text der Vereinbarung' }).getByText('§ 2 Rollen der Parteien').isVisible(), 'Vereinbarungstext sichtbar');
  pruefen(await m.getByText('Vertragsgasse 4, 1200 Wien').first().isVisible(), 'Text nennt Name und Adresse der Ordination');
  pruefen((await m.getByRole('button', { name: 'Vereinbarung annehmen' }).count()) === 0, 'Mitarbeiter: kein »Vereinbarung annehmen«');
  pruefen(await m.getByText(/Annehmen kann nur ein Praxis-Admin/).isVisible(), 'Mitarbeiter: Hinweis auf den Praxis-Admin');
  await bild(m, 'v1-mitarbeiter');
  pruefen((await m.getByRole('navigation').getByRole('link', { name: 'Neuer Auftrag' }).count()) === 0, 'kein Portal-Menü vor der Annahme');
  for (const pfad of ['/', '/auftraege/neu', '/einstellungen', '/abholung']) {
    await m.goto(`${PORTAL}${pfad}`);
    if (new URL(m.url()).pathname !== '/vereinbarung') pruefen(false, `${pfad} öffnet sich vor der Annahme`);
  }
  pruefen(true, 'alle Portal-Seiten führen vor der Annahme zur Vereinbarung');
  const api = await m.request.get(`${PORTAL}/api/dateien/${randomUUID()}`);
  pruefen(api.status() === 401, `API vor der Annahme gesperrt (${api.status()})`);

  // ════ Praxis-Admin: lesen bis zum Ende, Häkchen, annehmen ════
  const { s: p } = await einrichten(A.id, ADMIN, 'Dr. Qa Admin', 'praxis_admin');
  pruefen(new URL(p.url()).pathname === '/vereinbarung', 'Praxis-Admin: zuerst die Vereinbarung');
  const knopf = p.getByRole('button', { name: 'Vereinbarung annehmen' });
  const haken = p.getByLabel(/Ich habe die Vereinbarung gelesen/);
  pruefen((await knopf.isDisabled()) && (await haken.isDisabled()), 'vor dem Lesen: Häkchen und Knopf gesperrt');
  pruefen(await p.getByText('Bitte lesen Sie die Vereinbarung bis zum Ende.').isVisible(), 'Hinweis »bis zum Ende lesen«');
  await bild(p, 'v2-admin-vorher');

  // ظاهر موبایل پیش از پذیرش
  const zuBreit = [];
  for (const breite of [390, 320]) {
    await p.setViewportSize({ width: breite, height: 800 });
    await p.reload({ waitUntil: 'networkidle' });
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    if (w > breite + 1) zuBreit.push(`${breite}px: ${w}px`);
    await bild(p, `v3-mobil-${breite}`);
  }
  pruefen(!zuBreit.length, `Vereinbarung ohne horizontales Scrollen (390 und 320 px)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.reload({ waitUntil: 'networkidle' });

  const kasten = p.getByRole('region', { name: 'Text der Vereinbarung' });
  await kasten.evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await haken.waitFor({ state: 'attached' });
  pruefen(await sichtbar(p.locator('input[name="gelesen"]:not([disabled])')), 'nach dem Lesen bis zum Ende: Häkchen frei');
  pruefen(await knopf.isDisabled(), 'ohne Häkchen: Knopf noch gesperrt');
  await haken.check();
  pruefen(await knopf.isEnabled(), 'mit Häkchen: Knopf frei');
  await bild(p, 'v4-admin-bereit');

  // متنی که کاربر ندیده: sha256 دست‌کاری‌شده رد می‌شود
  await p.locator('input[name="sha256"]').evaluate((e) => (e.value = 'a'.repeat(64)));
  await knopf.click();
  pruefen(await sichtbar(p.getByText('Die Vereinbarung wurde inzwischen aktualisiert. Bitte lesen Sie die neue Fassung.')), 'veränderter Text wird abgelehnt');
  const [{ n: keine }] = await sql`select count(*)::int as n from ddl.practice_agreements where practice_id = ${A.id}`;
  pruefen(keine === 0, 'Datenbank: nichts gespeichert');

  await p.reload({ waitUntil: 'networkidle' });
  await kasten.evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await p.locator('input[name="gelesen"]:not([disabled])').waitFor();
  await haken.check();
  await knopf.click();
  await p.waitForURL(`${PORTAL}/`);
  pruefen(await sichtbar(p.getByRole('heading', { name: /Guten Tag/ })), 'nach der Annahme: Portal-Übersicht');
  pruefen(await p.getByRole('navigation').getByRole('link', { name: 'Neuer Auftrag' }).isVisible(), 'Portal-Menü ist da');

  const [a] = await sql`select * from ddl.practice_agreements where practice_id = ${A.id}`;
  pruefen(
    a?.version === VEREINBARUNG_VERSION && /^[0-9a-f]{64}$/.test(a.sha256) && a.accepted_by_email === ADMIN && a.inhalt?.praxis?.name === 'QA · Vereinbarung Ordination' && a.inhalt?.abschnitte?.length >= 12,
    'Datenbank: Version, Prüfsumme, wer, und der vollständige Text mit den Parteien',
  );
  const [audit] = await sql`select count(*)::int as n from ddl.audit_log where action = 'vereinbarung_angenommen' and target_id = ${A.id}`;
  pruefen(audit.n === 1, 'Audit-Log: »Vereinbarung angenommen«');

  // Mitarbeiter darf jetzt auch
  await m.goto(`${PORTAL}/`);
  pruefen(new URL(m.url()).pathname === '/' && (await sichtbar(m.getByRole('heading', { name: /Guten Tag/ }))), 'Mitarbeiter: Portal nach der Annahme offen');
  await p.goto(`${PORTAL}/vereinbarung`);
  pruefen(new URL(p.url()).pathname === '/', '/vereinbarung nach der Annahme → Übersicht');

  // Bestätigung per E-Mail an die Person und an die Ordination
  const [anAdmin, anPraxis, anMa] = [await mails(ADMIN), await mails(PRAXIS_MAIL), MITARBEITER];
  pruefen(anAdmin.length === 1 && anPraxis.length === 1, 'Bestätigung per E-Mail an Praxis-Admin und Ordination (Mailpit)');
  const [{ n: maMails }] = await sql`select count(*)::int as n from ddl.jobs where type = 'email_senden' and payload->>'an' = ${anMa}`;
  pruefen(maMails === 0, 'keine Bestätigung an andere Zugänge');

  // Einstellungen + PDF
  await p.goto(`${PORTAL}/einstellungen?tab=vereinbarung`);
  pruefen(await sichtbar(p.getByText(`Version ${VEREINBARUNG_VERSION}`)) && (await p.getByText(/angenommen am .* von Dr\. Qa Admin/).isVisible()), 'Einstellungen: Version, Datum, wer');
  await bild(p, 'v5-einstellungen');
  const href = await p.getByRole('link', { name: 'Als PDF öffnen ↗' }).getAttribute('href');
  const pdfAntwort = await p.request.get(`${PORTAL}${href}`);
  pruefen(pdfAntwort.ok() && pdfAntwort.headers()['content-type'] === 'application/pdf', 'PDF im Portal');
  const datei = path.join(tmpdir(), 'ddl-qa-vereinbarung.pdf');
  writeFileSync(datei, await pdfAntwort.body());
  const pdf = pdfLesen(datei);
  if (BILDER) execFileSync('swift', ['scripts/qa-pdf.swift', datei, path.join(BILDER, 'v7-pdf-seite1.png')]);
  const text = pdf.text.replace(/\s+/g, ' ');
  pruefen(
    // عنوان‌های کوچک PDF با حروف بزرگ چاپ می‌شوند
    ['Vereinbarung zu Datenschutz und Portalnutzung', 'QA · Vereinbarung Ordination', 'Elektronisch angenommen', ADMIN, a.sha256, 'Anlage 2'].every((t) => text.toLowerCase().includes(t.toLowerCase())),
    `PDF: Titel, Ordination, Annahme mit Person und Prüfsumme (${pdf.seiten} Seiten)`,
  );

  // جدایی Ordinationها: B فقط PDF خودش را می‌بیند
  const [nutzerB] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${B.id}, 'qa-vereinbarung-b@example.invalid', 'Qa B', 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, B.id, nutzerB.id);
  const tokenB = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(tokenB)}, 'einladung', 'practice', ${nutzerB.id}, now() + interval '1 hour')`;
  const b = await neueSeite();
  await b.goto(`${PORTAL}/einladung/${tokenB}`);
  await b.getByLabel('Neues Passwort').fill('test-passwort-vereinbarung-2');
  await b.getByLabel('Passwort wiederholen').fill('test-passwort-vereinbarung-2');
  await b.getByRole('button', { name: 'Zugang einrichten' }).click();
  await b.waitForURL(`${PORTAL}/`);
  const fremd = await b.request.get(`${PORTAL}/api/vereinbarung/${a.id}`);
  pruefen(fremd.status() === 404, `andere Ordination: fremde Vereinbarung nicht abrufbar (${fremd.status()})`);

  // ════ Labor (CRM) ════
  const [ich] = await sql`insert into ddl.staff_users (email, name, role) values (${STAFF_MAIL}, 'Test Vereinbarung', 'buero') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${ich.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-vereinbarung-3');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-vereinbarung-3');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${CRM}/`);
  await s.goto(`${CRM}/ordinationen/${A.id}?tab=vereinbarung`);
  const abschnitt = s.getByRole('region', { name: 'Vereinbarung', exact: true });
  pruefen(
    (await sichtbar(abschnitt)) && (await abschnitt.getByText(new RegExp(`angenommen am .* von Dr\\. Qa Admin \\(${ADMIN.replace('.', '\\.')}\\)`)).isVisible()),
    'CRM: Ordination zeigt die angenommene Vereinbarung',
  );
  await abschnitt.scrollIntoViewIfNeeded();
  await bild(s, 'v6-crm-ordination');
  const crmHref = await abschnitt.getByRole('link', { name: 'PDF öffnen ↗' }).getAttribute('href');
  const crmPdf = await s.request.get(`${CRM}${crmHref}`);
  pruefen(crmPdf.ok() && crmPdf.headers()['content-type'] === 'application/pdf', 'CRM: PDF abrufbar');
  await s.goto(`${CRM}/ordinationen/${C.id}`);
  const reiter = s.getByRole('navigation', { name: 'Bereiche der Ordination' }).getByRole('link', { name: /^Vereinbarung/ });
  pruefen((await reiter.innerText()).includes('offen'), 'CRM: Tab »Vereinbarung« zeigt »offen«, solange nicht angenommen');
  await reiter.click();
  pruefen(await sichtbar(abschnitt.getByText(`Version ${VEREINBARUNG_VERSION} noch nicht angenommen`, { exact: false })), 'CRM: »noch nicht angenommen« bei einer neuen Ordination');

  // ════ قفل دیتابیس ════
  const gesperrt = async (f) => {
    try {
      await f();
      return false;
    } catch (e) {
      return /unveränderlich/.test(String(e.message));
    }
  };
  pruefen(await gesperrt(() => sql`update ddl.practice_agreements set version = 'x' where id = ${a.id}`), 'Datenbank: Annahme lässt sich nicht ändern');
  pruefen(await gesperrt(() => sql`delete from ddl.practice_agreements where id = ${a.id}`), 'Datenbank: Annahme lässt sich nicht löschen');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
