// آزمون امنیتی (قدم ۱۲؛ Spec فاز ۱، «الزامات کیفی و امنیت»)، روی دادهٔ نمایشی:
// - جدایی Ordinationها: Ordination B هر صفحه و هر فایل/سند/طرح/Laufzettel/Entwurf از Ordination A را امتحان می‌کند ← هیچ‌کدام ۲۰۰ نیست
// - بدون نشست: همهٔ مسیرهای api ← ۴۰۱، صفحه‌ها ← ورود؛ درخواست تغییر از سایت دیگر ← ۴۰۳
// - نشست پورتال به‌جای نشست داخلی (کوکی دستکاری‌شده) ← رد
// - نقش‌ها: Fahrer، Nur lesen، Vertrieb و Techniker فقط آنچه اجازه دارند
// - «weiter» بعد از ورود به سایت دیگری نمی‌برد (حتی با Tab و خط تازه)
// - متن مخرب در پیام و نام بیمار فقط متن است؛ شناسه‌های دستکاری‌شده ← ۴۰۴
// اجرا: pnpm qa qa-sicherheit  (محیط جدای آزمون، `scripts/qa.mjs`)
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

const PORTAL_A = 'qa-sicherheit-a@example.invalid';
const PORTAL_B = 'qa-sicherheit-b@example.invalid';
const PASSWORT = 'test-passwort-sicherheit-1';
const ROLLEN = ['techniker', 'fahrer', 'vertrieb', 'nur_lesen', 'buero'];
const STAFF = ROLLEN.map((r) => `test-sicherheit-${r}@example.invalid`);
const XSS = '<img src=x onerror="window.__xss=1">';

async function aufraeumen() {
  const nutzer = (await sql`select id from ddl.practice_users where email in ${sql([PORTAL_A, PORTAL_B])}`).map((r) => r.id);
  const staff = (await sql`select id from ddl.staff_users where email in ${sql(STAFF)}`).map((r) => r.id);
  const akteure = [...nutzer, ...staff];
  if (akteure.length) {
    await sql`delete from ddl.order_messages where author_id in ${sql(akteure)}`;
    await sql`delete from ddl.data_access_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.audit_log where actor_id in ${sql(akteure)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(akteure)}`;
    await sql`delete from ddl.message_reads where reader_id in ${sql(akteure)}`;
  }
  await sql`delete from ddl.jobs where type = 'benachrichtigung' and payload->>'ereignis' = 'neue_nachricht' and created_at > now() - interval '1 hour' and payload->>'orderId' in (select o.id::text from ddl.orders o join ddl.practices p on p.id = o.practice_id where p.is_demo)`;
  if (nutzer.length) await sql`delete from ddl.practice_users where id in ${sql(nutzer)}`;
  if (staff.length) await sql`delete from ddl.staff_users where id in ${sql(staff)}`;
  await sql`delete from ddl.rate_limits where key like '%example.invalid%' or key like 'portal-anmeldung-ip:%' or key like 'einrichtung:%'`;
}

await aufraeumen();
const [A] = await sql`select id from ddl.practices where customer_no = 'K-9001' and is_demo`;
const [B] = await sql`select id from ddl.practices where customer_no = 'K-9002' and is_demo`;
const auftraegeA = await sql`select id, order_no, status, work_type_key, updated_at from ddl.orders where practice_id = ${A.id}`;
const patientenA = await sql`select id from ddl.patients where practice_id = ${A.id}`;
const dateienA = await sql`select f.id, f.kind, f.order_id from ddl.order_files f join ddl.orders o on o.id = f.order_id where o.practice_id = ${A.id}`;
const entwurfA = auftraegeA.find((o) => o.status === 'entwurf');
const laufendA = auftraegeA.find((o) => o.status === 'in_produktion') ?? auftraegeA.find((o) => o.order_no);

const browser = await chromium.launch({ channel: 'chrome' });
const neueSeite = async () => (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
async function portalZugang(email, praxisId) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, 'Qa Sicherheit', 'praxis_admin', now()) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill(PASSWORT);
  await s.getByLabel('Passwort wiederholen').fill(PASSWORT);
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}
async function mitarbeiter(email, rolle) {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${email}, ${`Test ${rolle}`}, ${rolle}) returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill(PASSWORT);
  await s.getByLabel('Passwort wiederholen').fill(PASSWORT);
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => x.href.startsWith(`${CRM}/`) && !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

