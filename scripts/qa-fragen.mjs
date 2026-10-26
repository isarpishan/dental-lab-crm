// آزمون «Frag deine Zahlen» در Chrome (Spec فاز ۵، قدم ۶) با Claude ساختگی که واقعاً ابزار صدا می‌زند: بدون KI ← دکمه خاموش،
// مثال‌ها، جواب با عدد همان دیتابیس (Material لابراتوار، Umsatz Ordination، رستوران Privat به فارسی)، «Grundlage» با لینک،
// سؤال پیگیری با پیشینهٔ گفت‌وگو، ابزار ناشناخته («patienten») ← رد، حلقهٔ بی‌پایان ← پیام «zu umfangreich»، فقط پنج ابزار
// مجاز به Anthropic، سقف روزانه، Büro بدون دسترسی، موبایل. دادهٔ آزمایشی «QA · Fragen …»؛ بعد پاک می‌شود.
// اجرا: pnpm qa qa-fragen
import { createHash, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const BILDER = process.env.QA_BILDER ?? null;
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};
const sichtbar = async (loc, timeout = 15000) => {
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
const eur = (n) => new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR' }).format(n);

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

const INHABER = 'test-fragen@example.invalid';
const BUERO = 'test-fragen-buero@example.invalid';
const SCHLUESSEL = 'sk-ant-qa-fragen-0123456789abcdefFRAG';
const RECHNUNG = 'R-2099-0081';
const heute = iso(new Date());
const jahrVon = `${heute.slice(0, 4)}-01-01`;

// ════ nachgebaute Anthropic-API mit Werkzeug-Aufrufen ════
const anfragen = [];
const antwort = (res, body, content, stop) =>
  json(res, 200, { id: 'msg_qa', type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 800, output_tokens: 120 } });
