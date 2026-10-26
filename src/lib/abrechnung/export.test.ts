import { describe, expect, it } from 'vitest';
import { excelDatum, spaltenName, xlsxErstellen } from './excel';
import { zeitraumFehler, zeitraumVorlagen } from './zeitraum';

describe('Excel-Datei', () => {
  it('Spaltennamen wie in Excel', () => {
    expect([0, 25, 26, 51, 701, 702].map(spaltenName)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
  });

  it('Datum als Excel-Zahl; Uhrzeit nach Wiener Zeit', () => {
    expect(excelDatum('1900-03-01')).toBe(61);
    expect(excelDatum('2026-01-01')).toBe(46023);
    expect(excelDatum('2026-10-04')).toBe(46299);
    // 06:30 UTC = 08:30 in Wien (Sommerzeit)
    expect(excelDatum(new Date('2026-10-04T06:30:00Z'))).toBeCloseTo(46299 + 8.5 / 24, 6);
  });

  it('Aufbau: Blätter, Text als Inline-Text (nie Formel), Beträge in Euro, Filter', async () => {
    const datei = await xlsxErstellen([
      {
        name: 'Rechnungen',
        filter: true,
        spalten: [
          { titel: 'Nummer', art: 'text' },
          { titel: 'Datum', art: 'datum' },
          { titel: 'Betrag', art: 'geld' },
        ],
        zeilen: [
          ['R-2026-0001', '2026-10-04', 123450],
          ['=HYPERLINK("x") & <Test>', null, -3000],
        ],
      },
      { name: 'Über/sicht?', spalten: [{ titel: 'Angabe', art: 'text' }], zeilen: [] },
    ]);
    // ZIP ohne Kompression: der XML-Text steht lesbar in der Datei
    const t = datei.toString('utf8');
    expect(datei.subarray(0, 2).toString()).toBe('PK');
    for (const teil of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) expect(t).toContain(teil);
    expect(t).toContain('<sheet name="Rechnungen" sheetId="1" r:id="rId1"/>');
    expect(t).toContain('<sheet name="Über sicht " sheetId="2" r:id="rId2"/>');
    expect(t).toContain('<c r="B2" s="2"><v>46299</v></c>');
    expect(t).toContain('<c r="C2" s="3"><v>1234.5</v></c>');
    expect(t).toContain('<c r="C3" s="3"><v>-30</v></c>');
    expect(t).toContain('<t xml:space="preserve">=HYPERLINK(&quot;x&quot;) &amp; &lt;Test&gt;</t>');
    expect(t).not.toContain('<f>');
    expect(t).toContain('<autoFilter ref="A1:C3"/>');
    expect(t).toContain("'Rechnungen'!$A$1:$C$3");
  });
});

describe('Zeiträume für den Export', () => {
  it('Vormonat, Vorquartal, laufendes Jahr, Vorjahr', () => {
    expect(zeitraumVorlagen('2026-10-04')).toEqual([
      { name: 'September 2026', von: '2026-09-01', bis: '2026-09-30' },
      { name: '3. Quartal 2026', von: '2026-07-01', bis: '2026-09-30' },
      { name: '2026 bis heute', von: '2026-01-01', bis: '2026-10-04' },
      { name: '2025', von: '2025-01-01', bis: '2025-12-31' },
    ]);
  });

  it('am Jahresanfang: Dezember und 4. Quartal des Vorjahres', () => {
    const [monat, quartal] = zeitraumVorlagen('2026-01-15');
    expect(monat).toEqual({ name: 'Dezember 2025', von: '2025-12-01', bis: '2025-12-31' });
    expect(quartal).toEqual({ name: '4. Quartal 2025', von: '2025-10-01', bis: '2025-12-31' });
    expect(zeitraumVorlagen('2026-02-10')[0].name).toBe('Jänner 2026');
  });

  it('Prüfung', () => {
    expect(zeitraumFehler('2026-09-01', '2026-09-30')).toBeNull();
    expect(zeitraumFehler('2026-09-30', '2026-09-01')).toMatch(/nach dem Bis-Datum/);
    expect(zeitraumFehler('2026-02-30', '2026-03-01')).toMatch(/gültiges/);
    expect(zeitraumFehler('', '2026-03-01')).toMatch(/gültiges/);
    expect(zeitraumFehler('2023-01-01', '2026-01-01')).toMatch(/zwei Jahre/);
  });
});
