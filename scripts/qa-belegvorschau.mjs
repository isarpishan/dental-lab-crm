// آزمون «Vorschau» اسناد Abrechnung در Chrome (مثل بخش Vorschau در arkan-crm): PDF پیش‌نمایش Rechnung پیش از صدور،
// Musterrechnung زنده در «Einstellungen» (تغییر فیلدها پیش از ذخیره روی PDF)، Gutschrift و Storno زیر فرم، و
// Zahlungserinnerung در فهرست «Mahnungen». هر پیش‌نمایش مُهر «VORSCHAU» و لوگو دارد، و هیچ‌چیز ذخیره، شماره‌گذاری
// یا فرستاده نمی‌شود. نقش‌ها و پورتال، و موبایل (فقط لینک PDF).
// دادهٔ آزمایشی: «QA · Belegvorschau …»، @example.invalid، شماره‌های «QA-BV-…»؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-belegvorschau  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL } from './qa-umgebung.mjs';

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
async function warten(f, timeout = 15000) {
  const ende = Date.now() + timeout;
  while (Date.now() < ende) {
    const r = await f();
    if (r) return r;
    await new Promise((x) => setTimeout(x, 250));
  }
  return null;
}
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};
/** nur der sichtbare Ausschnitt um den Rahmen: Chrome zeichnet PDFs nur, wo sie im Bild sind */
const ansicht = async (s, loc, name) => {
  if (!BILDER) return;
  await loc.scrollIntoViewIfNeeded();
  await s.waitForTimeout(1500);
  await s.screenshot({ path: path.join(BILDER, `${name}.png`) });
  // zurück nach oben: sonst liegen Bedienelemente unter der festen Kopfzeile und der nächste Klick geht daneben
  await s.evaluate(() => window.scrollTo(0, 0));
};
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
const HEUTE = iso(new Date());
const plus = (n) => new Date(Date.UTC(Number(HEUTE.slice(0, 4)), Number(HEUTE.slice(5, 7)) - 1, Number(HEUTE.slice(8, 10)) + n)).toISOString().slice(0, 10);
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

const INHABER = 'test-belegvorschau@example.invalid';
const BUERO = 'test-belegvorschau-buero@example.invalid';
const TECHNIKER = 'test-belegvorschau-tech@example.invalid';
const STAFF = [INHABER, BUERO, TECHNIKER];

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Belegvorschau%'`).map((r) => r.id);
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
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
    if (auftraege.length) await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
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
const einstellungen = async () => JSON.stringify(await sql`select key, value from ddl.settings where key in ('aussteller', 'rechnung') order by key`);
const vorherEinstellungen = await einstellungen();
const nummernStand = async () => JSON.stringify(await sql`select scope, year, last_value from ddl.number_sequences where scope in ('rechnung', 'gutschrift') order by scope, year`);

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
async function anmelden(email, name, rolle, viewport = { width: 1440, height: 900 }) {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${email}, ${name}, ${rolle}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const ctx = await browser.newContext({ viewport });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(m.text()));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-belegvorschau-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-belegvorschau-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return s;
}
/** پیش‌نمایش را مثل iframe از همان آدرس می‌خواند: وضعیت، سربرگ‌ها، متن و این‌که لوگو (تصویر) دارد */
let n = 0;
async function vorschau(s, src) {
  const a = await s.request.get(new URL(src, CRM).href);
  const roh = await a.body();
  const datei = path.join(tmpdir(), `ddl-qa-belegvorschau-${++n}.pdf`);
  writeFileSync(datei, roh);
  const pdf = a.headers()['content-type'] === 'application/pdf';
  if (pdf && BILDER) execFileSync('swift', ['scripts/qa-pdf.swift', datei, path.join(BILDER, `bv-pdf-${n}.png`)]);
  return { status: a.status(), headers: a.headers(), pdf, text: pdf ? pdfText(datei) : roh.toString(), logo: roh.includes('/Subtype /Image') };
}
const iframeSrc = async (loc) => (await loc.getAttribute('src'))?.split('#')[0] ?? '';

