// آزمون کامل ورود، مثل یک کاربر واقعی، با کاربرهای آزمایشی (@example.invalid).
// اجرا: pnpm qa qa-anmeldung  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
};

function base32Dekodieren(t) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, wert = 0;
  const aus = [];
  for (const z of t.replace(/\s/g, '')) {
    wert = (wert << 5) | A.indexOf(z);
    bits += 5;
    if (bits >= 8) { aus.push((wert >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(aus);
}
function totp(geheimnis) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', base32Dekodieren(geheimnis)).update(b).digest();
  const v = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(v) & 0x7fffffff) % 1e6).padStart(6, '0');
}

async function aufraeumen() {
  const ids = (await sql`select id from ddl.staff_users where email like '%@example.invalid'`).map((r) => r.id);
  if (ids.length) {
    await sql`delete from ddl.sessions where user_id in ${sql(ids)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(ids)}`;
    await sql`delete from ddl.staff_users where id in ${sql(ids)}`;
  }
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'anmeldung-ip:%' or key like 'code:%' or key like 'einrichtung:%'`;
  await sql`delete from ddl.jobs where payload->>'an' like '%@example.invalid'`;
}

async function einrichten(page, link, passwort) {
  await page.goto(link);
  const geheimnis = (await page.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await page.getByLabel('Neues Passwort').fill(passwort);
  await page.getByLabel('Passwort wiederholen').fill(passwort);
  await page.getByLabel('Code aus der App').fill(totp(geheimnis));
  await page.getByRole('button', { name: 'Zugang einrichten' }).click();
  await page.waitForURL(`${CRM}/`);
  return geheimnis;
}

await aufraeumen();
const browser = await chromium.launch({ channel: 'chrome' });

try {
  // 1. Test-Inhaber mit Einladungslink (wie `pnpm inhaber`)
  const [inhaber] = await sql`insert into ddl.staff_users (email, name, role) values ('test-inhaber@example.invalid', 'Test Inhaber', 'inhaber') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${inhaber.id}, now() + interval '1 hour')`;

  const a = await (await browser.newContext()).newPage();
  const geheimnis = await einrichten(a, `${CRM}/einladung/${token}`, 'test-passwort-inhaber-1');
  pruefen(await a.getByRole('heading', { name: 'Guten Tag, Test.' }).isVisible(), 'Einrichtung per Link: Passwort + 2FA, danach angemeldet');

  await a.goto(`${CRM}/einladung/${token}`);
  pruefen(await a.getByRole('heading', { name: 'Link nicht gültig.' }).isVisible(), 'Einrichtungslink nur einmal verwendbar');

  // 2. Abmelden und wieder anmelden mit Passwort + Code
  await a.goto(`${CRM}/`);
  await a.getByRole('button', { name: 'Abmelden' }).click();
  await a.waitForURL(`${CRM}/anmelden`);
  await a.getByLabel('E-Mail-Adresse').fill('TEST-inhaber@example.invalid');
  await a.getByLabel('Passwort').fill('test-passwort-inhaber-1');
  await a.getByRole('button', { name: 'Anmelden' }).click();
  await a.waitForURL(`${CRM}/anmelden/code`);
  await a.getByLabel('Code aus der Authenticator-App').fill(totp(geheimnis));
  await a.getByRole('button', { name: 'Bestätigen' }).click();
  await a.waitForURL(`${CRM}/`);
  pruefen(await a.getByRole('heading', { name: 'Guten Tag, Test.' }).isVisible(), 'Anmeldung mit Passwort und Code (E-Mail ohne Groß/Klein-Unterschied)');

  // 3. Mitarbeiter einladen → E-Mail im Testpostfach
  await a.goto(`${CRM}/benutzer`);
  // فقط داخل فرم دعوت: در فهرست، کاربرهای واقعی (مثلاً Inhaber) هم فیلد «Rolle» دارند
  const einladen = a.locator('form', { has: a.getByRole('button', { name: 'Mitarbeiter einladen' }) });
  await einladen.getByLabel('Name').fill('Test Techniker');
  await einladen.getByLabel('E-Mail-Adresse').fill('test-techniker@example.invalid');
  await einladen.getByLabel('Rolle').selectOption('techniker');
  await einladen.getByRole('button', { name: 'Mitarbeiter einladen' }).click();
  await a.getByText('Einladung an test-techniker@example.invalid wurde verschickt.').waitFor();
  const link = (await a.locator('code').first().textContent()).trim();
  pruefen(link.startsWith(`${CRM}/einladung/`), 'Einladung erstellt, Link wird angezeigt');

  let mail = null;
  for (let i = 0; i < 15 && !mail; i++) {
    const r = await (await fetch('http://localhost:8025/api/v1/search?query=to:test-techniker@example.invalid')).json();
    mail = r.messages?.[0] ?? null;
    if (!mail) await new Promise((r) => setTimeout(r, 1000));
  }
  pruefen(mail?.Subject === 'Ihr Zugang zum Digital Dental Lab', 'E-Mail kommt über den Worker im Testpostfach (Mailpit) an');

  // 4. Techniker richtet ein, sieht keine Benutzerverwaltung
  const t = await (await browser.newContext()).newPage();
  await einrichten(t, link, 'test-passwort-techniker-1');
  pruefen((await t.getByRole('link', { name: /Benutzer/ }).count()) === 0, 'Techniker: kein Link zu «Benutzer» (Menü und Übersicht)');
  await t.goto(`${CRM}/benutzer`);
  pruefen(await t.getByRole('heading', { name: 'Kein Zugriff.' }).isVisible(), 'Techniker: /benutzer gesperrt');

  // 5. Deaktivieren → sofort abgemeldet
  await a.goto(`${CRM}/benutzer`);
  const zeile = a.locator('li', { hasText: 'test-techniker@example.invalid' });
  await zeile.getByRole('button', { name: 'Deaktivieren' }).click();
  await a.getByText('Test Techniker ist deaktiviert und wurde sofort abgemeldet.').waitFor();
  await t.goto(`${CRM}/`);
  pruefen(t.url().startsWith(`${CRM}/anmelden`), 'Deaktivierter Techniker ist sofort abgemeldet');

  // 6. Sich selbst sperren geht nicht; letzter Inhaber bleibt
  pruefen(await a.locator('li', { hasText: 'test-inhaber@example.invalid' }).getByText('Ihr Zugang').isVisible(), 'Eigener Zugang ohne Sperr-Knopf');

  // 7. Zu viele falsche Passwörter
  const f = await (await browser.newContext()).newPage();
  let meldung = '';
  for (let i = 0; i < 6; i++) {
    await f.goto(`${CRM}/anmelden`);
    await f.getByLabel('E-Mail-Adresse').fill('test-inhaber@example.invalid');
    await f.getByLabel('Passwort').fill('falsch-falsch-falsch');
    await f.getByRole('button', { name: 'Anmelden' }).click();
    // Next.js hat ein eigenes, leeres role=alert; deshalb auf den Text warten
    const m = f.getByText(/nicht korrekt|Zu viele Versuche/);
    await m.waitFor();
    meldung = await m.textContent();
  }
  pruefen(meldung.includes('Zu viele Versuche'), 'Nach 5 Fehlversuchen gesperrt (15 Minuten)');

  // 8. Portal getrennt, interne Pfade nicht erreichbar
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${PORTAL}/benutzer`);
  pruefen(p.url().startsWith(`${PORTAL}/anmelden`) && (await p.getByText('Portal für Ordinationen').isVisible()), 'Portal: eigene Anmeldung, keine internen Seiten');
  const r = await p.goto(`${CRM}/intern/benutzer`);
  pruefen(r.status() === 404, 'Interne Pfade direkt: 404');

  const [{ anzahl }] = await sql`select count(*)::int as anzahl from ddl.audit_log where actor_label in ('Test Inhaber', 'test-inhaber@example.invalid')`;
  pruefen(anzahl >= 5, `Audit-Log: ${anzahl} Einträge für den Test-Inhaber`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql`delete from ddl.audit_log where actor_label in ('Test Inhaber', 'test-inhaber@example.invalid', 'Test Techniker', 'test-techniker@example.invalid')`;
  await sql.end();
}
process.exit(fehler ? 1 : 0);
