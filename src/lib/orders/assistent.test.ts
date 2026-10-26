import { describe, expect, it } from 'vitest';
import { ausStammdaten } from '@/lib/katalog/auswahl';
import { tempoRang, zuschlagText } from '@/lib/katalog/tempo';
import { BEHANDLUNGEN } from '@/lib/katalog/stammdaten';
import { blockFehler, blockText, implantatPositionen, kieferImAuftrag, sichtbareBloecke } from './assistent';
import { brueckeAnlegen, einzelUmschalten } from './bridge';
import { formSchemaSchema, type Block } from './form-schema';
import { anwenden } from './prothese';

const schema = (key: string) => formSchemaSchema.parse(BEHANDLUNGEN.find((b) => b.key === key)!.formSchema);
const block = (key: string, id: string) => schema(key).bloecke.find((b) => b.id === id)!;

describe('Neuer Auftrag: Schritte', () => {
  it('Gaumenabdeckung nur, wenn der Oberkiefer betroffen ist', () => {
    const s = schema('teilprothese');
    const ids = (a: Record<string, unknown>) => sichtbareBloecke(s, a).map((b) => b.id);
    expect(ids({})).not.toContain('gaumen');
    expect(ids({ zaehne: anwenden({}, 36, 'ersatzzahn') })).not.toContain('gaumen');
    expect(ids({ zaehne: anwenden({}, 12, 'ersatzzahn') })).toContain('gaumen');
  });

  it('erkennt Kiefer aus Zahnleiste und Kiefer-Auswahl', () => {
    const bloecke: Block[] = [
      { typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['krone'] },
      { typ: 'kiefer', id: 'kiefer', pflicht: true, label: 'Kiefer' },
    ];
    expect(kieferImAuftrag(bloecke, { zaehne: einzelUmschalten({}, 46, 'krone') })).toEqual(['UK']);
    expect(kieferImAuftrag(bloecke, { kiefer: 'beide' })).toEqual(['OK', 'UK']);
  });

  it('jede Zahnleiste hat nur die Werkzeuge ihrer Behandlung', () => {
    expect(block('krone', 'zaehne')).toMatchObject({ werkzeuge: ['krone'] });
    expect(block('bruecke', 'zaehne')).toMatchObject({ werkzeuge: ['bruecke'] });
    expect(block('inlay', 'zaehne')).toMatchObject({ werkzeuge: ['inlay'] });
  });
});

describe('Neuer Auftrag: vollständige Antworten', () => {
  it('Zähne: mindestens einer', () => {
    const b = block('krone', 'zaehne');
    expect(blockFehler(b, undefined)).toMatch(/Zahn/);
    expect(blockFehler(b, einzelUmschalten({}, 16, 'krone'))).toBeNull();
  });

  it('Teilprothese braucht einen ersetzten Zahn; nur Klammern reichen nicht', () => {
    const b = block('teilprothese', 'zaehne');
    expect(blockFehler(b, anwenden({}, 13, 'klammer'))).toMatch(/Ersatzzahn/);
    expect(blockFehler(b, anwenden({}, 12, 'extraktion'))).toBeNull();
  });

  it('Auswahl nur mit gültiger Option; optionale Schritte dürfen leer bleiben', () => {
    expect(blockFehler(block('teilprothese', 'prothesenform'), 'flipper')).toBeNull();
    expect(blockFehler(block('teilprothese', 'prothesenform'), 'zirkon')).not.toBeNull();
    expect(blockFehler(block('teilprothese', 'gaumen'), undefined)).toBeNull();
    expect(blockFehler(block('teilprothese', 'einprobe'), false)).toBeNull();
  });

  it('Zahnfarbe: Farbe aus dem gewählten System oder »Farbe folgt«', () => {
    const b = block('krone', 'farbe');
    expect(blockFehler(b, { system: 'vita_classical' })).not.toBeNull();
    expect(blockFehler(b, { system: 'vita_classical', farbe: 'A3.5' })).toBeNull();
    expect(blockFehler(b, { system: 'vita_3d_master', farbe: 'A2' })).not.toBeNull();
    expect(blockFehler(b, { system: 'folgt' })).toBeNull();
  });

  it('Implantat: Hersteller (oder »Andere« mit Namen) und System', () => {
    const b = block('implantatkrone', 'implantat');
    expect(blockFehler(b, { hersteller: 'Straumann' })).toMatch(/Plattform/);
    expect(blockFehler(b, { hersteller: 'andere', system: 'X' })).toMatch(/hersteller/);
    expect(blockFehler(b, { hersteller: 'Straumann', system: 'BLT RC' })).toBeNull();
  });

  it('Smile Design: Ästhetik ist Pflicht, bei Veneer nicht', () => {
    expect(blockFehler(block('smile_design', 'aesthetik'), {})).not.toBeNull();
    expect(blockFehler(block('smile_design', 'aesthetik'), { merkmale: ['Länge'] })).toBeNull();
    expect(blockFehler(block('veneer', 'aesthetik'), {})).toBeNull();
  });
});

