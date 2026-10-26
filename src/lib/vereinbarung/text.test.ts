import { describe, expect, it } from 'vitest';
import { adresseZeile, klartext, pruefsumme, VEREINBARUNG_VERSION, vereinbarungInhalt } from './text';

const labor = { name: 'Digital Dental Lab', zusatz: 'Labor', adresse: 'Musterstraße 1, 1200 Wien, Österreich' };
const praxis = { name: 'Ordination Dr. Test', adresse: 'Testgasse 2, 1010 Wien' };

describe('Vereinbarung', () => {
  it('nennt beide Parteien und die Version', () => {
    const text = klartext(vereinbarungInhalt(labor, praxis));
    expect(text).toContain('Digital Dental Lab, Labor, Musterstraße 1, 1200 Wien, Österreich – im Folgenden „DDL“');
    expect(text).toContain('Ordination Dr. Test, Testgasse 2, 1010 Wien – im Folgenden „Ordination“');
    expect(text).toContain(`Version ${VEREINBARUNG_VERSION}`);
  });

  it('Prüfsumme ist stabil und hängt an den Parteien', () => {
    const a = pruefsumme(vereinbarungInhalt(labor, praxis));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pruefsumme(vereinbarungInhalt(labor, praxis))).toBe(a);
    expect(pruefsumme(vereinbarungInhalt(labor, { ...praxis, name: 'Andere Ordination' }))).not.toBe(a);
  });

  it('Prüfsumme bleibt nach dem Speichern als JSON gleich', () => {
    const inhalt = vereinbarungInhalt(labor, praxis);
    expect(pruefsumme(JSON.parse(JSON.stringify(inhalt)))).toBe(pruefsumme(inhalt));
  });

  it('enthält die Pflichtinhalte nach Art. 28 Abs. 3 DSGVO', () => {
    const text = klartext(vereinbarungInhalt(labor, praxis));
    for (const stichwort of ['dokumentierte Weisung', 'Verschwiegenheit', 'Art. 32', 'Unterauftragsverarbeiter', 'Löschung oder Rückgabe', 'Kontrollen', 'Art. 32 bis 36']) {
      expect(text).toContain(stichwort);
    }
  });

  it('Adresszeile lässt leere Teile weg', () => {
    expect(adresseZeile(['Gasse 1', null, ' ', '1010 Wien'])).toBe('Gasse 1, 1010 Wien');
  });
});
