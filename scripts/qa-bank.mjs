// آزمون «Bank» در Chrome (Spec فاز ۵، قدم ۴) با Claude ساختگی و Kontoauszugهای ساختگی (هیچ دادهٔ حساب واقعی):
// بالا بردن و خواندن، کنترل کامل بودن (Auszug ناقص رد می‌شود)، «Sichere Vorschläge übernehmen» (Rechnung با شماره،
// Ausgabe موجود، Privat موجود از Fixkosten، Privat تازه)، Übernehmen تکی (Ignorieren، Beleg fehlt)، «Ändern …» (Privat با
// Kategorie دیگر)، «Als Ausgabe erfassen» از «Beleg fehlt»، Zurücksetzen (Zahlung و Privat برمی‌گردند)، Auszug بعدی با ردیف
// تکراری، Umsatzliste CSV (ردیف تکراری از PDF، بدون Kontostand)، «Als Fixkosten anlegen» (Privat، و Labor با پیشنهاد
// ماه قبل)، هشدار فاصلهٔ Kontostand، همان فایل دو بار، Entfernen، Büro
// بدون دسترسی، موبایل.
// دادهٔ آزمایشی: «QA · Bank …»، @example.invalid؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-bank  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import { rm } from 'node:fs/promises';
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
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);
const tag = (d) => (d instanceof Date ? iso(d) : String(d));

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