try {
  const { s: pA } = await portalZugang(PORTAL_A, A.id);
  const { s: pB } = await portalZugang(PORTAL_B, B.id);

  // ── 1. Ordination B gegen alles von A ──
  const ziele = [
    ...auftraegeA.flatMap((o) => (o.order_no ? ['', '?tab=kommunikation', '?tab=dateien', '?tab=details'].map((t) => `/auftraege/${o.id}${t}`) : [`/auftraege/neu?entwurf=${o.id}`])),
    ...patientenA.map((p) => `/patienten/${p.id}`),
    ...dateienA.flatMap((f) => [`/api/dateien/${f.id}`, `/api/dateien/${f.id}?ansicht=1`]),
    ...auftraegeA.filter((o) => o.order_no).flatMap((o) => [`/api/auftraege/${o.id}/design?version=1`, `/api/auftraege/${o.id}/laufzettel`]),
  ];
  const durch = [];
  for (const z of ziele) {
    const r = await pB.request.get(`${PORTAL}${z}`, { maxRedirects: 0 });
    const text = r.status() === 200 ? await r.text() : '';
    // لینک Entwurf یک Ordination دیگر حداکثر یک فرم خالی باز می‌کند
    const leererEntwurf = z.startsWith('/auftraege/neu') && !auftraegeA.some((o) => o.order_no && text.includes(o.order_no)) && !text.includes(entwurfA?.id ?? '§');
    if (r.status() === 200 && !leererEntwurf) durch.push(`${z} → 200`);
  }
  pruefen(!durch.length, `Ordination B: ${ziele.length} Seiten, Dateien, Designs und Laufzettel von A gesperrt${durch.length ? ` (${durch.slice(0, 4).join(', ')})` : ''}`);
  const entwurfPost = entwurfA
    ? (await pB.request.post(`${PORTAL}/api/auftraege/${entwurfA.id}/entwurf`, { headers: { origin: PORTAL }, data: { behandlung: 'krone' } })).status()
    : 404;
  const uploadPost = (await pB.request.post(`${PORTAL}/api/auftraege/${laufendA.id}/dateien?platz=nachricht`, { headers: { origin: PORTAL }, multipart: { datei: { name: 'x.stl', mimeType: 'model/stl', buffer: Buffer.from('solid x') } } })).status();
  const [entwurfDanach] = entwurfA ? await sql`select work_type_key, updated_at from ddl.orders where id = ${entwurfA.id}` : [null];
  // 409 = «Entwurf nicht gefunden» (AppError)؛ مهم این است که چیزی ذخیره نشده باشد
  pruefen(
    [403, 404, 409].includes(entwurfPost) && [403, 404].includes(uploadPost) && (!entwurfA || (entwurfDanach.work_type_key === entwurfA.work_type_key && +entwurfDanach.updated_at === +entwurfA.updated_at)),
    `Ordination B: Entwurf und Upload bei A abgelehnt, nichts geändert (${entwurfPost}/${uploadPost})`,
  );
  const listeB = await (await pB.request.get(`${PORTAL}/`)).text();
  pruefen(!auftraegeA.some((o) => o.order_no && listeB.includes(o.order_no)), 'Liste von B enthält keinen Auftrag von A');

  // ── 2. Ohne Anmeldung ──
  const apis = [`/api/dateien/${dateienA[0].id}`, `/api/auftraege/${laufendA.id}/design?version=1`, `/api/auftraege/${laufendA.id}/laufzettel`, `/api/dokumente/${dateienA[0].id}`];
  const ohne = [];
  for (const host of [CRM, PORTAL]) for (const z of apis) ohne.push((await fetch(`${host}${z}`, { redirect: 'manual' })).status);
  pruefen(ohne.every((x) => x === 401), `ohne Anmeldung: alle api-Abrufe 401 (${[...new Set(ohne)].join('/')})`);
  const seiten = [];
  for (const [host, pfad] of [[CRM, '/auftraege'], [CRM, `/auftraege/${laufendA.id}`], [CRM, '/benutzer'], [PORTAL, '/'], [PORTAL, `/auftraege/${laufendA.id}`], [PORTAL, '/einstellungen']]) {
    const r = await fetch(`${host}${pfad}`, { redirect: 'manual' });
    seiten.push(r.status === 307 && (r.headers.get('location') ?? '').includes('/anmelden'));
  }
  pruefen(seiten.every(Boolean), 'ohne Anmeldung: Seiten leiten zur Anmeldung');
  const fremdUrsprung = [
    (await pA.request.post(`${PORTAL}/api/auftraege/${laufendA.id}/dateien?platz=nachricht`, { headers: { origin: 'https://evil.example' }, multipart: { datei: { name: 'x.stl', mimeType: 'model/stl', buffer: Buffer.from('solid x') } } })).status(),
    (await pA.request.post(`${PORTAL}/api/auftraege/${entwurfA?.id ?? laufendA.id}/entwurf`, { headers: { origin: 'https://evil.example' }, data: {} })).status(),
  ];
  pruefen(fremdUrsprung.every((x) => x === 403), `Änderung von fremder Seite: 403 (${fremdUrsprung.join('/')})`);

  // ── 3. Portal-Sitzung als interne Sitzung ausgegeben ──
  const portalToken = (await pA.context().cookies()).find((c) => c.name === 'ddl_portal')?.value;
  const crmHost = new URL(CRM).hostname;
  const gefaelscht = await neueSeite();
  await gefaelscht.context().addCookies([{ name: 'ddl_intern', value: portalToken ?? 'x', domain: crmHost, path: '/' }]);
  await gefaelscht.goto(`${CRM}/auftraege`);
  const api = await gefaelscht.request.get(`${CRM}/api/auftraege/${laufendA.id}/laufzettel`);
  pruefen(Boolean(portalToken) && gefaelscht.url().includes('/anmelden') && api.status() === 401, 'Portal-Token als interner Cookie: abgelehnt (Anmeldung, 401)');

  // ── 4. Rollen ──
  const rollen = {};
  for (const [i, r] of ROLLEN.entries()) rollen[r] = (await mitarbeiter(STAFF[i], r)).s;
  // «Vertrieb» مراحل را در صفحهٔ سفارش فقط می‌بیند (auftraege.sehen)، بدون «Erledigt» و «Schritt korrigieren»
  const gesperrt = async (s, pfad) => {
    await s.goto(`${CRM}${pfad}`);
    const t = await s.locator('main').textContent();
    return /Kein Zugriff|nicht freigegeben/.test(t) || s.url().endsWith('/meine-tour');
  };
  const matrix = [
    ['techniker', '/benutzer', true],
    ['techniker', '/preise', true],
    ['fahrer', '/auftraege', true],
    ['fahrer', '/reklamationen', true],
    ['fahrer', '/ordinationen', true],
    ['vertrieb', '/benutzer', true],
    ['nur_lesen', '/benutzer', true],
    ['nur_lesen', '/auftraege', false],
    ['buero', '/benutzer', true],
  ];
  const falsch = [];
  for (const [r, pfad, soll] of matrix) if ((await gesperrt(rollen[r], pfad)) !== soll) falsch.push(`${r} ${pfad}`);
  pruefen(!falsch.length, `Rollen: Zugriff wie vorgesehen (${matrix.length} Fälle)${falsch.length ? ` — falsch: ${falsch.join(', ')}` : ''}`);
  await rollen.vertrieb.goto(`${CRM}/auftraege/${laufendA.id}`);
  const vertriebSieht = await rollen.vertrieb.getByRole('region', { name: 'Produktion' }).count();
  const vertriebDarf = (await rollen.vertrieb.getByText('Schritt korrigieren …').count()) + (await rollen.vertrieb.getByRole('form', { name: 'Schritt erledigt' }).count());
  pruefen(vertriebSieht === 1 && vertriebDarf === 0, `»Vertrieb«: Schritte im Auftrag nur ansehen (nichts zu ändern: ${vertriebDarf === 0})`);
  // das Kanban »Produktion« gibt es nicht mehr (26.10.2026)
  const altesBrett = await rollen.techniker.goto(`${CRM}/produktion`);
  pruefen(altesBrett?.status() === 404, `/produktion gibt es nicht mehr (${altesBrett?.status()})`);
  const fahrerApi = (await rollen.fahrer.request.get(`${CRM}/api/auftraege/${laufendA.id}/laufzettel`)).status();
  pruefen([401, 403].includes(fahrerApi), `Fahrer: kein Laufzettel (${fahrerApi})`);
  await rollen.nur_lesen.goto(`${CRM}/auftraege/${laufendA.id}`);
  const nurLesen = await rollen.nur_lesen.locator('main').textContent();
  pruefen(!/Rückfrage stellen|Design-Dateien hochladen|Reklamation erfassen|Name anzeigen/.test(nurLesen) && (await rollen.nur_lesen.getByRole('button', { name: 'Senden' }).count()) === 0, '»Nur lesen«: Auftrag ohne Knöpfe zum Ändern, ohne »Name anzeigen«');

  // ── 5. »weiter« nach der Anmeldung ──
  const boese = ['//evil.example/x', '/\t/evil.example/x', 'https://evil.example/x', '/\\evil.example'];
  const ziel = [];
  for (const w of boese) {
    const s = await neueSeite();
    await s.goto(`${PORTAL}/anmelden?weiter=${encodeURIComponent(w)}`);
    await s.getByLabel('E-Mail').fill(PORTAL_A);
    await s.getByLabel('Passwort').fill(PASSWORT);
    await s.getByRole('button', { name: 'Anmelden' }).click();
    await s.waitForURL((u) => !u.pathname.startsWith('/anmelden'), { timeout: 15000 }).catch(() => null);
    ziel.push(new URL(s.url()).host);
    await s.context().close();
  }
  pruefen(ziel.every((h) => h === new URL(PORTAL).host), `»weiter« führt nie zu einer fremden Seite (${[...new Set(ziel)].join(', ')})`);

  // ── 6. Schadcode bleibt Text; kaputte IDs ──
  await pA.goto(`${PORTAL}/auftraege/${laufendA.id}?tab=kommunikation`);
  await pA.getByLabel('Nachricht', { exact: true }).fill(`Test ${XSS}`);
  await pA.getByRole('button', { name: 'Senden' }).click();
  // صبر تا پیام واقعاً ذخیره شود (متن در خود فیلد هم پیدا می‌شود، پس آن نشانه نیست)
  for (let i = 0; i < 30; i++) {
    const [r] = await sql`select count(*)::int as n from ddl.order_messages where order_id = ${laufendA.id} and body like ${'%onerror%'}`;
    if (r.n) break;
    await new Promise((x) => setTimeout(x, 300));
  }
  const t = rollen.techniker;
  await t.goto(`${CRM}/auftraege/${laufendA.id}?tab=kommunikation`);
  const xssLabor = await t.evaluate(() => window.__xss);
  const xssPortal = await pA.evaluate(() => window.__xss);
  const xssText = await t.getByText(XSS).count();
  const [xssDb] = await sql`select count(*)::int as n from ddl.order_messages where order_id = ${laufendA.id} and body like ${'%onerror%'}`;
  pruefen(xssText >= 1 && xssLabor === undefined && xssPortal === undefined, `HTML in einer Nachricht wird als Text gezeigt, nicht ausgeführt (Portal und Labor; Text ${xssText}×, gespeichert ${xssDb.n}×, ausgeführt ${xssLabor ?? xssPortal ?? 'nein'})`);
  const kaputteIds = [];
  for (const z of ['/api/dateien/..%2F..%2F.env', '/api/dateien/nicht-eine-id', `/api/auftraege/${laufendA.id}'%20or%201=1/laufzettel`, "/auftraege/1' or '1'='1", '/patienten/..%2F..%2Fetc']) {
    kaputteIds.push((await pA.request.get(`${PORTAL}${z}`, { maxRedirects: 0 })).status());
  }
  pruefen(kaputteIds.every((x) => x === 404 || x === 400), `manipulierte Adressen: nicht gefunden (${kaputteIds.join('/')})`);
  const suche = await pA.request.get(`${PORTAL}/?suche=${encodeURIComponent("' OR '1'='1")}`);
  pruefen(suche.status() === 200 && !/Application error|Internal Server Error/.test(await suche.text()), 'Suche mit SQL-Zeichen: normale Antwort, kein Fehler');
  const datei = await pA.request.get(`${PORTAL}/api/dateien/${dateienA.find((f) => f.kind === 'scan').id}`);
  pruefen(datei.status() === 200 && datei.headers()['x-content-type-options'] === 'nosniff' && /no-store/.test(datei.headers()['cache-control'] ?? '') && /^attachment;/.test(datei.headers()['content-disposition'] ?? ''), 'Datei-Download: als Anhang, nosniff, nicht im Cache');
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
