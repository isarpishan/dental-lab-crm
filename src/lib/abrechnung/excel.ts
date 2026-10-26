import { zipErstellen } from '@/lib/zip';

/**
 * فایل Excel ساده (xlsx) بدون وابستگی تازه (Spec فاز ۲، قدم ۵): xlsx یک ZIP از چند فایل XML است، با
 * همان `zipErstellen` خودمان. متن‌ها «inline» (نه فرمول، پس هیچ متنی اجرا نمی‌شود)، تاریخ به‌صورت
 * عدد تاریخ Excel با قالب `dd.mm.yyyy`، مبلغ به یورو با قالب پول. ردیف سرتیتر ثابت و با فیلتر.
 */
export type SpaltenArt = 'text' | 'datum' | 'zeit' | 'geld' | 'zahl';
export type Spalte = { titel: string; art: SpaltenArt; breite?: number };
/** null = خانهٔ خالی. تاریخ: «YYYY-MM-DD» یا Date؛ پول: سنت (عدد صحیح) */
export type Wert = string | number | Date | null;
export type Blatt = { name: string; spalten: Spalte[]; zeilen: Wert[][]; filter?: boolean };

const STIL: Record<SpaltenArt, number> = { text: 0, zahl: 0, datum: 2, geld: 3, zeit: 4 };
/** سبک ۱ در `STYLES`: سرتیتر پررنگ */
const KOPF = 1;

/** ۰ ← A، ۲۵ ← Z، ۲۶ ← AA */
export function spaltenName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const WIEN_TAG = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Vienna' });
const WIEN_ZEIT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Vienna' });

/** عدد تاریخ Excel (روزها از 1899-12-30)؛ برای Date: روز و ساعت به وقت وین */
export function excelDatum(w: string | Date): number {
  const iso = typeof w === 'string' ? w : WIEN_TAG.format(w);
  const [y, m, d] = iso.split('-').map(Number);
  const tage = Date.UTC(y, m - 1, d) / 86_400_000 + 25_569;
  if (typeof w === 'string') return tage;
  const [h, min] = WIEN_ZEIT.format(w).split(':').map(Number);
  return tage + (h * 60 + min) / 1440;
}

// نویسه‌های کنترلی در XML مجاز نیستند
const xml = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function zelle(ref: string, w: Wert, art: SpaltenArt, stil?: number): string {
  if (w == null || w === '') return '';
  // متن، یا متنی در ستون عددی (مثلاً «–»)؛ تاریخ می‌تواند متن ISO باشد
  const alsText = art === 'text' || (typeof w === 'string' && art !== 'datum');
  if (alsText) {
    return `<c r="${ref}" t="inlineStr"${stil ? ` s="${stil}"` : ''}><is><t xml:space="preserve">${xml(String(w))}</t></is></c>`;
  }
  let v: number;
  if (art === 'datum' || art === 'zeit') v = excelDatum(w as string | Date);
  else if (art === 'geld') v = (w as number) / 100;
  else v = w as number;
  if (!Number.isFinite(v)) return '';
  return `<c r="${ref}" s="${stil ?? STIL[art]}"><v>${v}</v></c>`;
}

function blattXml(b: Blatt): string {
  const kopf = b.spalten.map((s, i) => zelle(`${spaltenName(i)}1`, s.titel, 'text', KOPF)).join('');
  const zeilen = b.zeilen.map((z, j) => b.spalten.map((s, i) => zelle(`${spaltenName(i)}${j + 2}`, z[i] ?? null, s.art)).join(''));
  const alle = [kopf, ...zeilen].map((inhalt, j) => `<row r="${j + 1}">${inhalt}</row>`).join('');
  const breiten = b.spalten.map((s, i) => `<col min="${i + 1}" max="${i + 1}" width="${s.breite ?? 14}" customWidth="1"/>`).join('');
  const letzte = `${spaltenName(b.spalten.length - 1)}${b.zeilen.length + 1}`;
  const fixiert = '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetViews><sheetView workbookViewId="0">${fixiert}</sheetView></sheetViews>` +
    `<cols>${breiten}</cols><sheetData>${alle}</sheetData>` +
    (b.filter && b.zeilen.length ? `<autoFilter ref="A1:${letzte}"/>` : '') +
    '</worksheet>'
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/><numFmt numFmtId="166" formatCode="dd\\.mm\\.yyyy\\ hh:mm"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** نام برگه در Excel: حداکثر ۳۱ نویسه، بدون []:*?/\ */
const blattName = (n: string) => n.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

export async function xlsxErstellen(blaetter: Blatt[], jetzt = new Date()): Promise<Buffer> {
  const n = blaetter.length;
  const namen = blaetter.map((b) => blattName(b.name));
  const filter = blaetter
    .map((b, i) =>
      b.filter && b.zeilen.length
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(namen[i]).replace(/'/g, "''")}'!$A$1:$${spaltenName(b.spalten.length - 1)}$${b.zeilen.length + 1}</definedName>`
        : '',
    )
    .join('');
  const dateien: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        blaetter.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets>' +
        namen.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets>${filter ? `<definedNames>${filter}</definedNames>` : ''}</workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', STYLES],
    ...blaetter.map((b, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, blattXml(b)]),
  ];
  const eintraege = dateien.map(([name, inhalt]) => {
    const daten = Buffer.from(inhalt, 'utf8');
    return {
      name,
      groesse: daten.length,
      oeffnen: async function* () {
        yield daten;
      },
    };
  });
  const teile: Buffer[] = [];
  for await (const t of zipErstellen(eintraege, jetzt)) teile.push(Buffer.from(t));
  return Buffer.concat(teile);
}

