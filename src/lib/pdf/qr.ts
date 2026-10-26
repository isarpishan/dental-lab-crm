import QRCode from 'qrcode';

/**
 * QR به شکل یک مسیر SVG (برای PDF برداری و تیز روی کاغذ). `groesse` تعداد ماژول‌ها در هر ضلع است،
 * بدون حاشیهٔ سفید؛ حاشیه را صفحه می‌گذارد. سطح تصحیح خطای «M»: روی کاغذ کارگاه کمی لک‌شدن را تحمل می‌کند.
 */
export function qrPfad(text: string): { groesse: number; pfad: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  const teile: string[] = [];
  for (let y = 0; y < n; y++) {
    // benachbarte dunkle Module einer Zeile als ein Rechteck
    let x = 0;
    while (x < n) {
      if (!modules.get(y, x)) {
        x++;
        continue;
      }
      const start = x;
      while (x < n && modules.get(y, x)) x++;
      teile.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
    }
  }
  return { groesse: n, pfad: teile.join('') };
}
