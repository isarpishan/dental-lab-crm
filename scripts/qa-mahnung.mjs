// آزمون قدم ۴ فاز ۲ در Chrome: «Mahnwesen» در Einstellungen (ترتیب مرحله‌ها، اثر روی فهرست)، فهرست «Mahnungen»
// در Abrechnung (فقط آنچه رسیده)، «Senden» و «Alle senden»، PDF نامه (متن مرحله، مبلغ باز، مهلت، IBAN)، ایمیل با
// دو پیوست (نامه و خود Rechnung با sha256)، Ordination بی‌آدرس (فقط PDF، بعد «Per E-Mail senden»)، Konto، پورتال،
// خروجی Excel («Letzte Mahnung»)، نقش‌ها، audit و موبایل.
// دادهٔ آزمایشی: «QA · Mahnung …»، @example.invalid، شماره‌های «QA-MA-…»؛ بعد کامل پاک می‌شود (با فایل‌ها و ایمیل‌ها).
// اجرا: pnpm qa qa-mahnung  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
const MAILPIT = process.env.QA_MAILPIT ?? 'http://localhost:8025';
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
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
const tag = (t) => t.split('-').reverse().join('.');
/** امروز ± روز، به‌صورت «YYYY-MM-DD» به وقت وین */
const HEUTE = iso(new Date());
const plus = (n) => new Date(Date.UTC(Number(HEUTE.slice(0, 4)), Number(HEUTE.slice(5, 7)) - 1, Number(HEUTE.slice(8, 10)) + n)).toISOString().slice(0, 10);
const text = async (loc) => (await loc.innerText()).replace(/\s/g, ' ');
const pdfText = (datei) => JSON.parse(execFileSync('swift', ['scripts/qa-pdf.swift', datei], { maxBuffer: 10_000_000 }).toString()).text.replace(/\s+/g, ' ');

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

const STAFF = ['test-mahnung@example.invalid', 'test-mahnung-tech@example.invalid'];
const RECHNUNG_MAIL = 'qa-mahnung-rechnung@example.invalid';
const B_MAIL = 'qa-mahnung-b-rechnung@example.invalid';
const ADMIN_A = 'qa-mahnung-admin@example.invalid';
const ADMIN_B = 'qa-mahnung-b@example.invalid';
const ADRESSEN = [RECHNUNG_MAIL, B_MAIL, ADMIN_A, ADMIN_B];

