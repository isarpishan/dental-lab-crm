/**
 * ایمیل هشدار سرور (قدم ۱۳). فرمان `ddl` روی سرور این را صدا می‌زند، مثلاً وقتی بکاپ شکست
 * خورده، دیسک پر است یا تونل دروازه قطع شده؛ و برای «ddl testmail».
 *   tsx scripts/warnung.ts "Betreff" < text
 * مستقیم با SMTP، نه از صف jobs: باید حتی وقتی دیتابیس یا worker خراب است هم برسد.
 * فقط وضعیت سرور، هیچ دادهٔ بیماری.
 */
import { readFileSync } from 'node:fs';
import nodemailer from 'nodemailer';

const betreff = process.argv[2];
const smtp = process.env.SMTP_URL;
if (!betreff || !smtp) {
  console.error('Aufruf: tsx scripts/warnung.ts "Betreff" < Text  (SMTP_URL muss gesetzt sein)');
  process.exit(2);
}
const text = readFileSync(0, 'utf8').trim();
const an = process.env.WARNUNG_AN || 'lab@drpishan.at';

await nodemailer.createTransport(smtp).sendMail({
  from: process.env.MAIL_FROM || 'Digital Dental Lab <lab@drpishan.at>',
  to: an,
  subject: `DDL-Server: ${betreff}`,
  text: `${text}\n\n— Automatische Nachricht des DDL-Servers im Labor. Anleitung: docs/betrieb.md`,
});
console.log(`✓ E-Mail an ${an} gesendet`);