const INHABER = 'test-bank@example.invalid';
const BUERO = 'test-bank-buero@example.invalid';
const SCHLUESSEL = 'sk-ant-qa-bank-0123456789abcdefBANK';
const IBAN = 'AT00 0000 0000 0000 0099';
const RECHNUNG = 'R-2099-0071';
const pdf = (marke) => Buffer.from(`%PDF-1.4\n% ${marke}\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
const PDF_9 = pdf('qa-bank-auszug-9');
const PDF_10 = pdf('qa-bank-auszug-10');
const PDF_LUECKE = pdf('qa-bank-luecke');
const PDF_FEHLT = pdf('qa-bank-fehlt');
// Umsatzliste wie aus dem eBanking (ISO-8859-1, »;«): Bolt ist schon aus Auszug 10 da, Spar ist neu
const CSV_IBAN = IBAN.replace(/\s/g, '');
const datumAt = (d) => d.split('-').reverse().join('.');

const jetzt = new Date();
const heute = iso(jetzt);
const vor = (n) => iso(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() - n, 12));
// gleicher Tag im Vormonat (in kürzeren Monaten der letzte), wie die Fixkosten rechnen
const vormonat = (() => {
  const t = Number(heute.slice(8, 10));
  const letzter = new Date(Date.UTC(jetzt.getFullYear(), jetzt.getMonth(), 0)).getUTCDate();
  return iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, Math.min(t, letzter), 12));
})();

// ════ erfundene Kontoauszüge ════
const zeile = (z) => ({ valuta: null, iban: null, referenz: null, kategorie: null, privatKategorie: null, rechnungsnummer: null, ...z });
const BILLA = zeile({ buchungstag: vor(4), betrag: -23.4, gegenpartei: 'QA · Bank BILLA', text: 'Bezahlung Karte POS QA BILLA', referenz: 'MC/QA0003', bereich: 'privat', privatKategorie: 'lebensmittel' });
const AUSZUG = {
  9: {
    istKontoauszug: true,
    iban: IBAN,
    auszugNummer: '9',
    auszugDatum: heute,
    alterKontostand: 300,
    neuerKontostand: 2190.7,
    summeEin: 2100,
    summeAus: 209.3,
    umsaetze: [
      zeile({ buchungstag: vor(7), betrag: 500, gegenpartei: 'QA · Bank Ordination', text: `Gutschrift ${RECHNUNG} Danke`, referenz: 'FE/QA0001', bereich: 'ddl', rechnungsnummer: RECHNUNG }),
      zeile({ buchungstag: vor(6), betrag: -120, gegenpartei: 'QA · Bank FORMLABS', text: 'Bezahlung Karte FORMLABS EU', referenz: 'MC/QA0002', bereich: 'ddl', kategorie: 'material' }),
      zeile({ buchungstag: vor(5), betrag: 1500, gegenpartei: 'QA · Bank Arbeitgeber', text: 'Lohn QA', referenz: 'FE/QA0004', bereich: 'privat', privatKategorie: 'gehalt' }),
      BILLA,
      zeile({ buchungstag: vor(3), betrag: -21.9, gegenpartei: 'QA · Bank ANTHROPIC', text: 'Bezahlung Karte ANTHROPIC CLAUDE SUB', referenz: 'MC/QA0005', bereich: 'ddl', kategorie: 'software' }),
      zeile({ buchungstag: vor(2), betrag: 100, gegenpartei: 'QA · Bank Familie', text: 'Gutschrift Onlinebanking', referenz: 'BG/QA0006', bereich: 'ignorieren' }),
      zeile({ buchungstag: vor(1), betrag: -44, gegenpartei: 'QA · Bank Laden', text: 'Bezahlung Karte QA LADEN', referenz: 'MC/QA0007', bereich: 'privat' }),
    ],
  },
  10: {
    istKontoauszug: true,
    iban: IBAN,
    auszugNummer: '10',
    auszugDatum: heute,
    alterKontostand: 2190.7,
    neuerKontostand: 2157.3,
    summeEin: 0,
    summeAus: 33.4,
    umsaetze: [BILLA, zeile({ buchungstag: heute, betrag: -10, gegenpartei: 'QA · Bank Bolt', text: 'Bezahlung Karte BOLT', referenz: 'MC/QA0008', bereich: 'privat', privatKategorie: 'oeffis' })],
  },
  luecke: {
    istKontoauszug: true,
    iban: IBAN,
    auszugNummer: '12',
    auszugDatum: heute,
    alterKontostand: 9999,
    neuerKontostand: 10000,
    summeEin: 1,
    summeAus: 0,
    umsaetze: [zeile({ buchungstag: heute, betrag: 1, gegenpartei: 'QA · Bank Zinsen', text: 'Zinsen', referenz: 'ZI/QA0009', bereich: 'privat', privatKategorie: 'sonstige_einnahme' })],
  },
  fehlt: {
    istKontoauszug: true,
    iban: IBAN,
    auszugNummer: '13',
    auszugDatum: heute,
    alterKontostand: 100,
    neuerKontostand: 50,
    summeEin: 0,
    summeAus: 50,
    umsaetze: [zeile({ buchungstag: heute, betrag: -20, gegenpartei: 'QA · Bank Halb', text: 'nur eine von zwei Zeilen', referenz: 'MC/QA0010', bereich: 'privat', privatKategorie: 'sonstiges' })],
  },
};

const CSV = () =>
  Buffer.from(
    [
      `${CSV_IBAN};Bezahlung Karte                                   MC/QA0008|POS BOLT\\WIEN;${datumAt(heute)};${datumAt(heute)};-10,00;EUR`,
      `${CSV_IBAN};Bezahlung Karte                                   MC/QA0011|POS QA SPAR M\xfcnchen;${datumAt(heute)};${datumAt(heute)};-1.234,50;EUR`,
      `${CSV_IBAN};Bezahlung Karte                                   MC/QA0012|POS QA SPAR M\xfcnchen;${datumAt(vormonat)};${datumAt(vormonat)};-1.234,50;EUR`,
    ].join('\r\n') + '\r\n',
    'latin1',
  );

const json = (res, status, daten) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'request-id': 'req_qa' });
  res.end(JSON.stringify(daten));
};
const api = http.createServer(async (req, res) => {
  const teile = [];
  for await (const t of req) teile.push(t);
  const schluessel = req.headers['x-api-key'] ?? req.headers.authorization?.replace(/^Bearer /, '');
  if (schluessel !== SCHLUESSEL) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname.startsWith('/v1/models/')) return json(res, 200, { type: 'model', id: 'x', display_name: 'x', created_at: '2026-01-01T00:00:00Z' });
  if (req.method === 'POST' && url.pathname === '/v1/messages') {
    const body = JSON.parse(Buffer.concat(teile).toString('utf8'));
    const frage = body.messages?.[0]?.content;
    if (typeof frage === 'string' && frage.startsWith('Ordne diese Buchungszeilen')) {
      const zeilen = [...frage.matchAll(/^(\d+) \| (\S+) \| (\S+) \| (.*)$/gm)].map((m) => ({
        nr: Number(m[1]),
        gegenpartei: /SPAR/.test(m[4]) ? 'QA · Bank CSV Spar' : 'QA · Bank CSV ?',
        bereich: 'privat',
        kategorie: null,
        privatKategorie: 'lebensmittel',
        rechnungsnummer: null,
      }));
      return json(res, 200, { id: 'msg_qa', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify({ zeilen }) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 300, output_tokens: 100 } });
    }
    const inhalt = Buffer.from(body.messages?.[0]?.content?.[0]?.source?.data ?? '', 'base64').toString('latin1');
    const welcher = inhalt.includes('qa-bank-auszug-10') ? 10 : inhalt.includes('qa-bank-luecke') ? 'luecke' : inhalt.includes('qa-bank-fehlt') ? 'fehlt' : 9;
    return json(res, 200, {
      id: 'msg_qa',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: JSON.stringify(AUSZUG[welcher]) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 4000, output_tokens: 900 },
    });
  }
  json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
});
const KI_URL = new URL(process.env.KI_API_URL ?? 'http://127.0.0.1:3198');
await new Promise((ok) => api.listen(Number(KI_URL.port), '127.0.0.1', ok));
const start = new Date();

async function aufraeumen() {
  const auszuege = await sql`select id, datei_key from ddl.bank_auszuege where hochgeladen_von_label = 'Test Bank'`;
  if (auszuege.length) {
    await sql`delete from ddl.bank_umsaetze where auszug_id in ${sql(auszuege.map((a) => a.id))}`;
    await sql`delete from ddl.bank_auszuege where id in ${sql(auszuege.map((a) => a.id))}`;
    for (const a of auszuege) await rm(path.join(SPEICHER, a.datei_key), { force: true });
  }
  await sql.begin(async (tx) => {
    await tx`set local ddl.rechnungen_loeschen = 'qa'`;
    await tx`delete from ddl.invoices where nummer = ${RECHNUNG}`;
  });
  const vorlagen = await sql`select id from ddl.fixkosten_vorlagen where titel like 'QA · Bank%'`;
  if (vorlagen.length) {
    await sql`delete from ddl.fixkosten_laeufe where vorlage_id in ${sql(vorlagen.map((v) => v.id))}`;
    await sql`delete from ddl.fixkosten_vorlagen where id in ${sql(vorlagen.map((v) => v.id))}`;
  }
  await sql`delete from ddl.privat_buchungen where haendler like 'QA · Bank%'`;
  const ausgaben = await sql`select id from ddl.expenses where lieferant like 'QA · Bank%'`;
  if (ausgaben.length) {
    await sql`delete from ddl.audit_log where target_id in ${sql(ausgaben.map((a) => a.id))}`;
    await sql.begin(async (tx) => {
      await tx`set local ddl.ausgaben_loeschen = 'qa'`;
      await tx`delete from ddl.expenses where lieferant like 'QA · Bank%'`;
    });
  }
  await sql`delete from ddl.ki_nutzung where am >= ${start}`;
  await sql`delete from ddl.settings where key = 'ki'`;
  const staff = (await sql`select id from ddl.staff_users where email in ${sql([INHABER, BUERO])}`).map((r) => r.id);
  if (staff.length) {
    await sql`delete from ddl.audit_log where actor_id in ${sql(staff)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(staff)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(staff)}`;
    await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  }
}
await aufraeumen();

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
  await s.getByLabel('Neues Passwort').fill('test-passwort-bank-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-bank-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s };
}

const umsatz = (referenz) => sql`select * from ddl.bank_umsaetze where fingerabdruck = ${`${IBAN.replace(/\s/g, '')}|ref|${referenz}`}`.then((r) => r[0]);

try {
  // ════ Ausgangslage: offene Rechnung, erfasste Ausgabe, Gehalt aus Fixkosten ════
  const [praxis] = await sql`select id from ddl.practices order by name limit 1`;
  const [r] = await sql`insert into ddl.invoices (nummer, art, practice_id, abrechnung, ausgestellt_am, faellig_am, summe_cent, empfaenger, aussteller, storage_key, sha256, size, ausgestellt_von_label)
    values (${RECHNUNG}, 'rechnung', ${praxis.id}, 'sammel', now() - interval '20 days', ${vor(5)}, 50000, ${sql.json({ name: 'QA · Bank Ordination', zeilen: [], uid: null, kundennummer: 'QA-BK' })},
      ${sql.json({ name: 'QA' })}, 'qa-bank/r', ${'0'.repeat(64)}, 1, 'QA') returning id`;
  const [ausgabe] = await sql`insert into ddl.expenses (rechnungsdatum, bezahlt_am, lieferant, kategorie, netto_cent, mwst_satz, mwst_cent, brutto_cent, erfasst_von_label)
    values (${vor(6)}, ${vor(6)}, 'QA · Bank Formlabs GmbH', 'material', 10000, 20, 2000, 12000, 'QA') returning id`;
  const [gehalt] = await sql`insert into ddl.privat_buchungen (art, datum, betrag_cent, kategorie, haendler, quelle, erfasst_von_label)
    values ('einnahme', ${vor(4)}, 150000, 'gehalt', 'QA · Bank Gehalt', 'vorlage', 'Fixkosten') returning id`;

  const { s } = await anmelden(INHABER, 'Test Bank', 'inhaber');

  // ════ Tab, KI ════
  await s.goto(`${CRM}/abrechnung`);
  await s.getByRole('navigation', { name: 'Einnahmen und Ausgaben' }).getByRole('link', { name: 'Bank' }).click();
  await s.waitForURL(`${CRM}/abrechnung/bank`);
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Bank', level: 1 })), 'Tab »Bank«');
  pruefen(await sichtbar(s.getByText('Die KI ist aus.')), 'ohne Schlüssel: Hinweis');
  await s.goto(`${CRM}/einstellungen/ki`);
  const ki = s.getByRole('form', { name: 'KI-Einstellungen' });
  await ki.getByLabel('API-Schlüssel von Anthropic').fill(SCHLUESSEL);
  await ki.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(ki.getByText('Gespeichert. Die Verbindung zu Anthropic funktioniert.')), 'KI-Schlüssel gespeichert');

  // ════ Auszug 9 ════
  const hochladen = (name, buffer) => s.getByLabel('Kontoauszüge wählen (PDF oder CSV)').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  const liste = s.getByRole('list', { name: 'Hochgeladene Kontoauszüge' });
  await s.goto(`${CRM}/abrechnung/bank`);
  await hochladen('auszug-9.pdf', PDF_9);
  pruefen(await sichtbar(liste.getByText(/auszug-9\.pdf · gelesen: Auszug 9 vom .*, 7 neue Zeilen/), 20000), 'Auszug 9 gelesen: 7 neue Zeilen');
  await s.waitForURL(/tab=klaeren/);
  const [a9] = await sql`select * from ddl.bank_auszuege where datei_sha256 = ${sha(PDF_9)}`;
  pruefen(a9?.status === 'gelesen' && a9.alter_cent === 30000 && a9.neuer_cent === 219070 && a9.umsaetze_neu === 7, 'Datenbank: Auszug mit Kontoständen');
  await s.reload();
  pruefen(/Kontostand\s*€\s2\.190,70/.test(await s.getByRole('navigation', { name: 'Bereiche der Bank' }).innerText()), 'Kennzahl: Kontostand € 2.190,70');
  const klaeren = s.getByRole('list', { name: 'Bankzeilen zu klären' });
  pruefen((await klaeren.getByRole('listitem').count()) === 7, 'Zu klären: 7 Zeilen');
  const zeileVon = (name) => klaeren.getByRole('listitem').filter({ hasText: name });
  pruefen(/Zahlung zu R-2099-0071/.test(await zeileVon('QA · Bank Ordination').innerText()), 'Vorschlag: Zahlung zu R-2099-0071');
  pruefen(/Ausgabe: QA · Bank Formlabs GmbH/.test(await zeileVon('QA · Bank FORMLABS').innerText()), 'Vorschlag: vorhandene Ausgabe');
  pruefen(/Privat: QA · Bank Gehalt/.test(await zeileVon('QA · Bank Arbeitgeber').innerText()), 'Vorschlag: Gehalt aus Fixkosten verbinden');
  pruefen(/Privat · Lebensmittel/.test(await zeileVon('QA · Bank BILLA').innerText()), 'Vorschlag: Privat · Lebensmittel');
  pruefen(/Labor · Beleg fehlt \(Software/.test(await zeileVon('QA · Bank ANTHROPIC').innerText()), 'Vorschlag: Labor · Beleg fehlt');
  pruefen(/Ignorieren/.test(await zeileVon('QA · Bank Familie').innerText()), 'Vorschlag: Ignorieren');
  pruefen(/Privat · Sonstiges · bitte prüfen/.test(await zeileVon('QA · Bank Laden').innerText()), 'Vorschlag ohne Kategorie: »bitte prüfen«');
  const [nochNichts] = await sql`select count(*)::int as n from ddl.payments where invoice_id = ${r.id}`;
  pruefen(nochNichts.n === 0, 'vor dem Bestätigen: nichts gebucht');
  await bild(s, 'bk1-klaeren');

  // ── sichere Vorschläge ──
  await s.getByRole('button', { name: 'Sichere Vorschläge übernehmen (4)' }).click();
  pruefen(await sichtbar(s.getByText('4 Vorschläge übernommen.')), 'vier sichere Vorschläge übernommen');
  const [zahlung] = await sql`select betrag_cent, eingegangen_am from ddl.payments where invoice_id = ${r.id}`;
  pruefen(zahlung?.betrag_cent === 50000 && tag(zahlung.eingegangen_am) === vor(7), 'Rechnung: Zahlung € 500,00 am Buchungstag');
  pruefen((await umsatz('MC/QA0002'))?.expense_id === ausgabe.id, 'Ausgabe verbunden');
  pruefen((await umsatz('FE/QA0004'))?.privat_buchung_id === gehalt.id, 'Gehalt verbunden (keine zweite Buchung)');
  const [billaPrivat] = await sql`select * from ddl.privat_buchungen where haendler = 'QA · Bank BILLA' and geloescht_am is null`;
  pruefen(billaPrivat?.quelle === 'bank' && billaPrivat.kategorie === 'lebensmittel' && billaPrivat.betrag_cent === 2340, 'BILLA: neue Privat-Buchung aus der Bank');
  await s.reload();
  pruefen((await klaeren.getByRole('listitem').count()) === 3, 'noch 3 zu klären');

  // ── einzeln: Ignorieren, Beleg fehlt ──
  await zeileVon('QA · Bank Familie').getByRole('button', { name: /Übernehmen/ }).click();
  await s.waitForTimeout(800);
  pruefen((await umsatz('BG/QA0006'))?.zuordnung === 'ignoriert', 'Familie: ignoriert');
  await s.reload();
  await zeileVon('QA · Bank ANTHROPIC').getByRole('button', { name: /Übernehmen/ }).click();
  await s.waitForTimeout(800);
  pruefen((await umsatz('MC/QA0005'))?.zuordnung === 'ddl_offen', 'Anthropic: Labor, Beleg fehlt');

  // ── Ändern …: andere Privat-Kategorie ──
  await s.reload();
  await zeileVon('QA · Bank Laden').getByRole('button', { name: /Ändern/ }).click();
  const fenster = s.getByRole('dialog', { name: /Bankzeile QA · Bank Laden/ });
  pruefen(await sichtbar(fenster.getByRole('heading', { name: /QA · Bank Laden/ })), 'Fenster »Ändern …«');
  pruefen(!(await fenster.getByText('Zahlung zu einer Rechnung des Labors').count()), 'Abgang: keine Rechnungs-Zahlung angeboten');
  const privatForm = fenster.getByRole('form', { name: 'Privat buchen' });
  await privatForm.getByLabel('Kategorie').selectOption('freizeit');
  await privatForm.getByRole('button', { name: 'Privat buchen' }).click();
  pruefen(await sichtbar(privatForm.getByText('Privat gebucht: Freizeit.')), 'Privat mit eigener Kategorie gebucht');
  await s.keyboard.press('Escape');
  await s.reload();
  pruefen(await sichtbar(s.getByText(/Nichts zu klären/)), 'Zu klären: leer');

  // ── Beleg fehlt → als Ausgabe erfassen ──
  await s.goto(`${CRM}/abrechnung/bank?tab=beleg`);
  const ohne = s.getByRole('list', { name: 'Bankzeilen ohne Beleg' });
  pruefen((await ohne.getByRole('listitem').count()) === 1, 'Beleg fehlt: Anthropic');
  await ohne.getByRole('button', { name: 'Als Ausgabe erfassen' }).click();
  const aForm = s.getByRole('form', { name: 'Ausgabe aus Bankzeile' });
  pruefen(
    (await aForm.locator('input[name=lieferant]').inputValue()) === 'QA · Bank ANTHROPIC' &&
      (await aForm.getByLabel('Brutto (€)').inputValue()) === '21,90' &&
      (await aForm.getByLabel('Kategorie').inputValue()) === 'software',
    'Formular: Lieferant, Brutto in Euro, Kategorie',
  );
  await aForm.getByLabel('MwSt-Satz').selectOption('0');
  await aForm.getByLabel('Brutto (€)').fill('21,90');
  await aForm.getByRole('button', { name: 'Ausgabe erfassen und verbinden' }).click();
  pruefen(await sichtbar(aForm.getByText(/Ausgabe erfasst: QA · Bank ANTHROPIC/)), 'Ausgabe erfasst und verbunden');
  const anthro = await umsatz('MC/QA0005');
  const [neueAusgabe] = await sql`select id, brutto_cent from ddl.expenses where lieferant = 'QA · Bank ANTHROPIC'`;
  pruefen(anthro?.zuordnung === 'ausgabe' && anthro.expense_id === neueAusgabe?.id && neueAusgabe.brutto_cent === 2190, 'Datenbank: Ausgabe € 21,90 mit Bankzeile verbunden');
  await bild(s, 'bk2-beleg');

  // ── Zurücksetzen ──
  await s.goto(`${CRM}/abrechnung/bank?tab=erledigt`);
  const erledigt = s.getByRole('list', { name: 'Zugeordnete Bankzeilen' });
  pruefen((await erledigt.getByRole('listitem').count()) === 7, 'Zugeordnet: 7');
  await erledigt.getByRole('button', { name: 'Zurücksetzen: QA · Bank BILLA' }).click();
  await s.waitForTimeout(800);
  const [billaWeg] = await sql`select geloescht_am from ddl.privat_buchungen where id = ${billaPrivat.id}`;
  pruefen((await umsatz('MC/QA0003'))?.zuordnung === null && Boolean(billaWeg.geloescht_am), 'BILLA zurück: Privat-Buchung gelöscht, Zeile offen');
  await s.reload();
  await erledigt.getByRole('button', { name: 'Zurücksetzen: QA · Bank Ordination' }).click();
  await s.waitForTimeout(800);
  const [keineZahlung] = await sql`select count(*)::int as n from ddl.payments where invoice_id = ${r.id}`;
  pruefen(keineZahlung.n === 0 && (await umsatz('FE/QA0001'))?.zuordnung === null, 'Rechnung zurück: Zahlung gelöscht, Rechnung wieder offen');

  // ════ Auszug 10: eine Zeile schon da ════
  await s.goto(`${CRM}/abrechnung/bank`);
  await hochladen('auszug-10.pdf', PDF_10);
  pruefen(await sichtbar(liste.getByText(/auszug-10\.pdf · gelesen: Auszug 10 .*1 neue Zeilen, 1 schon vorhanden/), 20000), 'Auszug 10: 1 neu, 1 schon vorhanden');
  const [anzahl] = await sql`select count(*)::int as n from ddl.bank_umsaetze where fingerabdruck like ${IBAN.replace(/\s/g, '') + '|%'}`;
  pruefen(anzahl.n === 8, 'Datenbank: 8 Zeilen, keine doppelt');

  // ════ Umsatzliste (CSV) ════
  await s.getByLabel('Kontoauszüge wählen (PDF oder CSV)').setInputFiles({ name: 'BAWAG_Umsatzliste_qa.csv', mimeType: 'text/csv', buffer: CSV() });
  pruefen(await sichtbar(liste.getByText(/BAWAG_Umsatzliste_qa\.csv · gelesen vom .*, 2 neue Zeilen, 1 schon vorhanden/), 20000), 'CSV: 2 neu, Bolt schon vorhanden');
  const spar = await umsatz('MC/QA0011');
  pruefen(spar?.betrag_cent === -123450 && spar.gegenpartei === 'QA · Bank CSV Spar' && spar.privat_kategorie === 'lebensmittel' && /SPAR München/.test(spar.text), 'CSV: Betrag, Umlaut, Einordnung der KI');
  const [csvA] = await sql`select * from ddl.bank_auszuege where datei_name = 'BAWAG_Umsatzliste_qa.csv'`;
  pruefen(csvA?.status === 'gelesen' && csvA.alter_cent === null && csvA.neuer_cent === null && csvA.iban === CSV_IBAN, 'CSV: gelesen, ohne Kontostand');
  await s.reload();
  pruefen(/Kontostand\s*€\s2\.157,30/.test(await s.getByRole('navigation', { name: 'Bereiche der Bank' }).innerText()), 'Kontostand bleibt vom letzten PDF');
  const csvAntwort = await s.request.get(`${CRM}/api/bank/auszug/${csvA.id}`);
  pruefen(csvAntwort.ok() && /text\/csv/.test(csvAntwort.headers()['content-type'] ?? ''), 'CSV abrufbar');
  const fremd = await s.request.post(`${CRM}/api/bank/auszug?name=x.csv`, { data: Buffer.from('Datum;Betrag\n1.1.2026;5\n'), headers: { 'Content-Type': 'text/csv', Origin: CRM } });
  // ════ Als Fixkosten anlegen ════
  // Privat: Bolt monatlich, Kategorie Abos
  await s.goto(`${CRM}/abrechnung/bank`);
  await zeileVon('QA · Bank Bolt').getByRole('button', { name: /Ändern/ }).click();
  const fBolt = s.getByRole('dialog', { name: /Bankzeile QA · Bank Bolt/ }).getByRole('form', { name: 'Als Fixkosten anlegen' });
  pruefen((await fBolt.getByLabel('Titel').inputValue()) === 'QA · Bank Bolt' && (await fBolt.getByLabel('Erste Fälligkeit').inputValue()) === heute, 'Fixkosten-Formular vorbelegt (Titel, Datum)');
  await fBolt.getByLabel('Kategorie').selectOption('abos');
  await fBolt.scrollIntoViewIfNeeded();
  await bild(s, 'bk-fixkosten');
  await fBolt.getByRole('button', { name: 'Als Fixkosten anlegen' }).click();
  pruefen(await sichtbar(fBolt.getByText(/Als Fixkosten angelegt: QA · Bank Bolt \(Monatlich\)/)), 'Privat: als Fixkosten angelegt');
  await s.keyboard.press('Escape');
  const bolt = await umsatz('MC/QA0008');
  const [vBolt] = await sql`select * from ddl.fixkosten_vorlagen where titel = 'QA · Bank Bolt'`;
  const lBolt = vBolt ? await sql`select * from ddl.fixkosten_laeufe where vorlage_id = ${vBolt.id}` : [];
  const [pBolt] = bolt?.privat_buchung_id ? await sql`select * from ddl.privat_buchungen where id = ${bolt.privat_buchung_id}` : [];
  pruefen(
    vBolt?.bereich === 'privat' && vBolt.betrag_cent === 1000 && vBolt.kategorie === 'abos' && lBolt.length === 1 && lBolt[0].status === 'gebucht' && lBolt[0].privat_buchung_id === bolt.privat_buchung_id,
    'Datenbank: Vorlage, eine Fälligkeit, mit der Bankzeile verbunden',
  );
  pruefen(bolt?.zuordnung === 'privat' && pBolt?.quelle === 'vorlage' && pBolt.betrag_cent === 1000 && pBolt.kategorie === 'abos', 'Bankzeile: Privat-Buchung aus den Fixkosten (keine doppelte)');
  await s.goto(`${CRM}/privat/fixkosten`);
  pruefen(await sichtbar(s.getByRole('list', { name: 'Fixkosten' }).getByText('QA · Bank Bolt')), 'unter Privat → Fixkosten sichtbar');

  // Labor: Spar ab Vormonat ⇒ diese Zeile wird Ausgabe, der Vormonat wird vorgeschlagen
  await s.goto(`${CRM}/abrechnung/bank`);
  await zeileVon('QA · Bank CSV Spar').filter({ hasText: datumAt(heute) }).first().getByRole('button', { name: /Ändern/ }).click();
  const fSpar = s.getByRole('dialog', { name: /Bankzeile QA · Bank CSV Spar/ }).getByRole('form', { name: 'Als Fixkosten anlegen' });
  await fSpar.getByLabel('Gehört zu').selectOption('ddl');
  await fSpar.getByLabel('Kategorie').selectOption('software');
  await fSpar.getByLabel('MwSt-Satz').selectOption('20');
  await fSpar.getByLabel('Erste Fälligkeit').fill(vormonat);
  await fSpar.getByRole('button', { name: 'Als Fixkosten anlegen' }).click();
  pruefen(await sichtbar(fSpar.getByText(/Als Fixkosten angelegt: QA · Bank CSV Spar/)), 'Labor: als Fixkosten angelegt');
  await s.keyboard.press('Escape');
  const sparHeute = await umsatz('MC/QA0011');
  const [aSpar] = sparHeute?.expense_id ? await sql`select * from ddl.expenses where id = ${sparHeute.expense_id}` : [];
  pruefen(sparHeute?.zuordnung === 'ausgabe' && aSpar?.brutto_cent === 123450 && aSpar.mwst_satz === 20 && aSpar.kategorie === 'software', 'Bankzeile: Ausgabe € 1.234,50 (20 %) erfasst und verbunden');
  const [vSpar] = await sql`select * from ddl.fixkosten_vorlagen where titel = 'QA · Bank CSV Spar'`;
  const lSpar = vSpar ? await sql`select * from ddl.fixkosten_laeufe where vorlage_id = ${vSpar.id} order by faellig_am` : [];
  pruefen(lSpar.length === 2 && lSpar[0].status === 'offen' && lSpar[1].status === 'gebucht' && lSpar[1].expense_id === aSpar?.id, 'Vormonat nachgetragen (offen), dieser Monat gebucht');
  await s.reload();
  const vorZeile = zeileVon('QA · Bank CSV Spar');
  pruefen((await vorZeile.count()) === 1 && /Fixkosten: QA · Bank CSV Spar/.test(await vorZeile.innerText()), 'Vormonat: Vorschlag »Fixkosten: …«');
  await vorZeile.getByRole('button', { name: /Übernehmen/ }).click();
  await s.waitForTimeout(1200);
  const sparVor = await umsatz('MC/QA0012');
  const [lVor] = await sql`select * from ddl.fixkosten_laeufe where id = ${lSpar[0]?.id ?? null}`;
  pruefen(sparVor?.zuordnung === 'ausgabe' && sparVor.expense_id && lVor?.status === 'gebucht' && lVor.expense_id === sparVor.expense_id, 'Vormonat übernommen: Ausgabe aus den Fixkosten, Fälligkeit gebucht');
  await s.goto(`${CRM}/abrechnung/bank`);

  pruefen(fremd.status() === 400 && /PDF oder die Umsatzliste als CSV/.test((await fremd.json()).fehler ?? ""), 'fremde CSV abgelehnt');

  // ════ unvollständig, Lücke, doppelt ════
  await hochladen('auszug-fehlt.pdf', PDF_FEHLT);
  pruefen(await sichtbar(liste.getByText(/auszug-fehlt\.pdf · hochgeladen, aber: Nicht vollständig gelesen/), 20000), 'unvollständiger Auszug abgelehnt');
  const [fehltZeilen] = await sql`select count(*)::int as n from ddl.bank_umsaetze where fingerabdruck like '%MC/QA0010'`;
  pruefen(fehltZeilen.n === 0, 'unvollständig: keine Zeile gespeichert');
  await hochladen('auszug-luecke.pdf', PDF_LUECKE);
  pruefen(await sichtbar(liste.getByText(/auszug-luecke\.pdf · gelesen/), 20000), 'Auszug mit Lücke gelesen');
  await hochladen('nochmal.pdf', PDF_9);
  pruefen(await sichtbar(liste.getByText(/nochmal\.pdf · Dieser Kontoauszug ist schon hochgeladen \(Nr\. 9/), 20000), 'gleiche Datei: abgelehnt');
  await s.goto(`${CRM}/abrechnung/bank?tab=auszuege`);
  const auszuege = s.getByRole('list', { name: 'Kontoauszüge' });
  pruefen(await sichtbar(auszuege.getByText('Kontostand passt nicht zum vorigen Auszug: fehlt einer?')), 'Lücke im Kontostand gemeldet');
  pruefen((await auszuege.getByText('Kontostand passt nicht zum vorigen Auszug: fehlt einer?').count()) === 1, 'CSV ohne Kontostand: keine falsche Lücke');
  pruefen(await sichtbar(auszuege.getByText('Umsatzliste (CSV), ohne Kontostand')), 'CSV in der Liste der Auszüge');
  pruefen(await sichtbar(auszuege.getByText(/Nicht vollständig gelesen/)), 'Fehler des unvollständigen Auszugs sichtbar');
  pruefen(/Kontoauszug prüfen/.test(await s.getByRole('navigation', { name: 'Bereiche der Bank' }).innerText()), 'Kennzahl: »Kontoauszug prüfen«');
  pruefen(!(await auszuege.getByRole('button', { name: 'Entfernen: auszug-9.pdf' }).count()), 'Auszug mit Zuordnungen: kein Entfernen');
  await auszuege.getByRole('button', { name: 'Entfernen: auszug-fehlt.pdf' }).click();
  await s.waitForTimeout(800);
  const [weg] = await sql`select count(*)::int as n from ddl.bank_auszuege where datei_sha256 = ${sha(PDF_FEHLT)}`;
  pruefen(weg.n === 0 && !(await auszuege.getByText('auszug-fehlt.pdf').count()), 'unvollständigen Auszug entfernt');
  const pdfAntwort = await s.request.get(`${CRM}/api/bank/auszug/${a9.id}`);
  pruefen(pdfAntwort.ok() && sha(await pdfAntwort.body()) === sha(PDF_9), 'PDF des Auszugs abrufbar');
  await bild(s, 'bk3-auszuege');

  // ════ Handy ════
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 844 });
    for (const q of ['', '?tab=beleg', '?tab=erledigt', '?tab=auszuege']) {
      await s.goto(`${CRM}/abrechnung/bank${q}`);
      const breit = await s.evaluate(() => document.documentElement.scrollWidth);
      pruefen(breit <= breite + 1, `Handy ${breite}px ${q || 'Zu klären'}: kein horizontales Scrollen (${breit}px)`);
    }
    await bild(s, `bk4-handy-${breite}`);
  }

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/abrechnung/bank`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Bank gesperrt');
  const bPdf = await b.request.get(`${CRM}/api/bank/auszug/${a9.id}`);
  const bHoch = await b.request.post(`${CRM}/api/bank/auszug?name=x.pdf`, { data: PDF_10, headers: { 'Content-Type': 'application/pdf', Origin: CRM } });
  pruefen(bPdf.status() === 401 && bHoch.status() === 401, 'Büro: kein PDF, kein Hochladen');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  api.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
