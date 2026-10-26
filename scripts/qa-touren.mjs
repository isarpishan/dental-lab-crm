// آزمون قدم ۹ در Chrome: تقویم و تورها.
// Büro: تور تازه (بدون روز ← پیام)، Ordinationها در مسیر و ترتیب، Tagesplan، «Fertig, ohne Tour»، Abholwunsch einplanen.
// Kalender: ماه، هفته، فیلتر، überfällig، گوشی. پورتال: «Abholung anfordern» (خودکار eingeplant / offen)، لینک در Einprobe،
// روز تور در «Versendet»، جدایی Ordinationها. Fahrer: فقط «Meine Tour»، بدون دادهٔ بیمار، «Zugestellt» و «Abgeholt».
// دادهٔ آزمایشی («QA · …»، @example.invalid، تور «QA …») در پایان کامل پاک می‌شود.
// اجرا: pnpm qa qa-touren  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const BILDER = process.env.QA_BILDER ?? null;
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
const plus = (d, n) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const kurz = (d) => `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${d}T00:00:00Z`).getUTCDay()]}, ${d.slice(8)}.${d.slice(5, 7)}.`;
const morgen = plus(heute, 1);

const STAFF = ['test-touren-buero@example.invalid', 'test-touren-fahrer@example.invalid'];
const NAME = { vor: 'Toni', nach: 'Wegmayr' };

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Tour%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  if (praxen.length) {
    await sql`delete from ddl.pickup_requests where practice_id in ${sql(praxen)}`;
    await sql`delete from ddl.orders where practice_id in ${sql(praxen)}`;
    await sql`delete from ddl.patients where practice_id in ${sql(praxen)}`;
  }
  await sql`delete from ddl.tours where name like 'QA %'`;
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
const zaehlerVorher = await sql`select scope, year, last_value from ddl.number_sequences order by scope, year`;
const touren = (await sql`select count(*)::int as n from ddl.tours`)[0].n;
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-touren-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-touren-1');
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-touren-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-touren-2');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}
const status = async (id) => (await sql`select status from ddl.orders where id = ${id}`)[0].status;

try {
  // ── Daten ──
  const praxis = async (kurz, name, extra = {}) =>
    (await sql`insert into ddl.practices (customer_no, name, street, zip, city, phone, delivery_notes)
      values (${kurz}, ${name}, ${extra.strasse ?? null}, ${extra.plz ?? null}, ${extra.ort ?? null}, ${extra.tel ?? null}, ${extra.hinweis ?? null}) returning id`)[0];
  const A = await praxis('QA-TA', 'QA · Tour Ordination A', { strasse: 'Teststraße 1', plz: '1200', ort: 'Wien', tel: '+43 1 000 00 00', hinweis: 'Hintereingang, 2. Stock' });
  const B = await praxis('QA-TB', 'QA · Tour Ordination B', { ort: 'Wien' });
  await praxis('QA-TC', 'QA · Tour Ordination C', { strasse: 'Probegasse 9', plz: '1020', ort: 'Wien' });
  const { s: p, id: nutzerA } = await portalZugang('Dr. Qa Tour', 'qa-tour-a@example.invalid', A.id);
  const [pat] = await sql`insert into ddl.patients (practice_id, code, first_name_enc, last_name_enc, created_by_kind, created_by_id)
    values (${A.id}, 'P-QAT1', ${verschluesseln(NAME.vor)}, ${verschluesseln(NAME.nach)}, 'practice', ${nutzerA}) returning id`;
  const [patB] = await sql`insert into ddl.patients (practice_id, code, first_name_enc, last_name_enc, created_by_kind, created_by_id)
    values (${B.id}, 'P-QAT2', ${verschluesseln('Berta')}, ${verschluesseln('Beispiel')}, 'practice', ${nutzerA}) returning id`;
  const auftrag = async ({ nr, praxisId, patientId = pat.id, behandlung = 'krone', status: st, tempo = 'standard', due = null, wunsch = null, config = { zaehne: { 16: { art: 'krone' } } } }) => {
    const [o] = await sql`insert into ddl.orders (order_no, practice_id, patient_id, work_type_key, delivery_kind, config, status, current_step_key, source, tempo, due_date, desired_date, submitted_at, created_by_kind, created_by_id)
      values (${nr}, ${praxisId}, ${patientId}, ${behandlung}, 'fertigung', ${sql.json(config)}, ${st}, ${st === 'versendet' ? 'uebergabe' : null}, 'portal', ${tempo}, ${due}, ${wunsch}, now() - interval '5 days', 'practice', ${nutzerA}) returning id`;
    await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, ${st}, now() - interval '1 day', 'staff')`;
    return o.id;
  };
  const t1 = await auftrag({ nr: 'QA-T-0001', praxisId: A.id, status: 'versendet' });
  const t2 = await auftrag({ nr: 'QA-T-0002', praxisId: A.id, status: 'versendet', tempo: 'express' });
  await auftrag({ nr: 'QA-T-0003', praxisId: B.id, patientId: patB.id, status: 'versendet' });
  const t4 = await auftrag({ nr: 'QA-T-0004', praxisId: A.id, behandlung: 'teilprothese', status: 'einprobe', config: { einprobe: true } });
  await auftrag({ nr: 'QA-T-0005', praxisId: A.id, status: 'in_planung', due: heute, tempo: 'express' });
  await auftrag({ nr: 'QA-T-0006', praxisId: A.id, status: 'in_produktion', wunsch: plus(heute, -2) });
  const t7 = await auftrag({ nr: 'QA-T-0007', praxisId: A.id, status: 'versendet' });

  const { s: t, id: buero } = await mitarbeiter(STAFF[0], 'Test Büro', 'buero');
  const { s: f, id: fahrer } = await mitarbeiter(STAFF[1], 'Test Fahrer', 'fahrer', 390);

  // ── Büro: Tour anlegen (Tab »Touren«; die Seite hat Tabs seit 25.10.2026) ──
  await t.goto(`${CRM}/touren?tab=touren`);
  pruefen(await sichtbar(t.getByRole('heading', { name: 'Touren.' })), 'Seite »Touren« (Büro)');
  const neu = t.getByRole('form', { name: 'Neue Tour' });
  await neu.getByLabel('Name').fill('QA Tour Nord');
  for (const tag of ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag']) await neu.getByLabel(tag).uncheck();
  await neu.getByRole('button', { name: 'Tour anlegen' }).click();
  pruefen(await sichtbar(neu.getByText('Bitte mindestens einen Tag wählen.')), 'Tour ohne Tag: Hinweis');
  for (const tag of ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']) await neu.getByLabel(tag).check();
  await neu.getByLabel('Fahrer').selectOption({ label: 'Test Fahrer' });
  await neu.getByRole('button', { name: 'Tour anlegen' }).click();
  pruefen(await sichtbar(neu.getByText('QA Tour Nord angelegt. Jetzt Ordinationen hinzufügen.')), 'Tour angelegt');
  const [tour] = await sql`select id, weekdays, driver_id from ddl.tours where name = 'QA Tour Nord'`;
  pruefen(tour && tour.weekdays.join() === '1,2,3,4,5,6,7' && tour.driver_id === fahrer, 'Datenbank: Tage Mo–So, Fahrer');

  const verw = t.getByRole('region', { name: 'Tour QA Tour Nord', exact: true });
  for (const name of ['QA · Tour Ordination A', 'QA · Tour Ordination C']) {
    await verw.getByLabel('Ordination hinzufügen').selectOption({ label: name });
    await verw.getByRole('button', { name: 'Hinzufügen' }).click();
    await verw.getByRole('list', { name: 'Route QA Tour Nord' }).getByText(name).waitFor();
  }
  await verw.getByRole('button', { name: 'QA · Tour Ordination C früher anfahren' }).click();
  pruefen(
    await warten(async () => {
      const r = await sql`select name, tour_position from ddl.practices where tour_id = ${tour.id} order by tour_position`;
      return r.map((x) => x.name).join() === 'QA · Tour Ordination C,QA · Tour Ordination A';
    }),
    'Route: C vor A nach »früher anfahren«',
  );

  // ── Tagesplan heute ──
  await t.goto(`${CRM}/touren`);
  const plan = t.getByRole('region', { name: 'QA Tour Nord', exact: true });
  const stoppA = plan.locator('li[aria-label$="QA · Tour Ordination A"]');
  pruefen(await sichtbar(stoppA), 'Tagesplan: Stopp bei Ordination A');
  const textA = await stoppA.textContent();
  pruefen(['QA-T-0001', 'QA-T-0002', 'QA-T-0007', 'Teststraße 1, 1200 Wien', 'Hintereingang'].every((x) => textA.includes(x)) && !textA.includes('QA-T-0005'), 'Stopp: Adresse, Hinweis, nur fertige Arbeiten (Übergabe)');
  pruefen((await plan.locator('li[aria-label$="QA · Tour Ordination C"]').count()) === 0, 'Ordination ohne Arbeit heute: kein Stopp');
  await t.getByRole('navigation', { name: 'Bereiche der Touren' }).getByRole('link', { name: /^Fertig, ohne Tour/ }).click();
  pruefen(await sichtbar(t.getByRole('region', { name: 'Fertig, ohne Tour' }).getByText('QA-T-0003')), '»Fertig, ohne Tour«: Ordination B (eigener Tab)');

  // ── Portal: Abholung ──
  await p.goto(`${PORTAL}/auftraege/${t4}`);
  await p.getByRole('link', { name: 'Abholung anfordern' }).click();
  await p.waitForURL(/\/abholung\?auftrag=/);
  const fa = p.getByRole('form', { name: 'Abholung anfordern' });
  // توضیح صفحه پشت علامت «i» کنار تیتر است
  await p.getByRole('button', { name: 'Erläuterung zu dieser Seite' }).click();
  pruefen(await sichtbar(p.getByText('Unsere Tour kommt zu Ihnen: Mo–So.')), 'Portal: Tourtage der eigenen Tour');
  await p.keyboard.press('Escape');
  pruefen((await fa.getByLabel('Wunschtag').inputValue()) === morgen && (await fa.getByLabel('Zu welchem Auftrag? (optional)').inputValue()) === t4, 'Vorschlag: nächster Tourtag; Auftrag aus der Einprobe vorgewählt');
  await fa.getByLabel('Was holen wir ab? (optional)').fill('QA Einprobe zurück');
  await bild(p, '56-portal-abholung');
  await fa.getByRole('button', { name: 'Abholung anfordern' }).click();
  pruefen(await sichtbar(fa.getByText(`Eingeplant: Wir kommen am ${kurz(morgen)}.`)), 'Tour fährt am Wunschtag: gleich eingeplant');
  const [abA] = await sql`select id, status, tour_id, planned_date::text as tag, order_id from ddl.pickup_requests where practice_id = ${A.id}`;
  pruefen(abA?.status === 'eingeplant' && abA.tour_id === tour.id && abA.tag === morgen && abA.order_id === t4, 'Datenbank: eingeplant, mit Tour, Tag und Auftrag');
  pruefen(await sichtbar(p.getByRole('region', { name: 'Ihre Abholungen' }).getByText(`Eingeplant: ${kurz(morgen)}`)), 'Portal: Liste »Ihre Abholungen«');

  // Ordination B ohne Tour: offen
  const { s: q } = await portalZugang('QA Tour B', 'qa-tour-b@example.invalid', B.id);
  await q.goto(`${PORTAL}/abholung`);
  await q.getByRole('form', { name: 'Abholung anfordern' }).getByLabel('Was holen wir ab? (optional)').fill('QA Abdruck');
  await q.getByRole('button', { name: 'Abholung anfordern' }).click();
  pruefen(await sichtbar(q.getByText('Danke. Sobald wir die Abholung eingeplant haben, sehen Sie den Tag hier.')), 'ohne Tour: Wunsch bleibt offen fürs Büro');
  const [abB] = await sql`select id, status from ddl.pickup_requests where practice_id = ${B.id}`;
  pruefen(abB?.status === 'offen', 'Datenbank: offen');
  // Trennung: B versucht, die Abholung von A zurückzuziehen
  await q.goto(`${PORTAL}/abholung`, { waitUntil: 'networkidle' });
  const versteckt = q.locator('form:has(button:text("Zurückziehen")) input[name="id"]');
  await versteckt.evaluate((el, fremd) => {
    el.value = fremd;
  }, abA.id);
  pruefen((await versteckt.inputValue()) === abA.id, '(Test: fremde ID eingesetzt)');
  await q.getByRole('button', { name: 'Zurückziehen' }).click();
  pruefen(await sichtbar(q.getByText('Diese Abholung kann nicht mehr zurückgezogen werden.')) && (await sql`select status from ddl.pickup_requests where id = ${abA.id}`)[0].status === 'eingeplant', 'Trennung: fremde Abholung nicht änderbar');
  pruefen(!(await q.locator('main').textContent()).includes('QA Einprobe zurück'), 'Trennung: B sieht die Abholungen von A nicht');

  // Büro plant den Wunsch von B auf heute
  await t.goto(`${CRM}/touren?tab=abholung`);
  const wunsch = t.getByRole('listitem', { name: 'Abholwunsch QA · Tour Ordination B' });
  await wunsch.getByLabel('Tour').selectOption({ label: 'QA Tour Nord' });
  await wunsch.getByLabel('Tag').fill(heute);
  await wunsch.getByRole('button', { name: 'Einplanen' }).click();
  pruefen(Boolean(await warten(async () => (await sql`select status from ddl.pickup_requests where id = ${abB.id}`)[0]?.status === 'eingeplant')), 'Büro: Abholwunsch eingeplant');
  await t.goto(`${CRM}/touren`);
  pruefen(await sichtbar(t.getByRole('region', { name: 'QA Tour Nord', exact: true }).locator('li[aria-label$="QA · Tour Ordination B"]').getByText('QA Abdruck')), 'Abholung bei Ordination außerhalb der Route: als letzter Stopp');
  await bild(t, '51-touren');
  await t.goto(`${CRM}/touren?datum=${morgen}`);
  pruefen(await sichtbar(t.getByRole('region', { name: 'QA Tour Nord', exact: true }).getByText('QA Einprobe zurück')), 'Tagesplan morgen: Abholung der Einprobe');

  // Portal: Versendet mit Tourtag
  await p.goto(`${PORTAL}/auftraege/${t7}`);
  pruefen(await sichtbar(p.getByText(`Lieferung mit unserer Tour voraussichtlich am ${kurz(heute)}.`)), 'Portal »Unterwegs«: Tag der Tour');

  // ── Kalender ──
  await t.goto(`${CRM}/kalender`);
  const zelle = (d) => t.locator(`div[data-tag="${d}"]`);
  pruefen(await sichtbar(zelle(heute).getByText('QA-T-0005')), 'Kalender (Monat): Liefertermin am Tag');
  pruefen((await zelle(heute).textContent()).includes('QA Tour Nord'), 'Kalender: Tourtag sichtbar');
  pruefen((await zelle(morgen).count()) === 0 || (await zelle(morgen).textContent()).includes('Abholung · QA · Tour Ordination A'), 'Kalender: Abholung am geplanten Tag');
  await bild(t, '52-kalender-monat');
  await t.goto(`${CRM}/kalender?ansicht=woche&datum=${plus(heute, -2)}`);
  const alt = zelle(plus(heute, -2)).getByRole('link', { name: /QA-T-0006/ });
  pruefen(await sichtbar(alt) && (await alt.getAttribute('class')).includes('text-rose-light') && (await alt.textContent()).includes('Wunsch'), 'Woche: Wunschtermin vorbei → hervorgehoben');
  await bild(t, '53-kalender-woche');
  await t.goto(`${CRM}/kalender?ordination=${B.id}`);
  const nurB = await t.locator('main').textContent();
  pruefen(!nurB.includes('QA-T-0005') && !nurB.includes('QA-T-0006'), 'Filter Ordination: nur deren Termine');
  await t.setViewportSize({ width: 390, height: 844 });
  await t.goto(`${CRM}/kalender`);
  pruefen(await sichtbar(t.locator('ol li').filter({ hasText: 'heute' }).getByText('QA-T-0005')), 'Handy: Kalender als Liste der Tage');
  await bild(t, '54-kalender-390');
  await t.setViewportSize({ width: 1440, height: 900 });
  const kalText = await t.locator('main').textContent();
  pruefen(!kalText.includes(NAME.nach), 'Kalender: kein Patientenname');

  // ── Fahrer ──
  await f.goto(`${CRM}/`);
  pruefen(f.url().endsWith('/meine-tour'), 'Fahrer: Übersicht führt zu »Meine Tour«');
  const navF = (await f.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link').allTextContents()).join(',');
  pruefen(navF === 'Meine Tour', `Fahrer: Menü nur »Meine Tour« (${navF})`);
  pruefen(await sichtbar(f.getByRole('heading', { name: /Stopps heute\./ })), 'Meine Tour: Stopps heute');
  const fText = await f.locator('main').textContent();
  pruefen(!fText.includes('P-QAT1') && !fText.includes(NAME.nach) && !fText.includes(NAME.vor), 'Fahrer sieht keine Patientendaten (weder Name noch ID)');
  await bild(f, '55-meine-tour-390');
  await f.getByRole('button', { name: 'Zugestellt: QA · Tour Ordination A' }).click();
  pruefen(
    await warten(async () => [t1, t2, t7].every(async () => true) && (await Promise.all([t1, t2, t7].map(status))).every((x) => x === 'geliefert')),
    'Fahrer: »Zugestellt (3 Arbeiten)« → alle drei Geliefert',
  );
  const [{ n: zug }] = await sql`select count(*)::int as n from ddl.order_messages where order_id in ${sql([t1, t2, t7])} and body = 'Zugestellt'`;
  const [{ n: schritt }] = await sql`select count(*)::int as n from ddl.order_steps where order_id in ${sql([t1, t2, t7])} and step_key = 'uebergabe' and done_by = ${fahrer}`;
  const geliefert = await sql`select delivered_at from ddl.orders where id in ${sql([t1, t2, t7])}`;
  pruefen(zug === 3 && schritt === 3 && geliefert.every((g) => g.delivered_at), 'Datenbank: Lieferdatum, Übergabe-Schritt und Meldung »Zugestellt«');
  pruefen(await sichtbar(f.getByText(/zugestellt \d{2}:\d{2}/).first()), 'Meine Tour: »zugestellt HH:MM«');
  await f.locator('li[aria-label$="QA · Tour Ordination B"]').getByRole('button', { name: 'Abgeholt' }).click();
  pruefen(await warten(async () => (await sql`select status, done_by from ddl.pickup_requests where id = ${abB.id}`)[0].done_by === fahrer), 'Fahrer: »Abgeholt« gespeichert');
  await p.goto(`${PORTAL}/auftraege/${t1}`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Geliefert.' })), 'Ordination sieht »Geliefert.«');
  for (const [pfad, was] of [['/touren', 'Touren'], ['/kalender', 'Kalender'], ['/auftraege', 'Aufträge']]) {
    await f.goto(`${CRM}${pfad}`);
    pruefen(await sichtbar(f.getByRole('heading', { name: 'Kein Zugriff.' })), `Fahrer: kein Zugriff auf »${was}«`);
  }

  // Portal: zurückziehen
  await p.goto(`${PORTAL}/abholung`);
  await p.getByRole('button', { name: 'Zurückziehen' }).click();
  pruefen(await warten(async () => (await sql`select status from ddl.pickup_requests where id = ${abA.id}`)[0].status === 'storniert'), 'Ordination zieht ihre Abholung zurück');
  await t.goto(`${CRM}/touren?datum=${morgen}`);
  pruefen(!(await t.locator('main').textContent()).includes('QA Einprobe zurück'), 'zurückgezogen: nicht mehr im Tagesplan');

  // Tour ohne Fahrer: »Meine Tour« leer
  await t.goto(`${CRM}/touren?tab=touren`);
  const bearb = t.getByRole('form', { name: 'Tour bearbeiten: QA Tour Nord' });
  await t.getByRole('region', { name: 'Tour QA Tour Nord', exact: true }).getByText('Tour bearbeiten').click();
  await bearb.getByLabel('Fahrer').selectOption({ label: 'Noch offen' });
  await bearb.getByRole('button', { name: 'Speichern' }).click();
  await bearb.getByText('Gespeichert.').waitFor();
  await f.goto(`${CRM}/meine-tour`);
  pruefen(await sichtbar(f.getByText('Ihnen ist noch keine Tour zugeordnet.', { exact: false })), 'Fahrer ohne Tour: Hinweis statt Stopps');
  const [{ n: audits }] = await sql`select count(*)::int as n from ddl.audit_log where actor_id in ${sql([buero, fahrer])} and action in ('tour_angelegt', 'tour_geaendert', 'abholung_eingeplant', 'auftrag_zugestellt', 'abholung_erledigt')`;
  pruefen(audits === 7, `Audit: Tour, Einplanung, Zustellungen, Abholung (${audits})`);

  // ── Ansicht ──
  const zuBreit = [];
  for (const [breite, hoehe] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
    for (const [s, basis, pfade] of [
      [t, CRM, ['/touren', '/kalender', '/kalender?ansicht=woche', '/']],
      [f, CRM, ['/meine-tour']],
      [p, PORTAL, ['/abholung', `/auftraege/${t7}`]],
    ]) {
      await s.setViewportSize({ width: breite, height: hoehe });
      for (const pfad of pfade) {
        await s.goto(`${basis}${pfad}`, { waitUntil: 'networkidle' });
        const w = await s.evaluate(() => document.documentElement.scrollWidth);
        if (w > breite + 1) zuBreit.push(`${pfad} ${breite}px: ${w}px`);
      }
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (1440 bis 320 px)${zuBreit.length ? ' → ' + zuBreit.slice(0, 6).join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  const zaehlerNachher = await sql`select scope, year, last_value from ddl.number_sequences order by scope, year`;
  pruefen(JSON.stringify(zaehlerVorher) === JSON.stringify(zaehlerNachher), 'Zähler (Kunden- und Auftragsnummern) unverändert');
  pruefen((await sql`select count(*)::int as n from ddl.tours`)[0].n === touren, 'Testtour entfernt');
  await sql.end();
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fehler ? 1 : 0);
