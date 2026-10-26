// آزمون قدم ۸ در Chrome: تولید.
// Materialien und Chargen (Charge erfassen، تکراری، منقضی)؛ مراحل در صفحهٔ سفارش («Erledigt» و «Schritt korrigieren»: مجاز و
// غیرمجاز، Nacharbeit بعد از QK؛ صفحهٔ Kanban از ۲۶ اکتبر ۲۰۲۶ حذف شد)؛ Laufzettel PDF (متن و QR با PDFKit خود macOS، بدون نام بیمار)؛ صفحهٔ «Schritt erledigt» بعد از QR
// (Drucker و Charge اجباری، کلیک دوم، همهٔ مراحل تا Geliefert)؛ آنچه Ordination می‌بیند؛ Zuständig؛ نقش «Nur lesen»؛
// برگشت بعد از ورود؛ ظاهر. دادهٔ آزمایشی («QA · …»، @example.invalid، LOT «QA-LOT-…») در پایان کامل پاک می‌شود.
// اجرا: pnpm qa qa-produktion  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { belegeLoeschen, belegZaehlerZurueck, zaehlerStand } from './qa-belege.mjs';
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
/** wartet, bis die Datenbank den erwarteten Wert zeigt */
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

const ordner = path.join(tmpdir(), 'ddl-qa-produktion');
mkdirSync(ordner, { recursive: true });
const STAFF = ['test-produktion@example.invalid', 'test-produktion-lesen@example.invalid'];
const NAME = { vor: 'Paula', nach: 'Quarzig' };

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Produktion%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  if (praxen.length) {
    await belegeLoeschen(sql, (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id));
    await sql`delete from ddl.orders where practice_id in ${sql(praxen)}`;
    await sql`delete from ddl.patients where practice_id in ${sql(praxen)}`;
  }
  await sql`delete from ddl.material_lots where lot_no like 'QA-LOT-%'`;
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
const zaehlerVorher = await zaehlerStand(sql);
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async (breite = 1440) => {
  const ctx = await browser.newContext({ viewport: { width: breite, height: 900 }, acceptDownloads: true });
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-produktion-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-produktion-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${CRM}/`);
  return { s, id: u.id };
}
const zeile = async (id) => (await sql`select status, current_step_key, assignee_id, delivered_at from ddl.orders where id = ${id}`)[0];
const pdfLesen = (datei, png) => JSON.parse(execFileSync('swift', ['scripts/qa-pdf.swift', datei, ...(png ? [png] : [])], { maxBuffer: 10_000_000 }).toString());

try {
  // ── Daten ──
  const [A] = await sql`insert into ddl.practices (customer_no, name) values ('QA-PR', 'QA · Produktion Ordination') returning id`;
  const [pu] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${A.id}, 'qa-produktion@example.invalid', 'Dr. Qa Produktion', 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, A.id, pu.id);
  const [pat] = await sql`insert into ddl.patients (practice_id, code, first_name_enc, last_name_enc, created_by_kind, created_by_id)
    values (${A.id}, 'P-QAP1', ${verschluesseln(NAME.vor)}, ${verschluesseln(NAME.nach)}, 'practice', ${pu.id}) returning id`;
  const gestern = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const auftrag = async ({ nr, behandlung, lieferart = 'fertigung', status, schritt = null, config, zaehne = [], tempo = 'standard', termin = null, shade = null, verlauf }) => {
    const [o] = await sql`insert into ddl.orders (order_no, practice_id, patient_id, work_type_key, delivery_kind, config, status, current_step_key, source, tempo, due_date, shade, submitted_at, created_by_kind, created_by_id, treatment_plan)
      values (${nr}, ${A.id}, ${pat.id}, ${behandlung}, ${lieferart}, ${sql.json(config)}, ${status}, ${schritt}, 'portal', ${tempo}, ${termin}, ${shade}, now() - interval '3 days', 'practice', ${pu.id}, 'Bitte Okklusion leicht entlasten. Danke!')
      returning id`;
    for (const [i, st] of verlauf.entries()) await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, ${st}, now() - interval '3 days' + ${`${i} hours`}::interval, 'staff')`;
    for (const [fdi, art] of zaehne) await sql`insert into ddl.order_teeth (order_id, fdi, treatment) values (${o.id}, ${fdi}, ${art})`;
    return o.id;
  };
  const krone = (fdi) => ({ zaehne: { [fdi]: { art: 'krone' } }, versorgung: 'definitiv', farbe: { system: 'vita_classical', farbe: 'A2' } });
  const o1 = await auftrag({ nr: 'QA-P-0001', behandlung: 'krone', status: 'eingereicht', config: krone(16), zaehne: [[16, 'krone']], tempo: 'express', termin: gestern, shade: 'A2', verlauf: ['eingereicht'] });
  const prothese = { zaehne: { 14: { zahn: 'ersatzzahn', basis: true }, 15: { zahn: 'ersatzzahn', basis: true }, 16: { klammer: true }, 13: { klammer: true } }, prothesenform: 'flipper', klammern: 'mit', gaumen: 'hufeisen', einprobe: true, farbe: { system: 'vita_classical', farbe: 'A3' } };
  const o2 = await auftrag({
    nr: 'QA-P-0002', behandlung: 'teilprothese', status: 'in_produktion', config: prothese, shade: 'A3',
    zaehne: [[14, 'ersatzzahn'], [14, 'basis'], [15, 'ersatzzahn'], [15, 'basis'], [13, 'klammer'], [16, 'klammer']],
    verlauf: ['eingereicht', 'in_planung', 'design_freigabe', 'in_produktion'],
  });
  const o3 = await auftrag({ nr: 'QA-P-0003', behandlung: 'krone', status: 'design_freigabe', config: krone(26), zaehne: [[26, 'krone']], verlauf: ['eingereicht', 'in_planung', 'design_freigabe'] });
  await auftrag({ nr: 'QA-P-0004', behandlung: 'smile_design', lieferart: 'design', status: 'in_planung', config: { zaehne: { 11: { art: 'veneer' }, 21: { art: 'veneer' } } }, zaehne: [[11, 'veneer'], [21, 'veneer']], verlauf: ['eingereicht', 'in_planung'] });
  const o5 = await auftrag({ nr: 'QA-P-0005', behandlung: 'krone', status: 'in_produktion', schritt: 'nachhaertung', config: krone(36), zaehne: [[36, 'krone']], verlauf: ['eingereicht', 'in_planung', 'design_freigabe', 'in_produktion'] });

  const { s: t, id: ich } = await mitarbeiter(STAFF[0], 'Test Produktion', 'techniker');

  // ── Materialien und Chargen ──
  await t.goto(`${CRM}/materialien`);
  pruefen(await sichtbar(t.getByRole('heading', { name: 'Materialien und Chargen.' })), 'Seite »Materialien und Chargen«');
  pruefen((await t.getByRole('region', { name: 'Neues Material' }).count()) === 0, 'Techniker: Charge ja, aber kein »Neues Material« (nur Stammdaten)');
  const apex = t.getByRole('listitem', { name: 'SprintRay Apex Base' });
  const fenster = t.getByRole('dialog', { name: 'SprintRay Apex Base' });
  const ablauf = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
  const gruppen = await t.locator('main section[aria-label]:not(dialog section)').evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')));
  pruefen(
    (await t.locator('ul[aria-label^="Materialien von"] > li').count()) >= 20 && !(await fenster.isVisible()) && gruppen.indexOf('SprintRay') === 0 && gruppen.indexOf('Formlabs') === 1,
    `Materialien als Kacheln, erst SprintRay, dann Formlabs (${gruppen.join(', ')}); Fenster erst nach Klick`,
  );
  const lot = (id) => sql`select stock, quantity, used_up_at, shade, fill_quarters from ddl.material_lots where lot_no = ${id}`.then((r) => r[0]);
  const charge = async (lot, menge = 1) => {
    if (!(await fenster.isVisible())) await apex.getByRole('button').first().click();
    const f = fenster.getByRole('form', { name: 'Charge erfassen: SprintRay Apex Base' });
    pruefen((await f.getByLabel('Verwendbar bis').count()) === 0, 'Neue Charge: kein Ablaufdatum mehr');
    await f.getByLabel('LOT-Nummer').fill(lot);
    await f.getByLabel('Anzahl Flaschen').fill(String(menge));
    await f.getByRole('button', { name: 'Charge speichern' }).click();
    return f;
  };
  let f = await charge('QA-LOT-1', 3);
  pruefen(await sichtbar(f.getByText('Charge QA-LOT-1 für SprintRay Apex Base erfasst: 3 Flaschen.')), 'Charge mit Anzahl erfasst (mit Erfolgsmeldung)');
  pruefen(await sichtbar(fenster.getByText(/^LOT QA-LOT-1 3 Flaschen von 3$/)), 'Charge erscheint im Fenster: 3 Flaschen von 3');
  const [{ summe }] = await sql`select coalesce(sum(stock), 0)::int as summe from ddl.material_lots where material_key = 'sr_apex_base' and used_up_at is null`;
  pruefen((await apex.getByRole('button').first().innerText()).includes(`${summe} Flaschen`), `Bestand klein auf der Kachel: ${summe} Flaschen (Fenster bleibt offen)`);
  await fenster.getByRole('button', { name: 'Flasche leer: LOT QA-LOT-1' }).click();
  pruefen((await sichtbar(fenster.getByText(/^LOT QA-LOT-1 2 Flaschen von 3$/))) && (await warten(async () => (await lot('QA-LOT-1')).stock === 2)), '»Flasche leer«: Bestand 3 → 2');
  await fenster.getByText('Bestand ändern').first().click();
  const bf = fenster.getByRole('form', { name: 'Bestand ändern: LOT QA-LOT-1' });
  await bf.getByLabel('Flaschen').fill('-1');
  await bf.evaluate((x) => {
    x.noValidate = true;
    x.requestSubmit();
  });
  pruefen(await sichtbar(fenster.getByText('Der Bestand kann nicht negativ sein.')) && (await lot('QA-LOT-1')).stock === 2, 'negativer Bestand wird abgelehnt');
  await bf.getByLabel('Flaschen').fill('4');
  await bf.getByRole('button', { name: 'Speichern' }).click();
  const l4 = await warten(async () => (await lot('QA-LOT-1')).stock === 4);
  pruefen(l4 && (await lot('QA-LOT-1')).quantity === 4, '»Bestand ändern«: gezählter Bestand 4 (gekauft wächst mit)');
  // offene Flasche: halb voll → zählt als 3½; »Flasche leer« → nächste Flasche wieder voll
  await fenster.getByRole('button', { name: 'Offene Flasche ½: LOT QA-LOT-1' }).click();
  pruefen(await warten(async () => (await lot('QA-LOT-1')).fill_quarters === 2), 'Füllstand »½« gespeichert');
  const zeileLot1 = async () => ((await fenster.locator('p').filter({ hasText: /^LOT QA-LOT-1 / }).first().textContent()) ?? '').trim();
  pruefen(await warten(async () => (await zeileLot1()) === 'LOT QA-LOT-1 3½ Flaschen von 4'), `Füllstand »½«: Charge zeigt 3½ Flaschen (${await zeileLot1()})`);
  pruefen((await apex.getByRole('button').first().innerText()).includes('½'), 'Kachel rechnet die halbe Flasche mit');
  await fenster.getByRole('button', { name: 'Flasche leer: LOT QA-LOT-1' }).click();
  const leer = await warten(async () => {
    const x = await lot('QA-LOT-1');
    return x.stock === 3 && x.fill_quarters === null;
  });
  pruefen(leer, '»Flasche leer«: Bestand 3, nächste Flasche wieder voll');
  f = await charge('QA-LOT-1');
  pruefen(await sichtbar(f.getByText('Die Charge QA-LOT-1 ist für SprintRay Apex Base schon erfasst.')), 'dieselbe Charge zweimal: Hinweis statt Doppel');
  // ältere Charge mit Ablaufdatum (das Formular fragt nicht mehr danach): bleibt markiert und beim 3D-Druck gesperrt
  await sql`insert into ddl.material_lots (material_key, lot_no, expiry_date) values ('sr_apex_base', 'QA-LOT-ALT', ${gestern})`;
  await t.reload();
  await apex.getByRole('button').first().click();
  pruefen(await sichtbar(fenster.getByText(`abgelaufen am ${gestern.split('-').reverse().join('.')}`)), 'abgelaufene Charge ist markiert');
  await bild(t, '41-materialien-fenster');
  await fenster.getByRole('button', { name: 'Schließen' }).click();
  pruefen(!(await fenster.isVisible()), 'Fenster schließt mit »Schließen«');

  // Kapseln mit Farbe: Crown HT (A1, A2, A3)
  const ht = t.getByRole('listitem', { name: 'SprintRay Crown HT' });
  const htFenster = t.getByRole('dialog', { name: 'SprintRay Crown HT' });
  await ht.getByRole('button').first().click();
  const hf = htFenster.getByRole('form', { name: 'Charge erfassen: SprintRay Crown HT' });
  await hf.getByLabel('LOT-Nummer').fill('QA-LOT-HT');
  await hf.getByLabel('Farbe').selectOption('A2');
  await hf.getByLabel('Anzahl Kapseln').fill('2');
  await hf.getByRole('button', { name: 'Charge speichern' }).click();
  pruefen(await sichtbar(hf.getByText('Charge QA-LOT-HT (A2) für SprintRay Crown HT erfasst: 2 Kapseln.')), 'Kapsel-Charge mit Farbe A2 erfasst');
  const htKachel = (await ht.getByRole('button').first().innerText()).replace(/\s+/g, ' ');
  pruefen(htKachel.includes('A1 nicht vorhanden') && htKachel.includes('A2 2 vorhanden') && htKachel.includes('2 Kapseln'), `Kachel: welche Farben da sind (${htKachel})`);
  await htFenster.getByRole('button', { name: 'Schließen' }).click();
  await sql`insert into ddl.material_lots (material_key, lot_no, expiry_date) values ('sr_crown', 'QA-LOT-CROWN', ${ablauf})`;
  await bild(t, '41-materialien');

  // ── Schritte auf der Auftragsseite (das Kanban »Produktion« gibt es seit dem 26.10.2026 nicht mehr) ──
  const bereichVon = async (id) => {
    await t.goto(`${CRM}/auftraege/${id}`);
    return t.getByRole('region', { name: 'Produktion' });
  };
  const korrigieren = async (bereich, label) => {
    await bereich.getByText('Schritt korrigieren …').click();
    const f = bereich.getByRole('form', { name: 'Schritt korrigieren' });
    await f.getByLabel('Auf Schritt setzen').selectOption({ label });
    await f.getByRole('button', { name: 'Schritt setzen' }).click();
  };
  let pr = await bereichVon(o1);
  pruefen(await sichtbar(pr.getByRole('heading', { name: 'Eingang / Datenprüfung' })), 'neuer Auftrag: Schritt »Eingang / Datenprüfung«');
  await pr.getByRole('form', { name: 'Schritt erledigt' }).getByRole('button', { name: 'Eingang / Datenprüfung erledigt' }).click();
  pruefen(await warten(async () => (await zeile(o1)).status === 'in_planung'), 'Eingang erledigt: Status »In Planung«');

  pr = await bereichVon(o3);
  await pr.waitFor();
  pruefen(!(await pr.getByText('Schritt korrigieren …').count()), 'Design bei der Ordination zur Freigabe: nichts von Hand zu setzen');

  pr = await bereichVon(o2);
  await pr.waitFor();
  const optionen2 = await pr.locator('select option').allTextContents();
  pruefen(!optionen2.includes('Reinigung & Nachhärtung'), `aus dem 3D-Druck nach vorn nur mit »Erledigt« (MDR) (${optionen2.join(', ')})`);

  pr = await bereichVon(o5);
  await korrigieren(pr, 'Ausarbeitung / Farbanpassung');
  pruefen(await warten(async () => (await zeile(o5)).current_step_key === 'ausarbeitung'), 'Schritt korrigieren: Nachhärtung → Ausarbeitung');
  const [s5] = await sql`select done_at, done_by from ddl.order_steps where order_id = ${o5} and step_key = 'nachhaertung'`;
  pruefen(s5?.done_at && s5.done_by === ich, 'vorheriger Schritt »erledigt« mit Person');
  pr = await bereichVon(o5);
  await korrigieren(pr, 'Qualitätskontrolle');
  pruefen(await warten(async () => (await zeile(o5)).status === 'fertig'), 'Ausarbeitung → Qualitätskontrolle, Status »Fertig«');
  // QK nicht bestanden: zurück in die Ausarbeitung
  pr = await bereichVon(o5);
  await korrigieren(pr, 'Ausarbeitung / Farbanpassung');
  pruefen(await warten(async () => (await zeile(o5)).status === 'in_produktion'), 'Qualitätskontrolle → zurück in die Ausarbeitung (Nacharbeit)');
  pr = await bereichVon(o5);
  await pr.getByText('Schritt korrigieren …').click();
  await bild(t, '42-schritt-korrigieren');

  // ── Auftragsseite: Produktion, Zuständig ──
  await t.goto(`${CRM}/auftraege/${o1}`);
  const prod = t.getByRole('region', { name: 'Produktion' });
  pruefen(await sichtbar(prod.getByRole('heading', { name: 'CAD-Design' })) && (await prod.getByText('Weiter mit dem Design: auf der Auftragsseite hochladen und zur Freigabe senden.').isVisible()), 'Auftragsseite: »Produktion« mit aktuellem Schritt und Hinweis');
  pruefen((await prod.locator('ol > li').count()) === 8, 'Schritte dieses Auftrags (Krone: 8)');
  await prod.getByLabel('Zuständig').selectOption({ label: 'Test Produktion' });
  pruefen(await warten(async () => (await zeile(o1)).assignee_id === ich), '»Zuständig« gespeichert');
  await bild(t, '48-auftrag-produktion');

  // ── Laufzettel ──
  const pdfAntwort = await t.request.get(`${CRM}/api/auftraege/${o2}/laufzettel`);
  const pdf = await pdfAntwort.body();
  const pdfDatei = path.join(ordner, 'laufzettel.pdf');
  writeFileSync(pdfDatei, pdf);
  pruefen(pdfAntwort.status() === 200 && pdfAntwort.headers()['content-type'] === 'application/pdf' && pdf.subarray(0, 5).toString() === '%PDF-', 'Laufzettel: PDF');
  const lz = pdfLesen(pdfDatei, BILDER ? path.join(BILDER, '44-laufzettel.png') : null);
  const qrZiel = `${CRM}/s/QA-P-0002`;
  pruefen(lz.seiten === 1 && lz.qr.includes(qrZiel), `Laufzettel: eine Seite, QR → ${lz.qr.join(', ') || 'kein QR erkannt'}`);
  const lzText = lz.text.replace(/\s+/g, ' ');
  for (const [teil, text] of [['QA-P-0002', 'Auftragsnummer'], ['P-QAP1', 'Patienten-ID'], ['QA · Produktion Ordination', 'Ordination'], ['Teilprothese', 'Behandlung'], ['A3', 'Zahnfarbe'], ['Flipper', 'Auswahl'], ['Okklusion leicht entlasten', 'Hinweise'], ['Einprobe', 'Schritt Einprobe'], ['ARBEITSSCHRITTE', 'Checkliste']]) {
    // gesperrte Großbuchstaben liest PDFKit mit Leerzeichen
    pruefen(lzText.includes(teil) || lzText.replace(/ /g, '').includes(teil), `Laufzettel enthält ${text}`);
  }
  pruefen(!lz.text.includes(NAME.nach) && !lz.text.includes(NAME.vor), 'Laufzettel: kein Patientenname');
  const [{ n: lzLog }] = await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${ich} and order_id = ${o2} and action = 'herunterladen'`;
  pruefen(lzLog === 1, 'Laufzettel im Data-Access-Log');

  // Ordination: kein Laufzettel, ohne Anmeldung 401
  const p = await neueSeite();
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${pu.id}, now() + interval '1 hour')`;
  await p.goto(`${PORTAL}/einladung/${token}`);
  await p.getByLabel('Neues Passwort').fill('test-passwort-produktion-2');
  await p.getByLabel('Passwort wiederholen').fill('test-passwort-produktion-2');
  await p.getByRole('button', { name: 'Zugang einrichten' }).click();
  await p.waitForURL(`${PORTAL}/`);
  const portalLz = (await p.request.get(`${PORTAL}/api/auftraege/${o2}/laufzettel`)).status();
  const ohneLz = (await fetch(`${CRM}/api/auftraege/${o2}/laufzettel`)).status;
  pruefen(portalLz === 404 && ohneLz === 401, `Laufzettel nur intern (Portal ${portalLz}, ohne Anmeldung ${ohneLz})`);

  // ── Tablet: QR → »Schritt erledigt« ──
  const tab = await neueSeite(820);
  await tab.context().addCookies(await t.context().cookies());
  await tab.goto(lz.qr[0] ?? qrZiel);
  const erl = tab.getByRole('form', { name: 'Schritt erledigt' });
  pruefen(await sichtbar(tab.getByRole('heading', { name: '3D-Druck' })), 'QR öffnet »Schritt erledigt« beim aktuellen Schritt (3D-Druck)');
  const tabText = await tab.locator('main').textContent();
  pruefen(tabText.includes('P-QAP1') && !tabText.includes(NAME.nach), 'Tablet: Patienten-ID, kein Name');
  const veraltet = await neueSeite(820);
  await veraltet.context().addCookies(await t.context().cookies());
  await veraltet.goto(qrZiel);

  await erl.getByRole('button', { name: '3D-Druck erledigt' }).click();
  pruefen(await sichtbar(erl.getByText('Bitte den Drucker wählen.')), 'ohne Drucker: Hinweis');
  await erl.getByLabel('SprintRay MIDAS').check();
  await erl.getByRole('button', { name: '3D-Druck erledigt' }).click();
  pruefen(await sichtbar(erl.getByText('Bitte die verwendete Charge wählen.')), 'ohne Charge: Hinweis (passende Charge vorhanden)');
  pruefen(await erl.getByRole('checkbox', { name: /LOT QA-LOT-ALT/ }).isDisabled(), 'abgelaufene Charge nicht wählbar');
  await erl.getByText(/Andere Materialien/).click();
  pruefen(await erl.getByRole('checkbox', { name: /SprintRay Crown · LOT QA-LOT-CROWN/ }).isVisible(), 'andere Materialien eingeklappt darunter');
  await erl.getByRole('checkbox', { name: /SprintRay Apex Base · LOT QA-LOT-1/ }).check();
  await erl.getByRole('checkbox', { name: /SprintRay Crown HT A2 · LOT QA-LOT-HT/ }).check();
  await erl.getByLabel('Kapseln aus LOT QA-LOT-HT').fill('3');
  await erl.getByRole('button', { name: '3D-Druck erledigt' }).click();
  pruefen(
    (await sichtbar(erl.getByText(/In der Charge QA-LOT-HT sind nur noch 2 Kapseln/))) &&
      (await sql`select count(*)::int as n from ddl.order_steps where order_id = ${o2} and step_key = 'druck'`)[0].n === 0 &&
      (await lot('QA-LOT-HT')).stock === 2,
    'mehr Kapseln als vorhanden: Hinweis, nichts gespeichert',
  );
  await erl.getByLabel('Kapseln aus LOT QA-LOT-HT').fill('2');
  await bild(tab, '45-tablet-druck');
  await erl.getByRole('button', { name: '3D-Druck erledigt' }).click();
  pruefen(await sichtbar(tab.getByText('3D-Druck erledigt. Weiter mit: Reinigung & Nachhärtung.')), '3D-Druck erledigt: weiter mit Nachhärtung');
  const [druck] = await sql`select device_key, done_by, done_at from ddl.order_steps where order_id = ${o2} and step_key = 'druck'`;
  const mats = await sql`select l.lot_no, m.quantity from ddl.order_materials m join ddl.material_lots l on l.id = m.lot_id where m.order_id = ${o2} order by l.lot_no`;
  pruefen(
    druck?.device_key === 'sprintray_midas' && druck.done_by === ich && mats.map((m) => `${m.lot_no}:${m.quantity}`).join() === 'QA-LOT-1:0,QA-LOT-HT:2',
    `Datenbank: Drucker, Person und Chargen beim Auftrag, 2 Kapseln (${mats.map((m) => `${m.lot_no}:${m.quantity}`).join()})`,
  );
  const htNach = await lot('QA-LOT-HT');
  pruefen(htNach.stock === 0 && htNach.used_up_at !== null && (await lot('QA-LOT-1')).stock === 3, 'Kapseln abgezogen: Bestand 0, Charge aufgebraucht; Flaschen unverändert');

  // zweiter Klick aus einem alten Tab
  await veraltet.getByRole('form', { name: 'Schritt erledigt' }).getByLabel('SprintRay MIDAS').check();
  await veraltet.getByRole('form', { name: 'Schritt erledigt' }).getByRole('checkbox', { name: /LOT QA-LOT-1/ }).check();
  await veraltet.getByRole('button', { name: '3D-Druck erledigt' }).click();
  pruefen(await sichtbar(veraltet.getByText('Dieser Schritt ist schon erledigt. Bitte laden Sie die Seite neu.')) && (await zeile(o2)).current_step_key === 'nachhaertung', 'alter Tab: »schon erledigt«, nichts doppelt');

  // weiter bis zur Lieferung
  const schritte = [
    ['Reinigung & Nachhärtung erledigt', 'einprobe', 'einprobe'],
    ['Einprobe erledigt', 'in_produktion', 'ausarbeitung'],
    ['Ausarbeitung / Farbanpassung erledigt', 'fertig', 'qualitaetskontrolle'],
    ['Qualitätskontrolle erledigt', 'versendet', 'uebergabe'],
  ];
  for (const [knopf, st, sk] of schritte) {
    await tab.getByRole('button', { name: knopf }).click();
    const ok = await warten(async () => {
      const z = await zeile(o2);
      return z.status === st && z.current_step_key === sk;
    });
    pruefen(ok, `»${knopf}« → Status ${st}`);
    if (st === 'einprobe') {
      await p.goto(`${PORTAL}/auftraege/${o2}`);
      pruefen(await sichtbar(p.getByRole('heading', { name: 'Bereit zur Einprobe.' })) && (await p.getByRole('region', { name: 'Produktion' }).count()) === 0, 'Ordination sieht »Bereit zur Einprobe.«, keine internen Schritte');
      await p.goto(`${PORTAL}/`);
      pruefen(await sichtbar(p.getByRole('link', { name: /Ihre Aktion erforderlich/ })), 'Einprobe: »Ihre Aktion erforderlich«');
    }
  }
  const belege = await sql`select kind, doc_no from ddl.documents where order_id = ${o2} order by kind`;
  pruefen(belege.length === 2 && /^KE-\d{4}-\d{4}$/.test(belege[0].doc_no) && /^LS-\d{4}-\d{4}$/.test(belege[1].doc_no), 'Qualitätskontrolle erledigt → Konformitätserklärung und Lieferschein ausgestellt');
  await p.goto(`${PORTAL}/auftraege/${o2}`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Unterwegs zu Ihnen.' })), 'Ordination: »Unterwegs zu Ihnen.«');
  await tab.getByRole('button', { name: 'Geliefert' }).click();
  pruefen(await warten(async () => {
    const z = await zeile(o2);
    return z.status === 'geliefert' && z.delivered_at;
  }), 'Übergabe erledigt → »Geliefert« mit Lieferdatum');
  pruefen(await sichtbar(tab.getByText('In der Produktion ist für diesen Auftrag nichts mehr zu tun.')), 'Tablet: nichts mehr zu tun');
  writeFileSync(pdfDatei, await (await t.request.get(`${CRM}/api/auftraege/${o2}/laufzettel`)).body());
  const lz2 = pdfLesen(pdfDatei, BILDER ? path.join(BILDER, '46-laufzettel-fertig.png') : null);
  pruefen(lz2.text.includes('LOT QA-LOT-1') && lz2.text.includes('SprintRay MIDAS') && (lz2.text.match(/TP/g) ?? []).length >= 6, 'Laufzettel danach: Charge, Drucker und Zeichen bei jedem Schritt');
  const [{ n: audits }] = await sql`select count(*)::int as n from ddl.audit_log where actor_id = ${ich} and action = 'schritt_erledigt'`;
  // 6 am Tablet + »Eingang erledigt« auf der Auftragsseite
  pruefen(audits === 7, `Audit: jeder erledigte Schritt (${audits})`);

  // ── Nur lesen ──
  const { s: l } = await mitarbeiter(STAFF[1], 'Test Lesen', 'nur_lesen');
  await l.goto(`${CRM}/auftraege/${o1}`);
  pruefen(await sichtbar(l.getByRole('region', { name: 'Produktion' })), '»Nur lesen« sieht die Schritte im Auftrag');
  pruefen((await l.getByText('Schritt korrigieren …').count()) === 0 && (await l.getByRole('form', { name: 'Schritt erledigt' }).count()) === 0, '»Nur lesen«: kein »Erledigt«, kein »Schritt korrigieren«');
  await l.goto(`${CRM}/s/QA-P-0005`);
  pruefen((await l.getByRole('form', { name: 'Schritt erledigt' }).count()) === 0 && (await l.getByLabel('Zuständig').count()) === 0, '»Nur lesen«: kein »Erledigt«, kein »Zuständig«');
  await l.goto(`${CRM}/materialien`);
  pruefen((await l.getByText('Charge erfassen').count()) === 0 && (await l.getByText('Bestand ändern').count()) === 0, '»Nur lesen«: keine Charge erfassen, kein Bestand ändern');

  // ── nach dem Anmelden zurück zum QR-Ziel ──
  const fremd = await neueSeite(820);
  await fremd.goto(`${CRM}/s/QA-P-0005`);
  pruefen(new URL(fremd.url()).searchParams.get('weiter') === '/s/QA-P-0005', 'ohne Sitzung: Anmeldung mit Rückweg zum QR-Ziel');
  await fremd.context().addCookies([{ name: 'ddl_intern', value: 'abgelaufen', url: CRM }]);
  await fremd.goto(`${CRM}/s/QA-P-0005`);
  pruefen(new URL(fremd.url()).searchParams.get('weiter') === '/s/QA-P-0005', 'abgelaufene Sitzung: ebenfalls mit Rückweg');

  // ── Ansicht ──
  const zuBreit = [];
  for (const [breite, hoehe] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
    await t.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of ['/materialien', '/s/QA-P-0005', `/auftraege/${o5}`, '/']) {
      await t.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
      const w = await t.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${pfad} ${breite}px: ${w}px`);
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen der Seite (1440 bis 320 px)${zuBreit.length ? ' → ' + zuBreit.slice(0, 6).join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await belegZaehlerZurueck(sql, zaehlerVorher);
  pruefen(JSON.stringify(zaehlerVorher) === JSON.stringify(await zaehlerStand(sql)), 'Zähler (Auftrags- und Belegnummern) unverändert');
  const [{ n: rest }] = await sql`select count(*)::int as n from ddl.material_lots where lot_no like 'QA-LOT-%'`;
  pruefen(rest === 0, 'Testchargen entfernt');
  await sql.end();
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fehler ? 1 : 0);
