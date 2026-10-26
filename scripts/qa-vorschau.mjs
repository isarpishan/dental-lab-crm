// بررسی سریع ظاهر پیش‌نمایش: اسکرول افقی، خطای کنسول، و اندازهٔ هدف‌های لمسی.
// اجرا: pnpm qa qa-vorschau  (محیط جدای آزمون، `scripts/qa.mjs`)
import { chromium } from '@playwright/test';
import { BASIS } from './qa-umgebung.mjs';

// قدم اول، و فرم پرشده با قدم‌های بزرگ باز (Zahnleiste، Kieferbogen، Zahnfarbe)
const urls = process.env.QA_URL
  ? [process.env.QA_URL]
  : [
      '/vorschau',
      '/vorschau?beispiel=bruecke&offen=b-zaehne',
      '/vorschau?beispiel=teilprothese&offen=b-zaehne',
      '/vorschau?beispiel=teilprothese&offen=b-farbe',
      '/vorschau?beispiel=krone&offen=tempo',
      '/vorschau?beispiel=teilprothese',
    ].map((p) => `${BASIS}${p}`);
const browser = await chromium.launch({ channel: 'chrome' });
let fehler = 0;

for (const url of urls)
for (const [breite, hoehe] of [[1440, 900], [768, 1024], [390, 844], [320, 640]]) {
  const page = await browser.newPage({ viewport: { width: breite, height: hoehe } });
  const konsole = [];
  page.on('console', (m) => m.type() === 'error' && konsole.push(m.text()));
  page.on('pageerror', (e) => konsole.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  // همهٔ عکس‌ها (حتی lazy) را بارگذاری کن
  await page.evaluate(async () => { for (const img of document.images) { img.loading = 'eager'; } });
  await page.waitForLoadState('networkidle');
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const breiteSeite = Math.max(doc.scrollWidth, document.body.scrollWidth);
    const zuBreit = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0) return false;
        // Inhalt innerhalb eines eigenen Scroll-Containers zählt nicht
        let p = el.parentElement;
        while (p) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === 'auto' || ox === 'scroll') return false;
          p = p.parentElement;
        }
        return b.right > window.innerWidth + 1;
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} → ${Math.round(el.getBoundingClientRect().right)}px`);
    const kleineZiele = [...document.querySelectorAll('button, a, [role=button]')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && (b.width < 24 || b.height < 24);
      })
      .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30));
    const kaputteBilder = [...document.images].filter((img) => img.complete && img.naturalWidth === 0).map((img) => img.src);
    const h1 = document.querySelector('h1').getBoundingClientRect();
    return { breiteSeite, fenster: window.innerWidth, zuBreit, kleineZiele: kleineZiele.slice(0, 6), anzahlKlein: kleineZiele.length, kaputteBilder, h1Rechts: Math.round(h1.right) };
  });
  const ok = r.breiteSeite <= r.fenster + 1 && konsole.length === 0 && r.kaputteBilder.length === 0 && r.h1Rechts <= r.fenster;
  if (!ok) fehler++;
  console.log(`${ok ? '✓' : '✗'} ${url.replace(/^.*?\/vorschau/, '/vorschau')} ${breite}×${hoehe}: Seitenbreite ${r.breiteSeite}/${r.fenster}, Titel bis ${r.h1Rechts}px, Konsolenfehler ${konsole.length}, kaputte Bilder ${r.kaputteBilder.length}, kleine Ziele ${r.anzahlKlein}`);
  for (const z of r.zuBreit) console.log('   zu breit:', z);
  for (const k of konsole.slice(0, 3)) console.log('   Konsole:', k.slice(0, 200));
  if (r.anzahlKlein) console.log('   kleine Ziele (Beispiele):', r.kleineZiele.join(' | '));
  await page.close();
}
await browser.close();
process.exit(fehler ? 1 : 0);
