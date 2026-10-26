// سه Tempo (خواستهٔ کاربر، ۵ اکتبر ۲۰۲۶): Standard، «Express < 24 Stunden» و «Same-Day»، هر کدام با Zuschlag جدا.
// با دادهٔ نمایشی: «Preise» (تیک‌ها و Zuschlagها، ظاهر در ۴ اندازه)، کاشی «Same-Day möglich»، قدم Tempo،
// صفحهٔ سفارش و پوزیشن «Same-Day-Zuschlag»، Laufzettel «SAME-DAY»،
// کاشی داشبورد و فیلتر «Nur Same-Day». با QA_BILDER=<پوشه> عکس صفحه‌ها هم ذخیره می‌شود.
// اجرا: pnpm qa qa-tempo
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import postgres from 'postgres';
import { BASIS, CRM } from './qa-umgebung.mjs';

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
const pdfLesen = (datei) => JSON.parse(execFileSync('swift', ['scripts/qa-pdf.swift', datei], { maxBuffer: 10_000_000 }).toString());

const STAFF = 'test-tempo@example.invalid';
async function aufraeumen() {
  const ids = (await sql`select id from ddl.staff_users where email = ${STAFF}`).map((r) => r.id);
  if (ids.length) {
    await sql`delete from ddl.data_access_log where actor_id in ${sql(ids)}`;
    await sql`delete from ddl.audit_log where actor_id in ${sql(ids)}`;
    await sql`delete from ddl.sessions where user_id in ${sql(ids)}`;
    await sql`delete from ddl.one_time_tokens where user_id in ${sql(ids)}`;
    await sql`delete from ddl.staff_users where id in ${sql(ids)}`;
  }
}

await aufraeumen();
const [sameDay] = await sql`select o.id, o.order_no from ddl.orders o join ddl.practices p on p.id = o.practice_id where p.is_demo and o.tempo = 'same_day' and o.status = 'in_produktion'`;
pruefen(Boolean(sameDay), 'Demo-Daten: eine Krone mit Same-Day in Produktion');
const browser = await chromium.launch({ channel: 'chrome' });
const konsole = [];
const bild = async (s, name) => {
  if (BILDER) await s.screenshot({ path: path.join(BILDER, `${name}.png`), fullPage: true });
};

