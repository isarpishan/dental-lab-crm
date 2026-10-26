// آزمون قدم ۷ در Chrome: Design-Freigabe از دو طرف.
// لابراتوار (نقش Techniker): «Eingang / Datenprüfung erledigt»، Rückfrage، Liefertermin، آپلود طرح و «Zur Freigabe senden»؛ بعد از Freigabe مراحل تولید تا Geliefert.
// Ordination: 3D بدون دانلود، قفل دانلود در سرور، Änderung anfordern، Freigabe با نام و تیک (دو بار ← یک نتیجه)،
// ZIP، Feedback. سفارش «Nur Design» با Überarbeitung بعد از Freigabe. جدایی Ordinationها و ظاهر.
// دادهٔ آزمایشی مستقیم در دیتابیس («QA · …»، @example.invalid) و بعد کامل پاک می‌شود.
// اجرا: pnpm qa qa-freigabe  (محیط جدای آزمون، `scripts/qa.mjs`)
import { execFileSync } from 'node:child_process';
import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { belegeLoeschen, belegZaehlerZurueck, zaehlerStand } from './qa-belege.mjs';
import { CRM, PORTAL, vereinbarungAngenommen, vereinbarungenLoeschen } from './qa-umgebung.mjs';

const SPEICHER = path.resolve(process.env.STORAGE_DIR ?? './data/files');
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

/** binäres STL eines Quaders, mit Höhe als Unterscheidung */
function quader(h = 10) {
  const p = [[0,0,0],[10,0,0],[10,8,0],[0,8,0],[0,0,h],[10,0,h],[10,8,h],[0,8,h]];
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const b = Buffer.alloc(84 + f.length * 50);
  b.writeUInt32LE(f.length, 80);
  f.forEach((t, i) => t.forEach((k, j) => p[k].forEach((w, a) => b.writeFloatLE(w, 84 + i * 50 + 12 + j * 12 + a * 4))));
  return b;
}

const ordner = path.join(tmpdir(), 'ddl-qa-freigabe');
mkdirSync(ordner, { recursive: true });
const datei = (name, h) => {
  const p = path.join(ordner, name);
  writeFileSync(p, quader(h));
  return p;
};
const D = { krone: datei('Krone 16.stl', 9), modell: datei('Modell OK.stl', 4), krone2: datei('Krone 16 v2.stl', 8), modell2: datei('Modell OK v2.stl', 4), smile: datei('Smile Mockup.stl', 6), smile2: datei('Smile Mockup v2.stl', 5) };

