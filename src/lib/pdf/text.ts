/**
 * قلم‌های پایهٔ PDF (Helvetica، بدون فایل قلم) فقط نویسه‌های WinAnsi را دارند: لاتین غربی،
 * Umlautها، €، – و „“. هر نویسهٔ دیگر (مثلاً emoji در متن Ordination) با «?» عوض می‌شود تا PDF نشکند.
 */
const EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
const ERSATZ: Record<string, string> = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'x', '−': '–', '\t': ' ' };

export function pdfText(s: string): string {
  let aus = '';
  for (const z of s.normalize('NFC')) {
    const c = z.codePointAt(0)!;
    if (z === '\n' || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRA.has(z)) aus += z;
    else aus += ERSATZ[z] ?? '?';
  }
  return aus;
}
