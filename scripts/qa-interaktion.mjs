// فرم قدم‌به‌قدم «Neuer Auftrag» در پیش‌نمایش، مثل یک کاربر واقعی: کلیک، صفحه‌کلید،
// ظاهر شدن قدم بعدی، «Ändern» و پاک شدن جواب‌ها با عوض کردن Behandlung.
// اجرا: pnpm qa qa-interaktion  (محیط جدای آزمون، `scripts/qa.mjs`)
import { chromium } from '@playwright/test';
import { BASIS } from './qa-umgebung.mjs';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASIS}/vorschau`, { waitUntil: 'networkidle' });
const pruefen = (ok, text) => { console.log(`${ok ? '✓' : '✗'} ${text}`); if (!ok) process.exitCode = 1; };
const kachel = (name) => page.getByRole('button', { name: new RegExp(`^${name}`) });
const schritt = (id) => page.locator(`#schritt-${id}`);
const sichtbar = async (loc) => { try { await loc.waitFor({ timeout: 4000 }); return true; } catch { return false; } };

pruefen(await page.getByRole('heading', { name: 'Was möchten Sie bestellen?' }).isVisible(), 'am Anfang nur Schritt 1');
pruefen((await page.getByRole('heading', { name: 'Welche Zähne?' }).count()) === 0, 'Zähne erst nach der Behandlung');

// Brücke: nur das Brückenwerkzeug, ohne Werkzeugspalte
await kachel('Brücke').click();
const zaehne = schritt('b-zaehne');
pruefen(await sichtbar(zaehne.getByRole('heading', { name: 'Welche Zähne?' })), 'Klick auf »Brücke« öffnet »Welche Zähne?«');
pruefen((await zaehne.getByRole('radio').count()) === 0, 'Brücke: keine Werkzeugspalte');
await zaehne.getByRole('button', { name: /^Zahn 14:/ }).click();
await zaehne.getByRole('button', { name: /^Zahn 16:/ }).click();
pruefen(await zaehne.getByText('Brücke 16–14: Anker 16, 14 · Glied 15').isVisible(), 'Brücke 14–16 per Klick');
await zaehne.getByRole('button', { name: /^Zahn 15:/ }).click();
pruefen(await zaehne.getByText('Brücke 16–14: Anker 16, 15, 14').isVisible(), 'Glied 15 → Anker per Klick');
await zaehne.getByRole('button', { name: /^Zahn 24:/ }).click();
await zaehne.getByRole('button', { name: /^Zahn 34:/ }).click();
pruefen(await zaehne.getByRole('alert').getByText('Eine Brücke muss in einem Kiefer liegen.').isVisible(), 'Fehlermeldung bei zwei Kiefern');

await zaehne.getByRole('button', { name: 'Weiter' }).click();
pruefen(await sichtbar(schritt('b-versorgung').getByRole('heading', { name: 'Versorgung' })), '»Weiter« öffnet den nächsten Schritt');
pruefen(await schritt('b-zaehne').getByText('Brücke 16–14: Anker 16, 15, 14').isVisible(), 'erledigter Schritt eingeklappt, mit Zusammenfassung');
await schritt('b-versorgung').getByRole('button', { name: 'Definitiv' }).click();
pruefen(await sichtbar(schritt('b-farbe').getByRole('heading', { name: 'Welche Zahnfarbe?' })), 'eine Auswahl springt sofort weiter');
await schritt('b-farbe').getByRole('button', { name: 'Weiter' }).click();
pruefen(await schritt('b-farbe').getByRole('alert').getByText(/Bitte eine Zahnfarbe wählen/).isVisible(), 'ohne Farbe kein »Weiter«');

// Behandlung wechseln: Antworten der Brücke verschwinden
await page.getByRole('button', { name: 'Behandlung ändern' }).click();
await kachel('Prothese').click();
pruefen(await sichtbar(page.getByRole('heading', { name: 'Welche Prothese?' })), '»Prothese« fragt »Welche Prothese?«');
pruefen((await schritt('b-versorgung').count()) === 0, 'Wechsel der Behandlung setzt die Antworten zurück');
await kachel('Teilprothese').click();
const bogen = schritt('b-zaehne');
pruefen(await sichtbar(bogen.getByRole('heading', { name: 'Welche Zähne ersetzt die Prothese?' })), 'Teilprothese öffnet den Kieferbogen');
await bogen.getByRole('button', { name: 'Weiter' }).click();
pruefen(await bogen.getByRole('alert').getByText(/Ersatzzahn/).isVisible(), 'ohne Ersatzzahn kein »Weiter«');
await bogen.getByRole('button', { name: /^Zahn 36:/ }).click();
await bogen.getByRole('radio', { name: /Klammer/ }).click();
await bogen.getByRole('button', { name: /^Zahn 35:/ }).focus();
await page.keyboard.press('Enter');
pruefen(await bogen.getByText('Klammer: 35').isVisible(), 'Klammer 35 per Tastatur');
await bogen.getByRole('button', { name: 'Weiter' }).click();