async function postfach(an) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${an}"`)}&limit=200`);
  return (await r.json()).messages ?? [];
}
const mailLesen = async (id) => (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
const mailVon = (an, betreff) => warten(async () => (await postfach(an)).find((m) => m.Subject === betreff) ?? null);
async function mailpitLeeren() {
  const ids = [];
  for (const a of ADRESSEN) for (const m of await postfach(a)) ids.push(m.ID);
  if (ids.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
}

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Mahnung%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  if (praxen.length) {
    const belege = await sql`select id, storage_key from ddl.invoices where practice_id in ${sql(praxen)}`;
    const briefe = await sql`select storage_key, job_id from ddl.dunning_letters where practice_id in ${sql(praxen)}`;
    for (const b of [...belege, ...briefe]) await rm(path.join(SPEICHER, b.storage_key), { force: true });
    const jobIds = briefe.map((b) => b.job_id).filter(Boolean);
    if (jobIds.length) await sql`delete from ddl.jobs where id in ${sql(jobIds)}`;
    if (belege.length) {
      await sql`delete from ddl.audit_log where target_id in ${sql(belege.map((b) => b.id))}`;
      await sql.begin(async (tx) => {
        await tx`set local ddl.rechnungen_loeschen = 'qa'`;
        await tx`delete from ddl.invoices where practice_id in ${tx(praxen)}`;
      });
    }
  }
  const akteure = [...nutzer, ...staff];
  if (akteure.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
  }
  await vereinbarungenLoeschen(sql, praxen);
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.audit_log where action = 'einstellungen_geaendert' and target_id = 'mahnwesen' and actor_id is null`;
  await mailpitLeeren();
}
await aufraeumen();
const [vorherMahnwesen] = await sql`select value from ddl.settings where key = 'mahnwesen'`;

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  return s;
};
async function anmelden(email, name, rolle) {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${email}, ${name}, ${rolle}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-mahnung-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-mahnung-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => x.href.startsWith(`${CRM}/`) && !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}
async function portalZugang(name, email, praxisId) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-mahnung-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-mahnung-2');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return s;
}
/** فایل واقعی در محیط آزمون، تا worker آن را با sha256 پیوست کند */
function datei(inhalt) {
  const id = randomUUID();
  const key = `${id.slice(0, 2)}/${id}`;
  mkdirSync(path.join(SPEICHER, id.slice(0, 2)), { recursive: true });
  writeFileSync(path.join(SPEICHER, key), inhalt);
  return { key, sha256: sha(inhalt), size: inhalt.length };
}
async function rechnung(praxis, name, nummer, faellig, cent) {
  const f = datei(Buffer.from(`%PDF-1.4\n% QA ${nummer}\n%%EOF\n`));
  const [r] = await sql`insert into ddl.invoices (nummer, art, practice_id, abrechnung, ausgestellt_am, faellig_am, summe_cent, empfaenger, aussteller, storage_key, sha256, size, ausgestellt_von_label)
    values (${nummer}, 'rechnung', ${praxis}, 'sammel', ${`${plus(-60)} 10:00+01`}, ${faellig}, ${cent},
      ${sql.json({ name, zeilen: ['Mahngasse 2', '1030 Wien'], uid: null, kundennummer: 'QA-MA' })}, ${sql.json({ name: 'Isar Pishan · Digital Dental Lab', hinweis: 'Steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.' })},
      ${f.key}, ${f.sha256}, ${f.size}, 'QA') returning id`;
  return { id: r.id, nummer, sha256: f.sha256 };
}

try {
  const [A] = await sql`insert into ddl.practices (customer_no, name, billing_email, billing_mode) values ('QA-MA1', 'QA · Mahnung Ordination', ${RECHNUNG_MAIL}, 'sammel') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name, billing_mode) values ('QA-MA2', 'QA · Mahnung Ohne Mail', 'sammel') returning id`;
  const rA = await rechnung(A.id, 'QA · Mahnung Ordination', 'QA-MA-0001', plus(-10), 10000);
  const rB = await rechnung(A.id, 'QA · Mahnung Ordination', 'QA-MA-0002', plus(-3), 5000);
  const rC = await rechnung(A.id, 'QA · Mahnung Ordination', 'QA-MA-0003', plus(-30), 7000);
  await sql`insert into ddl.payments (invoice_id, practice_id, betrag_cent, eingegangen_am, erfasst_von_label) values (${rC.id}, ${A.id}, 7000, ${plus(-20)}, 'QA')`;
  const rD = await rechnung(A.id, 'QA · Mahnung Ordination', 'QA-MA-0004', plus(-25), 8000);
  const vorher = datei(Buffer.from('%PDF-1.4\n% QA Erinnerung\n%%EOF\n'));
  await sql`insert into ddl.dunning_letters (invoice_id, practice_id, stufe, offen_cent, frist, erstellt_am, erstellt_von_label, storage_key, sha256, size)
    values (${rD.id}, ${A.id}, 1, 8000, ${plus(-11)}, ${`${plus(-18)} 09:00+01`}, 'QA', ${vorher.key}, ${vorher.sha256}, ${vorher.size})`;
  const rE = await rechnung(B.id, 'QA · Mahnung Ohne Mail', 'QA-MA-0005', plus(-40), 4500);

  const pa = await portalZugang('QA Admin', ADMIN_A, A.id);
  const pb = await portalZugang('QA Admin B', ADMIN_B, B.id);
  const { s } = await anmelden(STAFF[0], 'Test Mahnung', 'inhaber');

  // ════ Einstellungen: Mahnwesen ════
  await s.goto(`${CRM}/einstellungen?tab=mahnwesen`);
  const fm = s.getByRole('form', { name: 'Mahnwesen' });
  pruefen(
    (await fm.getByLabel('Zahlungserinnerung nach').inputValue()) === '7' && (await fm.getByLabel('1. Mahnung nach').inputValue()) === '21' && (await fm.getByLabel('2. Mahnung nach').inputValue()) === '35' && (await fm.getByLabel('Neue Frist (Tage)').inputValue()) === '7',
    'Einstellungen: 7 / 21 / 35 Tage, Frist 7 Tage (Standard)',
  );
  await fm.getByLabel('1. Mahnung nach').fill('5');
  await fm.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(fm.getByText(/müssen aufeinander folgen/)), 'falsche Reihenfolge wird abgelehnt');
  await fm.getByLabel('1. Mahnung nach').fill('21');
  await fm.getByLabel('Zahlungserinnerung nach').fill('12');
  await fm.getByRole('button', { name: 'Speichern' }).click();
  await sichtbar(fm.getByText(/^Gespeichert\./));
  await s.goto(`${CRM}/abrechnung?tab=mahnungen`);
  const liste = s.getByRole('list', { name: 'Fällige Mahnungen' });
  const nummern = async () => (await liste.count()) ? (await text(liste)) : '';
  pruefen(!(await nummern()).includes('QA-MA-0001'), 'Erinnerung erst nach 12 Tagen: 10 Tage alte Rechnung nicht in der Liste');
  await s.goto(`${CRM}/einstellungen?tab=mahnwesen`);
  await fm.getByLabel('Zahlungserinnerung nach').fill('7');
  await fm.getByRole('button', { name: 'Speichern' }).click();
  await sichtbar(fm.getByText(/^Gespeichert\./));

  // ════ Liste ════
  await s.goto(`${CRM}/abrechnung?tab=mahnungen`);
  const t0 = await nummern();
  pruefen(t0.includes('QA-MA-0001') && t0.includes('QA-MA-0004') && t0.includes('QA-MA-0005') && !t0.includes('QA-MA-0002') && !t0.includes('QA-MA-0003'), 'Liste: nur fällige (nicht zu jung, nicht bezahlt)');
  const zeile = (nr) => liste.getByRole('listitem').filter({ hasText: nr });
  pruefen(
    (await text(zeile('QA-MA-0001'))).includes('Zahlungserinnerung') && (await text(zeile('QA-MA-0001'))).includes(`an ${RECHNUNG_MAIL}`) && (await text(zeile('QA-MA-0001'))).includes('(10 Tage)'),
    'Zeile: Stufe, Empfänger, Tage überfällig',
  );
  pruefen((await text(zeile('QA-MA-0004'))).includes('1. Mahnung') && (await text(zeile('QA-MA-0005'))).includes('ohne E-Mail-Adresse'), '1. Mahnung nach abgelaufener Frist; ohne Adresse: nur PDF');
  await bild(s, 'm1-liste');

  // ════ Senden: eine ════
  await zeile('QA-MA-0001').getByRole('button', { name: 'Senden' }).click();
  pruefen(await sichtbar(s.getByText(`Zahlungserinnerung zu QA-MA-0001 wird an ${RECHNUNG_MAIL} gesendet.`)), 'Senden: Meldung bleibt oben');
  pruefen(await warten(async () => !(await nummern()).includes('QA-MA-0001')), 'gesendete Erinnerung verschwindet aus der Liste');
  const [b1] = await sql`select * from ddl.dunning_letters where invoice_id = ${rA.id}`;
  pruefen(b1?.stufe === 1 && b1.offen_cent === 10000 && iso(b1.frist) === plus(7) && b1.an === RECHNUNG_MAIL, `Datenbank: Stufe 1, € 100 offen, Frist ${tag(plus(7))}`);
  const m1 = await mailVon(RECHNUNG_MAIL, 'Zahlungserinnerung zur Rechnung QA-MA-0001 – Digital Dental Lab');
  const i1 = m1 ? await mailLesen(m1.ID) : null;
  const anh = i1?.Attachments ?? [];
  const brief = anh.find((a) => a.FileName === 'Zahlungserinnerung_QA-MA-0001.pdf');
  const rg = anh.find((a) => a.FileName === 'Rechnung_QA-MA-0001.pdf');
  const rgDaten = rg ? Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${m1.ID}/part/${rg.PartID}`)).arrayBuffer()) : null;
  pruefen(anh.length === 2 && brief && rgDaten && sha(rgDaten) === rA.sha256, 'E-Mail: Zahlungserinnerung und die Rechnung als PDF (sha256)');
  const pdf1 = path.join(tmpdir(), 'ddl-qa-mahnung-1.pdf');
  writeFileSync(pdf1, Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${m1.ID}/part/${brief.PartID}`)).arrayBuffer()));
  if (BILDER) execFileSync('swift', ['scripts/qa-pdf.swift', pdf1, path.join(BILDER, 'm-pdf-erinnerung.png')]);
  const t1 = pdfText(pdf1);
  const fehltPdf = ['Zahlungserinnerung', 'zu Rechnung QA-MA-0001', 'QA · Mahnung Ordination', 'Offener Betrag', '€ 100,00', tag(plus(7)), 'AT61 1904 3002 3457 3201', 'nur übersehen', 'Verwendungszweck: QA-MA-0001'].filter((x) => !t1.includes(x));
  pruefen(!fehltPdf.length, `PDF: Titel, Bezug, Empfänger, offener Betrag, neue Frist, IBAN, freundlicher Ton${fehltPdf.length ? ` → fehlt: ${fehltPdf.join(' | ')}` : ''}`);

  // ════ Alle senden ════
  await s.getByRole('button', { name: 'Alle 2 senden' }).click();
  pruefen(await sichtbar(s.getByText('1 per E-Mail gesendet. 1 ohne E-Mail-Adresse erstellt (bitte ausdrucken).')), 'Alle senden: eine per E-Mail, eine nur als PDF');
  pruefen(await sichtbar(s.getByText('Keine Mahnung fällig.')), 'danach: keine Mahnung fällig');
  const m4 = await mailVon(RECHNUNG_MAIL, '1. Mahnung zur Rechnung QA-MA-0004 – Digital Dental Lab');
  const i4 = m4 ? await mailLesen(m4.ID) : null;
  const b4 = i4?.Attachments?.find((a) => a.FileName === '1-Mahnung_QA-MA-0004.pdf');
  const pdf4 = path.join(tmpdir(), 'ddl-qa-mahnung-4.pdf');
  if (b4) writeFileSync(pdf4, Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${m4.ID}/part/${b4.PartID}`)).arrayBuffer()));
  pruefen(Boolean(b4) && pdfText(pdf4).includes(`trotz unserer Zahlungserinnerung vom ${tag(plus(-18))}`), '1. Mahnung: E-Mail, PDF mit Bezug auf die Erinnerung');
  const [b5] = await sql`select * from ddl.dunning_letters where invoice_id = ${rE.id}`;
  pruefen(b5?.stufe === 1 && b5.an === null && b5.job_id === null, 'ohne Adresse: Schreiben erstellt, nicht gesendet');

  // ════ Konto ════
  await s.goto(`${CRM}/abrechnung/${A.id}?tab=rechnungen`);
  const rechnungen = s.getByRole('list', { name: 'Rechnungen und Gutschriften' });
  const kz = (nr) => rechnungen.getByRole('listitem').filter({ has: s.getByRole('link', { name: nr, exact: true }) });
  const ka = await text(kz('QA-MA-0001'));
  const kaOk = ka.includes(`Zahlungserinnerung · ${tag(HEUTE)} · Frist ${tag(plus(7))} · per E-Mail gesendet am`) && !ka.includes('1. Mahnung senden');
  pruefen(kaOk, `Konto: Schreiben mit Datum, Frist, gesendet; keine weitere Stufe fällig${kaOk ? '' : ` → ${ka}`}`);
  const rF = await rechnung(A.id, 'QA · Mahnung Ordination', 'QA-MA-0006', plus(-9), 3000);
  await s.reload();
  await kz('QA-MA-0006').getByText('Zahlungserinnerung senden', { exact: true }).click();
  await s.getByRole('form', { name: 'Zahlungserinnerung zu QA-MA-0006' }).getByRole('button', { name: 'Erstellen und senden' }).click();
  pruefen(await warten(async () => (await sql`select 1 from ddl.dunning_letters where invoice_id = ${rF.id}`).length === 1), 'Konto: »Zahlungserinnerung senden« bei der Rechnung');
  await bild(s, 'm2-konto');

  await s.goto(`${CRM}/abrechnung/${B.id}?tab=rechnungen`);
  const ke = kz('QA-MA-0005');
  pruefen((await text(ke)).includes('nicht per E-Mail gesendet'), 'Konto ohne Adresse: »nicht per E-Mail gesendet«');
  await ke.getByRole('button', { name: 'Per E-Mail senden' }).click();
  const hinweisOk = await sichtbar(ke.getByText(/Mahnung Ohne Mail ist keine E-Mail-Adresse hinterlegt/));
  pruefen(hinweisOk, `ohne Adresse: Hinweis statt Versand${hinweisOk ? '' : ` → ${await text(ke)}`}`);
  await sql`update ddl.practices set billing_email = ${B_MAIL} where id = ${B.id}`;
  await ke.getByRole('button', { name: 'Per E-Mail senden' }).click();
  pruefen(Boolean(await mailVon(B_MAIL, 'Zahlungserinnerung zur Rechnung QA-MA-0005 – Digital Dental Lab')), 'nach dem Eintragen der Adresse: Erinnerung per E-Mail');
  const [{ n: erstellt }] = await sql`select count(*)::int as n from ddl.audit_log where action = 'mahnung_erstellt' and actor_id = (select id from ddl.staff_users where email = ${STAFF[0]})`;
  const [{ n: versendet }] = await sql`select count(*)::int as n from ddl.audit_log where action = 'mahnung_versendet' and actor_id = (select id from ddl.staff_users where email = ${STAFF[0]})`;
  pruefen(erstellt === 4 && versendet === 4, `Audit: 4 erstellt, 4 gesendet (${erstellt}/${versendet})`);

  // ════ Portal ════
  await pa.goto(`${PORTAL}/rechnungen`);
  const pz = pa.getByRole('list', { name: 'Rechnungen und Gutschriften' }).getByRole('listitem').filter({ hasText: 'QA-MA-0001' });
  pruefen((await text(pz)).includes(`Zahlungserinnerung vom ${tag(HEUTE)}`), 'Portal: »Zahlungserinnerung vom …« bei der Rechnung');
  const pdfP = await pa.request.get(`${PORTAL}/api/mahnungen/${b1.id}`);
  pruefen(pdfP.ok() && pdfP.headers()['content-type'] === 'application/pdf', 'Portal: Schreiben als PDF');
  pruefen((await pb.request.get(`${PORTAL}/api/mahnungen/${b1.id}`)).status() === 404, 'andere Ordination: fremdes Schreiben nicht abrufbar (404)');

  // ════ Excel ════
  const ex = await s.request.get(`${CRM}/api/abrechnung/export?von=${plus(-90)}&bis=${HEUTE}`);
  const xlsx = path.join(tmpdir(), 'ddl-qa-mahnung.xlsx');
  writeFileSync(xlsx, await ex.body());
  const op = execFileSync('unzip', ['-p', xlsx, 'xl/worksheets/sheet4.xml']).toString('utf8');
  pruefen(op.includes('Letzte Mahnung') && op.includes(`Zahlungserinnerung vom ${tag(HEUTE)}`) && op.includes(`1. Mahnung vom ${tag(HEUTE)}`), 'Excel »Offene Posten«: Spalte »Letzte Mahnung«');

  // ════ Rollen, Handy ════
  const { s: t } = await anmelden(STAFF[1], 'Test Technik', 'techniker');
  pruefen((await t.request.get(`${CRM}/api/mahnungen/${b1.id}`)).status() === 401, 'Techniker: kein Schreiben (401)');
  const zuBreit = [];
  for (const breite of [390, 320]) {
    for (const url of [`${CRM}/abrechnung`, `${CRM}/abrechnung/${A.id}`, `${CRM}/einstellungen`]) {
      await s.setViewportSize({ width: breite, height: 800 });
      await s.goto(url, { waitUntil: 'networkidle' });
      const w = await s.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${url} ${breite}px: ${w}px`);
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (390 und 320 px)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
  void rB;
} finally {
  await browser.close();
  await aufraeumen();
  if (vorherMahnwesen) await sql`update ddl.settings set value = ${sql.json(vorherMahnwesen.value)} where key = 'mahnwesen'`;
  else await sql`delete from ddl.settings where key = 'mahnwesen'`;
  await sql.end();
}
process.exit(fehler ? 1 : 0);
