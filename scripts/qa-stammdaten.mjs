// آزمون Stammdaten مثل یک کاربر واقعی: Ordination، Behandler، Portal-Zugang، ورود پورتال
// و صفحهٔ Preise. فقط با دادهٔ آزمایشی (@example.invalid، نام «QA · …»). قیمت‌ها و
// شمارندهٔ Kundennummer قبل از آزمون ذخیره و بعد از آن دقیقاً برگردانده می‌شوند.
// اجرا: pnpm qa qa-stammdaten  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const BILDER = process.env.QA_BILDER ?? null; // Ordner für Screenshots (optional)
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};
const sichtbar = async (loc) => {
  try {
    await loc.waitFor({ timeout: 6000 });
    return true;
  } catch {
    return false;
  }
};

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

async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · %'`).map((r) => r.id);
  if (praxen.length) {
    const nutzer = (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (nutzer.length) {
      await sql`delete from ddl.sessions where user_kind = 'practice' and user_id in ${sql(nutzer)}`;
      await sql`delete from ddl.one_time_tokens where user_kind = 'practice' and user_id in ${sql(nutzer)}`;
    }
    await vereinbarungenLoeschen(sql, praxen);
    await sql`delete from ddl.practices where id in ${sql(praxen)}`;
  }
  const staff = (await sql`select id from ddl.staff_users where email = 'test-stamm@example.invalid'`).map((r) => r.id);
  if (staff.length) {
    await sql`delete from ddl.sessions where user_id in ${sql(staff)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(staff)}`;
    await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  }
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
  await sql`delete from ddl.jobs where payload->>'an' like '%@example.invalid'`;
  await sql`delete from ddl.audit_log where actor_label in ('Test Stamm', 'QA Praxis', 'test-stamm@example.invalid', 'qa-praxis@example.invalid')`;
}

await aufraeumen();
const preiseVorher = await sql`select key, is_active, turnaround_label, delivery_options, express_available, express_surcharge, same_day_available, same_day_surcharge from ddl.work_types`;
const [zaehlerVorher] = await sql`select last_value from ddl.number_sequences where scope = 'kunde' and year = 0`;
const browser = await chromium.launch({ channel: 'chrome' });
let testNummer = null;

