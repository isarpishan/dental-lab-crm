/**
 * یک بار درخواست‌های پورتال را از سایت می‌خواند و نتیجه را چاپ می‌کند؛ برای `ddl website` بعد از وارد کردن
 * کلید، تا معلوم شود اتصال کار می‌کند. همان کاری که worker هر ۵ دقیقه می‌کند.
 *   tsx scripts/website-abruf.ts
 */
import { dbSchliessen } from '@/db/client';
import { anfragenAbrufen, websiteVerbindung } from '@/lib/website/anfragen';

const v = websiteVerbindung();
let code = 0;
if (!v) {
  console.error('✗ Kein Schlüssel für die Website eingerichtet (WEBSITE_ANFRAGEN_TOKEN).');
  code = 1;
} else {
  try {
    const r = await anfragenAbrufen();
    console.log(`✓ Verbindung zur Website (${new URL(v.url).host}) funktioniert. ${r?.offen ?? 0} offene Anfrage(n) für das Praxisportal, davon ${r?.neu ?? 0} neu.`);
  } catch (e) {
    console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
    code = 1;
  }
}
await dbSchliessen();
process.exit(code);
