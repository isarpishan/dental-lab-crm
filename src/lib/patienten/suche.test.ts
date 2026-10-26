import { describe, expect, it } from 'vitest';
import { dateiPruefen, dateinameBereinigen, groesseText } from '@/lib/dateien/regeln';
import { gleicherName, passt, patientenCode } from './suche';

const max = { vorname: 'Max', nachname: 'Müller-Lüdenscheidt', code: 'P-7K3Q' };

describe('Patienten', () => {
  it('Code: »P-« und vier eindeutige Zeichen', () => {
    for (let i = 0; i < 200; i++) expect(patientenCode()).toMatch(/^P-[2-9A-HJKMNP-Z]{4}$/);
    expect(patientenCode(() => 0)).toBe('P-2222');
  });

  it('Suche nach Namensanfängen, ohne Umlaute und Groß-/Kleinschreibung', () => {
    expect(passt('max', max)).toBe(true);
    expect(passt('mul', max)).toBe(true);
    expect(passt('lüd max', max)).toBe(true);
    expect(passt('ax', max)).toBe(false);
    expect(passt('', max)).toBe(true);
  });

  it('Suche nach Code', () => {
    expect(passt('7k3', max)).toBe(true);
    expect(passt('P-7K3Q', max)).toBe(true);
    expect(passt('7k3q', max)).toBe(true);
    // ein Buchstabe aus dem Code ist kein Treffer
    expect(passt('k', { ...max, vorname: 'Anna', nachname: 'Berg' })).toBe(false);
  });

  it('gleicher Name trotz Schreibweise', () => {
    expect(gleicherName({ vorname: ' max', nachname: 'Mueller' }, { vorname: 'Max', nachname: 'mueller' })).toBe(true);
    expect(gleicherName({ vorname: 'Max', nachname: 'Strauß' }, { vorname: 'max', nachname: 'Strauss' })).toBe(true);
    expect(gleicherName({ vorname: 'Max', nachname: 'Müller' }, { vorname: 'Moritz', nachname: 'Müller' })).toBe(false);
  });
});

describe('Dateien', () => {
  const MB = 1024 * 1024;
  it('nimmt Scans, Fotos und PDF an', () => {
    expect(dateiPruefen('Oberkiefer.STL', 5 * MB, 300 * MB)).toMatchObject({ ok: true, art: 'scan', mime: 'model/stl' });
    expect(dateiPruefen('foto.heic', MB, 300 * MB)).toMatchObject({ ok: true, art: 'foto' });
    expect(dateiPruefen('befund.pdf', MB, 300 * MB)).toMatchObject({ ok: true, art: 'dokument' });
  });

  it('lehnt andere Formate, leere und zu große Dateien ab', () => {
    expect(dateiPruefen('setup.exe', MB, 300 * MB).ok).toBe(false);
    expect(dateiPruefen('bild.svg', MB, 300 * MB).ok).toBe(false);
    expect(dateiPruefen('ohne-endung', MB, 300 * MB).ok).toBe(false);
    expect(dateiPruefen('leer.stl', 0, 300 * MB).ok).toBe(false);
    expect(dateiPruefen('gross.zip', 301 * MB, 300 * MB)).toEqual({ ok: false, fehler: 'Die Datei ist größer als 300 MB.' });
  });

  it('bereinigt Dateinamen', () => {
    expect(dateinameBereinigen('C:\\Scans\\OK.stl')).toBe('OK.stl');
    expect(dateinameBereinigen('../../etc/passwd.stl')).toBe('passwd.stl');
    expect(dateinameBereinigen('a\u0000b.stl')).toBe('ab.stl');
    expect(dateinameBereinigen(`${'x'.repeat(300)}.stl`)).toHaveLength(195);
  });

  it('Größe auf Österreichisch', () => {
    expect(groesseText(12.4 * MB)).toBe('12,4 MB');
    expect(groesseText(512)).toBe('512 B');
  });
});