try {
  const jetzt = new Date();
  const vm = iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 15, 12)).slice(0, 7);
  const jahr = HEUTE.slice(0, 4);

  const [A] = await sql`insert into ddl.practices (customer_no, name, street, zip, city, billing_mode)
    values ('QA-BV1', 'QA · Belegvorschau Ordination', 'Vorschaugasse 3', '1040', 'Wien', 'sammel') returning id`;
  await sql`insert into ddl.orders (order_no, practice_id, work_type_key, delivery_kind, config, status, source, submitted_at, created_by_kind, created_by_id, price_snapshot, delivered_at)
    values ('QA-BV-0001', ${A.id}, 'krone', 'fertigung', ${sql.json({})}, 'geliefert', 'labor', now() - interval '40 days', 'staff', gen_random_uuid(),
      ${sql.json({ lieferart: 'fertigung', preisAb: 150, einheit: 'Zahn' })}, ${`${vm}-15 12:00+01`}) returning id`
    .then(async ([o]) => sql`insert into ddl.order_teeth (order_id, fdi, treatment) values (${o.id}, 11, 'krone')`);
  // eine ausgestellte Rechnung, 10 Tage überfällig: Gutschrift, Storno und Zahlungserinnerung
  const id = randomUUID();
  const key = `${id.slice(0, 2)}/${id}`;
  mkdirSync(path.join(SPEICHER, id.slice(0, 2)), { recursive: true });
  const inhalt = Buffer.from('%PDF-1.4\n% QA Belegvorschau\n%%EOF\n');
  writeFileSync(path.join(SPEICHER, key), inhalt);
  const [R] = await sql`insert into ddl.invoices (nummer, art, practice_id, abrechnung, ausgestellt_am, faellig_am, summe_cent, empfaenger, aussteller, storage_key, sha256, size, ausgestellt_von_label)
    values ('QA-BV-R001', 'rechnung', ${A.id}, 'sammel', ${`${plus(-24)} 10:00+01`}, ${plus(-10)}, 10000,
      ${sql.json({ name: 'QA · Belegvorschau Ordination', zeilen: ['Vorschaugasse 3', '1040 Wien'], uid: null, kundennummer: 'QA-BV1' })},
      ${sql.json({ name: 'Isar Pishan · Digital Dental Lab', zusatz: 'Digital Dental Lab – Digitale Zahntechnik', strasse: 'Adalbert-Stifter-Straße 35/6/1', ort: '1200 Wien', land: 'Österreich', telefon: '', email: 'lab@drpishan.at', web: '', iban: 'AT611904300234573201', bic: '', uid: '', zahlungszielTage: 14, hinweis: 'Steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.', fusstext: '' })},
      ${key}, ${sha(inhalt)}, ${inhalt.length}, 'QA') returning id`;
  await sql`insert into ddl.invoice_lines (invoice_id, position, auftragsnummer, patientencode, leistungsdatum, bezeichnung, menge, einheit, einzelpreis_cent, betrag_cent)
    values (${R.id}, 1, 'QA-BV-0000', 'P-QABV', ${plus(-30)}, 'Krone · Fertigung', 1, 'Zahn', 10000, 10000)`;
  const nummernVorher = await nummernStand();
  const [{ wert: naechste }] = await sql`select coalesce(max(last_value), 0) + 1 as wert from ddl.number_sequences where scope = 'rechnung' and year = ${Number(jahr)}`;

  const s = await anmelden(INHABER, 'Test Belegvorschau', 'inhaber');

  // ════ Rechnung vor dem Ausstellen ════
  await s.goto(`${CRM}/abrechnung/${A.id}/rechnung?monat=${vm}`);
  const rahmen = s.locator('iframe[title^="Vorschau"]');
  pruefen(await sichtbar(rahmen), 'Rechnung: Vorschau mit dem PDF');
  const ueberschriften = await s.locator('section h2').allInnerTexts();
  const ausstellenForm = await s.getByRole('form', { name: 'Rechnung ausstellen' }).boundingBox();
  const rahmenBox = await rahmen.boundingBox();
  pruefen(
    ueberschriften.slice(0, 3).join(',') === 'Angaben,Positionen,Ausstellen' && ausstellenForm && rahmenBox && rahmenBox.x > ausstellenForm.x + 200,
    `wie Einstellungen: Angaben, Positionen, Ausstellen links, Vorschau rechts (${ueberschriften.slice(0, 3).join(', ')})`,
  );
  pruefen(Boolean(await warten(async () => (await s.locator('figcaption').first().innerText()).includes('So wird die Rechnung aussehen'))), 'PDF im Rahmen geladen (Hinweis »wird aktualisiert« verschwindet)');
  const v1 = await vorschau(s, await iframeSrc(rahmen));
  const nr = `R-${jahr}-${String(naechste).padStart(4, '0')}`;
  // PDFKit liest den gesperrten Schriftzug als «D I G I TA L …»
  const fehlt1 = [...(v1.text.replace(/\s/g, '').includes('DIGITALDENTALLAB') ? [] : ['DIGITAL DENTAL LAB']), ...['VORSCHAU', 'Rechnung', `${nr} (voraussichtlich)`, 'QA · Belegvorschau Ordination', 'QA-BV-0001', '€ 150,00', 'AT61 1904 3002 3457 3201'].filter((t) => !v1.text.includes(t))];
  pruefen(v1.status === 200 && v1.pdf && !fehlt1.length, `PDF-Vorschau: Aufdruck, voraussichtliche Nummer ${nr}, Empfänger, Position, Betrag, IBAN${fehlt1.length ? ` → fehlt: ${fehlt1.join(' | ')}` : ''}`);
  pruefen(v1.logo, 'PDF: Logo oben (Bild im Briefkopf)');
  pruefen(v1.headers['x-frame-options'] === 'SAMEORIGIN' && v1.headers['cache-control'] === 'private, no-store' && /inline/.test(v1.headers['content-disposition'] ?? ''), 'Antwort: inline, nur auf derselben Adresse einbettbar, nicht zwischengespeichert');
  pruefen((await sql`select count(*)::int as n from ddl.invoices where practice_id = ${A.id} and art = 'rechnung' and id <> ${R.id}`)[0].n === 0 && (await nummernStand()) === nummernVorher, 'nichts ausgestellt, keine Nummer verbraucht');
  await bild(s, 'bv1-rechnung');
  await ansicht(s, rahmen, 'bv1-rechnung-ansicht');

  // ════ Einstellungen: Musterrechnung beim Tippen ════
  await s.goto(`${CRM}/einstellungen`);
  const muster = s.locator('iframe[title="Vorschau: Musterrechnung"]');
  pruefen(await sichtbar(muster), 'Einstellungen: Musterrechnung neben den Feldern');
  const box = { f: await s.getByRole('form', { name: 'Aussteller' }).boundingBox(), v: await muster.boundingBox() };
  pruefen(box.f && box.v && box.v.x > box.f.x + box.f.width - 1 && box.v.width >= 500, `breiter Bildschirm: Vorschau rechts daneben (${Math.round(box.v?.width ?? 0)} px breit)`);
  const v2a = await vorschau(s, await iframeSrc(muster));
  pruefen(v2a.pdf && ['VORSCHAU', 'Muster-Ordination Dr. Beispiel', 'Isar Pishan · Digital Dental Lab', 'AT61 1904 3002 3457 3201'].every((t) => v2a.text.includes(t)), 'Musterrechnung mit den gespeicherten Angaben');
  // Tab »Aussteller«: neuer Name
  await s.getByRole('form', { name: 'Aussteller' }).getByLabel('Name').fill('QA Vorschau Labor');
  const src1 = await warten(async () => {
    const x = await iframeSrc(muster);
    return x.includes('name=QA+Vorschau+Labor') ? x : null;
  });
  const vA = await vorschau(s, src1 ?? '');
  pruefen(Boolean(src1) && vA.pdf && vA.text.includes('QA Vorschau Labor'), 'Tab »Aussteller«: Tippen aktualisiert die Vorschau (ohne Speichern)');
  // Tab »Rechnungen«: Fußtext und Zahlungsziel (die Seite hat Tabs seit 25.10.2026)
  await s.goto(`${CRM}/einstellungen?tab=rechnungen`);
  const formR = s.getByRole('form', { name: 'Rechnungen' });
  await formR.getByLabel('Text am Ende der Rechnung').fill('QA Vorschau: Danke schön!');
  await formR.getByLabel('Zahlungsziel (Tage)').fill('30');
  const src2 = await warten(async () => {
    const x = await iframeSrc(muster);
    return x.includes('fusstext=QA+Vorschau') && x.includes('zahlungszielTage=30') ? x : null;
  });
  pruefen(Boolean(src2), 'Tab »Rechnungen«: Tippen aktualisiert die Vorschau (ohne Speichern)');
  const v2 = await vorschau(s, src2 ?? '');
  const faellig30 = plus(30).split('-').reverse().join('.');
  pruefen(v2.pdf && ['QA Vorschau: Danke schön!', faellig30].every((t) => v2.text.includes(t)), `Musterrechnung zeigt Fußtext und Fälligkeit ${faellig30}`);
  await bild(s, 'bv2-einstellungen');
  await ansicht(s, muster, 'bv2-einstellungen-ansicht');
  pruefen((await einstellungen()) === vorherEinstellungen, 'Einstellungen: nichts gespeichert');
  await s.reload();

  // ════ Konto: Gutschrift und Storno ════
  await s.goto(`${CRM}/abrechnung/${A.id}?tab=rechnungen`);
  pruefen((await s.locator('iframe').count()) === 0, 'Konto: keine Vorschau, solange nichts geöffnet ist');
  const zeileR = s.getByRole('listitem').filter({ has: s.getByRole('link', { name: 'QA-BV-R001', exact: true }) });
  await zeileR.getByText('Gutschrift', { exact: true }).click();
  const gutRahmen = s.locator('iframe[title="Vorschau: Gutschrift zu QA-BV-R001"]');
  const gut = s.getByRole('form', { name: 'Gutschrift zu QA-BV-R001' });
  const gutBox = { f: await gut.boundingBox().catch(() => null), v: (await sichtbar(gutRahmen)) ? await gutRahmen.boundingBox() : null };
  pruefen(Boolean(gutBox.f && gutBox.v && gutBox.v.x >= gutBox.f.x + gutBox.f.width && gutBox.v.y < gutBox.f.y + gutBox.f.height), `Gutschrift geöffnet: Vorschau rechts neben dem Formular (${Math.round(gutBox.v?.width ?? 0)} px breit)`);
  await gut.getByLabel('Bezeichnung').fill('QA Kulanz Farbe');
  await gut.getByLabel('Betrag (€)').fill('12,50');
  await gut.getByLabel('Grund').fill('QA Grund Vorschau');
  const src3 = await warten(async () => {
    const x = await iframeSrc(gutRahmen);
    return x.includes('betrag=12%2C50') && x.includes('grund=QA+Grund+Vorschau') ? x : null;
  });
  const v3 = await vorschau(s, src3 ?? '');
  const t3 = v3.text.replace(/−/g, '-');
  pruefen(v3.pdf && ['VORSCHAU', 'Gutschrift', '(voraussichtlich)', 'QA Kulanz Farbe', '-€ 12,50', 'Grund: QA Grund Vorschau', 'bezieht sich auf die Rechnung QA-BV-R001'].every((t) => t3.includes(t)), 'Gutschrift-Vorschau: Bezeichnung, Betrag, Grund, Bezug');
  await bild(s, 'bv3-gutschrift');
  await ansicht(s, gutRahmen, 'bv3-gutschrift-ansicht');
  await zeileR.getByText('Stornieren', { exact: true }).click();
  const stornoRahmen = s.locator('iframe[title="Vorschau: Stornorechnung zu QA-BV-R001"]');
  pruefen(await sichtbar(stornoRahmen), 'Stornieren geöffnet: eigene Vorschau');
  const v4 = await vorschau(s, await iframeSrc(stornoRahmen));
  pruefen(v4.pdf && ['Stornorechnung', 'Krone · Fertigung', 'P-QABV'].every((t) => v4.text.includes(t)) && v4.text.replace(/−/g, '-').includes('-€ 100,00'), 'Storno-Vorschau: alle Positionen negativ');
  pruefen((await sql`select count(*)::int as n from ddl.invoices where bezug_id = ${R.id}`)[0].n === 0 && (await nummernStand()) === nummernVorher, 'keine Gutschrift ausgestellt, keine Nummer verbraucht');

  // ════ Abrechnung: Zahlungserinnerung ════
  await s.goto(`${CRM}/abrechnung?tab=mahnungen`);
  const link = s.getByRole('link', { name: 'Vorschau: Zahlungserinnerung zu QA-BV-R001' });
  pruefen(await sichtbar(link), 'Mahnungen: Link »Vorschau« in der Zeile');
  const v5 = await vorschau(s, await link.getAttribute('href'));
  pruefen(v5.pdf && ['VORSCHAU', 'Zahlungserinnerung', 'zu Rechnung QA-BV-R001', '€ 100,00', 'nur übersehen'].every((t) => v5.text.includes(t)), 'Vorschau der Zahlungserinnerung');
  pruefen((await sql`select count(*)::int as n from ddl.dunning_letters where invoice_id = ${R.id}`)[0].n === 0, 'kein Schreiben erstellt');

  // ════ Rechte ════
  const b = await anmelden(BUERO, 'Test Büro', 'buero');
  pruefen((await vorschau(b, `/api/abrechnung/vorschau?art=rechnung&ordination=${A.id}&monat=${vm}`)).pdf, 'Büro: Rechnungsvorschau erlaubt');
  pruefen((await vorschau(b, '/api/abrechnung/vorschau?art=muster')).status === 401, 'Büro: Musterrechnung der Einstellungen nicht (nur Inhaber)');
  const t = await anmelden(TECHNIKER, 'Test Technik', 'techniker');
  pruefen((await vorschau(t, `/api/abrechnung/vorschau?art=rechnung&ordination=${A.id}&monat=${vm}`)).status === 401, 'Techniker: keine Vorschau');
  const fremd = await browser.newContext();
  const anonym = await fremd.request.get(`${CRM}/api/abrechnung/vorschau?art=mahnung&rechnung=${R.id}`);
  const portal = await fremd.request.get(`${PORTAL}/api/abrechnung/vorschau?art=mahnung&rechnung=${R.id}`);
  pruefen(anonym.status() === 401 && portal.status() === 401, 'ohne Anmeldung und im Portal: keine Vorschau');
  await fremd.close();

  // ════ Handy ════
  const h = await (await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await s.context().storageState() })).newPage();
  await h.goto(`${CRM}/abrechnung/${A.id}/rechnung?monat=${vm}`);
  pruefen((await sichtbar(h.getByRole('link', { name: 'Vorschau als PDF öffnen' }))) && !(await h.locator('iframe').first().isVisible()), 'Handy: Link »Vorschau als PDF öffnen« statt Rahmen');
  pruefen(await h.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Handy: kein seitliches Scrollen');
  await bild(h, 'bv4-handy');

  pruefen(!konsole.length, `keine Fehler in der Konsole${konsole.length ? `: ${konsole.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  fehler++;
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
console.log(fehler ? `\n✗ ${fehler} Prüfung(en) fehlgeschlagen` : '\n✓ alles in Ordnung');
process.exit(fehler ? 1 : 0);
