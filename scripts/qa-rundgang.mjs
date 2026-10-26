// گشتی در همهٔ صفحه‌ها با دادهٔ نمایشی کامل (قدم ۱۲؛ Spec: «هیچ صفحه‌ای بدون دادهٔ نمایشی نشکند»):
// Inhaber همهٔ صفحه‌های داخلی و هر ۳۸ سفارش ارسال‌شده را با هر ۴ تب باز می‌کند؛ یک کاربر پورتال همهٔ
// سفارش‌ها، بیماران و Entwurf خودش را. هر صفحه: پاسخ ۲۰۰، بدون خطای مرورگر، بدون «Application error».
// صفحه‌های فهرست، تور و Reklamation هیچ نام بیماری ندارند. داشبورد عددهای نمایشی را نشان می‌دهد.
// ظاهر چند صفحهٔ پرمحتوا در عرض موبایل. داده‌ها را فقط می‌خواند؛ کاربرهای آزمون در پایان پاک می‌شوند.
// اجرا: pnpm qa qa-rundgang  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM, PORTAL } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const BILDER = process.env.QA_BILDER ?? null;
const sha = (s) => createHash('sha256').update(s).digest('hex');
let fehler = 0;
const pruefen = (ok, text) => {
  console.log(`${ok ? '✓' : '✗'} ${text}`);
  if (!ok) fehler++;
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
function entschluesseln(wert) {
  const [, iv, tag, daten] = wert.split('.');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(daten, 'base64url')), d.final()]).toString('utf8');
}

