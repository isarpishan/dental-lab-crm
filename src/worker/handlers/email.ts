import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer, { type SendMailOptions, type Transporter } from 'nodemailer';
import { z } from 'zod';
import { config } from '@/lib/config';
import { LOGO_CID } from '@/lib/email/vorlagen';
import { AppError } from '@/lib/errors';
import { speicherPfad } from '@/lib/speicherpfad';

const payload = z.object({ an: z.string().email(), betreff: z.string(), text: z.string(), html: z.string() });
/** پیوست‌ها از `STORAGE_DIR` (مثلاً PDF یک Rechnung)، با sha256 لحظهٔ صدور. */
const mitAnhang = payload.extend({
  anhaenge: z
    .array(z.object({ key: z.string(), dateiname: z.string().regex(/^[\w.-]+\.pdf$/), sha256: z.string().regex(/^[0-9a-f]{64}$/) }))
    .min(1)
    .max(5),
});
type Anhang = NonNullable<SendMailOptions['attachments']>[number];

/** لوگوی سربرگ، پیوست درون‌خطی (`cid:`). اگر فایل نباشد، ایمیل بدون لوگو می‌رود، نه اینکه گیر کند. */
const LOGO = path.join(process.cwd(), 'public/email/ddl-mark.png');

let transport: Transporter | null = null;

async function senden(daten: z.infer<typeof payload>, anhaenge: Anhang[] = []) {
  transport ??= nodemailer.createTransport(config().SMTP_URL);
  const logo = daten.html.includes(`cid:${LOGO_CID}`) && existsSync(LOGO);
  try {
    const info = await transport.sendMail({
      from: config().MAIL_FROM,
      to: daten.an,
      subject: daten.betreff,
      text: daten.text,
      html: daten.html,
      attachments: [...(logo ? [{ filename: 'ddl-mark.png', path: LOGO, cid: LOGO_CID }] : []), ...anhaenge],
    });
    return { messageId: info.messageId };
  } catch (e) {
    // 5xx از سرور ایمیل یعنی رد قطعی (مثلاً آدرس وجود ندارد): تکرار فایده ندارد. بقیه دوباره امتحان می‌شود.
    const code = (e as { responseCode?: number }).responseCode;
    if (code && code >= 500) throw new AppError(`E-Mail an ${daten.an} abgelehnt (${code}).`);
    throw e;
  }
}

export async function emailSenden(roh: unknown) {
  const r = payload.safeParse(roh);
  if (!r.success) throw new AppError(`Ungültige E-Mail-Daten: ${r.error.issues[0]?.message}`);
  return senden(r.data);
}

/**
 * ایمیل با PDF پیوست (Rechnung، Gutschrift؛ Spec فاز ۲، قدم ۳). فایل هنگام ارسال خوانده و با sha256
 * لحظهٔ صدور مقایسه می‌شود. فایل گم‌شده یا تغییرکرده یعنی ایمیل نمی‌رود، نه ایمیل بدون پیوست.
 */
export async function emailMitAnhangSenden(roh: unknown) {
  const r = mitAnhang.safeParse(roh);
  if (!r.success) throw new AppError(`Ungültige E-Mail-Daten: ${r.error.issues[0]?.message}`);
  const { anhaenge, ...daten } = r.data;
  const dateien: Anhang[] = [];
  for (const a of anhaenge) {
    // کلید نادرست هم مثل فایل گم‌شده: تکرار فایده ندارد
    let inhalt: Buffer | null = null;
    try {
      inhalt = await readFile(speicherPfad(a.key));
    } catch {
      inhalt = null;
    }
    if (!inhalt || createHash('sha256').update(inhalt).digest('hex') !== a.sha256) throw new AppError(`Anhang ${a.dateiname} fehlt oder wurde verändert.`);
    dateien.push({ filename: a.dateiname, content: inhalt, contentType: 'application/pdf' });
  }
  return { ...(await senden(daten, dateien)), anhaenge: dateien.length };
}
