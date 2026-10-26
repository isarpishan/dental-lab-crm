// آزمون «Fixkosten» در Chrome (Spec فاز ۵، قدم ۳): DDL با سررسیدهای گذشته ← «Fällige Fixkosten» زیر «Zu prüfen»
// (Übernehmen با فرم پرشده ← Ausgabe، Überspringen)، هرگز تکراری (بارگذاری‌های پشت‌سرهم و هم‌زمان)، Privat خودکار
// (Einnahme ماهانه، سالانه امروز، فصلی آینده)، علامت «Fixkosten» در فهرست، Pausieren/Fortsetzen، تغییر فقط برای آینده،
// حذف فقط بدون سررسید، ورودی نادرست، Büro بدون دسترسی، موبایل ۳۹۰ و ۳۲۰.
// دادهٔ آزمایشی: «QA · Fix …»، @example.invalid؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-fixkosten  (محیط جدای آزمون، `scripts/qa.mjs`)
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
const iso = (d) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' }).format(d);

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

const INHABER = 'test-fixkosten@example.invalid';
const BUERO = 'test-fixkosten-buero@example.invalid';

async function aufraeumen() {
  const vorlagen = (await sql`select id from ddl.fixkosten_vorlagen where titel like 'QA · Fix%'`).map((v) => v.id);
  if (vorlagen.length) {
    await sql`delete from ddl.fixkosten_laeufe where vorlage_id in ${sql(vorlagen)}`;
    await sql`delete from ddl.audit_log where target_id in ${sql(vorlagen)}`;
    await sql`delete from ddl.fixkosten_vorlagen where id in ${sql(vorlagen)}`;
  }
  await sql`delete from ddl.privat_buchungen where haendler like 'QA · Fix%'`;
  const ausgaben = await sql`select id from ddl.expenses where lieferant like 'QA · Fix%'`;
  if (ausgaben.length) {
    await sql`delete from ddl.audit_log where target_id in ${sql(ausgaben.map((a) => a.id))}`;
    await sql.begin(async (tx) => {
      await tx`set local ddl.ausgaben_loeschen = 'qa'`;
      await tx`delete from ddl.expenses where lieferant like 'QA · Fix%'`;
    });
  }
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-fixkosten-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-fixkosten-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s };
}

const laeufe = (titel) =>
  sql`select l.periode, l.status, l.expense_id, l.privat_buchung_id from ddl.fixkosten_laeufe l join ddl.fixkosten_vorlagen v on v.id = l.vorlage_id where v.titel = ${titel} order by l.periode`;