const STAFF = 'test-rundgang@example.invalid';
const PORTAL_MAIL = 'qa-rundgang-portal@example.invalid';
async function aufraeumen() {
  const staff = (await sql`select id from ddl.staff_users where email = ${STAFF}`).map((r) => r.id);
  const nutzer = (await sql`select id from ddl.practice_users where email = ${PORTAL_MAIL}`).map((r) => r.id);
  const akteure = [...staff, ...nutzer];
  if (akteure.length) {
    await sql`delete from ddl.data_access_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.message_reads where reader_id in ${sql(akteure)}`;
  }
  if (nutzer.length) await sql`delete from ddl.practice_users where id in ${sql(nutzer)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
}

await aufraeumen();
const demoPraxen = await sql`select id, name, customer_no from ddl.practices where is_demo order by customer_no`;
const demoAuftraege = await sql`select o.id, o.order_no, o.status, o.practice_id, p.code from ddl.orders o join ddl.practices x on x.id = o.practice_id left join ddl.patients p on p.id = o.patient_id where x.is_demo order by o.order_no nulls last`;
const demoPatienten = await sql`select p.id, p.practice_id, p.first_name_enc, p.last_name_enc from ddl.patients p join ddl.practices x on x.id = p.practice_id where x.is_demo`;
const namen = demoPatienten.map((p) => ({ vor: entschluesseln(p.first_name_enc), nach: entschluesseln(p.last_name_enc), praxis: p.practice_id }));
pruefen(demoPraxen.length === 5 && demoAuftraege.length === 40 && demoPatienten.length === 30, `Demo-Daten vorhanden (${demoPraxen.length} Ordinationen, ${demoAuftraege.length} Aufträge, ${demoPatienten.length} Patienten)`);
const statusVielfalt = new Set(demoAuftraege.map((o) => o.status));
pruefen(statusVielfalt.size === 14, `Aufträge in allen 14 Status (${[...statusVielfalt].join(', ')})`);

const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async (breite = 1440) => {
  const ctx = await browser.newContext({ viewport: { width: breite, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(`${s.url()}: ${String(e)}`));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(`${s.url()}: ${m.text()}`));
  return s;
};
const kaputt = [];
/** öffnet eine Seite und merkt sich alles, was nicht stimmt */
async function besuchen(s, url) {
  const r = await s.goto(url, { waitUntil: 'domcontentloaded' });
  const status = r?.status() ?? 0;
  const text = await s.locator('body').textContent();
  if (status !== 200 || /Application error|Unhandled Runtime Error|Internal Server Error/.test(text)) kaputt.push(`${url} → ${status}`);
  // صفحهٔ ورود به‌جای صفحهٔ خواسته‌شده یعنی نشست از دست رفته؛ آن هم خطاست
  if (new URL(s.url()).pathname.startsWith('/anmelden')) kaputt.push(`${url} → Anmeldung`);
  return text;
}
// فقط نام خانوادگی: چند نام کوچک (Anna، Paul، Lukas، Clara) مال Behandlerها هم هست
const namenIn = (text) => namen.filter((n) => new RegExp(`(^|[^\\p{L}])${n.nach}([^\\p{L}]|$)`, 'u').test(text));

try {
  // ── Inhaber ──
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${STAFF}, 'Test Rundgang', 'inhaber') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-rundgang-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-rundgang-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => x.href.startsWith(`${CRM}/`) && !x.pathname.startsWith('/einladung'));

  // Übersicht mit Zahlen aus den Demo-Daten
  await besuchen(s, `${CRM}/`);
  const zahl = async (name) => {
    const l = s.getByRole('region', { name: 'Auf einen Blick' }).getByRole('link', { name: new RegExp(name) });
    return (await l.count()) ? Number((await l.locator('span').first().textContent()).trim()) : -1;
  };
  const kacheln = {
    'Neu eingegangen': await zahl('Neu eingegangen'),
    'Termin überfällig': await zahl('Termin überfällig'),
    'Heute fällig': await zahl('Heute fällig'),
    'Offene Reklamationen': await zahl('Offene Reklamationen'),
    'Warten auf Freigabe': await zahl('Warten auf Freigabe'),
    'Rückfrage offen': await zahl('Rückfrage offen'),
    'Express & Same-Day offen': await zahl('Express & Same-Day offen'),
    'Offene Abholungen': await zahl('Offene Abholungen'),
  };
  pruefen(Object.values(kacheln).every((n) => n >= 1), `Übersicht zeigt die Demo-Lage (${Object.entries(kacheln).map(([k, v]) => `${k} ${v}`).join(', ')})`);

  // alle internen Seiten
  const seiten = [
    '/', '/auftraege', '/auftraege?status=eingereicht', '/auftraege?status=faellig', '/auftraege?sortierung=termin', '/auftraege?ansicht=patienten',
    '/kalender', '/kalender?ansicht=monat', '/touren', '/reklamationen', '/reklamationen?status=alle',
    '/materialien', '/ordinationen', '/preise', '/benutzer', '/auftraege/neu',
    ...demoPraxen.map((p) => `/ordinationen/${p.id}`),
    ...['behandler', 'konto', 'zugaenge', 'vereinbarung', 'benachrichtigungen'].map((t) => `/ordinationen/${demoPraxen[0].id}?tab=${t}`),
  ];
  for (const pfad of seiten) {
    const text = await besuchen(s, `${CRM}${pfad}`);
    const gefunden = namenIn(text);
    if (gefunden.length && !pfad.startsWith('/auftraege/neu')) kaputt.push(`${pfad}: Patientenname sichtbar (${gefunden[0].nach})`);
  }
  pruefen(!kaputt.length, `${seiten.length} interne Seiten öffnen fehlerfrei, ohne Patientennamen${kaputt.length ? `: ${kaputt.slice(0, 4).join(' | ')}` : ''}`);

  // توضیح صفحه پشت علامت «i» کنار تیتر (۲۴ اکتبر ۲۰۲۶): پنهان، با موس باز و بسته، با کلیک ثابت، Escape و کلیک بیرون می‌بندد
  {
    await s.goto(`${CRM}/preise`);
    const info = s.getByRole('button', { name: 'Erläuterung zu dieser Seite' });
    const text = s.getByText('Ein leeres Feld heißt »Preis auf Anfrage«', { exact: false });
    const zu1 = !(await text.isVisible());
    await info.hover();
    const hover = await text.isVisible();
    await s.mouse.move(1200, 700);
    await s.waitForTimeout(300);
    const weg = !(await text.isVisible());
    await info.click();
    await s.mouse.move(1200, 700);
    await s.waitForTimeout(300);
    const fest = await text.isVisible();
    if (BILDER) await s.screenshot({ path: path.join(BILDER, 'info-desktop.png') });
    await s.keyboard.press('Escape');
    const esc = !(await text.isVisible());
    await info.click();
    await s.locator('p.eyebrow').first().click();
    const aussen = !(await text.isVisible());
    pruefen(zu1 && hover && weg && fest && esc && aussen, `»i« neben dem Titel: verborgen ${zu1}, Maus darauf ${hover}, Maus weg ${weg}, Klick hält ${fest}, Escape ${esc}, Klick daneben ${aussen}`);
    const ohne = [];
    for (const pfad of ['/auftraege', '/kalender', '/materialien', '/touren', '/reklamationen', '/ordinationen', '/benutzer', '/abrechnung', '/einstellungen']) {
      await s.goto(`${CRM}${pfad}`);
      if ((await s.getByRole('button', { name: 'Erläuterung zu dieser Seite' }).count()) !== 1) ohne.push(pfad);
    }
    pruefen(!ohne.length, `»i« auf allen Hauptseiten${ohne.length ? ` (fehlt: ${ohne.join(', ')})` : ''}`);
  }

  // jede Auftragsseite mit allen Tabs
  const vorher = kaputt.length;
  let seitenAuftraege = 0;
  for (const o of demoAuftraege.filter((x) => x.order_no)) {
    for (const tab of ['', '?tab=kommunikation', '?tab=dateien', '?tab=details']) {
      const text = await besuchen(s, `${CRM}/auftraege/${o.id}${tab}`);
      seitenAuftraege++;
      if (!text.includes(o.order_no)) kaputt.push(`${o.order_no}${tab}: Auftragsnummer fehlt`);
      if (namenIn(text).length) kaputt.push(`${o.order_no}${tab}: Patientenname ohne »Name anzeigen«`);
    }
  }
  pruefen(kaputt.length === vorher, `Labor: ${seitenAuftraege} Auftragsseiten (alle Status, alle Tabs) öffnen fehlerfrei, Name verborgen${kaputt.length > vorher ? `: ${kaputt.slice(vorher, vorher + 4).join(' | ')}` : ''}`);

  // Laufzettel eines Demo-Auftrags in Produktion
  const inProd = demoAuftraege.find((o) => o.status === 'in_produktion');
  const lz = await s.request.get(`${CRM}/api/auftraege/${inProd.id}/laufzettel`);
  pruefen(lz.status() === 200 && (await lz.body()).subarray(0, 5).toString() === '%PDF-', 'Laufzettel eines Demo-Auftrags');

  // ── Portal: Ordination mit Entwurf, Rückfrage, Freigabe und Reklamation ──
  const praxis = demoPraxen.find((p) => p.customer_no === 'K-9001');
  const [pu] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxis.id}, ${PORTAL_MAIL}, 'Qa Rundgang', 'praxis_admin', now()) returning id`;
  const ptoken = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(ptoken)}, 'einladung', 'practice', ${pu.id}, now() + interval '1 hour')`;
  const p = await neueSeite();
  await p.goto(`${PORTAL}/einladung/${ptoken}`);
  await p.getByLabel('Neues Passwort').fill('test-passwort-rundgang-2');
  await p.getByLabel('Passwort wiederholen').fill('test-passwort-rundgang-2');
  await p.getByRole('button', { name: 'Zugang einrichten' }).click();
  await p.waitForURL(`${PORTAL}/`);
  const eigene = demoAuftraege.filter((o) => o.practice_id === praxis.id);
  const vorPortal = kaputt.length;
  const start = await besuchen(p, `${PORTAL}/`);
  pruefen(/Ihre Aktion erforderlich \(\d+\)/.test(start), 'Portal: »Ihre Aktion erforderlich« bei Demo-Aufträgen');
  for (const pfad of ['/?ansicht=patienten', '/abholung', '/einstellungen', '/auftraege/neu']) await besuchen(p, `${PORTAL}${pfad}`);
  for (const o of eigene) {
    if (!o.order_no) {
      await besuchen(p, `${PORTAL}/auftraege/neu?entwurf=${o.id}`);
      continue;
    }
    for (const tab of ['', '?tab=kommunikation', '?tab=dateien', '?tab=details']) {
      const text = await besuchen(p, `${PORTAL}/auftraege/${o.id}${tab}`);
      if (text.includes('Intern: Same-Day')) kaputt.push(`${o.order_no}: interne Notiz im Portal`);
    }
  }
  for (const pat of demoPatienten.filter((x) => x.practice_id === praxis.id)) await besuchen(p, `${PORTAL}/patienten/${pat.id}`);
  pruefen(kaputt.length === vorPortal, `Portal: Übersicht, Patienten, Abholung, Einstellungen, ${eigene.length} Aufträge (mit Entwurf) fehlerfrei, ohne interne Notiz${kaputt.length > vorPortal ? `: ${kaputt.slice(vorPortal, vorPortal + 4).join(' | ')}` : ''}`);
  const fremdeNamen = namen.filter((n) => n.praxis !== praxis.id);
  const liste = await besuchen(p, `${PORTAL}/?ansicht=patienten`);
  pruefen(fremdeNamen.every((n) => !liste.includes(n.nach)) && namen.filter((n) => n.praxis === praxis.id).every((n) => liste.includes(n.nach)), 'Portal: eigene Patienten mit Namen, keine fremden');

  // ── Handy: volle Seiten ohne waagrechtes Scrollen ──
  const zuBreit = [];
  for (const [seite, basis, pfade] of [
    [s, CRM, ['/', '/auftraege', '/reklamationen', '/touren', '/kalender', `/auftraege/${inProd.id}`]],
    [p, PORTAL, ['/', '/einstellungen', `/auftraege/${eigene.find((o) => o.order_no).id}`]],
  ]) {
    await seite.setViewportSize({ width: 375, height: 812 });
    for (const pfad of pfade) {
      await seite.goto(`${basis}${pfad}`);
      const w = await seite.evaluate(() => document.documentElement.scrollWidth);
      if (w > 376) zuBreit.push(`${pfad}: ${w}px`);
    }
  }
  await s.goto(`${CRM}/preise`);
  await s.getByRole('button', { name: 'Erläuterung zu dieser Seite' }).click();
  const wInfo = await s.evaluate(() => document.documentElement.scrollWidth);
  if (wInfo > 376) zuBreit.push(`/preise mit offenem »i«: ${wInfo}px`);
  if (BILDER) await s.screenshot({ path: path.join(BILDER, 'info-handy.png') });
  pruefen(!zuBreit.length, `375 px mit vielen Daten: kein waagrechtes Scrollen${zuBreit.length ? ` (${zuBreit.join(', ')})` : ''}`);
  pruefen(!konsole.length, `keine Fehler in der Browser-Konsole${konsole.length ? `: ${konsole.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('✗ Abbruch:', e);
  fehler++;
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlle Prüfungen bestanden.');
process.exit(fehler ? 1 : 0);
