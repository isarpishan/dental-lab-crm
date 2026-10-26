// آزمون قدم ۳ فاز ۲ در Chrome: «E-Mail für Rechnungen» در Stammdaten، صدور با ارسال فوری (PDF پیوست، همان فایل
// ذخیره‌شده با sha256)، «Erneut senden»، فایل گم‌شده ← ایمیل نمی‌رود، بدون آدرس ← ارسال پیشنهاد نمی‌شود،
// «Zahlung buchen» در Konto (سقف مبلغ باز، Teilzahlung، bezahlt، حذف)، Gutschrift با ارسال، Saldo، صفحهٔ کلی
// «Offene Rechnungen» (هر Rechnung یک ردیف، جست‌وجو با شماره، «Zahlung buchen» همان‌جا)، پورتال «Rechnungen» (فقط Praxis-Admin، فقط Ordination خودش، Data-Access-Log)، موبایل.
// دادهٔ آزمایشی: «QA · Zahlung …»، @example.invalid، «QA-ZA-…»؛ بعد کامل پاک می‌شود (با فایل‌های PDF و ایمیل‌ها).
// اجرا: pnpm qa qa-zahlungen  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
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
const euro = (cent) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(cent / 100).replace(/\s/g, ' ');
const tag = (d) => new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' }).format(d);
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
const text = async (loc) => (await loc.innerText()).replace(/\s/g, ' ');
/** متن با فاصلهٔ معمولی ← RegExp که فاصلهٔ ثابت Intl را هم می‌پذیرد */
const rx = (t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s'));

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

const INHABER = 'test-zahlung@example.invalid';
const PRAXIS_MAIL = 'qa-zahlung-praxis@example.invalid';
const RECHNUNG_MAIL = 'qa-zahlung-rechnung@example.invalid';
const B_MAIL = 'qa-zahlung-b-rechnung@example.invalid';
const ADMIN_A = 'qa-zahlung-admin@example.invalid';
const TEAM_A = 'qa-zahlung-team@example.invalid';
const ADMIN_B = 'qa-zahlung-b@example.invalid';
const ADRESSEN = [PRAXIS_MAIL, RECHNUNG_MAIL, B_MAIL, ADMIN_A, TEAM_A, ADMIN_B];

async function postfach(an) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${an}"`)}&limit=200`);
  if (!r.ok) throw new Error(`Mailpit: ${r.status}`);
  return (await r.json()).messages ?? [];
}
const mailLesen = async (id) => (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json();
const mailVon = (an, betreff, timeout) => warten(async () => (await postfach(an)).find((m) => m.Subject === betreff) ?? null, timeout);
async function mailpitLeeren() {
  const ids = [];
  for (const a of ADRESSEN) for (const m of await postfach(a)) ids.push(m.ID);
  if (ids.length) await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) });
}
/** آخرین ارسال یک سند، وقتی کار صف تمام شده باشد */
const versandFertig = (rechnungId) =>
  warten(async () => {
    const [z] = await sql`select d.an, j.id, j.type, j.status, j.error from ddl.invoice_dispatches d join ddl.jobs j on j.id = d.job_id
      where d.invoice_id = ${rechnungId} order by d.angefordert_am desc limit 1`;
    return z && (z.status === 'fertig' || z.status === 'fehler') ? z : null;
  });

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Zahlung%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email = ${INHABER}`).map((r) => r.id);
  if (praxen.length) {
    const belege = await sql`select id, storage_key from ddl.invoices where practice_id in ${sql(praxen)}`;
    for (const b of belege) {
      await rm(path.join(SPEICHER, b.storage_key), { force: true });
      await rm(path.join(SPEICHER, `${b.storage_key}.weg`), { force: true });
    }
    if (belege.length) {
      await sql`delete from ddl.jobs where id in (select job_id from ddl.invoice_dispatches where invoice_id in ${sql(belege.map((b) => b.id))})`;
      await sql`delete from ddl.audit_log where target_id in ${sql(belege.map((b) => b.id))}`;
      await sql.begin(async (tx) => {
        await tx`set local ddl.rechnungen_loeschen = 'qa'`;
        await tx`delete from ddl.invoices where practice_id in ${tx(praxen)} and bezug_id is not null`;
        await tx`delete from ddl.invoices where practice_id in ${tx(praxen)}`;
      });
    }
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      await sql`delete from ddl.audit_log where target_id in ${sql(auftraege)}`;
      await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
    }
  }
  const akteure = [...nutzer, ...staff];
  if (akteure.length) {
    await sql`delete from ddl.data_access_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
  }
  if (praxen.length) await sql`delete from ddl.audit_log where target_type = 'practice' and target_id in ${sql(praxen)}`;
  await vereinbarungenLoeschen(sql, praxen);
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
  await mailpitLeeren();
}
await aufraeumen();

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async (breite = 1440) => {
  const ctx = await browser.newContext({ viewport: { width: breite, height: 900 } });
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-zahlung-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-zahlung-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => x.href.startsWith(`${CRM}/`) && !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}
async function portalZugang(name, email, praxisId, rolle) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, ${rolle}, now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-zahlung-2');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-zahlung-2');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}
async function auftrag({ praxis, nr, lieferart, status, stand, zaehne = [], approved = null, delivered = null }) {
  const [o] = await sql`insert into ddl.orders (order_no, practice_id, work_type_key, delivery_kind, config, status, source, submitted_at,
      created_by_kind, created_by_id, price_snapshot, approved_at, delivered_at)
    values (${nr}, ${praxis}, 'krone', ${lieferart}, ${sql.json({})}, ${status}, 'labor', now() - interval '40 days',
      'staff', gen_random_uuid(), ${sql.json(stand)}, ${approved}, ${delivered}) returning id`;
  for (const [fdi, treatment] of zaehne) await sql`insert into ddl.order_teeth (order_id, fdi, treatment) values (${o.id}, ${fdi}, ${treatment})`;
  return o.id;
}