try {
  const [u] = await sql`insert into ddl.staff_users (email, name, role) values (${STAFF}, 'Test Tempo', 'inhaber') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into ddl.one_time_tokens (token_hash, purpose, user_kind, user_id, expires_at) values (${sha(token)}, 'einladung', 'staff', ${u.id}, now() + interval '1 hour')`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => konsole.push(`${s.url()}: ${String(e)}`));
  s.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && konsole.push(`${s.url()}: ${m.text()}`));
  await s.goto(`${CRM}/einladung/${token}`);
  const geheimnis = (await s.locator('p.font-medium.tracking-\\[0\\.08em\\]').textContent()).trim();
  await s.getByLabel('Neues Passwort').fill('test-passwort-tempo-1');
  await s.getByLabel('Passwort wiederholen').fill('test-passwort-tempo-1');
  await s.getByLabel('Code aus der App').fill(totp(geheimnis));
  await s.getByRole('button', { name: 'Zugang einrichten' }).click();
  await s.waitForURL(`${CRM}/`);

  // ── Übersicht: eine Kachel, beide Stufen getrennt gezählt ──
  const kachel = s.getByRole('region', { name: 'Auf einen Blick' }).getByRole('link', { name: /Express & Same-Day offen/ });
  pruefen(/\d+ Express · [1-9]\d* Same-Day/.test(await kachel.textContent()), `Übersicht: »Express & Same-Day offen« zählt beide getrennt (${(await kachel.textContent()).replace(/\s+/g, ' ').trim()})`);
  await kachel.click();
  await s.waitForURL(/status=eilig/);
  const liste = await s.getByRole('main').textContent();
  pruefen(liste.includes(sameDay.order_no) && liste.includes('Same-Day') && liste.includes('Express'), 'Kachel führt zur Liste mit Express- und Same-Day-Aufträgen');

  // ── Preise: drei Stufen pro Behandlung ──
  await s.goto(`${CRM}/preise`);
  const zeileKrone = s.locator('li', { has: s.locator('#zeit_krone') });
  pruefen((await zeileKrone.getByText('Express < 24 Stunden').count()) === 1 && (await zeileKrone.getByText('Same-Day', { exact: true }).count()) === 1, 'Preise: Krone mit »Express < 24 Stunden« und »Same-Day«');
  pruefen((await s.getByLabel('Same-Day-Zuschlag').count()) === (await s.getByLabel('Expresszuschlag').count()), 'Preise: Same-Day-Zuschlag und Expresszuschlag als eigene Felder');
  const zuBreit = [];
  const abgeschnitten = [];
  for (const [breite, hoehe] of [[1600, 900], [1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844], [320, 640]]) {
    await s.setViewportSize({ width: breite, height: hoehe });
    for (const pfad of ['/preise', '/vorschau?beispiel=krone&offen=tempo', `/auftraege/${sameDay.id}`]) {
      await s.goto(`${CRM}${pfad}`, { waitUntil: 'networkidle' });
      const w = await s.evaluate(() => document.documentElement.scrollWidth);
      if (w > breite + 1) zuBreit.push(`${pfad} ${breite}px: ${w}px`);
      if (pfad === '/preise') {
        // Platzhalter (»auf Anfrage«, »nach Prüfung«) passen ganz ins Feld
        const knapp = await s.locator('input[inputmode="decimal"]').evaluateAll((els) =>
          els.filter((e) => {
            const c = document.createElement('canvas').getContext('2d');
            const st = getComputedStyle(e);
            c.font = `${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
            return c.measureText(e.placeholder).width > e.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) + 0.5;
          }).length,
        );
        if (knapp) abgeschnitten.push(`${breite}px: ${knapp}`);
      }
      if ([1600, 1280, 390].includes(breite)) await bild(s, `tempo-${pfad.split(/[/?&=]/).filter(Boolean)[0] ?? 'start'}-${breite}`);
    }
  }
  pruefen(!abgeschnitten.length, `Preise: Platzhalter nicht abgeschnitten${abgeschnitten.length ? ' → ' + abgeschnitten.join(', ') : ''}`);
  pruefen(!zuBreit.length, `Preise, Tempo-Frage, Auftrag: kein horizontales Scrollen (1600/1440/1280/1024/768/390/320)${zuBreit.length ? ' → ' + zuBreit.join(', ') : ''}`);
  await s.setViewportSize({ width: 1440, height: 900 });

  // ── Auftragsformular: Kachel und Tempo ──
  await s.goto(`${BASIS}/vorschau`, { waitUntil: 'networkidle' });
  const markiert = [];
  for (const k of await s.getByRole('group', { name: 'Behandlung' }).getByRole('button').all()) {
    if ((await k.getByText('Same-Day möglich', { exact: true }).count()) === 1) markiert.push((await k.textContent()).split(',')[0].replace('Same-Day möglich', '').trim());
  }
  pruefen(markiert.length === 2 && markiert.some((n) => n.startsWith('Krone')) && markiert.some((n) => n.startsWith('Inlay')), `Kacheln: »Same-Day möglich« nur bei Krone und Inlay / Onlay (${markiert.join(', ')})`);

  // ── Auftrag: Tag, Tempo-Zeile und eigene Abrechnungszeile ──
  await s.goto(`${CRM}/auftraege/${sameDay.id}?tab=details`);
  const details = await s.getByRole('main').textContent();
  pruefen(details.includes('Same-Day · am selben Werktag') && details.includes('Same-Day-Zuschlag'), 'Auftragsdetails: »Same-Day · am selben Werktag« und Same-Day-Zuschlag');
  await s.goto(`${CRM}/auftraege/${sameDay.id}?tab=abrechnung`);
  const abrechnung = await s.getByRole('main').textContent();
  pruefen(abrechnung.includes('Same-Day-Zuschlag') && !abrechnung.includes('Expresszuschlag'), 'Abrechnung: eigene Zeile »Same-Day-Zuschlag«, kein Expresszuschlag');
  await bild(s, 'tempo-abrechnung-1440');

  // ── Laufzettel: SAME-DAY ──
  const antwort = await s.request.get(`${CRM}/api/auftraege/${sameDay.id}/laufzettel`);
  const ordner = mkdtempSync(path.join(tmpdir(), 'qa-tempo-'));
  const datei = path.join(ordner, 'laufzettel.pdf');
  writeFileSync(datei, await antwort.body());
  const lz = pdfLesen(datei);
  pruefen(antwort.status() === 200 && lz.text.includes('SAME-DAY') && !lz.text.includes('EXPRESS'), 'Laufzettel: »SAME-DAY«, nicht »EXPRESS«');

  pruefen(!konsole.length, `keine Konsolenfehler${konsole.length ? ' → ' + konsole[0].slice(0, 160) : ''}`);
} finally {
  await browser.close();
  await aufraeumen();
  await sql.end();
}
process.exit(fehler ? 1 : 0);
