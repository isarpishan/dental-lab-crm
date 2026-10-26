import { describe, expect, it } from 'vitest';
import { formSchemaSchema } from '@/lib/orders/form-schema';
import { HOCHGELADEN, bildUrl } from './auswahl';
import { behandlungsSchluessel, bildTyp, formularUebersicht, schluesselAus } from './neu';
import { BEHANDLUNGEN } from './stammdaten';

describe('Neue Behandlung', () => {
  it('macht Schlüssel aus dem Namen', () => {
    expect(schluesselAus('Individueller Löffel')).toBe('individueller_loeffel');
    expect(schluesselAus('  Klebetray (IDB) ')).toBe('klebetray_idb');
    const vorhanden = new Set(BEHANDLUNGEN.map((b) => b.key));
    expect(behandlungsSchluessel('Modell', vorhanden)).toBe('modell_2');
    expect(behandlungsSchluessel('Modell', new Set([...vorhanden, 'modell_2']))).toBe('modell_3');
    expect(behandlungsSchluessel('Kiefermodell', vorhanden)).toBe('kiefermodell');
    expect(behandlungsSchluessel('3D-Modell', vorhanden)).toBe('b_3d_modell');
    expect(behandlungsSchluessel('x'.repeat(80), vorhanden)).toHaveLength(40);
  });
  it('erkennt Bilder am Inhalt, nicht am Namen', () => {
    expect(bildTyp(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(bildTyp(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(bildTyp(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(bildTyp(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(bildTyp(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
  });
  it('fasst das Auftragsformular einer Vorlage zusammen', () => {
    const modell = BEHANDLUNGEN.find((b) => b.key === 'modell')!;
    expect(formularUebersicht(formSchemaSchema.parse(modell.formSchema), modell.requiredFiles)).toEqual({
      fragen: ['Kiefer', 'Hinweise'],
      dateien: ['Oberkiefer-Scan', 'Unterkiefer-Scan', 'Bissregistrierung'],
    });
    const krone = BEHANDLUNGEN.find((b) => b.key === 'krone')!;
    expect(formularUebersicht(formSchemaSchema.parse(krone.formSchema), krone.requiredFiles).fragen).toEqual(['Zähne im Zahnschema', 'Versorgung', 'Zahnfarbe']);
  });
  it('Bildadresse: Website-Bild oder hochgeladenes Bild', () => {
    expect(bildUrl('modell.webp')).toBe('/bilder/auswahl/modell.webp');
    expect(bildUrl(`${HOCHGELADEN}0f8fad5b-d9cb-469f-a165-70867728950e`)).toBe('/api/behandlungsbilder/0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(bildUrl(null)).toBeNull();
  });
});
