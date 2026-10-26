// آزمون درخواست‌های «Praxisportal-Zugang» از فرم تماس سایت در Chrome: یک سایت ساختگی روی پورت ۳۱۹۷ مثل
// `/api/lab-leads` سایت واقعی (صفحه‌بندی، کلید، PATCH وضعیت). worker آزمون هر چند ثانیه می‌خواند (`scripts/qa.mjs`).
// بررسی: فقط پورتال و فقط «new»، Übersicht و منو، فهرست در «Ordinationen»، کپی ایمیل، «Einladen» همین‌جا (ایمیل
// دعوت، وضعیت به سایت)، «Erledigt»، رسیدگی یا حذف روی سایت، Einladung از صفحهٔ Ordination، «Jetzt abrufen»، کلید
// نادرست، ۱۸۰ روز، «Neue Ordination» با ایمیل و تلفن، Techniker، audit و موبایل.
// دادهٔ آزمایشی: «QA · Anfragen …»، @example.invalid؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-anfragen  (محیط جدای آزمون)
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const BILDER = process.env.QA_BILDER ?? null;
const MAILPIT = process.env.QA_MAILPIT ?? 'http://localhost:8025';
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
async function warten(f, timeout = 20000) {
  const ende = Date.now() + timeout;
  while (Date.now() < ende) {
    const r = await f();
    if (r) return r;
    await new Promise((x) => setTimeout(x, 300));
  }
  return null;
}
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
const text = async (loc) => (await loc.innerText()).replace(/\s/g, ' ');

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

// ── die nachgebaute Website ──
const SCHLUESSEL = process.env.WEBSITE_ANFRAGEN_TOKEN;
const ADRESSE = new URL(process.env.WEBSITE_ANFRAGEN_URL ?? 'http://127.0.0.1:3197/api/lab-leads');
const STAFF = ['test-anfragen@example.invalid', 'test-anfragen-tech@example.invalid'];
const PRAXIS_MAIL = 'qa-anfrage-praxis@example.invalid';
const lead = (nr, x = {}) => ({
  id: randomUUID(),
  created_at: Date.now() - nr * 60_000,
  request_type: 'portal',
  first_name: 'QA',
  last_name: `Anfrage ${nr}`,
  email: `qa-anfrage-${nr}@example.invalid`,
  phone: '',
  status: 'new',
  consent_at: Date.now(),
  ...x,
});
const website = {
  leads: [
    lead(1, { phone: '+43 1 555 01 01' }),
    lead(2, { request_type: 'cooperation' }),
    lead(3, { status: 'closed' }),
    lead(4, { email: PRAXIS_MAIL, first_name: 'Dr. Paula', last_name: 'Praxis' }),
  ],
  patches: [],
  abrufe: 0,
  schluesselFalsch: false,
};
const server = createServer((req, res) => {
  const url = new URL(req.url, ADRESSE);
  const antwort = (status, daten) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(daten));
  };
  if (url.pathname !== ADRESSE.pathname) return antwort(404, { error: 'Nicht gefunden.' });
  if (website.schluesselFalsch || req.headers.authorization !== `Bearer ${SCHLUESSEL}`) return antwort(401, { error: 'Nicht freigegeben.' });
  if (req.method === 'PATCH') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const id = url.searchParams.get('id');
      const l = website.leads.find((x) => x.id === id);
      website.patches.push({ id, status: JSON.parse(body).status });
      if (!l) return antwort(404, { error: 'Anfrage nicht gefunden.' });
      l.status = JSON.parse(body).status;
      antwort(200, { ok: true });
    });
    return;
  }
  website.abrufe++;
  // wie die Website: Suche über Anliegen, Name und E-Mail; hier 2 pro Seite, damit das Blättern geprüft wird
  const q = (url.searchParams.get('q') ?? '').toLowerCase();
  const treffer = website.leads.filter((l) => !q || `${l.request_type} ${l.first_name} ${l.last_name} ${l.email} ${l.phone}`.toLowerCase().includes(q)).sort((a, b) => b.created_at - a.created_at);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  antwort(200, { items: treffer.slice(offset, offset + 2), hasMore: treffer.length > offset + 2 });
});

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Anfragen%'`).map((r) => r.id);
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  const anfragen = (await sql`select id from ddl.portal_anfragen where email like 'qa-anfrage%@example.invalid'`).map((r) => r.id);
  if (anfragen.length) {
    await sql`delete from ddl.jobs where type = 'website_anfrage_status' and payload->>'id' in ${sql(anfragen)}`;
    await sql`delete from ddl.audit_log where target_id in ${sql(anfragen)}`;
    await sql`delete from ddl.portal_anfragen where id in ${sql(anfragen)}`;
  }
  if (staff.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(staff)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(staff)}`;
  }
  if (praxen.length) {
    const nutzer = (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (nutzer.length) await sql`delete from ddl.one_time_tokens where user_id in ${sql(nutzer)}`;
    await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  }
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.jobs where type = 'website_anfragen_abrufen'`;
  const ids = [];
  for (const an of [PRAXIS_MAIL, ...[1, 4, 5, 6, 7, 8].map((n) => `qa-anfrage-${n}@example.invalid`)]) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${an}"`)}&limit=50`).then((x) => x.json(), () => ({}));
    ids.push(...(r.messages ?? []).map((m) => m.ID));
  }
  if (ids.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
}

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
async function anmelden(email, name, rolle, viewport = { width: 1440, height: 900 }) {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${email}, ${name}, ${rolle}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const ctx = await browser.newContext({ viewport });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: CRM });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-anfragen-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-anfragen-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return s;
}
const anfrage = async (email) => (await sql`select * from ddl.portal_anfragen where email = ${email}`)[0] ?? null;
const patch = (id, status) => warten(async () => website.patches.find((p) => p.id === id && p.status === status));

