// آزمون «Auftrag löschen» در Chrome (خواستهٔ کاربر، ۲۶ اکتبر ۲۰۲۶): سفارشِ اشتباهی که رویش کاری نشده، فقط به دست Inhaber
// کامل پاک می‌شود (فایل روی دیسک هم)؛ سفارشی که به تولید رسیده یا Büro: بدون دکمه، و سرور هم رد می‌کند.
// دادهٔ آزمایشی: سفارش‌های «QA-LOE-…»، کاربران @example.invalid؛ بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-auftrag-loeschen  (محیط جدای آزمون، `scripts/qa.mjs`)
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { CRM } from './qa-umgebung.mjs';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
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
const gibtEs = (p) => access(p).then(() => true, () => false);

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

const INHABER = 'test-loeschen@example.invalid';
const BUERO = 'test-loeschen-buero@example.invalid';

async function aufraeumen() {
  const alt = await sql`select id from ddl.orders where order_no like 'QA-LOE-%'`;
  if (alt.length) {
    const dateien = await sql`select storage_key from ddl.order_files where order_id in ${sql(alt.map((o) => o.id))}`;
    for (const d of dateien) await rm(path.join(SPEICHER, d.storage_key), { force: true });
    await sql`delete from ddl.orders where id in ${sql(alt.map((o) => o.id))}`;
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
  await s.getByLabel('Neues Passwort').fill('test-passwort-loeschen-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-loeschen-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL((x) => !x.pathname.startsWith('/einladung'));
  return { s, id: u.id };
}

/** Auftrag nach dem Muster eines gesendeten Demo-Auftrags, mit Verlauf, einer Datei auf der Platte und einer Nachricht */
async function auftrag(nr, status, verlauf, von) {
  const [o] = await sql`
    insert into ddl.orders (order_no, practice_id, dentist_id, patient_id, work_type_key, delivery_kind, config, tempo, price_snapshot, status, source, submitted_at, created_by_kind, created_by_id)
    select ${nr}, practice_id, dentist_id, patient_id, work_type_key, delivery_kind, config, tempo, price_snapshot, ${status}, 'labor', now(), 'staff', ${von}
    from ddl.orders where status <> 'entwurf' and order_no not like 'QA-LOE-%' order by created_at limit 1
    returning id`;
  for (const st of verlauf) await sql`insert into ddl.order_status_history (order_id, status, by_kind, by_id) values (${o.id}, ${st}, 'staff', ${von})`;
  const uuid = randomUUID();
  const key = `${uuid.slice(0, 2)}/${uuid}`;
  const inhalt = Buffer.from(`QA ${nr}`);
  await mkdir(path.dirname(path.join(SPEICHER, key)), { recursive: true });
  await writeFile(path.join(SPEICHER, key), inhalt);
  await sql`insert into ddl.order_files (order_id, origin, kind, slot, storage_key, filename_enc, mime, size, sha256, uploaded_by_kind, uploaded_by_id)
    values (${o.id}, 'labor', 'dokument', 'sonstiges', ${key}, ${verschluesseln('qa.txt')}, 'text/plain', ${inhalt.length}, ${sha(inhalt)}, 'staff', ${von})`;
  await sql`insert into ddl.order_messages (order_id, author_kind, author_id, kind, body) values (${o.id}, 'staff', ${von}, 'nachricht', 'QA Nachricht')`;
  return { id: o.id, key };
}

try {
  const { s, id: inhaberId } = await anmelden(INHABER, 'Test Löschen', 'inhaber');
  const irrtum = await auftrag('QA-LOE-1', 'eingereicht', ['eingereicht'], inhaberId);
  const storniert = await auftrag('QA-LOE-2', 'storniert', ['eingereicht', 'in_planung', 'storniert'], inhaberId);
  const produziert = await auftrag('QA-LOE-3', 'storniert', ['eingereicht', 'in_planung', 'in_produktion', 'storniert'], inhaberId);

  // ════ Büro: kein Knopf ════
  const { s: b } = await anmelden(BUERO, 'Test Löschen Büro', 'buero');
  await b.goto(`${CRM}/auftraege/${irrtum.id}`);
  pruefen(await sichtbar(b.getByText('Auftrag QA-LOE-1')), 'Büro: Auftrag sichtbar');
  pruefen(!(await b.getByRole('button', { name: 'Auftrag löschen …' }).count()), 'Büro: kein »Auftrag löschen«');

  // ════ produziert: kein Knopf ════
  await s.goto(`${CRM}/auftraege/${produziert.id}`);
  pruefen(await sichtbar(s.getByText('Auftrag QA-LOE-3')), 'Inhaber: stornierter Auftrag nach Produktion sichtbar');
  pruefen(!(await s.getByRole('button', { name: 'Auftrag löschen …' }).count()), 'nach Produktion: kein »Auftrag löschen«');

  // ════ irrtümlich: löschen ════
  await s.goto(`${CRM}/auftraege/${irrtum.id}`);
  await s.getByRole('button', { name: 'Auftrag löschen …' }).click();
  const bereich = s.getByRole('region', { name: 'Auftrag löschen' });
  pruefen(await sichtbar(bereich.getByText(/Auftrag QA-LOE-1 mit allen Dateien und Nachrichten endgültig löschen\?/)), 'Warnung mit Auftragsnummer');
  await bereich.getByRole('button', { name: 'Abbrechen' }).click();
  pruefen((await sql`select count(*)::int as n from ddl.orders where id = ${irrtum.id}`)[0].n === 1, 'Abbrechen: nichts gelöscht');
  await s.getByRole('button', { name: 'Auftrag löschen …' }).click();
  await bereich.getByRole('button', { name: 'Endgültig löschen' }).click();
  await s.waitForURL(`${CRM}/auftraege`, { timeout: 10000 }).catch(() => {});
  pruefen(new URL(s.url()).pathname === '/auftraege', 'danach zurück zur Liste');
  const [weg] = await sql`select count(*)::int as n from ddl.orders where id = ${irrtum.id}`;
  const [rest] = await sql`select (select count(*) from ddl.order_files where order_id = ${irrtum.id})::int + (select count(*) from ddl.order_messages where order_id = ${irrtum.id})::int + (select count(*) from ddl.order_status_history where order_id = ${irrtum.id})::int as n`;
  pruefen(weg.n === 0 && rest.n === 0, 'Datenbank: Auftrag, Dateien, Nachrichten und Verlauf weg');
  pruefen(!(await gibtEs(path.join(SPEICHER, irrtum.key))), 'Datei auch auf der Platte gelöscht');
  const [protokoll] = await sql`select details from ddl.audit_log where action = 'auftrag_geloescht' and actor_id = ${inhaberId}`;
  pruefen(protokoll?.details?.auftrag === 'QA-LOE-1' && protokoll.details.dateien === 1, 'Protokoll: »Auftrag gelöscht« mit Nummer');
  pruefen(!(await s.getByText('QA-LOE-1').count()), 'Liste: Auftrag nicht mehr da');

  // ════ storniert vor der Produktion: auch löschbar ════
  await s.goto(`${CRM}/auftraege/${storniert.id}`);
  await s.getByRole('button', { name: 'Auftrag löschen …' }).click();
  await s.getByRole('region', { name: 'Auftrag löschen' }).getByRole('button', { name: 'Endgültig löschen' }).click();
  await s.waitForURL(`${CRM}/auftraege`, { timeout: 10000 }).catch(() => {});
  pruefen((await sql`select count(*)::int as n from ddl.orders where id = ${storniert.id}`)[0].n === 0, 'stornierter Auftrag (vor Produktion) gelöscht');

  // ════ der produzierte bleibt ════
  pruefen((await sql`select count(*)::int as n from ddl.orders where id = ${produziert.id}`)[0].n === 1 && (await gibtEs(path.join(SPEICHER, produziert.key))), 'Auftrag nach Produktion bleibt mit Datei');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