await schritt('b-prothesenform').getByRole('button', { name: /^Nesbit/ }).click();
await schritt('b-klammern').getByRole('button', { name: /^Mit Klammern/ }).click();
pruefen(await sichtbar(schritt('b-einprobe').getByRole('heading')), 'Bildkarten springen weiter');
pruefen((await schritt('b-gaumen').count()) === 0, 'nur Unterkiefer: keine Gaumenabdeckung');

await page.getByRole('button', { name: 'Zähne ändern' }).click();
await schritt('b-zaehne').getByRole('button', { name: /^Zahn 12:/ }).click();
await schritt('b-zaehne').getByRole('button', { name: 'Weiter' }).click();
pruefen(await sichtbar(schritt('b-gaumen').getByRole('heading', { name: 'Gaumenabdeckung' })), 'Oberkiefer dazu: Gaumenabdeckung erscheint als nächster Schritt');

await schritt('b-gaumen').getByRole('button', { name: 'Überspringen' }).click();
await schritt('b-einprobe').getByRole('button', { name: 'Nein' }).click();
await schritt('b-farbe').getByRole('button', { name: 'Farbe folgt' }).click();
await schritt('b-farbe').getByRole('button', { name: 'Weiter' }).click();
await kachel('Fertige Arbeit').click();
// Prothese: nur Standard (kein Express, kein Same-Day), also keine Tempo-Frage
pruefen(await sichtbar(page.getByRole('heading', { name: 'Auswahl vollständig.' })), 'nach der Lieferart: ohne Tempo-Frage »Auswahl vollständig.«');
pruefen((await schritt('tempo').count()) === 0, 'Prothese: keine Frage nach Express oder Same-Day');
pruefen((await page.getByText(/Material/).count()) === 0, 'keine Frage nach dem Material');
pruefen(await page.getByText(/^Teilprothese · Fertige Arbeit · Standard · (Preis auf Anfrage|ab €)/).isVisible(), 'Zusammenfassung mit Lieferart, Standard und Preis');
pruefen(await page.getByText('Bearbeitungszeit: ca. 2 Wochen').isVisible(), 'Zusammenfassung mit der Standard-Bearbeitungszeit');

// Krone: drei Stufen, klar getrennt
await page.goto(`${BASIS}/vorschau?beispiel=krone&offen=tempo`, { waitUntil: 'networkidle' });
const tempo = schritt('tempo');
pruefen(await sichtbar(tempo.getByRole('heading', { name: 'Wie schnell brauchen Sie die Arbeit?' })), 'Krone: Frage nach dem Tempo');
const stufen = await tempo.getByRole('group', { name: 'Tempo' }).getByRole('button').allTextContents();
pruefen(
  stufen.length === 3 && /^Standard.*Bearbeitungszeit: nach Prüfung/.test(stufen[0]) && /^Express < 24 Stunden.*innerhalb von 24 Stunden, nach Verfügbarkeit.*Expresszuschlag/.test(stufen[1]) && /^Same-Day.*am selben Werktag, nach Verfügbarkeit.*Same-Day-Zuschlag/.test(stufen[2]),
  `Krone: Standard, Express < 24 Stunden und Same-Day mit eigenem Zuschlag (${stufen.join(' | ')})`,
);
await tempo.getByRole('button', { name: /^Same-Day/ }).click();
pruefen(await page.getByText(/^Krone · Fertige Arbeit · Same-Day · (Preis auf Anfrage|ab €)/).isVisible(), 'Zusammenfassung: Same-Day');
pruefen(
  (await schritt('abschluss').getByText(/Fertigstellung am selben Werktag, nach Verfügbarkeit · zzgl\. Same-Day-Zuschlag/).isVisible()) && (await schritt('abschluss').getByText(/Expresszuschlag/).count()) === 0,
  'Zusammenfassung: Same-Day-Zuschlag, nicht Expresszuschlag',
);

await browser.close();