try {
  if (!SCHLUESSEL) throw new Error('WEBSITE_ANFRAGEN_TOKEN fehlt: bitte über »pnpm qa qa-anfragen« starten.');
  await aufraeumen();
  await new Promise((ok) => server.listen(Number(ADRESSE.port), ADRESSE.hostname, ok));
  const [A] = await sql`insert into ddl.practices (customer_no, name, email, billing_mode) values ('QA-AN1', 'QA · Anfragen Ordination', ${PRAXIS_MAIL}, 'sammel') returning id`;

  // ════ Abruf durch den Worker ════
  const [l1, l2, l3, l4] = website.leads;
  pruefen(Boolean(await warten(async () => (await sql`select count(*)::int as n from ddl.portal_anfragen where email like 'qa-anfrage%'`)[0].n === 2)), 'Worker holt die Anfragen: nur Praxisportal und nur »new« (2 von 4), über zwei Seiten');
  pruefen(!(await anfrage(l2.email)) && !(await anfrage(l3.email)), 'Zusammenarbeit und auf der Website schon erledigte nicht übernommen');
  const a1 = await anfrage(l1.email);
  pruefen(a1?.id === l1.id && a1.vorname === 'QA' && a1.nachname === 'Anfrage 1' && a1.telefon === '+43 1 555 01 01' && a1.status === 'neu', 'Datenbank: Name, E-Mail, Telefon, Status »neu«, gleiche ID wie auf der Website');

  const s = await anmelden(STAFF[0], 'Test Anfragen', 'inhaber');

  // ════ Übersicht und Menü ════
  const hinweis = s.getByRole('link', { name: /2 neue Anfragen für das Praxisportal/ });
  pruefen(await sichtbar(hinweis), 'Übersicht: »2 neue Anfragen für das Praxisportal« ganz oben');
  pruefen((await text(hinweis)).includes('QA Anfrage 1') && (await text(hinweis)).includes('Dr. Paula Praxis'), 'Übersicht: mit den Namen');
  pruefen((await s.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Einstellungen/ }).innerText()).replace(/\s/g, '') === 'Einstellungen2', 'Menü: »Einstellungen« mit der Zahl 2');
  await s.goto(`${CRM}/einstellungen`);
  pruefen((await s.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link', { name: /Ordinationen/ }).innerText()).replace(/\s/g, '') === 'Ordinationen2', 'Tab »Ordinationen« mit der Zahl 2');
  await s.goto(`${CRM}/`);
  await bild(s, 'an1-uebersicht');
  if (BILDER) await s.screenshot({ path: path.join(BILDER, 'an1-oben.png') });

  // ════ Liste unter »Ordinationen« ════
  await hinweis.click();
  await s.waitForURL(/\/ordinationen/);
  const liste = s.getByRole('list', { name: 'Anfragen für das Praxisportal' });
  pruefen(await sichtbar(s.getByRole('heading', { name: '2 Anfragen für das Praxisportal.' })), 'Ordinationen: Abschnitt »2 Anfragen für das Praxisportal.«');
  const t0 = await text(liste);
  pruefen(t0.includes(l1.email) && t0.includes('+43 1 555 01 01') && t0.includes(PRAXIS_MAIL) && !t0.includes(l2.email) && !t0.includes(l3.email), 'Liste: E-Mail und Telefon, ohne Zusammenarbeit und Erledigte');
  const zeile = (email) => liste.getByRole('listitem').filter({ hasText: email });
  pruefen((await text(zeile(PRAXIS_MAIL))).includes('Gleiche E-Mail wie die Ordination QA · Anfragen Ordination'), 'Hinweis: gleiche E-Mail wie eine bestehende Ordination');
  pruefen((await text(s.locator('#anfragen'))).includes('Zuletzt von der Website abgerufen'), 'Stand: »Zuletzt von der Website abgerufen …«');
  await zeile(l1.email).getByRole('button', { name: 'E-Mail kopieren' }).click();
  pruefen((await sichtbar(zeile(l1.email).getByRole('button', { name: 'Kopiert' }))) && (await s.evaluate(() => navigator.clipboard.readText())) === l1.email, 'E-Mail kopieren: Adresse in der Zwischenablage');
  await bild(s, 'an2-liste');
  if (BILDER) {
    await zeile(PRAXIS_MAIL).getByText('Einladen', { exact: true }).click();
    await s.screenshot({ path: path.join(BILDER, 'an2-einladen.png'), fullPage: true });
    await zeile(PRAXIS_MAIL).getByText('Einladen', { exact: true }).click();
  }

  // ════ Neue Ordination: vorausgefüllt ════
  const neuLink = zeile(l1.email).getByRole('link', { name: 'Neue Ordination ↗' });
  const neuHref = await neuLink.getAttribute('href');
  await s.goto(`${CRM}${neuHref}`);
  pruefen((await s.getByLabel('E-Mail der Ordination').inputValue()) === l1.email && (await s.getByLabel('Telefon').inputValue()) === '+43 1 555 01 01', '»Neue Ordination ↗«: E-Mail und Telefon aus der Anfrage');

  // ════ Einladen direkt bei der Anfrage ════
  await s.goto(`${CRM}/ordinationen`);
  await zeile(l1.email).getByText('Einladen', { exact: true }).click();
  const form = s.getByRole('form', { name: 'QA Anfrage 1 einladen' });
  pruefen((await form.getByLabel('Name').inputValue()) === 'QA Anfrage 1' && (await form.getByLabel('E-Mail-Adresse').inputValue()) === l1.email, 'Einladen: Name und E-Mail aus der Anfrage vorausgefüllt');
  await form.getByRole('button', { name: 'Zum Portal einladen' }).click();
  pruefen((await form.getByLabel('Ordination').evaluate((el) => el.validity.valueMissing)) && !(await sql`select 1 from ddl.practice_users where email = ${l1.email}`).length, 'ohne Ordination: nicht abgeschickt (Pflichtfeld)');
  await form.getByLabel('Ordination').selectOption(A.id);
  const ab = Date.now() - 2000;
  await form.getByRole('button', { name: 'Zum Portal einladen' }).click();
  pruefen(await sichtbar(s.getByText(`Einladung an ${l1.email} wurde verschickt.`)), 'Einladung verschickt: Meldung bleibt oben');
  const [zugang] = await sql`select * from ddl.practice_users where email = ${l1.email}`;
  const a1b = await anfrage(l1.email);
  pruefen(zugang?.practice_id === A.id && zugang.role === 'praxis_admin' && a1b.status === 'eingeladen' && a1b.practice_user_id === zugang.id && a1b.erledigt_von_label === 'Test Anfragen', 'Datenbank: Portal-Zugang bei der Ordination, Anfrage »eingeladen« mit Verweis');
  const mail = await warten(async () => {
    const r = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${l1.email}`)}`)).json();
    return r.messages?.find((m) => m.Subject === 'Ihr Zugang zum Portal von Digital Dental Lab' && Date.parse(m.Created) >= ab) ?? null;
  });
  pruefen(Boolean(mail), 'Einladungs-E-Mail kommt an');
  pruefen(Boolean(await patch(l1.id, 'contacted')), 'Website: Status »contacted« (Evaluation zeigt »kontaktiert«)');
  pruefen(!(await text(liste)).includes(l1.email), 'eingeladene Anfrage verschwindet aus der Liste');

  // ════ Erledigt ohne Einladung ════
  await zeile(PRAXIS_MAIL).getByRole('button', { name: 'Erledigt, ohne Einladung' }).click();
  pruefen(await sichtbar(s.getByText(`Anfrage von ${PRAXIS_MAIL} als erledigt markiert.`)), 'Erledigt: Meldung');
  pruefen((await anfrage(PRAXIS_MAIL))?.status === 'erledigt' && Boolean(await patch(l4.id, 'closed')), 'Datenbank »erledigt«, Website »closed«');
  await s.reload();
  pruefen(await sichtbar(s.getByText(/Keine offenen Anfragen für das Praxisportal/)), 'keine offenen Anfragen: nur eine Zeile, Menü ohne Zahl');
  pruefen((await s.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: /Einstellungen/ }).innerText()).trim() === 'Einstellungen', 'Menü: »Einstellungen« ohne Zahl');
  const audit = await sql`select action from ddl.audit_log where target_id in ${sql([l1.id, l4.id])} order by created_at`;
  pruefen(audit.map((x) => x.action).join(',') === 'portal_anfrage_eingeladen,portal_anfrage_erledigt', 'Audit: eingeladen und erledigt');

  // ════ auf der Website bearbeitet oder gelöscht ════
  const l5 = lead(5);
  const l6 = lead(6);
  website.leads.push(l5, l6);
  pruefen(Boolean(await warten(async () => (await anfrage(l5.email))?.status === 'neu' && (await anfrage(l6.email))?.status === 'neu')), 'neue Anfragen kommen von selbst nach (alle paar Sekunden im Test, sonst 5 Minuten)');
  l5.status = 'closed';
  website.leads = website.leads.filter((l) => l !== l6);
  pruefen(Boolean(await warten(async () => (await anfrage(l5.email))?.erledigt_von_label === 'Website (Evaluation)' && (await anfrage(l6.email))?.erledigt_von_label === 'Auf der Website gelöscht')), 'auf der Website erledigt oder gelöscht: im CRM »erledigt«');

  // ════ Einladung über die Ordinationsseite schließt die Anfrage ════
  const l7 = lead(7, { first_name: 'Sieben' });
  website.leads.push(l7);
  await warten(async () => (await anfrage(l7.email))?.status === 'neu');
  await s.goto(`${CRM}/ordinationen/${A.id}?tab=zugaenge`);
  const einladen = s.locator('form', { has: s.getByRole('button', { name: 'Zum Portal einladen' }) });
  await einladen.locator('input[name="name"]').fill('Sieben Anfrage');
  await einladen.getByLabel('E-Mail-Adresse').fill(l7.email.toUpperCase());
  await einladen.getByRole('button', { name: 'Zum Portal einladen' }).click();
  await sichtbar(s.getByText(`Einladung an ${l7.email} wurde verschickt.`));
  pruefen((await anfrage(l7.email))?.status === 'eingeladen' && Boolean(await patch(l7.id, 'contacted')), 'Einladung auf der Ordinationsseite (gleiche Adresse): Anfrage »eingeladen«, Website »contacted«');

  // ════ Jetzt abrufen, falscher Schlüssel, 180 Tage ════
  await sql`insert into ddl.portal_anfragen (id, eingegangen_am, vorname, nachname, email, website_status, status) values (${randomUUID()}, now() - interval '200 days', 'Alt', 'Anfrage', 'qa-anfrage-alt@example.invalid', 'closed', 'erledigt')`;
  website.schluesselFalsch = true;
  await s.goto(`${CRM}/ordinationen`);
  await s.getByRole('button', { name: 'Jetzt abrufen' }).click();
  pruefen(await sichtbar(s.getByText('Wird abgerufen … Die Seite in einigen Sekunden neu laden.')), '»Jetzt abrufen«: Meldung');
  pruefen(Boolean(await warten(async () => (await sql`select value from ddl.settings where key = 'website_abruf'`)[0]?.value?.ok === false)), 'falscher Schlüssel: Abruf als fehlgeschlagen gemerkt');
  await s.reload();
  pruefen(await sichtbar(s.getByText(/Abruf von der Website fehlgeschlagen .*Schlüssel nicht angenommen/)), 'Ordinationen: Fehler mit Hinweis auf »ddl website« sichtbar');
  website.schluesselFalsch = false;
  pruefen(Boolean(await warten(async () => !(await anfrage('qa-anfrage-alt@example.invalid')))), 'nach 180 Tagen gelöscht (wie auf der Website)');

  // ════ Rechte und Handy ════
  website.leads.push(lead(8));
  await warten(async () => (await anfrage('qa-anfrage-8@example.invalid'))?.status === 'neu');
  const t = await anmelden(STAFF[1], 'Test Technik', 'techniker');
  await t.goto(`${CRM}/ordinationen`);
  pruefen((await t.locator('#anfragen').count()) === 0 && !(await text(t.getByRole('main'))).includes('qa-anfrage-8'), 'Techniker: keine Anfragen');
  const h = await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await s.context().storageState() })).newPage();
  await h.goto(`${CRM}/ordinationen`);
  await sichtbar(h.getByRole('list', { name: 'Anfragen für das Praxisportal' }));
  pruefen(await h.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Handy: kein seitliches Scrollen');
  await bild(h, 'an3-handy');

  pruefen(!konsole.length, `keine Fehler in der Konsole${konsole.length ? `: ${konsole.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  fehler++;
} finally {
  await browser.close();
  server.close();
  await aufraeumen();
  await sql.end();
}
console.log(fehler ? `\n✗ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✓ alles in Ordnung');
process.exit(fehler ? 1 : 0);
