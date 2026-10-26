/**
 * قالب ایمیل‌ها. ساده و خوانا: سربرگ سیاه با لوگو و «DIGITAL DENTAL LAB»، متن روی
 * زمینهٔ روشن (در ایمیل‌خوان‌ها خواناتر است)، دکمهٔ قرصی مثل سایت.
 * فقط HTML جدولی و استایل درون‌خطی، چون ایمیل‌خوان‌ها CSS کامل را نمی‌فهمند.
 * لوگو پیوست درون‌خطی است (`cid:`)؛ worker آن را از `public/email/` اضافه می‌کند.
 */
export const LOGO_CID = 'ddl-mark';

export function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

type Extra = {
  /** ردیف‌های کوتاه زیر متن، مثل «Auftrag · A-2026-0001» */
  fakten?: [string, string][];
  /** متن کوچک زیر دکمه، مثلاً اینکه چرا این ایمیل آمده */
  fussnote?: string;
};

export function rahmen(titel: string, absaetze: string[], knopf?: { text: string; url: string }, extra: Extra = {}) {
  const p = absaetze.map((a) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#171913">${escape(a)}</p>`).join('');
  const f = extra.fakten?.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px 0 8px;border-top:1px solid #e3dfd9">${extra.fakten
        .map(
          ([k, v]) =>
            `<tr><td style="padding:10px 16px 10px 0;border-bottom:1px solid #e3dfd9;font-size:13px;color:#5c5a57;width:120px">${escape(k)}</td><td style="padding:10px 0;border-bottom:1px solid #e3dfd9;font-size:15px;color:#171913">${escape(v)}</td></tr>`,
        )
        .join('')}</table>`
    : '';
  const k = knopf
    ? `<p style="margin:28px 0 8px"><a href="${escape(knopf.url)}" style="display:inline-block;background:#c6ae94;color:#171913;text-decoration:none;padding:15px 26px;border-radius:30px;font-size:16px">${escape(knopf.text)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5c5a57">Falls der Knopf nicht funktioniert: ${escape(knopf.url)}</p>`
    : '';
  const n = extra.fussnote ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#5c5a57">${escape(extra.fussnote)}</p>` : '';
  return `<!doctype html><html lang="de-AT"><body style="margin:0;background:#f4f2ef;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2ef"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff">
<tr><td style="background:#050505;padding:18px 32px"><table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td style="padding-right:16px"><img src="cid:${LOGO_CID}" width="62" height="52" alt="" style="display:block;border:0"></td>
<td style="color:#f4f2ef;font-size:12px;font-weight:500;letter-spacing:.06em">DIGITAL DENTAL LAB</td>
</tr></table></td></tr>
<tr><td style="padding:36px 32px 24px"><h1 style="margin:0 0 24px;font-size:28px;font-weight:300;line-height:1.2;color:#050505">${escape(titel)}</h1>${p}${f}${k}${n}</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #e3dfd9;font-size:12px;line-height:1.5;color:#5c5a57">Digital Dental Lab · Adalbert-Stifter-Straße 35/6/1 · 1200 Wien · lab@drpishan.at</td></tr>
</table></td></tr></table></body></html>`;
}

export function portalEinladungMail(e: { name: string; ordination: string; link: string; gueltigStunden: number }) {
  const betreff = 'Ihr Zugang zum Portal von Digital Dental Lab';
  const absaetze = [
    `Guten Tag ${e.name},`,
    `für ${e.ordination} wurde ein Zugang zum Portal von Digital Dental Lab angelegt. Dort senden Sie Aufträge, geben Designs frei und sehen jederzeit, in welchem Schritt Ihre Arbeiten sind.`,
    `Bitte legen Sie über den folgenden Link Ihr Passwort fest. Der Link ist ${e.gueltigStunden} Stunden gültig und nur einmal verwendbar.`,
  ];
  return {
    betreff,
    text: `${absaetze.join('\n\n')}\n\n${e.link}\n\nDigital Dental Lab · lab@drpishan.at`,
    html: rahmen('Portal-Zugang einrichten', absaetze, { text: 'Passwort festlegen', url: e.link }),
  };
}

/** تأیید پذیرش Vereinbarung (§ 10 Abs. 2 ECG: دریافت اعلام ارادهٔ الکترونیکی بی‌درنگ تأیید می‌شود). */
export function vereinbarungBestaetigungMail(e: { name: string; ordination: string; version: string; am: string; von: string; link: string }) {
  const betreff = 'Bestätigung: Vereinbarung zu Datenschutz und Portalnutzung';
  const absaetze = [
    `Guten Tag ${e.name},`,
    `für ${e.ordination} wurde die Vereinbarung zu Datenschutz und Portalnutzung im Portal von Digital Dental Lab angenommen. Damit ist das Portal freigeschaltet.`,
    'Die angenommene Fassung ist gespeichert. Sie finden sie jederzeit im Portal unter „Einstellungen“ als PDF.',
  ];
  const fakten: [string, string][] = [
    ['Ordination', e.ordination],
    ['Version', e.version],
    ['Angenommen', e.am],
    ['Von', e.von],
  ];
  return {
    betreff,
    text: `${absaetze.join('\n\n')}\n\n${fakten.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${e.link}\n\nDigital Dental Lab · lab@drpishan.at`,
    html: rahmen('Vereinbarung angenommen', absaetze, { text: 'Vereinbarung ansehen', url: e.link }, { fakten, fussnote: 'Diese E-Mail bestätigt den Eingang Ihrer Annahme.' }),
  };
}

export function einladungMail(e: { name: string; rolle: string; link: string; gueltigStunden: number }) {
  const betreff = 'Ihr Zugang zum Digital Dental Lab';
  const absaetze = [
    `Guten Tag ${e.name},`,
    `für Sie wurde ein Zugang zum internen System von Digital Dental Lab angelegt (Rolle: ${e.rolle}).`,
    `Bitte legen Sie über den folgenden Link Ihr Passwort fest und richten Sie die Zwei-Faktor-Anmeldung mit einer Authenticator-App ein. Der Link ist ${e.gueltigStunden} Stunden gültig und nur einmal verwendbar.`,
  ];
  return {
    betreff,
    text: `${absaetze.join('\n\n')}\n\n${e.link}\n\nDigital Dental Lab · lab@drpishan.at`,
    html: rahmen('Zugang einrichten', absaetze, { text: 'Zugang einrichten', url: e.link }),
  };
}