try {
  const jetzt = new Date();
  const heute = iso(jetzt);
  const vorZwei = iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 2, 1, 12));
  const vorEins = iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 1, 1, 12));
  const inFuenf = iso(new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + 5, 12));
  const { s } = await anmelden(INHABER, 'Test Fixkosten', 'inhaber');

  // ════ DDL ════
  await s.goto(`${CRM}/abrechnung`);
  await s.getByRole('navigation', { name: 'Einnahmen und Ausgaben' }).getByRole('link', { name: 'Fixkosten' }).click();
  await s.waitForURL(`${CRM}/abrechnung/fixkosten`);
  pruefen(await sichtbar(s.getByRole('heading', { name: 'Fixkosten', level: 1 })), 'DDL: Tab »Fixkosten«');
  pruefen(await sichtbar(s.getByText(/Noch keine Fixkosten/)), 'DDL: leer mit Beispielen');

  await s.getByRole('button', { name: '+ Neue Fixkosten' }).click();
  const neu = s.getByRole('form', { name: 'Neue Fixkosten' });
  pruefen(!(await neu.getByText('Einnahme', { exact: true }).count()), 'DDL: keine Wahl »Einnahme«');
  await neu.locator('input[name=titel]').fill('QA · Fix Miete Labor');
  await neu.locator('input[name=gegenpartei]').fill('QA · Fix Vermieter');
  await neu.getByLabel('Kategorie').selectOption('buero');
  await neu.getByLabel('Betrag (€)').fill('1.200');
  await neu.getByLabel('Erste Fälligkeit').fill(vorZwei);
  await neu.getByLabel('Endet am').fill(iso(new Date(jetzt.getFullYear(), jetzt.getMonth() - 3, 1, 12)));
  await neu.getByRole('button', { name: 'Fixkosten anlegen' }).click();
  pruefen(await sichtbar(neu.getByText('»Endet am« liegt vor der ersten Fälligkeit.')), 'ungültig: »Endet am« vor der ersten Fälligkeit');
  pruefen((await neu.locator('input[name=titel]').inputValue()) === 'QA · Fix Miete Labor', 'Eingaben bleiben nach dem Fehler');
  await neu.getByLabel('Endet am').fill('');
  await neu.getByRole('button', { name: 'Fixkosten anlegen' }).click();
  pruefen(await sichtbar(neu.getByText('QA · Fix Miete Labor angelegt.')), 'DDL-Fixkosten angelegt');
  await s.waitForTimeout(1200);

  let l = await laeufe('QA · Fix Miete Labor');
  pruefen(l.length === 3 && l.every((x) => x.status === 'offen'), `drei Monate nachgetragen, alle offen (${l.length})`);
  const [ausgabeDirekt] = await sql`select count(*)::int as n from ddl.expenses where lieferant like 'QA · Fix%'`;
  pruefen(ausgabeDirekt.n === 0, 'DDL: noch keine Ausgabe ohne Bestätigung');

  // nie doppelt: mehrmals und gleichzeitig laden
  await Promise.all([1, 2, 3, 4].map(() => s.request.get(`${CRM}/abrechnung/fixkosten`)));
  await s.reload();
  l = await laeufe('QA · Fix Miete Labor');
  pruefen(l.length === 3, 'gleichzeitige Aufrufe: weiterhin genau drei');
  const zelle = s.getByRole('region', { name: 'Fixkosten in Zahlen' });
  pruefen(/Zu prüfen\s*3/.test(await zelle.innerText()), 'Kennzahl »Zu prüfen«: 3');
  pruefen(await sichtbar(s.getByRole('list', { name: 'Fixkosten' }).getByText(/3 zu prüfen/)), 'Zeile: »3 zu prüfen«');
  await bild(s, 'fk1-ddl');

  // ── Ausgaben → Zu prüfen ──
  await s.goto(`${CRM}/abrechnung/ausgaben`);
  pruefen(/Zu prüfen\s*[3-9]/.test(await s.getByRole('navigation', { name: 'Bereiche der Ausgaben' }).innerText()), 'Ausgaben: »Zu prüfen« zählt die Fixkosten mit');
  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  const faellig = s.getByRole('list', { name: 'Fällige Fixkosten' });
  pruefen((await faellig.getByRole('button').count()) === 3, 'drei fällige Fixkosten');
  await faellig.getByRole('button').first().click();
  const fenster = s.getByRole('dialog', { name: 'Fixkosten QA · Fix Miete Labor' });
  const form = fenster.getByRole('form', { name: 'Fixkosten übernehmen' });
  pruefen(
    (await form.locator('input[name=lieferant]').inputValue()) === 'QA · Fix Vermieter' &&
      (await form.getByLabel('Brutto (€)').inputValue()) === '1200,00' &&
      (await form.getByLabel('Netto (€)').inputValue()) === '1000,00' &&
      (await form.getByLabel('Kategorie').inputValue()) === 'buero' &&
      (await form.locator('input[name=rechnungsdatum]').inputValue()) === vorZwei,
    'Formular: Lieferant, Brutto/Netto, Kategorie, Datum der Fälligkeit',
  );
  pruefen(await sichtbar(form.getByLabel('Beleg (Foto oder PDF)')), 'Beleg kann gleich mit');
  await form.getByRole('button', { name: 'Übernehmen' }).click();
  pruefen(await sichtbar(form.getByText(/Ausgabe erfasst: QA · Fix Vermieter/)), 'übernommen');
  l = await laeufe('QA · Fix Miete Labor');
  const [ausgabe] = await sql`select id, brutto_cent, bezahlt_am from ddl.expenses where lieferant = 'QA · Fix Vermieter'`;
  const tag = (d) => (d instanceof Date ? iso(d) : String(d));
  pruefen(
    l[0].status === 'gebucht' && l[0].expense_id === ausgabe?.id && ausgabe.brutto_cent === 120000 && tag(ausgabe.bezahlt_am) === vorZwei,
    `Datenbank: Ausgabe 1.200,00, Lauf »gebucht« mit Verweis (${l[0].status}, ${ausgabe?.brutto_cent}, ${tag(ausgabe?.bezahlt_am)})`,
  );

  await s.goto(`${CRM}/abrechnung/ausgaben?tab=pruefen`);
  pruefen((await faellig.getByRole('button').count()) === 2, 'noch zwei offen');
  await faellig.getByRole('button').first().click();
  const fenster2 = s.getByRole('dialog', { name: 'Fixkosten QA · Fix Miete Labor' });
  await fenster2.getByRole('button', { name: 'Diesen Monat überspringen' }).click();
  pruefen(await sichtbar(fenster2.getByText(/übersprungen\.$/)), 'übersprungen');
  l = await laeufe('QA · Fix Miete Labor');
  pruefen(l[1].status === 'uebersprungen' && !l[1].expense_id && l[2].status === 'offen', 'Datenbank: zweiter übersprungen, dritter offen');
  const [nurEine] = await sql`select count(*)::int as n from ddl.expenses where lieferant like 'QA · Fix%'`;
  pruefen(nurEine.n === 1, 'genau eine Ausgabe');
  await bild(s, 'fk2-zu-pruefen');

  // ════ Privat ════
  await s.goto(`${CRM}/privat`);
  await s.getByRole('navigation', { name: 'Bereiche von Privat' }).getByRole('link', { name: 'Fixkosten' }).click();
  await s.waitForURL(`${CRM}/privat/fixkosten`);
  const anlegen = async (w) => {
    await s.getByRole('button', { name: '+ Neue Fixkosten' }).click();
    const f = s.getByRole('form', { name: 'Neue Fixkosten' });
    if (w.einnahme) await f.getByText('Einnahme', { exact: true }).click();
    await f.locator('input[name=titel]').fill(w.titel);
    await f.getByLabel('Kategorie').selectOption(w.kategorie);
    await f.getByLabel('Betrag (€)').fill(w.betrag);
    await f.getByLabel('Wie oft?').selectOption(w.rhythmus);
    await f.getByLabel('Erste Fälligkeit').fill(w.ab);
    await f.getByRole('button', { name: 'Fixkosten anlegen' }).click();
    const ok = await sichtbar(f.getByText(`${w.titel} angelegt.`));
    await s.waitForTimeout(1100);
    await s.keyboard.press('Escape');
    return ok;
  };
  pruefen(await anlegen({ einnahme: true, titel: 'QA · Fix Gehalt', kategorie: 'gehalt', betrag: '3.000', rhythmus: 'monatlich', ab: vorEins }), 'Privat: Gehalt angelegt');
  pruefen(await anlegen({ titel: 'QA · Fix Strom', kategorie: 'energie', betrag: '600', rhythmus: 'jaehrlich', ab: heute }), 'Privat: Strom jährlich ab heute');
  pruefen(await anlegen({ titel: 'QA · Fix Streaming', kategorie: 'abos', betrag: '13,99', rhythmus: 'quartal', ab: inFuenf }), 'Privat: Abo ab in fünf Tagen');

  const gehalt = await laeufe('QA · Fix Gehalt');
  const strom = await laeufe('QA · Fix Strom');
  const abo = await laeufe('QA · Fix Streaming');
  pruefen(gehalt.length === 2 && gehalt.every((x) => x.status === 'gebucht' && x.privat_buchung_id), 'Gehalt: zwei Monate automatisch gebucht');
  pruefen(strom.length === 1 && abo.length === 0, 'Strom heute gebucht, Abo noch nicht');
  const buchungen = await sql`select art, betrag_cent, datum, quelle, kategorie from ddl.privat_buchungen where haendler like 'QA · Fix%' order by datum`;
  pruefen(buchungen.length === 3 && buchungen.every((b) => b.quelle === 'vorlage') && buchungen.filter((b) => b.art === 'einnahme').length === 2, 'Datenbank: drei Buchungen aus Fixkosten');
  const liste = s.getByRole('list', { name: 'Fixkosten' });
  pruefen(/vierteljährlich am/.test(await liste.getByRole('button', { name: /QA · Fix Streaming/ }).innerText()), 'Liste: Rhythmus');
  pruefen(await sichtbar(s.getByText(new RegExp(`${inFuenf.split('-').reverse().join('\\.')}`)).first()), 'Liste: nächste Fälligkeit des Abos');
  pruefen(/Einnahmen pro Monat\s*€\s3\.000,00/.test(await s.getByRole('region', { name: 'Fixkosten in Zahlen' }).innerText()), 'Kennzahl: Einnahmen pro Monat € 3.000,00');
  await bild(s, 'fk3-privat');

  await s.goto(`${CRM}/privat/buchungen`);
  pruefen(await sichtbar(s.getByRole('button', { name: /QA · Fix Gehalt/ }).first().getByText('Fixkosten')), 'Buchungen: Zeile mit »Fixkosten«');

  // ── pausieren: nichts Neues; fortsetzen: Fehlendes wird nachgetragen ──
  await s.goto(`${CRM}/privat/fixkosten`);
  await liste.getByRole('button', { name: /QA · Fix Gehalt/ }).click();
  const gFenster = s.getByRole('dialog', { name: 'Fixkosten QA · Fix Gehalt' });
  pruefen(!(await gFenster.getByText('Fixkosten löschen …').count()), 'schon fällig gewesen: kein Löschen');
  await gFenster.getByRole('button', { name: 'Pausieren' }).click();
  pruefen(await sichtbar(gFenster.getByText(/pausiert\. Es wird nichts mehr gebucht/)), 'pausiert');
  await s.keyboard.press('Escape');
  // den aktuellen Monat entfernen, als wäre er noch nicht gelaufen
  const [diesen] = await sql`select l.id, l.privat_buchung_id from ddl.fixkosten_laeufe l join ddl.fixkosten_vorlagen v on v.id = l.vorlage_id where v.titel = 'QA · Fix Gehalt' and l.periode = ${heute.slice(0, 7)}`;
  await sql`delete from ddl.fixkosten_laeufe where id = ${diesen.id}`;
  await sql`delete from ddl.privat_buchungen where id = ${diesen.privat_buchung_id}`;
  await s.reload();
  pruefen((await laeufe('QA · Fix Gehalt')).length === 1, 'pausiert: nichts nachgetragen');
  pruefen(/pausiert/.test(await liste.getByRole('button', { name: /QA · Fix Gehalt/ }).innerText()), 'Liste: »pausiert«');
  await liste.getByRole('button', { name: /QA · Fix Gehalt/ }).click();
  await gFenster.getByRole('button', { name: 'Fortsetzen' }).click();
  pruefen(await sichtbar(gFenster.getByText(/läuft wieder/)), 'fortgesetzt');
  pruefen((await laeufe('QA · Fix Gehalt')).length === 2, 'fortgesetzt: aktueller Monat wieder gebucht');

  // ── ändern gilt nur künftig ──
  const gForm = gFenster.getByRole('form', { name: 'Fixkosten ändern' });
  await gForm.getByLabel('Betrag (€)').fill('3.200');
  await gForm.getByRole('button', { name: 'Änderungen speichern' }).click();
  pruefen(await sichtbar(gForm.getByText(/gespeichert\. Gilt ab der nächsten Fälligkeit\./)), 'geändert');
  const gehaltBetraege = await sql`select betrag_cent from ddl.privat_buchungen where haendler = 'QA · Fix Gehalt'`;
  pruefen(gehaltBetraege.every((b) => b.betrag_cent === 300000), 'schon Gebuchtes bleibt bei 3.000');
  await s.keyboard.press('Escape');

  // ── löschen nur ohne Fälligkeit ──
  await liste.getByRole('button', { name: /QA · Fix Streaming/ }).click();
  const aFenster = s.getByRole('dialog', { name: 'Fixkosten QA · Fix Streaming' });
  await aFenster.getByText('Fixkosten löschen …').click();
  await aFenster.getByRole('button', { name: 'Wirklich löschen: QA · Fix Streaming' }).click();
  pruefen(await sichtbar(aFenster.getByText('QA · Fix Streaming gelöscht.')), 'ohne Fälligkeit: gelöscht');
  const [weg] = await sql`select count(*)::int as n from ddl.fixkosten_vorlagen where titel = 'QA · Fix Streaming'`;
  pruefen(weg.n === 0, 'Datenbank: gelöscht');

  // ════ Handy ════
  for (const breite of [390, 320]) {
    await s.setViewportSize({ width: breite, height: 844 });
    for (const pfad of ['/abrechnung/fixkosten', '/privat/fixkosten', '/abrechnung/ausgaben?tab=pruefen']) {
      await s.goto(`${CRM}${pfad}`);
      const breit = await s.evaluate(() => document.documentElement.scrollWidth);
      pruefen(breit <= breite + 1, `Handy ${breite}px ${pfad}: kein horizontales Scrollen (${breit}px)`);
    }
    await s.goto(`${CRM}/privat/fixkosten`);
    await s.getByRole('button', { name: '+ Neue Fixkosten' }).click();
    pruefen((await s.evaluate(() => document.documentElement.scrollWidth)) <= breite + 1, `Handy ${breite}px: Formular passt`);
    await bild(s, `fk4-handy-${breite}`);
  }

  // ════ Büro ════
  const { s: b } = await anmelden(BUERO, 'Test Büro', 'buero');
  await b.goto(`${CRM}/abrechnung/fixkosten`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: DDL-Fixkosten gesperrt');
  await b.goto(`${CRM}/privat/fixkosten`);
  pruefen(await sichtbar(b.getByRole('heading', { name: 'Kein Zugriff.' })), 'Büro: Privat-Fixkosten gesperrt');
  pruefen(!(await b.getByText('QA · Fix').count()), 'Büro: keine Fixkosten sichtbar');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