const STAFF_MAIL = 'test-freigabe@example.invalid';
async function aufraeumen() {
  const praxen = (await sql`select id from ddl.practices where name like 'QA · Freigabe%'`).map((r) => r.id);
  const nutzer = praxen.length ? (await sql`select id from ddl.practice_users where practice_id in ${sql(praxen)}`).map((r) => r.id) : [];
  const staff = (await sql`select id from ddl.staff_users where email = ${STAFF_MAIL}`).map((r) => r.id);
  if (praxen.length) {
    const auftraege = (await sql`select id from ddl.orders where practice_id in ${sql(praxen)}`).map((r) => r.id);
    if (auftraege.length) {
      for (const f of await sql`select storage_key from ddl.order_files where order_id in ${sql(auftraege)}`) await rm(path.join(SPEICHER, f.storage_key), { force: true });
      await belegeLoeschen(sql, auftraege);
      await sql`delete from ddl.orders where id in ${sql(auftraege)}`;
    }
    await sql`delete from ddl.patients where practice_id in ${sql(praxen)}`;
  }
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

async function scan(orderId, slot, vonId) {
  const inhalt = quader(10);
  const id = randomUUID();
  const key = `${id.slice(0, 2)}/${id}`;
  mkdirSync(path.join(SPEICHER, id.slice(0, 2)), { recursive: true });
  writeFileSync(path.join(SPEICHER, key), inhalt);
  await sql`insert into ddl.order_files (order_id, origin, kind, slot, storage_key, filename_enc, mime, size, sha256, uploaded_by_kind, uploaded_by_id, created_at)
    values (${orderId}, 'praxis', 'scan', ${slot}, ${key}, ${verschluesseln(`${slot}.stl`)}, 'model/stl', ${inhalt.length}, ${sha(inhalt)}, 'practice', ${vonId}, now() - interval '3 days')`;
}

await aufraeumen();
const zaehlerVorher = await zaehlerStand(sql);
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const neueSeite = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(String(e)));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebGL|GPU stall/.test(m.text()) && konsole.push(m.text()));
  return s;
};
async function portalZugang(name, email, praxisId) {
  const [u] = await sql`insert into ddl.practice_users (practice_id, email, name, role, invited_at) values (${praxisId}, ${email}, ${name}, 'praxis_admin', now()) returning id`;
  await vereinbarungAngenommen(sql, praxisId, u.id);
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'practice', ${u.id}, now() + interval '1 hour')`;
  const s = await neueSeite();
  await s.goto(`${PORTAL}/einladung/${token}`);
  await s.getByLabel('Neues Passwort').fill('test-passwort-freigabe-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-freigabe-1');
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${PORTAL}/`);
  return { s, id: u.id };
}
const status = async (id) => (await sql`select status from ddl.orders where id = ${id}`)[0].status;
const fertigHochgeladen = (s) => s.waitForFunction(() => !document.body.textContent.match(/\d+ %/), null, { timeout: 20000 });