const werkzeug = (name, input) => [{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2)}`, name, input }];
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
  if (req.method !== 'POST' || url.pathname !== '/v1/messages') return json(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'x' } });
  const body = JSON.parse(Buffer.concat(teile).toString('utf8'));
  anfragen.push(body);
  const letzte = body.messages.at(-1);
  // erste Frage dieser Runde: welches Werkzeug?
  const frage = body.messages.filter((m) => m.role === 'user' && typeof m.content === 'string').at(-1)?.content ?? '';
  if (typeof letzte.content === 'string') {
    if (/Patient/.test(frage)) return antwort(res, body, werkzeug('patienten', { name: 'x' }), 'tool_use');
    if (/Material/.test(frage)) return antwort(res, body, werkzeug('summen', { bereich: 'ddl', art: 'ausgaben', von: jahrVon, bis: heute, gruppieren: 'kategorie' }), 'tool_use');
    if (/Vormonat/.test(frage)) return antwort(res, body, werkzeug('summen', { bereich: 'ddl', art: 'ausgaben', von: jahrVon, bis: heute, gruppieren: 'monat' }), 'tool_use');
    if (/Ordination/.test(frage)) return antwort(res, body, werkzeug('summen', { bereich: 'ddl', art: 'fakturiert', von: jahrVon, bis: heute, gruppieren: 'ordination' }), 'tool_use');
    if (/رستوران/.test(frage)) return antwort(res, body, werkzeug('summen', { bereich: 'privat', art: 'ausgaben', von: jahrVon, bis: heute, gruppieren: 'kategorie' }), 'tool_use');
    if (/endlos/.test(frage)) return antwort(res, body, werkzeug('bank', {}), 'tool_use');
    return antwort(res, body, [{ type: 'text', text: 'Keine Ahnung.' }], 'end_turn');
  }
  // Ergebnis eines Werkzeugs ← Antwort mit den Zahlen daraus
  const ergebnis = JSON.parse(letzte.content[0].content);
  if (/endlos/.test(frage)) return antwort(res, body, werkzeug('bank', {}), 'tool_use');
  if (ergebnis.fehler) return antwort(res, body, [{ type: 'text', text: `Dazu habe ich keine Daten (${ergebnis.fehler}).` }], 'end_turn');
  const g = (name) => ergebnis.gruppen?.find((x) => x.gruppe === name);
  let text;
  if (/Material/.test(frage)) text = `Material & Resin ${heute.slice(0, 4)}: ${eur(g('Material & Resin')?.summe_eur ?? 0)}`;
  else if (/Vormonat/.test(frage)) text = `Nach Monaten: ${ergebnis.gruppen.map((x) => `${x.gruppe} ${eur(x.summe_eur)}`).join(', ')}`;
  else if (/Ordination/.test(frage)) text = `Meister Umsatz: ${ergebnis.gruppen[0]?.gruppe} mit ${eur(ergebnis.gruppen[0]?.summe_eur ?? 0)}`;
  else text = `خرج رستوران امسال: ${eur(g('Restaurant & Café')?.summe_eur ?? 0)}`;
  return antwort(res, body, [{ type: 'text', text }], 'end_turn');
});
const KI_URL = new URL(process.env.KI_API_URL ?? 'http://127.0.0.1:3198');
await new Promise((ok) => api.listen(Number(KI_URL.port), '127.0.0.1', ok));
const start = new Date();

async function aufraeumen() {
  await sql.begin(async (tx) => {
    await tx`set local ddl.rechnungen_loeschen = 'qa'`;
    await tx`delete from ddl.invoices where nummer = ${RECHNUNG}`;
  });
  await sql`delete from ddl.privat_buchungen where haendler like 'QA · Fragen%'`;
  await sql.begin(async (tx) => {
    await tx`set local ddl.ausgaben_loeschen = 'qa'`;
    await tx`delete from ddl.expenses where lieferant like 'QA · Fragen%'`;
  });
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-fragen-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-fragen-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s };
}

try {
  // ════ Daten ════
  await sql`insert into ddl.expenses (rechnungsdatum, bezahlt_am, lieferant, kategorie, netto_cent, mwst_satz, mwst_cent, brutto_cent, erfasst_von_label) values (${heute}, ${heute}, 'QA · Fragen Resin', 'material', 10000, 20, 2000, 12000, 'QA')`;
  await sql`insert into ddl.privat_buchungen (art, datum, betrag_cent, kategorie, haendler, quelle, erfasst_von_label) values ('ausgabe', ${heute}, 3050, 'restaurant', 'QA · Fragen Pizzeria', 'hand', 'QA')`;
  const [praxis] = await sql`select id, name from ddl.practices order by name limit 1`;
  await sql`insert into ddl.invoices (nummer, art, practice_id, abrechnung, ausgestellt_am, summe_cent, empfaenger, aussteller, storage_key, sha256, size, ausgestellt_von_label)
    values (${RECHNUNG}, 'rechnung', ${praxis.id}, 'sammel', now(), 9999900, ${sql.json({ name: 'QA', zeilen: [] })}, ${sql.json({ name: 'QA' })}, 'qa-fragen/r', ${'0'.repeat(64)}, 1, 'QA')`;
  const [material] = await sql`select coalesce(sum(brutto_cent), 0)::int as c from ddl.expenses where geloescht_am is null and kategorie = 'material' and bezahlt_am between ${jahrVon} and ${heute}`;
  const [restaurant] = await sql`select coalesce(sum(betrag_cent), 0)::int as c from ddl.privat_buchungen where geloescht_am is null and art = 'ausgabe' and kategorie = 'restaurant' and datum between ${jahrVon} and ${heute}`;

  const { s } = await anmelden(INHABER, 'Test Fragen', 'inhaber');

  // ════ ohne KI ════
  await s.goto(`${CRM}/abrechnung`);
  await s.getByRole('navigation', { name: 'Einnahmen und Ausgaben' }).getByRole('link', { name: 'Fragen' }).click();
  await s.waitForURL(`${CRM}/abrechnung/fragen`);
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Frag deine Zahlen', level: 1 })), 'Tab »Fragen«');
  pruefen(await sichtbar(s.getByText('Die KI ist aus.')), 'ohne Schlüssel: Hinweis');
  pruefen(await s.getByRole('button', { name: 'Fragen', exact: true }).isDisabled(), 'ohne Schlüssel: Knopf aus');
  await s.goto(`${CRM}/einstellungen/ki`);
  const ki = s.getByRole('form', { name: 'KI-Einstellungen' });
  await ki.getByLabel('API-Schlüssel von Anthropic').fill(SCHLUESSEL);
  await ki.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(ki.getByText('Gespeichert. Die Verbindung zu Anthropic funktioniert.')), 'KI-Schlüssel gespeichert');

  // ════ Beispiel: Material ════
  await s.goto(`${CRM}/abrechnung/fragen`);
  const verlauf = s.getByRole('list', { name: 'Fragen und Antworten' });
  await s.getByRole('button', { name: /letzten Quartal für Material/ }).click();
  pruefen(await sichtbar(verlauf.getByText(`Material & Resin ${heute.slice(0, 4)}: ${eur(material.c / 100)}`)), `Antwort mit der Summe aus der Datenbank (${eur(material.c / 100)})`);
  const grundlage = verlauf.getByRole('link', { name: /Ausgaben Labor/ });
  pruefen((await grundlage.getAttribute('href')) === `/abrechnung/ausgaben?jahr=${heute.slice(0, 4)}`, 'Grundlage: Link zu den Ausgaben');
  const erste = anfragen[0];
  pruefen(
    JSON.stringify(erste.tools.map((t) => t.name).sort()) === JSON.stringify(['bank', 'buchungen', 'offene_rechnungen', 'steuer_vorschau', 'summen']) && erste.tools.every((t) => t.input_schema?.type === 'object'),
    'an Anthropic: genau die fünf erlaubten Werkzeuge',
  );
  const ergebnisText = anfragen[1]?.messages.at(-1)?.content?.[0]?.content ?? '';
  pruefen(/summe_eur/.test(ergebnisText) && !/patient/i.test(ergebnisText), 'Werkzeug-Ergebnis: nur Summen, nichts zu Patienten');

  // ── Nachfrage mit Zusammenhang ──
  const feld = s.getByLabel('Ihre Frage (Deutsch oder Persisch)');
  const vorher = anfragen.length;
  await feld.fill('Und wie war es im Vormonat?');
  await feld.press('Enter');
  pruefen(await sichtbar(verlauf.getByText(/^Nach Monaten:/)), 'Nachfrage beantwortet');
  const nachfrage = anfragen[vorher];
  pruefen(nachfrage.messages.length === 3 && nachfrage.messages[1].role === 'assistant' && /Material/.test(nachfrage.messages[0].content), 'Nachfrage: vorige Frage und Antwort gehen mit');

  // ── Ordination, Persisch ──
  await feld.fill('Welche Ordination hatte dieses Jahr den meisten Umsatz?');
  await s.getByRole('button', { name: 'Fragen', exact: true }).click();
  pruefen(await sichtbar(verlauf.getByText(new RegExp(`Meister Umsatz: ${praxis.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))), `Umsatz je Ordination: ${praxis.name}`);
  await feld.fill('امسال چقدر خرج رستوران کردم؟');
  await feld.press('Enter');
  const persisch = verlauf.getByText(`خرج رستوران امسال: ${eur(restaurant.c / 100)}`);
  pruefen(await sichtbar(persisch), `persische Antwort mit Privat-Zahl (${eur(restaurant.c / 100)})`);
  pruefen((await persisch.getAttribute('dir')) === 'auto', 'Antwort mit Schreibrichtung »auto« (Persisch von rechts)');
  pruefen((await verlauf.getByRole('link', { name: /Privat Ausgaben/ }).first().getAttribute('href'))?.startsWith('/privat/buchungen'), 'Grundlage: Privat-Buchungen');

  // ── nicht erlaubtes Werkzeug, Endlosschleife ──
  await feld.fill('Zeig mir die Patienten von Ordination X');
  await feld.press('Enter');
  pruefen(await sichtbar(verlauf.getByText(/Dazu habe ich keine Daten \(Unbekanntes Werkzeug patienten\)/)), 'Werkzeug »patienten« gibt es nicht');
  await feld.fill('endlos weiter');
  await feld.press('Enter');
  pruefen(await sichtbar(verlauf.getByText(/zu umfangreich/)), 'Endlosschleife: nach sieben Runden abgebrochen');
  const [nutzung] = await sql`select count(*)::int as n from ddl.ki_nutzung where zweck = 'zahlen_fragen' and am >= ${start}`;
  pruefen(nutzung.n === 6, `Verbrauch je Frage protokolliert (${nutzung.n})`);
  await bild(s, 'fr1-fragen');

  // ── Tageslimit ──
  await sql`insert into ddl.ki_nutzung (zweck, modell, eingabe_tokens, ausgabe_tokens, erfolgreich) select 'zahlen_fragen', 'qa', 0, 0, true from generate_series(1, 44)`;
  await feld.fill('Noch eine Frage zum Material');
  await feld.press('Enter');
  pruefen(await sichtbar(verlauf.getByText(/Heute sind schon 50 Fragen gestellt/)), 'Tageslimit 50');

  // ════ Handy ════
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 844 });
    await s.goto(`${CRM}/abrechnung/fragen`);
    const breit = await s.evaluate(() => document.documentElement.scrollWidth);
    pruefen(breit <= breite + 1, `Handy ${breite}px: kein horizontales Scrollen (${breit}px)`);
    await bild(s, `fr2-handy-${breite}`);
  }

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/abrechnung/fragen`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Fragen gesperrt');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  api.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