describe('Neuer Auftrag: Texte', () => {
  it('fasst Antworten in einer Zeile zusammen', () => {
    expect(blockText(block('bruecke', 'zaehne'), brueckeAnlegen({}, 14, 16))).toBe('Brücke 16–14: Anker 16, 14 · Glied 15');
    expect(blockText(block('krone', 'farbe'), { system: 'vita_classical', farbe: 'A3.5', farbanpassung: true })).toBe(
      'VITA classical A3,5 · Individuelle Farbanpassung',
    );
    expect(blockText(block('totalprothese', 'kiefer'), 'beide')).toBe('Ober- und Unterkiefer');
    expect(blockText(block('implantatkrone', 'implantat'), { hersteller: 'Camlog', system: 'Conelog', scanbodyTyp: 'SB-1' })).toBe(
      'Camlog · Conelog · Scanbody SB-1',
    );
  });

  it('liest Implantatpositionen aus der Zahnleiste', () => {
    const s = schema('implantatkrone');
    const zaehne = einzelUmschalten(einzelUmschalten({}, 46, 'implantatkrone'), 36, 'implantatkrone');
    expect(implantatPositionen(s.bloecke, { zaehne })).toEqual([46, 36]);
  });
});

describe('Neuer Auftrag: Standard, Express und Same-Day', () => {
  it('Same-Day nur bei Krone und Inlay/Onlay, mit Kennzeichnung auf der Kachel', () => {
    const k = ausStammdaten();
    const mitSameDay = k.behandlungen.filter((b) => b.tempi.includes('same_day')).map((b) => b.key);
    expect(mitSameDay).toEqual(['krone', 'inlay']);
    for (const b of k.behandlungen) expect(b.tags.includes('Same-Day möglich')).toBe(mitSameDay.includes(b.key));
    // die Standardzeit ist nicht mehr »Same Day möglich«
    expect(k.behandlungen.find((b) => b.key === 'krone')!.bearbeitungszeit).toBe('nach Prüfung');
  });

  it('Express < 24 Stunden für alle außer Prothesen; Prothesen nur Standard (ca. 2 Wochen)', () => {
    for (const b of ausStammdaten().behandlungen) {
      expect(b.tempi.includes('express')).toBe(b.groupKey !== 'prothese');
      expect(b.tempi[0]).toBe('standard');
      if (b.groupKey === 'prothese') expect(b.bearbeitungszeit).toBe('ca. 2 Wochen');
    }
  });

  it('Expresszuschlag und Same-Day-Zuschlag getrennt, Platzhalter bis der Betrag in den Stammdaten steht', () => {
    expect(zuschlagText('express', { betrag: null, einheit: 'Auftrag' })).toBe('Expresszuschlag nach Prüfung');
    expect(zuschlagText('express', { betrag: 40, einheit: 'Auftrag' })).toMatch(/^Expresszuschlag €\s40 pro Auftrag$/);
    expect(zuschlagText('same_day', { betrag: 60, einheit: 'Zahn' })).toMatch(/^Same-Day-Zuschlag €\s60 pro Zahn$/);
    const krone = ausStammdaten().behandlungen.find((b) => b.key === 'krone')!;
    expect(krone.zuschlaege).toEqual({ express: 'Expresszuschlag nach Prüfung', same_day: 'Same-Day-Zuschlag nach Prüfung' });
  });

  it('Reihenfolge: Same-Day vor Express vor Standard', () => {
    expect(['standard', 'same_day', 'express', null].sort((a, b) => tempoRang(b as never) - tempoRang(a as never))).toEqual(['same_day', 'express', 'standard', null]);
  });

  it('keine Frage nach dem Material: das Labor arbeitet mit festen Materialien', () => {
    for (const b of BEHANDLUNGEN) expect(b.formSchema.bloecke.map((x) => x.typ as string)).not.toContain('material');
  });
});
