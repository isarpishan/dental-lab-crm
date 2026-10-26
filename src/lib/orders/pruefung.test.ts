import { describe, expect, it } from 'vitest';
import { ausStammdaten } from '@/lib/katalog/auswahl';
import { brueckeAnlegen } from './bridge';
import { auftragPruefen, entwurfSchema, farbeKurz, LEERER_PLAN, zaehneAus, type EntwurfDaten } from './pruefung';

const katalog = ausStammdaten();
const eintrag = (key: string) => katalog.behandlungen.find((b) => b.key === key)!;
const optionen = { dateiPlaetze: ['ok', 'uk', 'biss'], patientGewaehlt: true, behandlerNoetig: false, heute: '2026-10-01' };

const bruecke: EntwurfDaten = {
  auswahl: 'bruecke',
  behandlung: 'bruecke',
  antworten: {
    zaehne: brueckeAnlegen({}, 14, 16),
    versorgung: 'definitiv',
    farbe: { system: 'vita_classical', farbe: 'A3.5' },
  },
  bestaetigt: {},
  lieferart: 'fertigung',
  tempo: 'standard',
  nachgereicht: false,
  plan: LEERER_PLAN,
};

describe('auftragPruefen', () => {
  it('eine vollständige Brücke 14–16 ist in Ordnung', () => {
    const p = auftragPruefen(eintrag('bruecke'), bruecke, optionen);
    expect(p.fehler).toEqual([]);
    expect(p.lieferart).toBe('fertigung');
    expect(Object.keys(p.config).sort()).toEqual(['farbe', 'versorgung', 'zaehne']);
  });

  it('meldet fehlende Behandlung und fehlenden Patienten', () => {
    const p = auftragPruefen(null, { ...bruecke, behandlung: null }, { ...optionen, patientGewaehlt: false });
    expect(p.fehler.map((f) => f.schritt)).toEqual(['patient', 'behandlung']);
  });

  it('fehlende Pflichtdateien nur mit »nachgereicht«', () => {
    const ohneBiss = { ...optionen, dateiPlaetze: ['ok', 'uk'] };
    const p = auftragPruefen(eintrag('bruecke'), bruecke, ohneBiss);
    expect(p.fehler).toEqual([{ schritt: 'dateien', text: expect.stringContaining('Bissregistrierung') }]);
    const q = auftragPruefen(eintrag('bruecke'), { ...bruecke, nachgereicht: true }, ohneBiss);
    expect(q.fehler).toEqual([]);
    expect(q.fehlendeDateien).toEqual(['biss']);
  });

  it('lehnt Werkzeuge ab, die diese Behandlung nicht hat', () => {
    const p = auftragPruefen(eintrag('bruecke'), { ...bruecke, antworten: { ...bruecke.antworten, zaehne: { 16: { art: 'krone' } } } }, optionen);
    expect(p.fehler.map((f) => f.schritt)).toEqual(['b-zaehne']);
  });

  it('lehnt unbekannte Optionen und fremde Felder ab', () => {
    const a = auftragPruefen(eintrag('bruecke'), { ...bruecke, antworten: { ...bruecke.antworten, versorgung: 'gold' } }, optionen);
    expect(a.fehler.map((f) => f.schritt)).toEqual(['b-versorgung']);
    const b = auftragPruefen(
      eintrag('bruecke'),
      { ...bruecke, antworten: { ...bruecke.antworten, farbe: { system: 'folgt', script: '<x>' } } },
      optionen,
    );
    expect(b.fehler.map((f) => f.schritt)).toEqual(['b-farbe']);
  });

  it('übernimmt nur Antworten sichtbarer Blöcke', () => {
    const teil: EntwurfDaten = {
      ...bruecke,
      auswahl: 'prothese',
      behandlung: 'teilprothese',
      antworten: {
        zaehne: { 36: { zahn: 'ersatzzahn' }, 35: { klammer: true } },
        prothesenform: 'flipper',
        klammern: 'mit',
        gaumen: 'hufeisen', // nur für OK – hier nur UK
        farbe: { system: 'folgt' },
        unbekannt: 'x',
      },
    };
    const p = auftragPruefen(eintrag('teilprothese'), teil, optionen);
    expect(p.fehler).toEqual([]);
    expect(Object.keys(p.config).sort()).toEqual(['farbe', 'klammern', 'prothesenform', 'zaehne']);
  });

  it('Lieferart wird übernommen, wenn es nur eine gibt', () => {
    const smile: EntwurfDaten = {
      ...bruecke,
      auswahl: 'smile_design',
      behandlung: 'smile_design',
      lieferart: null,
      antworten: { zaehne: { 11: { art: 'veneer' } }, aesthetik: { merkmale: ['Länge'] }, farbe: { system: 'folgt' } },
    };
    const p = auftragPruefen(eintrag('smile_design'), smile, { ...optionen, dateiPlaetze: ['ok', 'uk', 'biss', 'fotos'] });
    expect(p.fehler).toEqual([]);
    expect(p.lieferart).toBe('design');
  });

  it('Behandler und Wunschtermin', () => {
    const p = auftragPruefen(eintrag('bruecke'), { ...bruecke, plan: { ...LEERER_PLAN, wunschtermin: '2026-09-30' } }, { ...optionen, behandlerNoetig: true });
    expect(p.fehler.map((f) => f.text)).toEqual(['Bitte die Behandlerin oder den Behandler wählen.', 'Der Wunschtermin liegt in der Vergangenheit.']);
  });

  it('Tempo muss gewählt sein', () => {
    const p = auftragPruefen(eintrag('bruecke'), { ...bruecke, tempo: null }, optionen);
    expect(p.fehler.map((f) => f.schritt)).toEqual(['tempo']);
  });

  it('Same-Day nur, wo die Behandlung es anbietet', () => {
    expect(auftragPruefen(eintrag('bruecke'), { ...bruecke, tempo: 'express' }, optionen).fehler).toEqual([]);
    const p = auftragPruefen(eintrag('bruecke'), { ...bruecke, tempo: 'same_day' }, optionen);
    expect(p.fehler).toEqual([{ schritt: 'tempo', text: 'Same-Day ist für diese Behandlung nicht möglich. Bitte ein anderes Tempo wählen.' }]);
  });
});

