// آزمون قدم ۱۱ در Chrome: اعلان‌های ایمیلی (Spec فاز ۱، بخش M)، با ایمیل‌های واقعی در Mailpit.
// Rückfrage، Design zur Freigabe، Einprobe (تبلت)، Neue Nachricht (حداکثر یکی در ۱۵ دقیقه، فقط برای خوانده‌نشده)،
// Reklamation entschieden؛ Versendet و Auftrag eingegangen مستقیم از صف (تا هیچ شمارهٔ واقعی مصرف نشود).
// گیرنده‌ها: فقط کاربران فعال پورتال همان Ordination (نه دعوت‌شدهٔ بی‌رمز، نه غیرفعال، نه Ordination دیگر).
// تنظیمات: Praxis-Admin در پورتال خاموش می‌کند، Mitarbeiter فقط می‌بیند، Büro در پنل داخلی دوباره روشن می‌کند.
// هیچ ایمیلی نام بیمار یا متن پیام ندارد؛ لوگو پیوست درون‌خطی است. ظاهر صفحهٔ «Einstellungen» در ۴ اندازه.
// دادهٔ آزمایشی («QA · …»، @example.invalid)، کارهای صف و ایمیل‌های Mailpit در پایان پاک می‌شوند.
// هیچ شمارنده‌ای (Auftrag، KE، LS، RK، Kundennummer) مصرف نمی‌شود؛ در پایان همین بررسی می‌شود.
// اجرا: pnpm qa qa-benachrichtigung  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { belegeLoeschen, zaehlerStand } from './qa-belege.mjs';
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
const sichtbar = async (loc, timeout = 8000) => {
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
/** binäres STL eines Quaders */
function quader(h = 10) {
  const p = [[0,0,0],[10,0,0],[10,8,0],[0,8,0],[0,0,h],[10,0,h],[10,8,h],[0,8,h]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const b = Buffer.alloc(84 + f.length * 50);
  b.writeUInt32LE(f.length, 80);
  f.forEach((t, i) => t.forEach((k, j) => p[k].forEach((w, a) => b.writeFloatLE(w, 84 + i * 50 + 12 + j * 12 + a * 4))));
  return b;
}

// ── Mailpit ──
const ADMIN = 'qa-benachrichtigung-admin@example.invalid';
const TEAM = 'qa-benachrichtigung-team@example.invalid';
const EINGELADEN = 'qa-benachrichtigung-eingeladen@example.invalid';
const INAKTIV = 'qa-benachrichtigung-inaktiv@example.invalid';
const ANDERE = 'qa-benachrichtigung-b@example.invalid';
const ADRESSEN = [ADMIN, TEAM, EINGELADEN, INAKTIV, ANDERE];
const STAFF = ['test-benachrichtigung-technik@example.invalid', 'test-benachrichtigung-buero@example.invalid'];
const NAME = { vor: 'Benedikta', nach: 'Briefgeheim' };

async function postfach(an) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${an}"`)}&limit=200`);
  if (!r.ok) throw new Error(`Mailpit: ${r.status}`);
  return (await r.json()).messages ?? [];
}
const mailLesen = async (id) => (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
async function mailpitLeeren() {
  const ids = [];
  for (const a of ADRESSEN) for (const m of await postfach(a)) ids.push(m.ID);
  if (ids.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
}
/** wartet auf eine E-Mail mit genau diesem Betreff an diese Adresse */
const mailVon = (an, betreff, timeout) => warten(async () => (await postfach(an)).find((m) => m.Subject === betreff) ?? null, timeout);
const anzahl = async (an) => (await postfach(an)).length;

const ordner = path.join(tmpdir(), 'ddl-qa-benachrichtigung');
mkdirSync(ordner, { recursive: true });

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Benachrichtigung%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  if (praxen.length) {
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      for (const f of await sql`select storage_key from ddl.order_files where order_id in ${sql(auftraege)}`) await rm(path.join(SPEICHER, f.storage_key), { force: true });
      await belegeLoeschen(sql, auftraege);
      await sql`delete from ddl.jobs where type = 'benachrichtigung' and payload->>'orderId' in ${sql(auftraege)}`;
      await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
    }
    await sql`delete from ddl.patients where practice_id in ${sql(praxen)}`;
  }
  await sql`delete from ddl.jobs where type = 'email_senden' and payload->>'an' in ${sql(ADRESSEN)}`;
  await sql`delete from ddl.jobs where type = 'benachrichtigung' and payload->>'orderId' = '00000000-0000-4000-8000-000000000000'`;
  const akteure = [...nutzer, ...staff];
  if (akteure.length) {
    await sql`delete from ddl.data_access_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.message_reads where reader_id in ${sql(akteure)}`;
  }
  if (praxen.length) await sql`delete from ddl.audit_log where target_type = 'practice' and target_id in ${sql(praxen)}`;
  await vereinbarungenLoeschen(sql, praxen);
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
  await mailpitLeeren();
}

await aufraeumen();
const zaehlerVorher = await zaehlerStand(sql);
const kundeVorher = await sql`select year, last_value from ddl.number_sequences where scope = 'kunde' order by year`;

// ── Worker mit Schritt 11? Sonst bleibt alles in der Warteschlange stecken. ──
const LEER = '00000000-0000-4000-8000-000000000000';
const [probe] = await sql`insert into ddl.jobs (type, payload) values ('benachrichtigung', ${sql.json({ ereignis: 'versendet', orderId: LEER })}) returning id`;
const probeFertig = await warten(async () => {
  const [j] = await sql`select status, error, output from ddl.jobs where id = ${probe.id}`;
  return j.status === 'fertig' || j.status === 'fehler' ? j : null;
}, 15000);
await sql`delete from ddl.jobs where id = ${probe.id}`;
if (probeFertig?.status !== 'fertig') {
  console.log(`✗ Der Worker kennt »benachrichtigung« noch nicht (${probeFertig?.error ?? 'keine Antwort'}). Bitte DDL System neu starten.`);
  await sql.end();
  process.exit(1);
}
pruefen(probeFertig.output?.uebersprungen === 'Auftrag nicht gefunden', 'Worker: Benachrichtigung für einen gelöschten Auftrag wird still übersprungen');

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async (breite = 1440) => {
  const ctx = await browser.newContext({ viewport: { width: breite, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  return s;
};
async function mitarbeiter(email, name, rolle) {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${email}, ${name}, ${rolle}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-benachrichtigung-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-benachrichtigung-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((u) => u.href.startsWith(`${CRM}/`) && !u.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}
async function portalZugang(name, email, praxisId, rolle = 'praxis_admin', breite = 1440) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, ${rolle}, now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite(breite);
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-benachrichtigung-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-benachrichtigung-2');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}
const zeile = async (id) => (await sql`select * from ddl.orders where id = ${id}`)[0];
const geprueft = [];
/** prüft eine angekommene E-Mail: kein Patientenname, Logo eingebettet, Link zum Auftrag, Hinweis auf Einstellungen */
async function mailPruefen(eintrag, orderId) {
  const m = await mailLesen(eintrag.ID);
  geprueft.push(m);
  const inhalt = `${m.Subject}\n${m.Text}\n${m.HTML}`;
  return (
    !inhalt.includes(NAME.vor) &&
    !inhalt.includes(NAME.nach) &&
    (m.Inline ?? []).some((i) => i.ContentID === 'ddl-mark') &&
    m.HTML.includes(`${PORTAL}/auftraege/${orderId}`) &&
    m.Text.includes(`${PORTAL}/einstellungen`) &&
    m.Text.includes('P-QAB1')
  );
}

try {
  // ── Daten ──
  const [A] = await sql`insert into ddl.practices (customer_no, name) values ('QA-BA', 'QA · Benachrichtigung Ordination A') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name) values ('QA-BB', 'QA · Benachrichtigung Ordination B') returning id`;
  const { s: p, id: admin } = await portalZugang('Dr. Qa Admin', ADMIN, A.id);
  const { s: team } = await portalZugang('Qa Assistenz', TEAM, A.id, 'mitarbeiter', 375);
  const { s: pB } = await portalZugang('Dr. Qa Andere', ANDERE, B.id);
  await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${A.id}, ${EINGELADEN}, 'Qa Eingeladen', 'mitarbeiter', now())`;
  await sql`insert into ddl.practice_users (practice_id, email, name, role, password_hash, is_active) values (${A.id}, ${INAKTIV}, 'Qa Inaktiv', 'mitarbeiter', 'deaktiviert', false)`;
  const [pat] = await sql`insert into ddl.patients (practice_id, code, first_name_enc, last_name_enc, created_by_kind, created_by_id)
    values (${A.id}, 'P-QAB1', ${verschluesseln(NAME.vor)}, ${verschluesseln(NAME.nach)}, 'practice', ${admin}) returning id`;
  const krone = { zaehne: { 16: { art: 'krone' } }, versorgung: 'definitiv', farbe: { system: 'vita_classical', farbe: 'A2' } };
  const prothese = { zaehne: { 14: { zahn: 'ersatzzahn', basis: true }, 16: { klammer: true } }, prothesenform: 'flipper', klammern: 'mit', gaumen: 'hufeisen', einprobe: true, farbe: { system: 'vita_classical', farbe: 'A3' } };
  const auftrag = async ({ nr, behandlung = 'krone', status, schritt = null, config = krone, geliefert = null }) => {
    const [o] = await sql`insert into ddl.orders (order_no, practice_id, patient_id, work_type_key, delivery_kind, config, status, current_step_key, source, tempo, submitted_at, delivered_at, created_by_kind, created_by_id)
      values (${nr}, ${A.id}, ${pat.id}, ${behandlung}, 'fertigung', ${sql.json(config)}, ${status}, ${schritt}, 'portal', 'standard', now() - interval '3 days', ${geliefert}, 'practice', ${admin}) returning id`;
    await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, ${status}, now() - interval '1 day', 'staff')`;
    await sql`insert into ddl.order_teeth (order_id, fdi, treatment) values (${o.id}, 16, ${behandlung === 'krone' ? 'krone' : 'klammer'})`;
    return o.id;
  };
  const o1 = await auftrag({ nr: 'QA-B-0001', status: 'in_planung', schritt: 'cad_design' });
  const o2 = await auftrag({ nr: 'QA-B-0002', status: 'in_planung', schritt: 'cad_design' });
  const o3 = await auftrag({ nr: 'QA-B-0003', behandlung: 'teilprothese', status: 'in_produktion', schritt: 'nachhaertung', config: prothese });
  const o4 = await auftrag({ nr: 'QA-B-0004', status: 'in_planung', schritt: 'cad_design' });
  const o5 = await auftrag({ nr: 'QA-B-0005', status: 'geliefert', schritt: 'uebergabe', geliefert: new Date(Date.now() - 10 * 86400000) });
  const [rk] = await sql`insert into ddl.complaints (complaint_no, order_id, practice_id, reported_by_kind, reported_by_id, reason, description, warranty_until, warranty_valid)
    values ('QA-RK-B1', ${o5}, ${A.id}, 'practice', ${admin}, 'bruch', 'Krone gebrochen.', now() + interval '700 days', true) returning id`;

  const { s: t } = await mitarbeiter(STAFF[0], 'Test Technik', 'techniker');
  const { s: bu } = await mitarbeiter(STAFF[1], 'Test Büro', 'buero');

  // ── Rückfrage ──
  await t.goto(`${CRM}/auftraege/${o1}`);
  await t.getByRole('button', { name: 'Rückfrage stellen' }).click();
  await t.getByLabel('Frage an die Ordination').fill(`Bitte Biss nachreichen. ${NAME.nach}`);
  await t.getByRole('button', { name: 'Rückfrage senden' }).click();
  await t.getByRole('heading', { name: 'Rückfrage.' }).waitFor();
  const rueck = await mailVon(ADMIN, 'Rückfrage zu Auftrag QA-B-0001');
  pruefen(Boolean(rueck), 'Rückfrage → E-Mail »Rückfrage zu Auftrag QA-B-0001« an Praxis-Admin');
  pruefen(Boolean(await mailVon(TEAM, 'Rückfrage zu Auftrag QA-B-0001')), 'auch an Mitarbeiter (alle aktiven Zugänge)');
  if (rueck) {
    pruefen(await mailPruefen(rueck, o1), 'E-Mail: kein Patientenname, kein Fragetext, Logo eingebettet, Link zum Auftrag und zu den Einstellungen');
    const m = await mailLesen(rueck.ID);
    pruefen(!m.Text.includes('Bitte Biss nachreichen') && m.Text.includes('Guten Tag Dr. Qa Admin,') && m.Text.includes('Patienten-ID: P-QAB1') && m.Text.includes('Ordination: QA · Benachrichtigung Ordination A'), 'E-Mail: Anrede mit Namen, Patienten-ID, Ordination; Text der Frage nur im Portal');
    if (BILDER) {
      const v = await browser.newPage({ viewport: { width: 700, height: 900 } });
      await v.goto(`${MAILPIT}/view/${rueck.ID}.html`);
      await bild(v, '70-email-rueckfrage');
      await v.close();
    }
  }

  // ── Design zur Freigabe ──
  const krone16 = path.join(ordner, 'Krone 16.stl');
  writeFileSync(krone16, quader(9));
  await t.goto(`${CRM}/auftraege/${o2}`);
  await t.getByLabel('Design-Dateien hochladen').setInputFiles(krone16);
  await t.waitForFunction(() => !document.body.textContent.match(/\d+ %/), null, { timeout: 20000 });
  await t.getByLabel('Notiz für die Ordination (optional)').fill('Kontakt leicht verstärkt.');
  await t.getByRole('button', { name: 'Zur Freigabe senden' }).click();
  await t.getByRole('heading', { name: 'Design zur Freigabe.' }).waitFor();
  const design = await mailVon(ADMIN, 'Design zur Freigabe: Auftrag QA-B-0002');
  pruefen(Boolean(design), 'Design hochgeladen → »Design zur Freigabe: Auftrag QA-B-0002«');
  if (design) {
    pruefen(await mailPruefen(design, o2), 'Design-E-Mail: ohne Patientenname, mit Logo und Link');
    const m = await mailLesen(design.ID);
    pruefen(m.Text.includes('Version 1') && m.Text.includes('Nach Ihrer Freigabe beginnen wir mit der Produktion.') && !m.Text.includes('Kontakt leicht verstärkt'), 'Design-E-Mail: Version 1, nächster Schritt; Notiz des Labors nicht in der E-Mail');
  }
  pruefen((await sql`select count(*)::int as n from ddl.jobs where type = 'benachrichtigung' and payload->>'orderId' = ${o2} and payload->>'ereignis' = 'neue_nachricht'`)[0].n === 0, 'Notiz zum Design: keine zweite E-Mail »Neue Nachricht«');
  // die Ordination gibt frei: keine E-Mail an sie selbst
  const vorFreigabe = await anzahl(ADMIN);
  await p.goto(`${PORTAL}/auftraege/${o2}`);
  await p.getByRole('button', { name: 'Freigeben & herunterladen' }).click();
  const dialog = p.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await Promise.all([p.waitForEvent('download'), dialog.getByRole('button', { name: 'Freigeben' }).click()]);
  pruefen(Boolean(await warten(async () => (await zeile(o2)).status === 'in_produktion')), 'Ordination gibt frei → In Produktion');
  await new Promise((x) => setTimeout(x, 5000));
  pruefen((await anzahl(ADMIN)) === vorFreigabe, 'eigene Freigabe: keine E-Mail an die Ordination');

  // ── Einprobe (Tablet) ──
  await t.goto(`${CRM}/s/QA-B-0003`);
  await t.getByRole('button', { name: 'Reinigung & Nachhärtung erledigt' }).click();
  pruefen(Boolean(await warten(async () => (await zeile(o3)).status === 'einprobe')), 'Tablet: Nachhärtung erledigt → Einprobe');
  const einprobe = await mailVon(TEAM, 'Bereit zur Einprobe: Auftrag QA-B-0003');
  pruefen(Boolean(einprobe) && (await mailPruefen(einprobe, o3)), 'Einprobe → E-Mail »Bereit zur Einprobe: Auftrag QA-B-0003«, ohne Patientenname');

  // ── Neue Nachricht: höchstens eine in 15 Minuten, nur ungelesen ──
  await bu.goto(`${CRM}/auftraege/${o4}?tab=kommunikation`);
  await bu.getByLabel('Nachricht', { exact: true }).fill(`Erste Frage zu ${NAME.vor} ${NAME.nach}.`);
  await bu.getByRole('button', { name: 'Senden' }).click();
  await bu.getByText(`Erste Frage zu ${NAME.vor}`).waitFor();
  const n1 = await mailVon(ADMIN, 'Neue Nachricht zu Auftrag QA-B-0004');
  pruefen(Boolean(n1), 'Nachricht des Labors → »Neue Nachricht zu Auftrag QA-B-0004«');
  if (n1) {
    pruefen(await mailPruefen(n1, o4), 'Nachricht-E-Mail: Text und Patientenname nicht enthalten, Logo, Link');
    pruefen((await mailLesen(n1.ID)).Text.includes('eine neue Nachricht von Digital Dental Lab'), 'Nachricht-E-Mail: »eine neue Nachricht«');
  }
  pruefen(Boolean(await mailVon(TEAM, 'Neue Nachricht zu Auftrag QA-B-0004')), 'auch der Mitarbeiter bekommt sie');
  await bu.getByLabel('Nachricht', { exact: true }).fill('Zweite Nachricht gleich danach.');
  await bu.getByRole('button', { name: 'Senden' }).click();
  await bu.getByText('Zweite Nachricht gleich danach.').waitFor();
  await bu.getByLabel('Nachricht', { exact: true }).fill('QA intern: nur Labor.');
  await bu.getByLabel('Intern (nur im Labor sichtbar)').check();
  await bu.getByRole('button', { name: 'Senden' }).click();
  await bu.getByText('QA intern: nur Labor.').waitFor();
  const wartend = await sql`select id, run_after, status from ddl.jobs where dedupe_key = ${`neue_nachricht:${o4}`} order by run_after`;
  const abstand = wartend.length === 2 ? (wartend[1].run_after - wartend[0].run_after) / 60000 : 0;
  pruefen(wartend.length === 2 && wartend[1].status === 'wartend' && abstand > 14.9 && abstand < 15.1, `zweite Nachricht: E-Mail wartet 15 Minuten (${abstand.toFixed(2)} min); interne Notiz ohne E-Mail`);
  // Admin liest im Portal, dann ist die Wartezeit um
  await p.goto(`${PORTAL}/auftraege/${o4}?tab=kommunikation`);
  await p.getByText('Zweite Nachricht gleich danach.').waitFor();
  pruefen((await p.getByText('QA intern: nur Labor.').count()) === 0, 'Portal: interne Notiz unsichtbar');
  const adminVorher = await anzahl(ADMIN);
  await sql`update ddl.jobs set run_after = now() where id = ${wartend[1]?.id ?? randomUUID()}`;
  const zweite = (await warten(async () => {
    const l = (await postfach(TEAM)).filter((m) => m.Subject === 'Neue Nachricht zu Auftrag QA-B-0004');
    return l.length === 2 ? l : null;
  })) ?? [];
  pruefen(zweite.length === 2 && (await mailLesen(zweite[0].ID)).Text.includes('2 neue Nachrichten'), 'nach der Pause: Mitarbeiter (ungelesen) bekommt »2 neue Nachrichten«');
  const [jobZwei] = await sql`select output from ddl.jobs where id = ${wartend[1]?.id ?? randomUUID()}`;
  pruefen(jobZwei?.output?.empfaenger === 1 && (await anzahl(ADMIN)) === adminVorher, 'Admin hat schon gelesen: keine zweite E-Mail an ihn');

  // ── Reklamation entschieden ──
  await bu.goto(`${CRM}/auftraege/${o5}`);
  const ent = bu.getByRole('form', { name: 'Reklamation entscheiden' });
  await ent.getByLabel('Reparatur').check();
  await ent.getByRole('button', { name: 'Entscheidung senden' }).click();
  await ent.waitFor({ state: 'detached' });
  const rkMail = await mailVon(ADMIN, 'Reklamation QA-RK-B1 zu Auftrag QA-B-0005 entschieden');
  pruefen(Boolean(rkMail) && (await mailPruefen(rkMail, o5)) && (await mailLesen(rkMail.ID)).Text.includes('wir reparieren die Arbeit'), 'Reklamation entschieden → E-Mail mit Entscheidung »Reparatur«');
  pruefen((await sql`select decision from ddl.complaints where id = ${rk.id}`)[0].decision === 'reparatur', 'Datenbank: Reparatur');

  // ── Versendet und Auftrag eingegangen direkt aus der Warteschlange (keine echten Nummern) ──
  await sql`insert into ddl.jobs (type, payload) values ('benachrichtigung', ${sql.json({ ereignis: 'versendet', orderId: o5, nach: 'versendet' })})`;
  await sql`insert into ddl.jobs (type, payload) values ('benachrichtigung', ${sql.json({ ereignis: 'auftrag_eingegangen', orderId: o1, nach: 'rueckfrage' })})`;
  const versendet = await mailVon(ADMIN, 'Auftrag QA-B-0005 versendet');
  pruefen(Boolean(versendet) && (await mailPruefen(versendet, o5)) && (await mailLesen(versendet.ID)).Text.includes('Lieferschein und Konformitätserklärung'), 'Versendet → E-Mail mit Hinweis auf Lieferschein und Konformitätserklärung');
  const eingang = await mailVon(ADMIN, 'Auftrag QA-B-0001 eingegangen');
  pruefen(Boolean(eingang) && (await mailLesen(eingang.ID)).Text.includes('Daten nachgereicht'), 'Auftrag eingegangen mit »Daten werden nachgereicht« → Bitte um die fehlenden Daten');

  // ── Einstellungen im Portal ──
  await p.goto(`${PORTAL}/`);
  await p.getByRole('link', { name: 'Einstellungen' }).first().click();
  await p.waitForURL(`${PORTAL}/einstellungen`);
  const liste = p.getByRole('list', { name: 'E-Mail-Benachrichtigungen' });
  pruefen((await liste.getByRole('checkbox').count()) === 7 && (await liste.getByRole('checkbox', { checked: true }).count()) === 7, 'Portal »Einstellungen«: 7 Benachrichtigungen, alle an');
  await p.goto(`${PORTAL}/einstellungen?tab=empfaenger`);
  const empf = p.getByRole('list', { name: 'Empfänger' });
  pruefen((await empf.getByText(ADMIN).count()) === 1 && (await empf.getByText(TEAM).count()) === 1 && (await empf.getByText(EINGELADEN).count()) === 0 && (await empf.getByText(INAKTIV).count()) === 0 && (await empf.getByText(ANDERE).count()) === 0, 'Empfänger: nur aktive Zugänge dieser Ordination');
  await p.goto(`${PORTAL}/einstellungen`);
  await liste.getByRole('checkbox', { name: /Neue Nachricht/ }).uncheck();
  await liste.getByRole('checkbox', { name: /Rückfrage/ }).uncheck();
  await bild(p, '71-portal-einstellungen');
  await p.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(p.getByText('Gespeichert.')), 'Speichern → »Gespeichert.«');
  const prefs = await sql`select event_key, email_enabled from ddl.notification_prefs where practice_id = ${A.id} order by event_key`;
  pruefen(prefs.length === 2 && prefs.every((x) => !x.email_enabled) && prefs.map((x) => x.event_key).join() === 'neue_nachricht,rueckfrage', 'Datenbank: nur die zwei Änderungen gespeichert');
  const [audit] = await sql`select actor_kind, details from ddl.audit_log where action = 'benachrichtigungen_geaendert' and actor_id = ${admin}`;
  pruefen(audit?.actor_kind === 'practice' && audit.details?.neue_nachricht?.zu === false, 'Audit: Änderung mit Person und Vorher/Nachher');
  await p.reload();
  pruefen(!(await p.getByRole('list', { name: 'E-Mail-Benachrichtigungen' }).getByRole('checkbox', { name: /Neue Nachricht/ }).isChecked()), 'nach dem Neuladen: »Neue Nachricht« bleibt aus');
  await p.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(p.getByText('Keine Änderungen.')), 'nochmals speichern ohne Änderung → »Keine Änderungen.«');

  // abgeschaltet: keine E-Mail
  const teamVorher = await anzahl(TEAM);
  await bu.goto(`${CRM}/auftraege/${o2}?tab=kommunikation`);
  await bu.getByLabel('Nachricht', { exact: true }).fill('Nachricht bei ausgeschalteter E-Mail.');
  await bu.getByRole('button', { name: 'Senden' }).click();
  await bu.getByText('Nachricht bei ausgeschalteter E-Mail.').waitFor();
  const aus = await warten(async () => {
    const [j] = await sql`select status, output from ddl.jobs where dedupe_key = ${`neue_nachricht:${o2}`}`;
    return j?.status === 'fertig' ? j : null;
  });
  pruefen(aus?.output?.uebersprungen === 'Von der Ordination abgeschaltet' && (await anzahl(TEAM)) === teamVorher, 'abgeschaltete Benachrichtigung: keine E-Mail');

  // Mitarbeiter: nur ansehen; andere Ordination: eigene Werte
  await team.goto(`${PORTAL}/einstellungen`);
  const teamListe = team.getByRole('list', { name: 'E-Mail-Benachrichtigungen' });
  pruefen((await sichtbar(teamListe)) && (await teamListe.getByRole('checkbox').count()) === 0 && (await team.getByRole('button', { name: 'Speichern' }).count()) === 0 && (await sichtbar(team.getByText('Ändern kann sie nur ein Praxis-Admin.'))), 'Mitarbeiter: Einstellungen nur ansehen (An/Aus), kein Speichern');
  pruefen((await teamListe.getByRole('listitem').filter({ hasText: 'Neue Nachricht' }).getByText('Aus', { exact: true }).count()) === 1, 'Mitarbeiter sieht »Neue Nachricht: Aus«');
  await bild(team, '72-portal-einstellungen-mitarbeiter-375');
  await pB.goto(`${PORTAL}/einstellungen`);
  pruefen((await pB.getByRole('list', { name: 'E-Mail-Benachrichtigungen' }).getByRole('checkbox', { checked: true }).count()) === 7 && (await pB.getByText(ADMIN).count()) === 0, 'andere Ordination: eigene Einstellungen, keine fremden Empfänger');

  // ── Panel intern ──
  await t.goto(`${CRM}/ordinationen/${A.id}?tab=benachrichtigungen`);
  const tBereich = t.getByRole('list', { name: 'E-Mail-Benachrichtigungen' });
  const tOk = (await sichtbar(tBereich)) && (await tBereich.getByRole('checkbox').count()) === 0;
  pruefen(tOk, `Techniker: Benachrichtigungen der Ordination nur ansehen${tOk ? '' : ` → ${(await t.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 600)}`}`);
  await bu.goto(`${CRM}/ordinationen/${A.id}?tab=benachrichtigungen`);
  const buListe = bu.getByRole('list', { name: 'E-Mail-Benachrichtigungen' });
  pruefen(!(await buListe.getByRole('checkbox', { name: /Neue Nachricht/ }).isChecked()), 'Büro sieht die Einstellung der Ordination (Neue Nachricht aus)');
  await buListe.getByRole('checkbox', { name: /Neue Nachricht/ }).check();
  await buListe.locator('xpath=ancestor::form').getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(bu.getByText('Gespeichert.')), 'Büro schaltet »Neue Nachricht« wieder ein');
  await bild(bu, '73-intern-ordination-benachrichtigungen');
  const [nn] = await sql`select email_enabled from ddl.notification_prefs where practice_id = ${A.id} and event_key = 'neue_nachricht'`;
  const [auditIntern] = await sql`select actor_kind from ddl.audit_log where action = 'benachrichtigungen_geaendert' and target_id = ${A.id} and actor_kind = 'staff'`;
  pruefen(nn?.email_enabled === true && Boolean(auditIntern), 'Datenbank und Audit: vom Büro wieder eingeschaltet');

  // ── niemand sonst ──
  pruefen((await anzahl(EINGELADEN)) === 0 && (await anzahl(INAKTIV)) === 0 && (await anzahl(ANDERE)) === 0, 'keine E-Mail an Eingeladene ohne Passwort, Deaktivierte oder die andere Ordination');
  const alle = [...(await postfach(ADMIN)), ...(await postfach(TEAM))];
  let sauber = true;
  for (const e of alle) {
    const m = await mailLesen(e.ID);
    if (`${m.Subject}${m.Text}${m.HTML}`.match(new RegExp(`${NAME.vor}|${NAME.nach}`))) sauber = false;
  }
  pruefen(alle.length >= 10 && sauber, `alle ${alle.length} E-Mails ohne Patientennamen (Mailpit)`);

  // ── Layout ──
  const zuBreit = [];
  for (const breite of [375, 768, 1024, 1440]) {
    await p.setViewportSize({ width: breite, height: 900 });
    await p.goto(`${PORTAL}/einstellungen`);
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    if (w > breite + 1) zuBreit.push(`portal /einstellungen ${breite}px: ${w}px`);
    await bu.setViewportSize({ width: breite, height: 900 });
    await bu.goto(`${CRM}/ordinationen/${A.id}?tab=benachrichtigungen`);
    const wi = await bu.evaluate(() => document.documentElement.scrollWidth);
    if (wi > breite + 1) zuBreit.push(`intern /ordinationen ${breite}px: ${wi}px`);
  }
  pruefen(!zuBreit.length, `kein waagrechtes Scrollen (375–1440)${zuBreit.length ? `: ${zuBreit.join(', ')}` : ''}`);
  pruefen(!konsole.length, `keine Fehler in der Browser-Konsole${konsole.length ? `: ${konsole.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('✗ Abbruch:', e);
  fehler++;
} finally {
  await browser.close();
  await aufraeumen();
  // Reste der anderen Tests (letzter Test in `pnpm qa`): E-Mails an @example.invalid und Benachrichtigungen gelöschter Aufträge
  await sql`delete from ddl.jobs where type = 'email_senden' and payload->>'an' like '%@example.invalid'`;
  await sql`delete from ddl.jobs j where j.type = 'benachrichtigung' and not exists (select 1 from ddl.orders o where o.id::text = j.payload->>'orderId')`;
  const qaMails = ((await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:example.invalid')}&limit=1000`)).json()).messages ?? []).map((m) => m.ID);
  if (qaMails.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: qaMails }) });
  const reste = await sql`select count(*)::int as n from ddl.practices where name like 'QA · Benachrichtigung%'`;
  const nachher = await zaehlerStand(sql);
  const kundeNachher = await sql`select year, last_value from ddl.number_sequences where scope = 'kunde' order by year`;
  pruefen(reste[0].n === 0 && (await anzahl(ADMIN)) === 0, 'aufgeräumt: Testdaten, Warteschlange und Mailpit');
  pruefen(JSON.stringify(nachher) === JSON.stringify(zaehlerVorher) && JSON.stringify(kundeNachher) === JSON.stringify(kundeVorher), 'keine Nummer verbraucht (Auftrag, KE, LS, RK, Kundennummer)');
  await sql.end();
}
console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fehler ? 1 : 0);