try {
  const [A] = await sql`insert into ddl.practices (customer_no, name) values ('QA-FA', 'QA · Freigabe Ordination A') returning id`;
  const [B] = await sql`insert into ddl.practices (customer_no, name) values ('QA-FB', 'QA · Freigabe Ordination B') returning id`;
  const { s: p, id: nutzerA } = await portalZugang('Dr. Qa Freigabe', 'qa-freigabe-a@example.invalid', A.id);
  const [pat] = await sql`insert into ddl.patients (practice_id, code, first_name_enc, last_name_enc, created_by_kind, created_by_id)
    values (${A.id}, 'P-QAF2', ${verschluesseln('Frieda')}, ${verschluesseln('Freigabe')}, 'practice', ${nutzerA}) returning id`;
  const auftrag = async (nr, behandlung, lieferart, st, config) => {
    const [o] = await sql`insert into ddl.orders (order_no, practice_id, patient_id, work_type_key, delivery_kind, config, status, source, tempo, submitted_at, created_by_kind, created_by_id, price_snapshot)
      values (${nr}, ${A.id}, ${pat.id}, ${behandlung}, ${lieferart}, ${sql.json(config)}, ${st}, 'portal', 'standard', now() - interval '2 days', 'practice', ${nutzerA},
        ${sql.json({ lieferart, preisAb: null, einheit: 'Zahn', zuschlag: null, bearbeitungszeit: 'nach Prüfung' })}) returning id`;
    await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, 'eingereicht', now() - interval '2 days', 'practice')`;
    if (st === 'in_planung') await sql`insert into ddl.order_status_history (order_id, status, at, by_kind) values (${o.id}, 'in_planung', now() - interval '1 day', 'staff')`;
    for (const slot of ['ok', 'uk', 'biss']) await scan(o.id, slot, nutzerA);
    return o.id;
  };
  const bruecke = {
    zaehne: { 14: { art: 'bruecke_anker', spanne: 'b16-14' }, 15: { art: 'bruecke_glied', spanne: 'b16-14' }, 16: { art: 'bruecke_anker', spanne: 'b16-14' } },
    versorgung: 'definitiv',
    farbe: { system: 'vita_classical', farbe: 'A2' },
  };
  const f1 = await auftrag('QA-F-0001', 'bruecke', 'fertigung', 'eingereicht', bruecke);
  const f2 = await auftrag('QA-F-0002', 'smile_design', 'design', 'in_planung', { zaehne: { 11: { art: 'veneer' }, 21: { art: 'veneer' } }, aesthetik: { merkmale: ['Länge'] }, farbe: { system: 'folgt' } });

  // ── Labor: Techniker ──
  const [ich] = await sql`insert into ddl.staff_users (email, name, role) values (${STAFF_MAIL}, 'Test Technik', 'techniker') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${ich.id}, now() + interval '1 hour')`;
  const t = await neueSeite();
  await t.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await t.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await t.getByLabel('Neues Passwort').fill('test-passwort-freigabe-2');
  await t.getByLabel('Passwort wiederholen').fill('test-passwort-freigabe-2');
  await t.getByLabel('Code aus der App').fill(totp(geheimnis));
  await t.getByRole('button', { name: 'Zugang einrichten' }).click();
  await t.waitForURL(`${CRM}/`);

  await t.goto(`${CRM}/auftraege/${f1}`);
  const schritt = t.getByRole('region', { name: 'Produktion' });
  pruefen(await sichtbar(schritt.getByRole('button', { name: 'Eingang / Datenprüfung erledigt' })), 'Labor: »Produktion« mit »Eingang / Datenprüfung erledigt«');
  pruefen((await t.getByRole('button', { name: 'Name anzeigen' }).count()) === 0, 'Techniker ohne Recht auf Patientennamen: kein »Name anzeigen«');
  await schritt.getByRole('button', { name: 'Eingang / Datenprüfung erledigt' }).click();
  await t.getByRole('heading', { name: 'In Planung.' }).waitFor();
  pruefen((await status(f1)) === 'in_planung', 'Status »In Planung«');

  // Rückfrage
  await t.getByRole('button', { name: 'Rückfrage stellen' }).click();
  await t.getByLabel('Frage an die Ordination').fill('Ist der Biss in Schlussbiss gescannt?');
  await t.getByRole('button', { name: 'Bissregistrierung' }).click();
  await t.getByRole('button', { name: 'Rückfrage senden' }).click();
  await t.getByRole('heading', { name: 'Rückfrage.' }).waitFor();
  pruefen((await status(f1)) === 'rueckfrage', 'Labor: Rückfrage gestellt');
  await p.goto(`${PORTAL}/auftraege/${f1}`);
  pruefen(await sichtbar(p.getByText('Ist der Biss in Schlussbiss gescannt?')) && (await p.getByText(/Bitte nachreichen: Bissregistrierung/).isVisible()), 'Ordination sieht die Frage des Labors');
  await p.getByLabel('Antwort (optional)').fill('Ja, Schlussbiss.');
  await p.getByRole('button', { name: 'Daten senden' }).click();
  await p.getByRole('heading', { name: 'Wir arbeiten an Ihrem Design.' }).waitFor();
  pruefen((await status(f1)) === 'in_planung', 'Antwort: zurück zu »In Planung« (Stand vor der Rückfrage)');

  // Liefertermin
  const termin = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await t.goto(`${CRM}/auftraege/${f1}`);
  await t.getByRole('textbox', { name: 'Liefertermin' }).fill(termin);
  await t.getByRole('form', { name: 'Liefertermin' }).getByRole('button', { name: 'Speichern' }).click();
  await t.getByRole('form', { name: 'Liefertermin' }).getByRole('button', { name: 'Speichern' }).and(t.locator(':disabled')).waitFor();
  await p.goto(`${PORTAL}/`);
  pruefen(await sichtbar(p.getByRole('link', { name: new RegExp(`QA-F-0001.*Liefertermin ${termin.split('-').reverse().join('.')}`) })), 'Liefertermin erscheint in der Liste der Ordination');

  // Design Version 1
  await t.goto(`${CRM}/auftraege/${f1}`);
  await t.getByLabel('Design-Dateien hochladen').setInputFiles([D.krone, D.modell]);
  await fertigHochgeladen(t);
  await t.getByLabel('Notiz für die Ordination (optional)').fill('Kontaktpunkte leicht verstärkt.');
  await bild(t, '31-labor-design-hochladen');
  await t.getByRole('button', { name: 'Zur Freigabe senden' }).click();
  await t.getByRole('heading', { name: 'Design zur Freigabe.' }).waitFor();
  const [r1] = await sql`select status, revision from ddl.design_revisions where order_id = ${f1}`;
  pruefen((await status(f1)) === 'design_freigabe' && r1?.revision === 1 && r1.status === 'offen', 'Design Version 1 gesendet: »Design zur Freigabe«');

  // ── Ordination: prüfen ──
  await p.goto(`${PORTAL}/`);
  pruefen(await sichtbar(p.getByRole('link', { name: /Ihre Aktion erforderlich \(1\)/ })), 'Ordination: »Ihre Aktion erforderlich (1)«');
  await p.goto(`${PORTAL}/auftraege/${f1}`);
  const karte = p.getByRole('region', { name: 'Design prüfen' });
  pruefen(await sichtbar(karte.getByRole('heading', { name: 'Bitte prüfen Sie das Design (Version 1).' })), 'Karte »Bitte prüfen Sie das Design (Version 1).«');
  pruefen(await karte.getByText('Kontaktpunkte leicht verstärkt.').isVisible(), 'Notiz des Labors sichtbar');
  pruefen((await karte.getByRole('link', { name: /herunterladen$/ }).count()) === 0, 'vor der Freigabe: kein Download-Link');
  await bild(p, '32-portal-pruefen');
  const designDatei = (await sql`select id from ddl.order_files where order_id = ${f1} and kind = 'design' and design_revision = 1 order by created_at limit 1`)[0].id;
  const gesperrt = [
    (await p.request.get(`${PORTAL}/api/dateien/${designDatei}`)).status(),
    (await p.request.get(`${PORTAL}/api/auftraege/${f1}/design?version=1`)).status(),
    (await p.request.get(`${PORTAL}/api/dateien/${designDatei}?ansicht=1`)).status(),
  ];
  pruefen(gesperrt[0] === 403 && gesperrt[1] === 403 && gesperrt[2] === 200, `Server: Download gesperrt (403/403), 3D-Ansicht erlaubt (${gesperrt.join('/')})`);
  await karte.getByRole('button', { name: '3D-Ansicht Krone 16.stl' }).click();
  pruefen(await sichtbar(p.getByRole('img', { name: '3D-Modell Krone 16.stl' }), 15000), '3D-Ansicht des Designs');
  await p.getByRole('button', { name: 'Schließen' }).click();

  // Änderung anfordern
  await karte.getByRole('button', { name: 'Änderung anfordern' }).click();
  const aend = p.getByRole('form', { name: 'Änderung anfordern' });
  pruefen((await aend.getByRole('button', { name: /^Zahn \d+$/ }).allTextContents()).join(',') === 'Zahn 14,Zahn 15,Zahn 16', 'Änderung: nur die Zähne des Auftrags zur Auswahl');
  await aend.getByRole('button', { name: 'Änderung senden' }).click();
  pruefen((await aend.locator('textarea:invalid').count()) === 1 && (await status(f1)) === 'design_freigabe', 'Änderung ohne Beschreibung: Formular hält an');
  await aend.getByRole('button', { name: 'Zahn 15' }).click();
  await aend.getByRole('button', { name: 'kürzer' }).click();
  await aend.getByRole('button', { name: 'Okklusion' }).click();
  await aend.getByLabel('Beschreibung').fill('Glied 15 basal etwas kürzer, Okklusion entlasten');
  await bild(p, '33-portal-aenderung');
  await aend.getByRole('button', { name: 'Änderung senden' }).click();
  await p.getByRole('heading', { name: 'Wir überarbeiten Ihr Design.' }).waitFor();
  pruefen(await p.getByText('Zahn 15: kürzer, Okklusion · Glied 15 basal etwas kürzer, Okklusion entlasten').isVisible(), 'Änderungswunsch als lesbarer Text');
  const [r1b] = await sql`select status, change_message_id from ddl.design_revisions where order_id = ${f1} and revision = 1`;
  pruefen((await status(f1)) === 'in_ueberarbeitung' && r1b.status === 'aenderung' && r1b.change_message_id, 'Datenbank: Version 1 »Änderung«, Status »In Überarbeitung«');
  await p.goto(`${PORTAL}/auftraege/${f1}?tab=kommunikation`);
  pruefen(await sichtbar(p.getByText('Änderungswunsch · Version 1')), 'Kommunikation: »Änderungswunsch · Version 1«');

  // Labor: Version 2 (zwei Dateien)
  await t.goto(`${CRM}/auftraege/${f1}`);
  pruefen(await sichtbar(t.getByText('Änderungswunsch der Ordination zu Version 1')), 'Labor sieht den Änderungswunsch');
  await t.getByLabel('Design-Dateien hochladen').setInputFiles([D.krone2, D.modell2]);
  await fertigHochgeladen(t);
  await t.getByRole('button', { name: 'Zur Freigabe senden' }).click();
  await t.getByRole('heading', { name: 'Design zur Freigabe.' }).waitFor();

  // Ordination: Freigabe, zweimal (zweiter Tab mit altem Stand)
  await p.goto(`${PORTAL}/auftraege/${f1}`);
  const p2 = await p.context().newPage();
  await p2.goto(`${PORTAL}/auftraege/${f1}`);
  await p.getByRole('button', { name: 'Freigeben & herunterladen' }).click();
  const dialog = p.getByRole('dialog', { name: 'Design Version 2 freigeben' });
  pruefen((await dialog.getByLabel('Ihr Name').inputValue()) === 'Dr. Qa Freigabe' && (await dialog.getByRole('button', { name: 'Freigeben' }).isDisabled()), 'Freigabe-Dialog: Name vorausgefüllt, Freigeben erst mit Häkchen');
  await dialog.getByLabel('Ich habe das Design geprüft.').check();
  await bild(p, '34-portal-freigabe-dialog');
  const [zipDownload] = await Promise.all([p.waitForEvent('download'), dialog.getByRole('button', { name: 'Freigeben' }).click()]);
  const zipPfad = path.join(ordner, 'design.zip');
  await zipDownload.saveAs(zipPfad);
  const inhalt = execFileSync('unzip', ['-l', zipPfad]).toString();
  pruefen(zipDownload.suggestedFilename() === 'QA-F-0001_Design_V2.zip' && execFileSync('unzip', ['-t', zipPfad]).toString().includes('No errors') && inhalt.includes('Krone 16 v2.stl') && inhalt.includes('Modell OK v2.stl'), 'nach der Freigabe: ZIP mit beiden Dateien von Version 2');
  await p.getByRole('heading', { name: 'In Produktion.' }).waitFor();
  const [r2] = await sql`select status, decided_name, decided_ip, decided_at from ddl.design_revisions where order_id = ${f1} and revision = 2`;
  pruefen((await status(f1)) === 'in_produktion' && r2.status === 'freigegeben' && r2.decided_name === 'Dr. Qa Freigabe' && r2.decided_at, 'Datenbank: Freigabe mit Name und Zeit, Status »In Produktion«');
  await p2.getByRole('button', { name: 'Freigeben & herunterladen' }).click();
  await p2.getByRole('dialog').getByLabel('Ich habe das Design geprüft.').check();
  const [zweiter] = await Promise.all([p2.waitForEvent('download'), p2.getByRole('dialog').getByRole('button', { name: 'Freigeben' }).click()]);
  const [{ n: produktion }] = await sql`select count(*)::int as n from ddl.order_status_history where order_id = ${f1} and status = 'in_produktion'`;
  pruefen(zweiter.suggestedFilename() === 'QA-F-0001_Design_V2.zip' && produktion === 1, 'zweite Freigabe (anderer Tab): gleicher Download, kein doppelter Schritt');
  await p2.close();
  pruefen((await p.request.get(`${PORTAL}/api/dateien/${designDatei}`)).status() === 403, 'alte Version 1 bleibt gesperrt');

  // Feedback
  await p.getByRole('button', { name: 'Nicht gut' }).click();
  await p.getByRole('button', { name: 'Senden' }).click();
  pruefen(await sichtbar(p.getByText('Bitte sagen Sie uns kurz, was nicht gepasst hat.')), 'Feedback »Nicht gut« braucht einen Satz');
  await p.getByLabel('Was hat nicht gepasst?').fill('Erste Version zu lang');
  await p.getByRole('button', { name: 'Senden' }).click();
  pruefen(await sichtbar(p.getByText('Danke für Ihr Feedback.')), 'Feedback gespeichert');
  await bild(p, '35-portal-nach-freigabe');
  await p.goto(`${PORTAL}/auftraege/${f1}?tab=dateien`);
  pruefen(await sichtbar(p.getByText('Verlauf (1)')), 'Dateien: »Design von DDL« mit Verlauf');
  await bild(p, '36-portal-dateien-design');

  // Labor: Feedback sehen, weiter bis geliefert
  await t.goto(`${CRM}/auftraege/${f1}`);
  pruefen(await sichtbar(t.getByText(/Feedback der Ordination: Nicht gut/)), 'Labor sieht das Feedback');
  // Produktion (Schritt 8): Drucker und, falls schon erfasst, eine passende Charge
  const prod = t.getByRole('region', { name: 'Produktion' });
  await prod.getByLabel('SprintRay MIDAS').check();
  const frei = prod.locator('input[type=checkbox]:visible:not(:disabled)');
  if (await frei.count()) await frei.first().check();
  for (const knopf of ['3D-Druck erledigt', 'Reinigung & Nachhärtung erledigt', 'Ausarbeitung / Farbanpassung erledigt', 'Qualitätskontrolle erledigt']) {
    await prod.getByRole('button', { name: knopf }).click();
    await prod.getByText(`${knopf}. Weiter mit:`).waitFor();
  }
  await prod.getByRole('button', { name: 'Geliefert' }).click();
  await t.getByRole('heading', { name: 'Geliefert.' }).waitFor();
  const [o1] = await sql`select status, delivered_at, approved_at from ddl.orders where id = ${f1}`;
  pruefen(o1.status === 'geliefert' && o1.delivered_at && o1.approved_at, 'Labor: Produktionsschritte bis Geliefert, mit Lieferdatum');
  await p.goto(`${PORTAL}/auftraege/${f1}`);
  pruefen(await sichtbar(p.getByRole('heading', { name: 'Geliefert.' })), 'Ordination sieht »Geliefert.«');

  // ── Nur Design: Freigabe, danach Überarbeitung ──
  await t.goto(`${CRM}/auftraege/${f2}`);
  await t.getByLabel('Design-Dateien hochladen').setInputFiles(D.smile);
  await fertigHochgeladen(t);
  await t.getByRole('button', { name: 'Zur Freigabe senden' }).click();
  await t.getByRole('heading', { name: 'Design zur Freigabe.' }).waitFor();
  await p.goto(`${PORTAL}/auftraege/${f2}`);
  await p.getByRole('button', { name: 'Freigeben & herunterladen' }).click();
  await p.getByRole('dialog').getByLabel('Ich habe das Design geprüft.').check();
  const [stl] = await Promise.all([p.waitForEvent('download'), p.getByRole('dialog').getByRole('button', { name: 'Freigeben' }).click()]);
  pruefen(stl.suggestedFilename() === 'Smile Mockup.stl', 'eine Datei: direkter Download statt ZIP');
  await p.getByRole('heading', { name: 'Ihr Design ist bereit zum Drucken.' }).waitFor();
  pruefen((await status(f2)) === 'freigegeben' && (await p.getByRole('link', { name: 'Dateien herunterladen' }).isVisible()), '»Nur Design«: »Freigegeben« mit »Dateien herunterladen«');
  await p.getByRole('button', { name: 'Überarbeitung anfordern' }).click();
  await p.getByRole('form', { name: 'Überarbeitung anfordern' }).getByLabel('Beschreibung').fill('Mittellinie 1 mm nach rechts');
  await p.getByRole('form', { name: 'Überarbeitung anfordern' }).getByRole('button', { name: 'Mittellinie' }).click();
  await p.getByRole('form', { name: 'Überarbeitung anfordern' }).getByRole('button', { name: 'Änderung senden' }).click();
  await p.getByRole('heading', { name: 'Wir überarbeiten Ihr Design.' }).waitFor();
  pruefen((await status(f2)) === 'in_ueberarbeitung', '»Überarbeitung anfordern« nach der Freigabe');
  await t.goto(`${CRM}/auftraege/${f2}`);
  await t.getByLabel('Design-Dateien hochladen').setInputFiles(D.smile2);
  await fertigHochgeladen(t);
  await t.getByRole('button', { name: 'Zur Freigabe senden' }).click();
  await t.getByRole('heading', { name: 'Design zur Freigabe.' }).waitFor();
  pruefen((await status(f2)) === 'design_freigabe', 'überarbeitete Version wieder zur Freigabe');

  // ── Trennung ──
  const { s: q } = await portalZugang('QA Freigabe B', 'qa-freigabe-b@example.invalid', B.id);
  const fremd = [(await q.request.get(`${PORTAL}/api/auftraege/${f1}/design?version=2`)).status(), (await q.request.get(`${PORTAL}/api/dateien/${designDatei}?ansicht=1`)).status()];
  const ohne = (await fetch(`${PORTAL}/api/auftraege/${f1}/design?version=2`)).status;
  pruefen(fremd.every((x) => x === 404) && ohne === 401, `Design anderer Ordination: 404/404, ohne Anmeldung 401 (${[...fremd, ohne].join('/')})`);
  const [{ n: downloads }] = await sql`select count(*)::int as n from ddl.data_access_log where actor_id = ${nutzerA} and action = 'herunterladen' and order_id = ${f1}`;
  pruefen(downloads >= 2, 'Data-Access-Log: Design-Downloads protokolliert');

  // ── Ansicht ──
  const zuBreit = [];
  for (const [breite, hoehe] of [[1440, 900], [768, 1024], [390, 844], [320, 640]]) {
    await p.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of [`/auftraege/${f2}`, `/auftraege/${f2}?tab=dateien`, `/auftraege/${f1}?tab=kommunikation`]) {
      await p.goto(`${PORTAL}${pfad}`, { waitUntil: 'networkidle' });
      const w = await p.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`portal ${pfad} ${breite}px: ${w}px`);
    }
    await t.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of [`/auftraege/${f2}`, `/auftraege/${f1}?tab=dateien`]) {
      await t.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
      const w = await t.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`intern ${pfad} ${breite}px: ${w}px`);
    }
    if (breite === 390) {
      await p.goto(`${PORTAL}/auftraege/${f2}`, { waitUntil: 'networkidle' });
      await bild(p, '37-portal-pruefen-390');
    }
  }
  pruefen(!zuBreit.length, `kein horizontales Scrollen (1440 bis 320 px)${zuBreit.length ? ' → ' + zuBreit.slice(0, 6).join(', ') : ''}`);
  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 200) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await belegZaehlerZurueck(sql, zaehlerVorher);
  pruefen(JSON.stringify(zaehlerVorher) === JSON.stringify(await zaehlerStand(sql)), 'Zähler (Auftrags- und Belegnummern) unverändert');
  await sql.end();
}
process.exit(fehler ? 1 : 0);
