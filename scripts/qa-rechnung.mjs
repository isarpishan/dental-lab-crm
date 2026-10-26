// آزمون قدم ۲ فاز ۲ (Rechnung) در Chrome: «Einstellungen» (فقط Inhaber، IBAN با رقم کنترل)، پیش‌نمایش
// و صدور Sammelrechnung با شمارهٔ پیوسته، متن PDF طبق § 11 UStG، قفل سفارش‌های فاکتورشده، تکرارنشدن،
// «ohne Preis» و قفل صدور، Storno (سفارش‌ها دوباره باز) و فاکتور دوباره، Gutschrift جزئی با سقف،
// Einzelrechnung، قفل دیتابیس، نقش‌ها، و موبایل.
// دادهٔ آزمایشی: «QA · Rechnung …»، @example.invalid، «QA-RE-…»؛ بعد کامل پاک می‌شود (با فایل‌های PDF).
// اجرا: pnpm qa qa-rechnung  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
const euro = (cent) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(cent / 100).replace(/\s/g, ' ');
const tag = (d) => new Intl.DateTimeFormat('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' }).format(d);
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
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

const INHABER = 'test-rechnung@example.invalid';
const BUERO = 'test-rechnung-buero@example.invalid';
const TECHNIKER = 'test-rechnung-tech@example.invalid';
const FUSS = 'Vielen Dank für die Zusammenarbeit. QA';

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Rechnung%'`).map((r) => r.id);
  const staff = (await sql`select id from ddl.staff_users where email in ${sql([INHABER, BUERO, TECHNIKER])}`).map((r) => r.id);
  if (praxen.length) {
    const belege = await sql`select id, storage_key from ddl.invoices where practice_id in ${sql(praxen)}`;
    for (const b of belege) await rm(path.join(SPEICHER, b.storage_key), { force: true });
    if (belege.length) {
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
  if (staff.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.data_access_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(staff)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(staff)}`;
  }
  if (praxen.length) await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
}
await aufraeumen();
// تنظیمات مثل بعد از seed (آزمون متن پایانی را عوض می‌کند و در آخر برمی‌گرداند)
const [vorherRechnung] = await sql`select value from ddl.settings where key = 'rechnung'`;

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
  await s.getByLabel('Neues Passwort').fill('test-passwort-rechnung-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-rechnung-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}
async function auftrag({ praxis, nr, lieferart, status, stand, zaehne = [], tempo = 'standard', approved = null, delivered = null }) {
  const [o] = await sql`insert into ddl.orders (order_no, practice_id, work_type_key, delivery_kind, config, status, source, tempo, submitted_at,
      created_by_kind, created_by_id, price_snapshot, approved_at, delivered_at)
    values (${nr}, ${praxis}, 'krone', ${lieferart}, ${sql.json({})}, ${status}, 'labor', ${tempo}, now() - interval '40 days',
      'staff', gen_random_uuid(), ${sql.json(stand)}, ${approved}, ${delivered}) returning id`;
  for (const [fdi, treatment] of zaehne) await sql`insert into ddl.order_teeth (order_id, fdi, treatment) values (${o.id}, ${fdi}, ${treatment})`;
  return o.id;
}
async function pdfVon(s, id, name) {
  const a = await s.request.get(`${CRM}/api/rechnungen/${id}`);
  const datei = path.join(tmpdir(), `ddl-qa-${name}.pdf`);
  writeFileSync(datei, await a.body());
  if (BILDER) execFileSync('swift', ['scripts/qa-pdf.swift', datei, path.join(BILDER, `r-pdf-${name}.png`)]);
  return { ok: a.ok() && a.headers()['content-type'] === 'application/pdf', text: pdfText(datei) };
}

try {
  const jetzt = new Date();
  const vormonat = new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15, 12);
  const vm = iso(vormonat).slice(0, 7);
  const heute = new Date(jetzt.getTime() - 60_000);
  const jahr = iso(jetzt).slice(0, 4);
  const letzterVm = new Date(Date.UTC(Number(vm.slice(0, 4)), Number(vm.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const faellig = new Date(Date.UTC(Number(iso(jetzt).slice(0, 4)), Number(iso(jetzt).slice(5, 7)) - 1, Number(iso(jetzt).slice(8, 10)) + 14));

  const [A] = await sql`insert into ddl.practices (customer_no, name, street, zip, city, uid_number, billing_mode)
    values ('QA-RE1', 'QA · Rechnung Ordination', 'Rechnungsgasse 7', '1100', 'Wien', 'ATU12345678', 'sammel') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name, billing_mode) values ('QA-RE2', 'QA · Rechnung Einzel', 'einzel') returning id`;
  const krone = await auftrag({
    praxis: A.id, nr: 'QA-RE-0001', lieferart: 'fertigung', status: 'geliefert', tempo: 'express', delivered: vormonat,
    stand: { lieferart: 'fertigung', preisAb: 120, einheit: 'Zahn', zuschlag: { betrag: 40, einheit: 'Auftrag' } }, zaehne: [[14, 'krone'], [15, 'krone']],
  });
  await auftrag({ praxis: A.id, nr: 'QA-RE-0002', lieferart: 'fertigung', status: 'geliefert', delivered: heute, stand: { lieferart: 'fertigung', preisAb: 100, einheit: 'Zahn' }, zaehne: [[36, 'krone']] });
  await auftrag({ praxis: A.id, nr: 'QA-RE-0003', lieferart: 'design', status: 'freigegeben', approved: heute, stand: { lieferart: 'design', preisAb: null, einheit: 'Zahn' }, zaehne: [[21, 'krone']] });
  const einzel = await auftrag({ praxis: B.id, nr: 'QA-RE-0006', lieferart: 'design', status: 'freigegeben', approved: heute, stand: { lieferart: 'design', preisAb: 45, einheit: 'Zahn' }, zaehne: [[46, 'krone']] });

  const { s } = await anmelden(INHABER, 'Test Rechnung', 'inhaber');

  // ════ Einstellungen ════
  pruefen(await s.getByRole('navigation').getByRole('link', { name: 'Einstellungen' }).isVisible(), 'Inhaber: Menüpunkt »Einstellungen«');
  // Preise, Benutzer, Ordinationen, Reklamationen und Touren sind Tabs unter »Einstellungen«, nicht mehr im Menü
  const menue = (await s.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link').allTextContents()).join(',');
  pruefen(!/Preise|Benutzer|Ordinationen|Reklamationen|Touren/.test(menue), `Menü ohne Preise, Benutzer, Ordinationen, Reklamationen, Touren (${menue})`);
  await s.goto(`${CRM}/touren`);
  const tabsI = (await s.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link').allTextContents()).join(',');
  // »Steuer« seit Spec فاز ۵، قدم ۵
  pruefen(tabsI === 'Aussteller & Rechnungen,KI,Handy-Scanner,Steuer,Preise,Benutzer,Ordinationen,Reklamationen,Touren', `Inhaber: neun Tabs (${tabsI})`);
  pruefen(
    (await s.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link', { name: 'Touren' }).getAttribute('aria-current')) === 'page' &&
      (await s.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' }).getAttribute('aria-current')) === 'page',
    'auf /touren: Tab »Touren« und Menüpunkt »Einstellungen« aktiv',
  );
  await s.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link', { name: 'Aussteller & Rechnungen' }).click();
  await s.waitForURL(`${CRM}/einstellungen`);
  const formA = s.getByRole('form', { name: 'Aussteller' });
  const formR = s.getByRole('form', { name: 'Rechnungen' });
  pruefen(
    (await formA.getByLabel('Name').inputValue()) === 'Isar Pishan · Digital Dental Lab' && (await formA.getByLabel('PLZ').inputValue()) === '1200' && (await formA.getByLabel('Ort').inputValue()) === 'Wien',
    'Aussteller: Isar Pishan · Digital Dental Lab, 1200 Wien',
  );
  // »Rechnungen« ist ein eigener Tab (seit 25.10.2026)
  await s.getByRole('navigation', { name: 'Abschnitte' }).getByRole('link', { name: 'Rechnungen', exact: true }).click();
  await s.waitForURL(/tab=rechnungen/);
  pruefen((await formR.getByLabel('IBAN').inputValue()) === 'AT61 1904 3002 3457 3201' && (await formR.getByLabel('Zahlungsziel (Tage)').inputValue()) === '14', 'Rechnungen: IBAN und 14 Tage aus dem Seed');
  await formR.getByLabel('IBAN').fill('AT61 1904 3002 3457 3210');
  await formR.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(formR.getByText(/Die IBAN ist nicht gültig/)), 'falsche IBAN (Prüfziffer) wird abgelehnt');
  await formR.getByLabel('IBAN').fill('AT61 1904 3002 3457 3201');
  await formR.getByLabel('Text am Ende der Rechnung').fill(FUSS);
  await formR.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(formR.getByText('Gespeichert. Gilt für alle neuen Rechnungen.')), 'Rechnungsdaten gespeichert');
  const [einst] = await sql`select details from ddl.audit_log where action = 'einstellungen_geaendert' and target_id = 'rechnung' order by created_at desc limit 1`;
  pruefen(einst?.details?.fusstext?.zu === FUSS && !einst.details.iban, 'Audit: nur der geänderte Fußtext');
  await bild(s, 'r1-einstellungen');

  // ════ Sammelrechnung Vormonat ════
  await s.goto(`${CRM}/abrechnung/${A.id}`);
  await s.getByRole('region', { name: new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric', timeZone: 'Europe/Vienna' }).format(vormonat) }).getByRole('link', { name: 'Sammelrechnung erstellen ↗' }).click();
  await s.waitForURL(/\/rechnung\?monat=/);
  const pos = s.getByRole('table', { name: 'Rechnungspositionen' });
  pruefen((await text(pos)).includes('QA-RE-0001') && (await text(pos)).includes(euro(28000)) && (await text(pos)).includes('Steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.'), 'Vorschau: Krone mit Express, € 280, Steuerhinweis');
  pruefen((await text(s.getByRole('main'))).includes(`${tag(faellig)} (14 Tage)`) && (await text(s.getByRole('main'))).includes('IBAN AT61 1904 3002 3457 3201'), 'Vorschau: fällig in 14 Tagen, IBAN');
  const ausstellen = s.getByRole('button', { name: 'Rechnung ausstellen' });
  pruefen(await ausstellen.isDisabled(), 'ohne Bestätigung: Ausstellen gesperrt');
  await bild(s, 'r2-vorschau');
  await s.getByLabel(/Ich habe die Rechnung geprüft/).check();
  await ausstellen.click();
  await s.waitForURL(/\/abrechnung\/[0-9a-f-]+\?ausgestellt=/);
  // تاریخ‌ها به‌صورت متن، نه شیء Date (کتابخانهٔ postgres ستون date را به Date تبدیل می‌کند)
  const [r1] = await sql`select *, zeitraum_von::text as von, zeitraum_bis::text as bis from ddl.invoices where practice_id = ${A.id} and art = 'rechnung' order by ausgestellt_am limit 1`;
  pruefen(/^R-\d{4}-\d{4}$/.test(r1?.nummer ?? '') && r1.nummer.startsWith(`R-${jahr}-`) && r1.summe_cent === 28000 && r1.von === `${vm}-01` && r1.bis === letzterVm, `Datenbank: ${r1?.nummer}, € 280, Leistungszeitraum Vormonat`);
  pruefen(await sichtbar(s.getByText(`Rechnung ${r1.nummer} über ${euro(28000)} ausgestellt.`)), 'Konto: Meldung mit Nummer und Betrag');
  const zeilen1 = await sql`select order_id, betrag_cent from ddl.invoice_lines where invoice_id = ${r1.id} order by position`;
  pruefen(zeilen1.length === 2 && zeilen1.every((z) => z.order_id === krone) && zeilen1[0].betrag_cent === 24000 && zeilen1[1].betrag_cent === 4000, 'Datenbank: zwei Zeilen, an den Auftrag gebunden');

  const p1 = await pdfVon(s, r1.id, 'rechnung-1');
  const erwartet = [
    'Rechnung', r1.nummer, 'Isar Pishan · Digital Dental Lab', 'Adalbert-Stifter-Straße 35/6/1', '1200 Wien', 'QA · Rechnung Ordination', 'Rechnungsgasse 7', '1100 Wien',
    'Kundennummer', 'QA-RE1', 'Leistungszeitraum', `01.${vm.slice(5, 7)}.${vm.slice(0, 4)}`, 'QA-RE-0001', 'Expresszuschlag', 'Rechnungsbetrag', euro(28000),
    'Steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.', 'AT61 1904 3002 3457 3201', `Verwendungszweck: ${r1.nummer}`, 'UID Empfänger', 'ATU12345678', FUSS, tag(faellig),
  ];
  const fehlt = erwartet.filter((t) => !p1.text.toLowerCase().includes(t.toLowerCase()));
  pruefen(p1.ok && !fehlt.length, `PDF nach § 11 UStG: Aussteller, Empfänger, Nummer, Zeitraum, Positionen, Betrag, Steuerhinweis, IBAN, fällig${fehlt.length ? ` → fehlt: ${fehlt.join(' | ')}` : ''}`);
  pruefen(!/rabatt/i.test(p1.text), 'PDF ohne Rabatt: keine Spalte »Rabatt«');

  // فاکتورشده: از «noch nicht verrechnet» بیرون، پوزیشن‌ها قفل، دوباره فاکتور نمی‌شود
  pruefen(!(await text(s.getByRole('main'))).includes('QA-RE-0001 '), 'Konto: Krone nicht mehr offen');
  await s.goto(`${CRM}/auftraege/${krone}?tab=abrechnung`);
  pruefen((await sichtbar(s.getByText(`Verrechnet mit Rechnung ${r1.nummer}`))) && (await s.getByRole('button', { name: 'Positionen bearbeiten' }).count()) === 0, 'Auftrag: »Verrechnet mit Rechnung …«, nicht mehr bearbeitbar');
  await s.goto(`${CRM}/abrechnung/${A.id}/rechnung?monat=${vm}`);
  pruefen((await sichtbar(s.getByText(/Nichts zu verrechnen/))) && (await s.getByRole('button', { name: 'Rechnung ausstellen' }).isDisabled()), 'gleicher Monat ein zweites Mal: nichts zu verrechnen');
  await s.goto(`${CRM}/abrechnung/${A.id}/rechnung?monat=${iso(jetzt).slice(0, 7)}`);
  pruefen((await sichtbar(s.getByText(/Noch ohne Preis: QA-RE-0003/))) && (await s.getByRole('button', { name: 'Rechnung ausstellen' }).isDisabled()), 'Auftrag ohne Preis sperrt die Rechnung');

  // ════ Storno ════
  await s.goto(`${CRM}/abrechnung/${A.id}?tab=rechnungen`);
  const zeileR1 = s.getByRole('listitem').filter({ has: s.getByRole('link', { name: r1.nummer, exact: true }) });
  await zeileR1.getByText('Stornieren', { exact: true }).click();
  const stornoForm = s.getByRole('form', { name: `${r1.nummer} stornieren` });
  await stornoForm.getByLabel('Grund').fill('QA: falsche Menge');
  await stornoForm.getByRole('button', { name: 'Stornorechnung ausstellen' }).click();
  await sichtbar(s.getByText(/^G-\d{4}-\d{4} ausgestellt\.$/));
  const [g1] = await sql`select * from ddl.invoices where bezug_id = ${r1.id}`;
  pruefen(g1?.art === 'gutschrift' && g1.storno && g1.summe_cent === -28000 && /^G-\d{4}-\d{4}$/.test(g1.nummer), `Stornorechnung ${g1?.nummer} über -€ 280`);
  await s.goto(`${CRM}/abrechnung/${A.id}?tab=rechnungen`);
  pruefen((await text(s.getByRole('list', { name: 'Rechnungen und Gutschriften' }))).includes(`storniert mit ${g1.nummer}`), 'Liste: Rechnung als storniert markiert');
  await s.goto(`${CRM}/abrechnung/${A.id}?tab=arbeiten`);
  pruefen((await text(s.getByRole('main'))).includes('QA-RE-0001'), 'nach dem Storno: Krone wieder offen');
  const pg = await pdfVon(s, g1.id, 'storno');
  pruefen(pg.ok && ['Stornorechnung', g1.nummer, r1.nummer, '-€ 280,00', 'QA: falsche Menge'].every((t) => pg.text.replace(/−/g, '-').includes(t)), 'PDF: Stornorechnung mit Bezug, Grund und negativem Betrag');

  // فاکتور دوباره: شمارهٔ بعدی
  await s.goto(`${CRM}/abrechnung/${A.id}/rechnung?monat=${vm}`);
  await s.getByLabel(/Ich habe die Rechnung geprüft/).check();
  await s.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await s.waitForURL(/ausgestellt=/);
  const [r2] = await sql`select * from ddl.invoices where practice_id = ${A.id} and art = 'rechnung' and id <> ${r1.id}`;
  pruefen(Number(r2?.nummer.slice(-4)) === Number(r1.nummer.slice(-4)) + 1, `neu verrechnet mit der nächsten Nummer (${r2?.nummer})`);

  // ════ Gutschrift جزئی ════
  const zeileR2 = s.getByRole('listitem').filter({ has: s.getByRole('link', { name: r2.nummer, exact: true }) });
  await zeileR2.getByText('Gutschrift', { exact: true }).click();
  const gForm = s.getByRole('form', { name: `Gutschrift zu ${r2.nummer}` });
  await gForm.getByLabel('Bezeichnung').fill('Kulanz QA');
  await gForm.getByLabel('Betrag (€)').fill('500');
  await gForm.getByLabel('Grund').fill('QA Kulanz');
  await gForm.getByRole('button', { name: 'Gutschrift ausstellen' }).click();
  pruefen(await sichtbar(gForm.getByText(/höher als der offene Rechnungsbetrag/)), 'Gutschrift über dem Rechnungsbetrag wird abgelehnt');
  await gForm.getByLabel('Betrag (€)').fill('30');
  await gForm.getByRole('button', { name: 'Gutschrift ausstellen' }).click();
  pruefen(await sichtbar(gForm.getByText(/^G-\d{4}-\d{4} ausgestellt\.$/)), 'Gutschrift über € 30 ausgestellt');
  const [g2] = await sql`select * from ddl.invoices where bezug_id = ${r2.id}`;
  pruefen(g2?.summe_cent === -3000 && !g2.storno, 'Datenbank: Gutschrift -€ 30, kein Storno');
  await s.goto(`${CRM}/abrechnung/${A.id}?tab=rechnungen`);
  const zeileR2b = s.getByRole('listitem').filter({ has: s.getByRole('link', { name: r2.nummer, exact: true }) });
  pruefen((await text(zeileR2b)).includes(g2.nummer) && (await zeileR2b.getByText('Stornieren', { exact: true }).count()) === 0, 'Liste: Gutschrift bei der Rechnung, Stornieren nicht mehr angeboten');
  await bild(s, 'r3-konto');

  // ════ Einzelrechnung، با Rabatt ۱۰ ٪ (ویرایش پوزیشن در فرم را `qa-abrechnung` می‌آزماید) ════
  await sql`insert into ddl.order_positions (order_id, position, bezeichnung, menge, einheit, einzelpreis_cent, rabatt_art, rabatt_wert, created_by_id, created_by_label)
    values (${einzel}, 1, 'Krone · Nur Design · Zahn 46', 1, 'Zahn', 4500, 'prozent', 1000, gen_random_uuid(), 'QA')`;
  await s.goto(`${CRM}/abrechnung/${B.id}`);
  await s.getByRole('link', { name: 'Einzelrechnung ↗' }).click();
  await s.waitForURL(/rechnung\?auftrag=/);
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Einzelrechnung QA-RE-0006.' })), 'Einzelrechnung: Vorschau');
  const posR3 = await text(s.getByRole('table', { name: 'Rechnungspositionen' }));
  pruefen([`Rabatt 10 % (− ${euro(450)})`, euro(4050)].every((t) => posR3.includes(t)), 'Vorschau: Rabatt 10 % (− € 4,50), Betrag € 40,50');
  await s.getByLabel(/Ich habe die Rechnung geprüft/).check();
  await s.getByRole('button', { name: 'Rechnung ausstellen' }).click();
  await s.waitForURL(/ausgestellt=/);
  const [r3] = await sql`select *, zeitraum_von::text as von, zeitraum_bis::text as bis from ddl.invoices where practice_id = ${B.id}`;
  pruefen(r3?.abrechnung === 'einzel' && r3.summe_cent === 4050 && r3.von === r3.bis && r3.von === iso(heute), 'Einzelrechnung: € 45 − 10 % = € 40,50, Leistungsdatum');
  const [l3] = await sql`select rabatt_art, rabatt_wert, rabatt_cent, betrag_cent from ddl.invoice_lines where invoice_id = ${r3.id}`;
  pruefen(l3?.rabatt_art === 'prozent' && l3.rabatt_wert === 1000 && l3.rabatt_cent === 450 && l3.betrag_cent === 4050, 'Datenbank: Rechnungszeile mit Rabatt 10 % (€ 4,50)');
  const p3 = await pdfVon(s, r3.id, 'rechnung-rabatt');
  // سرستون‌های PDF بزرگ نوشته می‌شوند («RABATT»)؛ «−» در PDF «–» است
  pruefen(
    p3.ok && /rabatt/i.test(p3.text) && ['10 %', `– ${euro(450)}`, euro(4050)].every((t) => p3.text.includes(t)),
    `PDF: Spalte »Rabatt« mit 10 % und – € 4,50, Rechnungsbetrag € 40,50${p3.ok ? '' : ' (PDF fehlt)'}`,
  );
  const [{ n: offenB }] = await sql`select count(*)::int as n from ddl.invoice_lines where order_id = ${einzel}`;
  pruefen(offenB === 1, 'Auftrag steht auf genau einer Rechnung');

  // Storno einer Rechnung mit Rabatt: alles mit umgekehrtem Vorzeichen
  await s.goto(`${CRM}/abrechnung/${B.id}?tab=rechnungen`);
  await s.getByRole('listitem').filter({ has: s.getByRole('link', { name: r3.nummer, exact: true }) }).getByText('Stornieren', { exact: true }).click();
  const stornoR3 = s.getByRole('form', { name: `${r3.nummer} stornieren` });
  await stornoR3.getByLabel('Grund').fill('QA: Rabatt');
  await stornoR3.getByRole('button', { name: 'Stornorechnung ausstellen' }).click();
  await sichtbar(s.getByText(/^G-\d{4}-\d{4} ausgestellt\.$/));
  const [g3] = await sql`select * from ddl.invoices where bezug_id = ${r3.id}`;
  const [gl3] = g3 ? await sql`select rabatt_art, rabatt_wert, rabatt_cent, betrag_cent from ddl.invoice_lines where invoice_id = ${g3.id}` : [];
  pruefen(g3?.storno && g3.summe_cent === -4050 && gl3?.rabatt_cent === -450 && gl3.rabatt_wert === 1000 && gl3.betrag_cent === -4050, 'Stornorechnung mit Rabatt: -€ 40,50, Rabatt -€ 4,50');
  const pg3 = await pdfVon(s, g3.id, 'storno-rabatt');
  pruefen(pg3.ok && /rabatt/i.test(pg3.text) && ['10 %', `+ ${euro(450)}`].every((t) => pg3.text.includes(t)) && pg3.text.replace(/−/g, '-').includes(`-${euro(4050)}`), 'PDF Stornorechnung: Rabatt 10 % (+ € 4,50), -€ 40,50');

  // ════ غیرقابل‌تغییر ════
  const gesperrt = async (f) => {
    try {
      await f();
      return false;
    } catch (e) {
      return /unveränderlich/.test(String(e.message));
    }
  };
  pruefen(await gesperrt(() => sql`update ddl.invoices set summe_cent = 1 where id = ${r2.id}`), 'Datenbank: Rechnung lässt sich nicht ändern');
  pruefen(await gesperrt(() => sql`delete from ddl.invoice_lines where invoice_id = ${r2.id}`), 'Datenbank: Rechnungszeilen lassen sich nicht löschen');

  // موبایل
  const zuBreit = [];
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 800 });
    for (const pfad of [`/abrechnung/${A.id}`, `/abrechnung/${A.id}/rechnung?monat=${iso(jetzt).slice(0, 7)}`, '/einstellungen']) {
      await s.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
      const w = await s.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${pfad} ${breite}px: ${w}px`);
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (390 und 320 px)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);

  // ════ نقش‌ها ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/einstellungen`);
  const bTabs = (await b.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link').allTextContents()).join(',');
  pruefen(
    (await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' }))) &&
      (await b.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' }).getAttribute('href')) === '/ordinationen' &&
      bTabs === 'Ordinationen,Reklamationen,Touren',
    `Büro: »Aussteller & Rechnungen« gesperrt, Einstellungen nur mit Ordinationen, Reklamationen, Touren (${bTabs})`,
  );
  const api = await b.request.get(`${CRM}/api/rechnungen/${r2.id}`);
  pruefen(api.ok(), 'Büro: Rechnungs-PDF abrufbar');
  const { s: t } = await anmelden(TECHNIKER, 'Test Technik', 'techniker');
  await t.goto(`${CRM}/abrechnung/${A.id}/rechnung?monat=${vm}`);
  const apiT = await t.request.get(`${CRM}/api/rechnungen/${r2.id}`);
  pruefen((await sichtbar(t.getByRole('heading', { name: 'Kein Zugriff.' }))) && apiT.status() === 401, 'Techniker: keine Rechnungsvorschau, kein PDF');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  if (vorherRechnung) await sql`update ddl.settings set value = ${sql.json(vorherRechnung.value)} where key = 'rechnung'`;
  await sql.end();
}
process.exit(fehler ? 1 : 0);