describe('abgeleitete Werte', () => {
  it('Zähne einer Brücke mit Anker und Glied', () => {
    const p = auftragPruefen(eintrag('bruecke'), bruecke, optionen);
    expect(zaehneAus(eintrag('bruecke').formSchema.bloecke, p.config)).toEqual([
      { fdi: 14, treatment: 'bruecke_anker', spanId: 'b16-14' },
      { fdi: 15, treatment: 'bruecke_glied', spanId: 'b16-14' },
      { fdi: 16, treatment: 'bruecke_anker', spanId: 'b16-14' },
    ]);
    expect(farbeKurz(eintrag('bruecke').formSchema.bloecke, p.config)).toBe('A3,5');
  });

  it('Zähne einer Teilprothese', () => {
    const config = { zaehne: { 36: { zahn: 'ersatzzahn' }, 46: { zahn: 'extraktion' }, 35: { klammer: true }, 44: { basis: true } } };
    expect(zaehneAus(eintrag('teilprothese').formSchema.bloecke, config)).toEqual([
      { fdi: 35, treatment: 'klammer', spanId: null },
      { fdi: 36, treatment: 'ersatzzahn', spanId: null },
      { fdi: 44, treatment: 'basis', spanId: null },
      { fdi: 46, treatment: 'extraktion', spanId: null },
    ]);
  });

  it('Entwurf-Schema begrenzt die Größe', () => {
    const gross = { ...bruecke, antworten: { text: 'x'.repeat(60_000) } };
    expect(entwurfSchema.safeParse(gross).success).toBe(false);
    expect(entwurfSchema.safeParse(bruecke).success).toBe(true);
  });
});
