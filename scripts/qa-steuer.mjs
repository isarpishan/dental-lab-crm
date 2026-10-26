// آزمون «Steuer- und SVS-Vorschau» در Chrome (Spec فاز ۵، قدم ۵): بدون ورودی ← راهنما، «Einstellungen → Steuer»
// (ورودی نادرست، ذخیره، audit)، عددهای Vorschau برابر محاسبهٔ دستی (Gehalt ۲٫۰۰۰ × ۱۲، شروع ژانویه، Gewinn ۲۴٫۰۰۰ تخمینی،
// Mindestbeiträge)، بدون تخمین ← «hochgerechnet»، نوار Übersicht، برچسب «Schätzung – keine Steuerberatung»، Büro، موبایل.
// عددها ساختگی‌اند. اجرا: pnpm qa qa-steuer
import { createHash, createHmac, randomBytes } from 'node:crypto';
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
const normal = (t) => (t ?? '').replace(/\s+/g, ' ').trim();

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

const INHABER = 'test-steuer@example.invalid';
const BUERO = 'test-steuer-buero@example.invalid';

async function aufraeumen() {
  await sql`delete from ddl.settings where key = 'steuer'`;
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-steuer-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-steuer-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

/** Betrag einer Zeile in einer der kleinen Tabellen (»Ergebnis«, »Einkommensteuer«, »Sozialversicherung (SVS)«) */
const zelle = async (s, titel, tabelle = 'Ergebnis') => {
  const zeile = s.getByRole('region', { name: tabelle }).getByRole('row').filter({ has: s.getByRole('rowheader', { name: new RegExp(`^${titel}`) }) }).first();
  return normal(await zeile.getByRole('cell').textContent());
};

try {
  const jahr = new Date().getFullYear();
  const { s, id } = await anmelden(INHABER, 'Test Steuer', 'inhaber');

  // ════ ohne Angaben ════
  await s.goto(`${CRM}/abrechnung`);
  await s.getByRole('navigation', { name: 'Einnahmen und Ausgaben' }).getByRole('link', { name: 'Steuer' }).click();
  await s.waitForURL(`${CRM}/abrechnung/steuer`);
  pruefen(await sichtbar(s.getByText('Schätzung – keine Steuerberatung')), 'Hinweis »Schätzung – keine Steuerberatung«');
  pruefen(await sichtbar(s.getByText('Für die Vorschau fehlen noch ein paar Angaben.')), 'ohne Angaben: Hinweis');
  await s.goto(`${CRM}/abrechnung/uebersicht`);
  pruefen(await sichtbar(s.getByRole('link', { name: /Wie viel für Steuer und SVS zurücklegen\?/ })), 'Übersicht: Einladung zu den Angaben');

  // ════ Einstellungen → Steuer ════
  await s.goto(`${CRM}/einstellungen/steuer`);
  pruefen((await s.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link', { name: 'Steuer', exact: true }).getAttribute('aria-current')) === 'page', 'Einstellungen: Tab »Steuer«');
  const form = s.getByRole('form', { name: 'Steuer-Angaben' });
  await form.getByLabel('Gehalt je Monat, steuerpflichtig (€)').fill('abc');
  await form.getByLabel('Beginn der Selbständigkeit').fill(`${jahr}-01-15`);
  await form.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(form.getByText(/Gehalt je Monat \(BMG LSt\): »abc« ist kein gültiger Betrag/)), 'ungültiges Gehalt abgelehnt');
  await form.getByLabel('Gehalt je Monat, steuerpflichtig (€)').fill('2.000');
  await form.getByLabel('Erwarteter Gewinn im Jahr (€, optional)').fill('24.000');
  await form.getByRole('button', { name: 'Speichern' }).click();
  pruefen(await sichtbar(form.getByText(`Gespeichert. Die Vorschau für ${jahr} ist aktualisiert.`)), 'gespeichert');
  const [einst] = await sql`select value from ddl.settings where key = 'steuer'`;
  pruefen(einst?.value?.[jahr]?.gehaltMonatCent === 200000 && einst.value[jahr].gewinnSchaetzungCent === 2400000 && einst.value[jahr].svsQuartalCent === null, 'Datenbank: Angaben in Cent');
  pruefen((await sql`select count(*)::int as n from ddl.audit_log where action = 'steuer_einstellungen_geaendert' and actor_id = ${id}`)[0].n === 1, 'Protokoll: Steuer-Angaben geändert');

  // ════ Vorschau = Handrechnung ════
  // Mindestbeiträge 12 × 160,81 = 1.929,72; GFB 15 % von 22.070,28 = 3.310,54; steuerpflichtig 18.759,74
  // Tarif(24.000 + 18.759,74) − Tarif(24.000) = 8.551,10 − 2.293,00 = 6.258,10 (Summe reicht in die 40-%-Stufe)
  // BG 18.759,74 + 1.223,44 + 449,70 = 20.432,88; PV 18,5 % von (20.432,88 − 6.613,20) = 2.556,64; KV im 1. Jahr 0
  await s.goto(`${CRM}/abrechnung/steuer`);
  pruefen((await zelle(s, 'Einkommensteuer zusätzlich')) === '€ 6.258,10', `Einkommensteuer zusätzlich € 6.258,10 (${await zelle(s, 'Einkommensteuer zusätzlich')})`);
  pruefen((await zelle(s, 'SVS-Nachzahlung später')) === '€ 2.556,64', 'SVS-Nachzahlung € 2.556,64');
  pruefen((await zelle(s, 'Zurücklegen gesamt')) === '€ 8.814,74', 'Zurücklegen gesamt € 8.814,74');
  pruefen((await zelle(s, 'Zurücklegen pro Monat')) === '€ 734,56', 'pro Monat € 734,56');
  const rechenweg = normal(await s.getByRole('region', { name: 'Einkommensteuer' }).innerText());
  pruefen(/SVS laufend \(Mindestbeiträge\) – € 1\.929,72/.test(rechenweg), 'Rechenweg: SVS laufend € 1.929,72 (Mindestbeiträge)');
  pruefen(/Gewinnfreibetrag.*– € 3\.310,54/.test(rechenweg) && /Steuerpflichtiger Gewinn € 18\.759,74/.test(rechenweg), 'Rechenweg: Gewinnfreibetrag und steuerpflichtiger Gewinn');
  pruefen(/im 1\. Jahr fix/.test(await s.getByRole('region', { name: 'Sozialversicherung (SVS)' }).innerText()), 'KV im ersten Jahr fix');
  pruefen((await zelle(s, 'Pensionsversicherung', 'Sozialversicherung (SVS)')) === '€ 2.556,64', 'SVS-Tabelle: Pensionsversicherung € 2.556,64');
  await bild(s, 'st1-vorschau');

  await s.goto(`${CRM}/abrechnung/uebersicht`);
  pruefen(await sichtbar(s.getByRole('link', { name: /Für Steuer und SVS zurücklegen: € 734,56 im Monat/ })), 'Übersicht: € 734,56 im Monat');

  // ── ohne eigene Schätzung: hochgerechnet ──
  await s.goto(`${CRM}/einstellungen/steuer`);
  await form.getByLabel('Erwarteter Gewinn im Jahr (€, optional)').fill('');
  await form.getByLabel('SVS-Vorschreibung je Quartal (€)').fill('482,43');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await sichtbar(form.getByText(/Gespeichert/));
  await s.goto(`${CRM}/abrechnung/steuer`);
  const weg2 = normal(await s.getByRole('region', { name: 'Einkommensteuer' }).innerText());
  pruefen(/Gewinn im Jahr \(hochgerechnet\)/.test(weg2) && /SVS laufend \(laut SVS-Brief\)/.test(weg2), 'ohne Schätzung: hochgerechnet; SVS laut Vorschreibung');

  // ════ Handy ════
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 844 });
    for (const p of ['/abrechnung/steuer', '/einstellungen/steuer', '/abrechnung/uebersicht']) {
      await s.goto(`${CRM}${p}`);
      const breit = await s.evaluate(() => document.documentElement.scrollWidth);
      pruefen(breit <= breite + 1, `Handy ${breite}px ${p}: kein horizontales Scrollen (${breit}px)`);
    }
    await bild(s, `st2-handy-${breite}`);
  }

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/abrechnung/steuer`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Steuer gesperrt');
  await b.goto(`${CRM}/einstellungen/steuer`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Einstellungen → Steuer gesperrt');
  pruefen(!(await b.getByText('734,56').count()), 'Büro: keine Zahlen');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