try {
  const jetzt = new Date();
  const vormonat = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15, 12);
  const vm = iso(vormonat).slice(0, 7);
  const heute = new Date(jetzt.getTime() - 60_000);
  const faellig = new Date(Date.UTC(Number(iso(jetzt).slice(0, 4)), Number(iso(jetzt).slice(5, 7)) - 1, Number(iso(jetzt).slice(8, 10)) + 14));

  const [A] = await sql`insert into ddl.practices (customer_no, name, street, zip, city, email, billing_mode)
    values ('QA-ZA1', 'QA · Zahlung Ordination', 'Zahlgasse 3', '1020', 'Wien', ${PRAXIS_MAIL}, 'sammel') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name, billing_mode) values ('QA-ZA2', 'QA · Zahlung Einzel', 'einzel') returning id`;
  await auftrag({ praxis: A.id, nr: 'QA-ZA-0001', lieferart: 'fertigung', status: 'geliefert', delivered: vormonat, stand: { lieferart: 'fertigung', preisAb: 120, einheit: 'Zahn' }, zaehne: [[14, 'krone']] });
  await auftrag({ praxis: A.id, nr: 'QA-ZA-0002', lieferart: 'fertigung', status: 'geliefert', delivered: vormonat, stand: { lieferart: 'fertigung', preisAb: 100, einheit: 'Zahn' }, zaehne: [[36, 'krone']] });
  const einzel = await auftrag({ praxis: B.id, nr: 'QA-ZA-0006', lieferart: 'design', status: 'freigegeben', approved: heute, stand: { lieferart: 'design', preisAb: 45, einheit: 'Zahn' }, zaehne: [[46, 'krone']] });

  // پورتال پیش از صدور، تا لینک «Rechnungen» در ایمیل بیاید
  const { s: pa, id: adminA } = await portalZugang('QA Admin', ADMIN_A, A.id, 'praxis_admin');
  const { s: pt } = await portalZugang('QA Team', TEAM_A, A.id, 'mitarbeiter');
  const { s: pb } = await portalZugang('QA Admin B', ADMIN_B, B.id, 'praxis_admin');
  const { s } = await anmelden(INHABER, 'Test Zahlung', 'inhaber');

  // ════ Stammdaten: E-Mail für Rechnungen ════
  await s.goto(`${CRM}/ordinationen/${A.id}`);
  const feld = s.getByLabel('E-Mail für Rechnungen');
  const stamm = s.locator('form').filter({ has: feld });
  await feld.fill(RECHNUNG_MAIL.toUpperCase());
  await stamm.getByRole('button', { name: 'Speichern' }).click();
  await sichtbar(stamm.getByText('Gespeichert.'));
  const [pa1] = await sql`select billing_email from ddl.practices where id = ${A.id}`;
  pruefen(pa1.billing_email === RECHNUNG_MAIL, 'Stammdaten: »E-Mail für Rechnungen« gespeichert (klein geschrieben)');

  // ════ Sammelrechnung mit sofortigem Versand ════
  await s.goto(`${CRM}/abrechnung/${A.id}/rechnung?monat=${vm}`);
  const haken = s.getByLabel(rx(`Danach als PDF per E-Mail an ${RECHNUNG_MAIL} senden.`));
  pruefen(await haken.isChecked(), 'Vorschau: »per E-Mail senden« an die Rechnungsadresse, vorausgewählt');
  await s.getByLabel(/Ich habe die Rechnung geprüft/).check();
  await s.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await s.waitForURL(/ausgestellt=/);
  const [r1] = await sql`select * from ddl.invoices where practice_id = ${A.id} and art = 'rechnung'`;
  pruefen(r1?.summe_cent === 22000, `Rechnung ${r1?.nummer} über € 220 ausgestellt`);
  pruefen(await sichtbar(s.getByText(`Die E-Mail an ${RECHNUNG_MAIL} wird gesendet.`)), 'Konto: »Die E-Mail an … wird gesendet.«');
  const v1 = await versandFertig(r1.id);
  pruefen(v1?.an === RECHNUNG_MAIL && v1.type === 'email_mit_anhang' && v1.status === 'fertig', `Worker: E-Mail mit Anhang an die Rechnungsadresse gesendet${v1?.error ? ` (${v1.error})` : ''}`);
  const m1 = await mailVon(RECHNUNG_MAIL, `Rechnung ${r1.nummer} – Digital Dental Lab`);
  const i1 = m1 ? await mailLesen(m1.ID) : null;
  const a1 = i1?.Attachments?.find((a) => a.FileName === `Rechnung_${r1.nummer}.pdf`);
  const pdf1 = a1 ? Buffer.from(await (await fetch(`${MAILPIT}/api/v1/message/${m1.ID}/part/${a1.PartID}`)).arrayBuffer()) : null;
  pruefen(a1?.ContentType === 'application/pdf' && pdf1 && sha(pdf1) === r1.sha256, 'E-Mail: PDF im Anhang, genau die gespeicherte Rechnung (sha256)');
  const t1 = (i1?.Text ?? '').replace(/\s/g, ' ');
  pruefen(
    ['AT61 1904 3002 3457 3201', `Verwendungszweck: ${r1.nummer}`, euro(22000), tag(faellig), `${PORTAL}/rechnungen`, 'Isar Pishan · Digital Dental Lab'].every((x) => t1.includes(x)) && !(i1?.Text ?? '').includes(PRAXIS_MAIL),
    'E-Mail: Betrag, fällig, IBAN, Verwendungszweck, Link zum Portal',
  );
  pruefen((await postfach(PRAXIS_MAIL)).length === 0, 'an die »E-Mail für Rechnungen«, nicht an die allgemeine Adresse');

  await s.reload();
  const liste = s.getByRole('list', { name: 'Rechnungen und Gutschriften' });
  const zeile = (nr) => liste.getByRole('listitem').filter({ has: s.getByRole('link', { name: nr, exact: true }) });
  const z1 = await text(zeile(r1.nummer));
  pruefen(z1.includes(`Per E-Mail gesendet am ${tag(jetzt)}`) && z1.includes(RECHNUNG_MAIL) && z1.includes(`offen · fällig am ${tag(faellig)}`), 'Konto: »offen · fällig am …« und »Per E-Mail gesendet am … an …«');

  // ════ Erneut senden ════
  await zeile(r1.nummer).getByText('Erneut senden', { exact: true }).click();
  const fs = s.getByRole('form', { name: `${r1.nummer} per E-Mail senden` });
  await fs.getByRole('button', { name: 'Jetzt senden' }).click();
  pruefen(await sichtbar(fs.getByText(`${r1.nummer} wird an ${RECHNUNG_MAIL} gesendet.`)), 'Erneut senden: Meldung');
  const zweite = await warten(async () => ((await postfach(RECHNUNG_MAIL)).filter((m) => m.Subject === `Rechnung ${r1.nummer} – Digital Dental Lab`).length === 2 ? true : null));
  const [{ n: versendet }] = await sql`select count(*)::int as n from ddl.audit_log where action = 'rechnung_versendet' and target_id = ${r1.id}`;
  pruefen(Boolean(zweite) && versendet === 2, 'Erneut senden: zweite E-Mail, zweimal im Audit');

  // ════ Zahlungen ════
  await s.reload();
  await zeile(r1.nummer).getByText('Zahlung buchen', { exact: true }).click();
  const fz = s.getByRole('form', { name: `Zahlung zu ${r1.nummer}` });
  pruefen((await fz.getByLabel('Betrag (€)').inputValue()) === '220,00' && (await fz.getByLabel('Eingegangen am').inputValue()) === iso(jetzt), 'Zahlung: offener Betrag und heutiges Datum vorausgefüllt');
  await fz.getByLabel('Betrag (€)').fill('300');
  await fz.getByRole('button', { name: 'Buchen', exact: true }).click();
  pruefen(await sichtbar(fz.getByText(`Der Betrag ist höher als der offene Betrag von ${euro(22000)}.`)), 'Zahlung über dem offenen Betrag wird abgelehnt');
  await fz.getByLabel('Betrag (€)').fill('100');
  await fz.getByLabel('Notiz').fill('QA Kontoauszug 1');
  await fz.getByRole('button', { name: 'Buchen', exact: true }).click();
  pruefen(await sichtbar(fz.getByText(`Zahlung zu ${r1.nummer} gebucht. Noch offen: ${euro(12000)}.`)), 'Teilzahlung € 100 erfasst, € 120 offen');
  await s.reload();
  const z2 = await text(zeile(r1.nummer));
  pruefen(z2.includes(`teilweise bezahlt · offen ${euro(12000)}`) && z2.includes(`Zahlung ${euro(10000)} · ${tag(jetzt)} · Überweisung · QA Kontoauszug 1`), 'Liste: »teilweise bezahlt«, Zahlung mit Datum, Art und Notiz');
  pruefen((await text(s.getByRole('main'))).includes(`${euro(12000)} offen aus 1 Rechnung`), 'Saldo: € 120 offen');
  await bild(s, 'z1-konto-teilzahlung');

  await zeile(r1.nummer).getByText('Zahlung buchen', { exact: true }).click();
  await fz.getByLabel('Zahlungsart').selectOption('bar');
  await fz.getByRole('button', { name: 'Buchen', exact: true }).click();
  const bezahlt = await warten(async () => ((await text(zeile(r1.nummer))).includes(`bezahlt am ${tag(jetzt)}`) ? true : null));
  pruefen(
    Boolean(bezahlt) && (await zeile(r1.nummer).getByText('Zahlung buchen', { exact: true }).count()) === 0 && (await text(s.getByRole('main'))).includes('Alles bezahlt. Nichts offen.'),
    'Restzahlung: »bezahlt am …«, keine weitere Zahlung angeboten, Saldo »Alles bezahlt«',
  );
  const zl = s.getByRole('list', { name: `Zahlungen zu ${r1.nummer}` }).getByRole('listitem').filter({ hasText: rx(`Zahlung ${euro(12000)}`) });
  pruefen((await text(zl)).includes('Bar'), 'Zahlungsart »Bar« gespeichert');
  await zl.getByText('Löschen', { exact: true }).click();
  await zl.getByRole('button', { name: 'Zahlung löschen' }).click();
  const zurueck = await warten(async () => ((await text(zeile(r1.nummer))).includes(`teilweise bezahlt · offen ${euro(12000)}`) ? true : null));
  const za = await sql`select action, details from ddl.audit_log where target_id = ${r1.id} and action like 'zahlung_%' order by created_at`;
  pruefen(
    Boolean(zurueck) && za.map((a) => a.action).join() === 'zahlung_erfasst,zahlung_erfasst,zahlung_geloescht' && za[2].details.betragCent === 12000,
    'Zahlung gelöscht: wieder € 120 offen; Audit mit beiden Zahlungen und der Löschung',
  );
  const gesperrt = await sql`insert into ddl.payments (invoice_id, practice_id, betrag_cent, eingegangen_am, erfasst_von_label) values (${r1.id}, ${A.id}, 0, current_date, 'QA')`.then(() => false, () => true);
  pruefen(gesperrt, 'Datenbank: Zahlung über € 0 ist nicht möglich');

  // ════ Gutschrift mit Versand ════
  await zeile(r1.nummer).getByText('Gutschrift', { exact: true }).click();
  const fg = s.getByRole('form', { name: `Gutschrift zu ${r1.nummer}` });
  await fg.getByLabel('Bezeichnung').fill('Kulanz QA');
  await fg.getByLabel('Betrag (€)').fill('20');
  await fg.getByLabel('Grund').fill('QA Kulanz');
  pruefen(await fg.getByLabel(`Per E-Mail an ${RECHNUNG_MAIL} senden`).isChecked(), 'Gutschrift: »Per E-Mail senden« vorausgewählt');
  await fg.getByRole('button', { name: 'Gutschrift ausstellen' }).click();
  pruefen(await sichtbar(fg.getByText(new RegExp(`^G-\\d{4}-\\d{4} ausgestellt\\. Die E-Mail an ${RECHNUNG_MAIL.replace(/\./g, '\\.')} wird gesendet\\.$`))), 'Gutschrift ausgestellt und zum Versand vorbereitet');
  const [g1] = await sql`select * from ddl.invoices where bezug_id = ${r1.id}`;
  const mg = await mailVon(RECHNUNG_MAIL, `Gutschrift ${g1.nummer} zur Rechnung ${r1.nummer} – Digital Dental Lab`);
  const ig = mg ? await mailLesen(mg.ID) : null;
  pruefen(Boolean(ig?.Attachments?.find((a) => a.FileName === `Gutschrift_${g1.nummer}.pdf`)) && (ig?.Text ?? '').replace(/\s/g, ' ').includes(`über ${euro(2000)} zur Rechnung ${r1.nummer}`), 'E-Mail: Gutschrift mit PDF und Bezug');
  await s.reload();
  pruefen((await text(zeile(r1.nummer))).includes(`teilweise bezahlt · offen ${euro(10000)}`), 'nach der Gutschrift: € 100 offen');

  // ════ Ordination ohne Adresse, und fehlende PDF-Datei ════
  await s.goto(`${CRM}/abrechnung/${B.id}/rechnung?auftrag=${einzel}`);
  pruefen((await sichtbar(s.getByText(/Keine E-Mail-Adresse für Rechnungen hinterlegt/))) && (await s.getByLabel(/per E-Mail an/).count()) === 0, 'ohne Adresse: kein Versand angeboten, Hinweis auf die Stammdaten');
  await s.getByLabel(/Ich habe die Rechnung geprüft/).check();
  await s.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await s.waitForURL(/ausgestellt=/);
  const [r2] = await sql`select * from ddl.invoices where practice_id = ${B.id}`;
  await zeile(r2.nummer).getByText('Per E-Mail senden', { exact: true }).click();
  pruefen(await sichtbar(zeile(r2.nummer).getByRole('link', { name: 'In den Stammdaten eintragen' })), 'Konto ohne Adresse: »In den Stammdaten eintragen«');
  await sql`update ddl.practices set billing_email = ${B_MAIL} where id = ${B.id}`;
  const datei = path.join(SPEICHER, r2.storage_key);
  await rename(datei, `${datei}.weg`);
  await s.reload();
  await zeile(r2.nummer).getByText('Per E-Mail senden', { exact: true }).click();
  await s.getByRole('form', { name: `${r2.nummer} per E-Mail senden` }).getByRole('button', { name: 'Jetzt senden' }).click();
  const v2 = await versandFertig(r2.id);
  pruefen(v2?.status === 'fehler' && /fehlt oder wurde verändert/.test(v2.error ?? ''), 'PDF-Datei fehlt: keine E-Mail (auch nicht ohne Anhang)');
  await s.reload();
  pruefen((await text(zeile(r2.nummer))).includes(`E-Mail an ${B_MAIL} nicht gesendet: Anhang`), 'Konto: »nicht gesendet« mit Grund');
  await rename(`${datei}.weg`, datei);
  await zeile(r2.nummer).getByText('Per E-Mail senden', { exact: true }).click();
  await s.getByRole('form', { name: `${r2.nummer} per E-Mail senden` }).getByRole('button', { name: 'Jetzt senden' }).click();
  pruefen(Boolean(await mailVon(B_MAIL, `Rechnung ${r2.nummer} – Digital Dental Lab`)), 'Datei wieder da: E-Mail gesendet');

  // ════ Übersicht: offene Rechnungen, Suche, »Zahlung buchen« ════
  await s.goto(`${CRM}/abrechnung?tab=offen`);
  const ol = s.getByRole('list', { name: 'Offene Rechnungen' });
  const oz = (nr) => ol.getByRole('listitem').filter({ has: s.getByRole('link', { name: nr, exact: true }) });
  const o1 = await text(oz(r1.nummer));
  const o2 = await text(oz(r2.nummer));
  pruefen(o1.includes('QA · Zahlung Ordination') && o1.includes(euro(10000)) && o1.includes(`von ${euro(22000)}`) && o2.includes('QA · Zahlung Einzel') && o2.includes(euro(4500)), 'Übersicht: je Rechnung eine Zeile mit Ordination, offenem Betrag (»von …« nach Teilzahlung)');
  await bild(s, 'z2-uebersicht');

  const suche = s.getByLabel('Rechnung suchen');
  await suche.fill(r2.nummer.replace(/-/g, ' ').toLowerCase());
  pruefen((await ol.getByRole('listitem').count()) === 1 && (await oz(r2.nummer).count()) === 1, 'Suche: Rechnungsnummer ohne Bindestriche, klein → genau eine Zeile');
  await suche.press('Enter');
  const fb = s.getByRole('form', { name: `Zahlung zu ${r2.nummer} buchen` });
  pruefen(
    (await sichtbar(fb)) && (await fb.getByLabel('Betrag (€)').inputValue()) === '45,00' && (await fb.getByLabel('Eingegangen am').inputValue()) === iso(jetzt),
    'Enter bei einem Treffer öffnet »Zahlung buchen«: offener Betrag und heute vorausgefüllt',
  );
  const gestern = iso(new Date(jetzt.getTime() - 86_400_000));
  await fb.getByLabel('Eingegangen am').fill(gestern);
  await bild(s, 'z2b-buchen');
  await fb.getByRole('button', { name: 'Buchen', exact: true }).click();
  pruefen(await sichtbar(s.getByText(`Zahlung zu ${r2.nummer} gebucht. ${r2.nummer} ist bezahlt.`)), 'Buchen: Meldung »… ist bezahlt«');
  const weg = await warten(async () => ((await oz(r2.nummer).count()) === 0 ? true : null));
  const [p2] = await sql`select betrag_cent, eingegangen_am::text as am, art from ddl.payments where invoice_id = ${r2.id}`;
  pruefen(Boolean(weg) && (await suche.inputValue()) === '' && p2?.betrag_cent === 4500 && p2.am === gestern && p2.art === 'ueberweisung', 'bezahlte Rechnung verschwindet, Suche leer; Zahlung mit gewähltem Datum gespeichert');
  pruefen(await suche.evaluate((e) => e === document.activeElement), 'nach dem Buchen steht der Cursor wieder in der Suche');

  await suche.fill('zahlung ordination');
  await oz(r1.nummer).getByRole('button', { name: 'Zahlung buchen' }).click();
  const fb1 = s.getByRole('form', { name: `Zahlung zu ${r1.nummer} buchen` });
  await fb1.getByLabel('Betrag (€)').fill('500');
  await fb1.getByRole('button', { name: 'Buchen', exact: true }).click();
  pruefen(await sichtbar(fb1.getByText(`Der Betrag ist höher als der offene Betrag von ${euro(10000)}.`)), 'Suche nach Ordination; zu hoher Betrag: Fehler direkt im Formular, nichts gebucht');
  await s.getByLabel('Rechnung suchen').fill('R-0000-9999');
  pruefen(await sichtbar(s.getByText('Keine offene Rechnung passt zu „R-0000-9999“.')), 'Suche ohne Treffer: Hinweis');

  // ════ Portal ════
  await pa.goto(`${PORTAL}/`);
  pruefen(await pa.getByRole('navigation').getByRole('link', { name: 'Rechnungen' }).isVisible(), 'Portal-Admin: Menüpunkt »Rechnungen«');
  await pa.goto(`${PORTAL}/rechnungen`);
  // die Rechnungsadresse steht in der Erläuterung hinter dem »i« neben dem Titel
  await pa.getByRole('button', { name: 'Erläuterung zu dieser Seite' }).click();
  const pm = await text(pa.getByRole('main'));
  const pl = await text(pa.getByRole('list', { name: 'Rechnungen und Gutschriften' }));
  pruefen(pm.includes(`${euro(10000)} offen aus 1 Rechnung`) && pm.includes('AT61 1904 3002 3457 3201') && pm.includes('Isar Pishan · Digital Dental Lab') && pm.includes(RECHNUNG_MAIL), 'Portal: offener Betrag, Zahlungsdaten, Rechnungsadresse');
  pruefen(pl.includes(r1.nummer) && pl.includes(g1.nummer) && pl.includes(`teilweise bezahlt · offen ${euro(10000)}`) && !pm.includes('QA Kontoauszug') && !pl.includes(r2.nummer), 'Portal: eigene Rechnung mit Zahlstand und Gutschrift, ohne interne Notiz, ohne fremde Rechnung');
  const pdfP = await pa.request.get(`${PORTAL}/api/rechnungen/${r1.id}`);
  pruefen(pdfP.ok() && pdfP.headers()['content-type'] === 'application/pdf' && sha(await pdfP.body()) === r1.sha256, 'Portal: Rechnungs-PDF');
  const [{ n: protokoll }] = await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${adminA} and action = 'herunterladen'`;
  pruefen(protokoll >= 1, 'Data-Access-Log: Download im Portal protokolliert');
  await bild(pa, 'z3-portal');
  pruefen((await pt.getByRole('navigation').getByRole('link', { name: 'Rechnungen' }).count()) === 0, 'Mitarbeiter: kein Menüpunkt »Rechnungen«');
  await pt.goto(`${PORTAL}/rechnungen`);
  pruefen((await sichtbar(pt.getByRole('heading', { name: 'Kein Zugriff.' }))) && (await pt.request.get(`${PORTAL}/api/rechnungen/${r1.id}`)).status() === 404, 'Mitarbeiter: Seite und PDF gesperrt');
  pruefen((await pb.request.get(`${PORTAL}/api/rechnungen/${r1.id}`)).status() === 404, 'andere Ordination: fremde Rechnung nicht abrufbar (404)');

  // موبایل
  const zuBreit = [];
  for (const breite of [390, 320]) {
    for (const [seite, url] of [[pa, `${PORTAL}/rechnungen`], [s, `${CRM}/abrechnung/${A.id}`], [s, `${CRM}/abrechnung`], [s, `${CRM}/abrechnung?tab=offen`]]) {
      await seite.setViewportSize({ width: breite, height: 800 });
      await seite.goto(url, { waitUntil: 'networkidle' });
      const w = await seite.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${url} ${breite}px: ${w}px`);
      if (breite === 390) await bild(seite, `z4-mobil-${new URL(url).host.split('.')[0]}-${new URL(url).pathname.split('/').length}`);
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (390 und 320 px)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