try {
  // ── Test-Inhaber ──
  const [ich] = await sql`insert into ddl.staff_users (email, name, role) values ('test-stamm@example.invalid', 'Test Stamm', 'inhaber') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${ich.id}, now() + interval '1 hour')`;
  const a = await (await browser.newContext()).newPage();
  await a.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await a.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await a.getByLabel('Neues Passwort').fill('test-passwort-stamm-1');
  await a.getByLabel('Passwort wiederholen').fill('test-passwort-stamm-1');
  await a.getByLabel('Code aus der App').fill(totp(geheimnis));
  await a.getByRole('button', { name: 'Zugang einrichten' }).click();
  await a.waitForURL(`${CRM}/`);

  // ── Ordination anlegen ──
  // Ordinationen ist ein Tab unter »Einstellungen«
  await a.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Einstellungen' }).click();
  await a.getByRole('navigation', { name: 'Einstellungen' }).getByRole('link', { name: 'Ordinationen' }).click();
  await a.getByRole('link', { name: 'Neue Ordination' }).click();
  await a.getByLabel('Name der Ordination').fill('QA · Ordination Test');
  await a.getByLabel('Straße und Hausnummer').fill('Testgasse 1');
  await a.getByLabel('PLZ').fill('1010');
  await a.getByLabel('Ort').fill('Wien');
  await a.getByLabel('E-Mail der Ordination').fill('qa-ordination@example.invalid');
  await a.getByLabel('UID-Nummer').fill('ATU123');
  await a.getByRole('button', { name: 'Ordination anlegen' }).click();
  pruefen(await sichtbar(a.getByText('Die UID-Nummer hat die Form ATU12345678.')), 'falsche UID-Nummer wird abgelehnt');
  await a.getByLabel('UID-Nummer').fill('ATU12345678');
  await a.getByRole('button', { name: 'Ordination anlegen' }).click();
  pruefen(await sichtbar(a.getByText(/Die Ordination ist angelegt \(Kundennummer K-\d{4}\)/)), 'Ordination angelegt, Kundennummer automatisch');
  testNummer = Number((await a.getByText(/Kundennummer K-\d{4}/).textContent()).match(/K-(\d{4})/)[1]);
  const detail = a.url().split('?')[0];
  // صفحهٔ Ordination تب دارد (۲۵ اکتبر ۲۰۲۶): بعد از ساختن، تب «Stammdaten» باز است
  pruefen(await sichtbar(a.getByRole('navigation', { name: 'Bereiche der Ordination' }).getByRole('link', { name: 'Stammdaten', exact: true })), 'Ordination: Bereiche als Tabs, »Stammdaten« zuerst');
  await a.getByRole('navigation', { name: 'Bereiche der Ordination' }).getByRole('link', { name: /^Behandler/ }).click();
  await a.waitForURL(/tab=behandler/);

  // ── Behandler ──
  await a.getByLabel('Titel').fill('Dr.');
  await a.getByLabel('Vorname').fill('Test');
  await a.getByLabel('Nachname').fill('Behandler');
  await a.getByRole('button', { name: 'Behandler hinzufügen' }).click();
  pruefen(await sichtbar(a.getByRole('list', { name: 'Behandler' }).getByText('Dr. Test Behandler')), 'Behandler hinzugefügt');

  // ── Portal-Zugang einladen ──
  await a.getByRole('navigation', { name: 'Bereiche der Ordination' }).getByRole('link', { name: /^Portal-Zugänge/ }).click();
  await a.waitForURL(/tab=zugaenge/);
  const einladen = a.locator('form', { has: a.getByRole('button', { name: 'Zum Portal einladen' }) });
  await einladen.locator('input[name="name"]').fill('QA Praxis');
  await einladen.getByLabel('E-Mail-Adresse').fill('qa-praxis@example.invalid');
  // Mailpit ایمیل‌های اجراهای قبلی را نگه می‌دارد (مثلاً «Bestätigung: Vereinbarung»)؛ فقط ایمیل تازه حساب است
  const eingeladenAb = Date.now() - 2000;
  await einladen.getByRole('button', { name: 'Zum Portal einladen' }).click();
  pruefen(await sichtbar(a.getByText('Einladung an qa-praxis@example.invalid wurde verschickt.')), 'Portal-Zugang eingeladen');
  const link = (await a.locator('code').first().textContent()).trim();
  pruefen(link.startsWith(`${PORTAL}/einladung/`), 'Einladungslink zeigt auf das Portal');

  let mail = null;
  for (let i = 0; i < 15 && !mail; i++) {
    const r = await (await fetch('http://localhost:8025/api/v1/search?query=to:qa-praxis@example.invalid')).json();
    mail = r.messages?.find((m) => m.Subject === 'Ihr Zugang zum Portal von Digital Dental Lab' && Date.parse(m.Created) >= eingeladenAb) ?? null;
    if (!mail) await new Promise((r) => setTimeout(r, 1000));
  }
  pruefen(Boolean(mail), 'Einladungs-E-Mail kommt an (Mailpit)');

  // ── پورتال: ساختن رمز، بعد واردشده ──
  const p = await (await browser.newContext()).newPage();
  await p.goto(link);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Willkommen, QA Praxis.' })), 'Portal: Einladungsseite mit Name');
  await p.getByLabel('Neues Passwort').fill('test-passwort-praxis-1');
  await p.getByLabel('Passwort wiederholen').fill('test-passwort-praxis-1');
  await p.getByRole('button', { name: 'Zugang einrichten' }).click();
  // پورتال تازه: اول Vereinbarung (جزئیاتش در qa-vereinbarung)
  await p.waitForURL(`${PORTAL}/vereinbarung`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Bevor es losgeht.' })), 'Portal: zuerst die Vereinbarung');
  await p.getByRole('region', { name: 'Text der Vereinbarung' }).evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await p.getByLabel(/Ich habe die Vereinbarung gelesen/).check();
  await p.getByRole('button', { name: 'Vereinbarung annehmen' }).click();
  await p.waitForURL(`${PORTAL}/`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Guten Tag, QA.' })), 'Portal: nach dem Einrichten angemeldet');
  pruefen(await p.getByText('Portal · QA · Ordination Test').isVisible(), 'Portal zeigt die eigene Ordination');
  await p.goto(`${CRM}/ordinationen`);
  pruefen(p.url().startsWith(`${CRM}/anmelden`), 'Portal-Sitzung öffnet das interne System nicht');

  // ── غیرفعال ← فوراً بیرون؛ دوباره فعال ← ورود ──
  await a.goto(`${detail}?tab=zugaenge`);
  const zeile = a.locator('li', { hasText: 'qa-praxis@example.invalid' });
  await zeile.getByRole('button', { name: 'Deaktivieren' }).click();
  await a.getByText('QA Praxis ist deaktiviert und wurde sofort abgemeldet.').waitFor();
  await p.goto(`${PORTAL}/`);
  pruefen(p.url().startsWith(`${PORTAL}/anmelden`), 'deaktivierter Portal-Zugang ist sofort abgemeldet');
  await zeile.getByRole('button', { name: 'Aktivieren' }).click();
  await a.getByText('QA Praxis ist wieder aktiv.').waitFor();
  await p.getByLabel('E-Mail-Adresse').fill('qa-praxis@example.invalid');
  await p.getByLabel('Passwort').fill('test-passwort-praxis-1');
  await p.getByRole('button', { name: 'Anmelden' }).click();
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Guten Tag, QA.' })), 'Portal-Anmeldung mit E-Mail und Passwort');

  // ── غیرفعال‌کردن Ordination پورتال را می‌بندد ──
  await a.goto(detail);
  await a.locator('select[name="isActive"]').first().selectOption('nein');
  await a.locator('#bereich-stammdaten').getByRole('button', { name: 'Speichern', exact: true }).click();
  pruefen(await sichtbar(a.getByText(/Die Ordination ist deaktiviert; ihre Portal-Zugänge wurden sofort abgemeldet/)), 'Ordination deaktiviert');
  await p.goto(`${PORTAL}/`);
  pruefen(p.url().startsWith(`${PORTAL}/anmelden`), 'deaktivierte Ordination: Portal gesperrt');

  // ── Preise ──
  await a.goto(`${CRM}/preise`);
  await a.getByLabel('Nur Design ab').first().fill('abc');
  await a.getByRole('button', { name: 'Speichern', exact: true }).click();
  pruefen(await sichtbar(a.getByText(/»abc« ist kein gültiger Betrag/)), 'ungültiger Preis wird abgelehnt');
  // drei Stufen: Same-Day nur bei Krone und Inlay/Onlay angehakt, Express bei allen außer Prothesen
  const angehakt = async (name) => a.locator(`input[name="${name}"]`).isChecked();
  pruefen(
    (await angehakt('sameday_an_krone')) && (await angehakt('sameday_an_inlay')) && !(await angehakt('sameday_an_bruecke')) && (await angehakt('express_an_bruecke')) && !(await angehakt('express_an_teilprothese')),
    'Preise: Same-Day bei Krone und Inlay, Express nicht bei Prothesen',
  );
  pruefen((await a.locator('#zeit_krone').inputValue()) === 'nach Prüfung', 'Krone: Standard-Bearbeitungszeit »nach Prüfung«, nicht »Same Day möglich«');
  await a.locator('#design_krone').fill('89,50');
  await a.locator('#fertigung_krone').fill('249');
  await a.locator('#express_bruecke').fill('40');
  await a.locator('#sameday_krone').fill('60');
  await a.locator('input[name="express_an_schiene"]').uncheck();
  await a.getByRole('button', { name: 'Speichern', exact: true }).click();
  pruefen(await sichtbar(a.getByText('Gespeichert: Krone, Brücke, Schiene.')), 'Preise gespeichert');
  const [schiene] = await sql`select express_available, express_surcharge from ddl.work_types where key = 'schiene'`;
  const [krone] = await sql`select express_surcharge, same_day_surcharge from ddl.work_types where key = 'krone'`;
  pruefen(!schiene.express_available && krone.same_day_surcharge.betrag === 60 && krone.express_surcharge.betrag === null, 'Datenbank: Same-Day-Zuschlag getrennt vom Expresszuschlag, Express pro Behandlung abschaltbar');
  await a.goto(`${CRM}/vorschau`);
  pruefen(await sichtbar(a.getByText(/ab\s€\s89,50\spro\sZahn/).first()), 'neuer Preis erscheint sofort im Auftragsformular');
  // jede Lieferart mit eigenem Namen, Fertig zuerst (früher nur der billigste Preis ohne Namen, also Design)
  // Kinder der Kachel: Bild, Name, dann die Preiszeilen
  const kronePreise = (await a.getByRole('button', { name: /^Krone/ }).locator(':scope > span').allInnerTexts()).slice(2);
  pruefen(
    kronePreise.join(' | ').replace(/\s/g, ' ') === 'Fertig ab € 249 pro Zahn | Nur Design ab € 89,50 pro Zahn',
    `Kachel Krone: Preis für fertige Arbeit und für Nur Design getrennt benannt (${kronePreise.join(' | ')})`,
  );
  pruefen(await a.getByRole('button', { name: /^Brücke/ }).getByText('Preis auf Anfrage', { exact: true }).isVisible(), 'Kachel ohne Preise: nur »Preis auf Anfrage«');
  pruefen(await a.getByRole('button', { name: /^Krone/ }).getByText('Same-Day möglich', { exact: true }).isVisible(), 'Kachel Krone: »Same-Day möglich«');
  await a.goto(`${CRM}/vorschau?beispiel=bruecke&offen=tempo`);
  pruefen(await sichtbar(a.getByText(/Expresszuschlag €\s40 pro Auftrag/)), 'Expresszuschlag erscheint bei Express');
  pruefen((await a.getByRole('group', { name: 'Tempo' }).getByRole('button', { name: /^Same-Day/ }).count()) === 0, 'Brücke: kein Same-Day');
  await a.goto(`${CRM}/vorschau?beispiel=krone&offen=tempo`);
  pruefen(await sichtbar(a.getByText(/Same-Day-Zuschlag €\s60 pro Auftrag/)) && (await a.getByText(/Expresszuschlag nach Prüfung/).isVisible()), 'Krone: Same-Day-Zuschlag und Expresszuschlag getrennt');
  // Preis mit Summe am Ende des Formulars (25.10.2026): Krone 26, Fertig, Same-Day = € 249 + € 60
  await a.goto(`${CRM}/vorschau?beispiel=krone`);
  const preisBox = a.getByRole('region', { name: 'Preis', exact: true });
  const preisText = (await sichtbar(preisBox)) ? (await preisBox.innerText()).replace(/\s+/g, ' ') : '';
  pruefen(['€ 309,00', 'netto', '1 Zahn', '€ 249,00', 'Same-Day-Zuschlag', '€ 60,00', 'steuerfrei'].every((t) => preisText.includes(t)) && !/voraussichtlich|Richtwert/i.test(preisText), `Formular: »Preis« € 309 (ohne »voraussichtlich«) mit Zusammensetzung (${preisText.slice(0, 160)})`);

  // ── ظاهر: بدون اسکرول افقی و بدون خطای کنسول، در ۴ اندازه ──
  const konsole = [];
  a.on('pageerror', (e) => konsole.push(String(e)));
  a.on('console', (m) => m.type() === 'error' && konsole.push(m.text()));
  const zuBreit = [];
  for (const [breite, hoehe] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
    await a.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of ['/ordinationen', detail.replace(CRM, ''), '/preise', '/benutzer', '/', '/vorschau']) {
      await a.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
      if (BILDER && pfad === '/vorschau') await a.screenshot({ path: path.join(BILDER, `vorschau-kacheln-${breite}.png`), fullPage: true });
      const w = await a.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${pfad.split('/')[1]} ${breite}px: ${w}px`);
    }
  }
  pruefen(!zuBreit.length && !konsole.length, `Interne Seiten: kein horizontales Scrollen, keine Konsolenfehler (1440/1024/768/390/320)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}${konsole.length ? ' → ' + konsole[0].slice(0, 120) : ''}`);

  const aktionen = (await sql`select action from ddl.audit_log where actor_label = 'Test Stamm'`).map((r) => r.action);
  pruefen(['ordination_angelegt', 'behandler_angelegt', 'praxiszugang_eingeladen', 'praxiszugang_deaktiviert', 'ordination_geaendert', 'katalog_geaendert'].every((x) => aktionen.includes(x)), 'Audit-Log: jede Änderung mit Namen');
} finally {
  await browser.close();
  // قیمت‌ها و شمارندهٔ Kundennummer دقیقاً مثل قبل از آزمون
  for (const w of preiseVorher) {
    await sql`update ddl.work_types set is_active = ${w.is_active}, turnaround_label = ${w.turnaround_label}, delivery_options = ${sql.json(w.delivery_options)},
      express_available = ${w.express_available}, express_surcharge = ${sql.json(w.express_surcharge)},
      same_day_available = ${w.same_day_available}, same_day_surcharge = ${sql.json(w.same_day_surcharge)} where key = ${w.key}`;
  }
  if (testNummer !== null) {
    if (zaehlerVorher) await sql`update ddl.number_sequences set last_value = ${zaehlerVorher.last_value} where scope = 'kunde' and year = 0 and last_value = ${testNummer}`;
    else await sql`delete from ddl.number_sequences where scope = 'kunde' and year = 0 and last_value = ${testNummer}`;
  }
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
