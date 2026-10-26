import { Document, Font, Page, Path, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import { datum, datumZeit } from '@/lib/format';
import { istEilig, TEMPO_KURZ } from '@/lib/katalog/tempo';
import type { LaufzettelDaten, ZahnMarke } from '@/lib/produktion/laufzettel';
import { pdfText as t } from './text';

/**
 * Laufzettel A4 (Spec فاز ۱، بخش H): همراه کار در کارگاه. سیاه‌وسفید برای چاپگر کارگاه، Helvetica پایهٔ
 * PDF (بدون فایل قلم). فقط کد بیمار. QR به صفحهٔ «Schritt erledigt» روی تبلت می‌رود.
 */

// keine Silbentrennung: Namen, Nummern und Codes bleiben ganz («Produk-tion» wäre falsch)
Font.registerHyphenationCallback((wort) => [wort]);

const SCHWARZ = '#050505';
const GRAU = '#5c5c5c';
const LINIE = '#cfcac3';
const FLAECHE = '#e9e6e1';

const s = StyleSheet.create({
  // lineHeight je Text: als Zahl gilt sie sonst für die Schriftgröße der Seite, nicht des Textes
  seite: { paddingTop: 34, paddingBottom: 52, paddingHorizontal: 40, fontFamily: 'Helvetica', fontSize: 10, color: SCHWARZ },
  kopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: SCHWARZ },
  marke: { fontSize: 7.5, letterSpacing: 1.2, color: GRAU },
  nummer: { fontSize: 28, lineHeight: 1.15, marginTop: 8, letterSpacing: 0.3 },
  behandlung: { fontSize: 15, lineHeight: 1.25, marginTop: 4 },
  tempo: { marginTop: 8, alignSelf: 'flex-start', borderWidth: 1.2, borderColor: SCHWARZ, paddingVertical: 2, paddingHorizontal: 7, fontSize: 9, letterSpacing: 1.2 },
  // Same-Day auf Papier deutlich anders als Express: schwarz gefüllt
  sameDay: { backgroundColor: SCHWARZ, color: '#ffffff' },
  qrKasten: { alignItems: 'center', width: 96 },
  qrText: { fontSize: 6.5, color: GRAU, marginTop: 4, textAlign: 'center' },
  raster: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  feld: { width: '25%', paddingVertical: 4, paddingRight: 10, borderBottomWidth: 0.6, borderBottomColor: LINIE },
  etikett: { fontSize: 6.5, letterSpacing: 0.9, color: GRAU, textTransform: 'uppercase' },
  wert: { fontSize: 10.5, lineHeight: 1.3, marginTop: 1.5 },
  abschnitt: { marginTop: 13 },
  titel: { fontSize: 7.5, letterSpacing: 1.1, color: GRAU, textTransform: 'uppercase', marginBottom: 5 },
  zahnReihe: { flexDirection: 'row' },
  zahn: { width: 25.5, height: 16, borderWidth: 0.6, borderColor: LINIE, marginRight: -0.6, marginBottom: -0.6, alignItems: 'center', justifyContent: 'center' },
  zahnZahl: { fontSize: 7.5 },
  mitte: { width: 6 },
  zeile: { flexDirection: 'row', paddingVertical: 2.5, borderBottomWidth: 0.6, borderBottomColor: LINIE },
  zeileTitel: { width: 110, color: GRAU, fontSize: 9 },
  zeileWert: { flex: 1, fontSize: 9.5, lineHeight: 1.3 },
  tabKopf: { flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: SCHWARZ },
  tabZeile: { flexDirection: 'row', minHeight: 21, alignItems: 'center', borderBottomWidth: 0.6, borderBottomColor: LINIE },
  sNr: { width: 22, fontSize: 8, color: GRAU },
  sName: { flex: 1.5, fontSize: 10 },
  sAm: { flex: 1.1, fontSize: 8.5 },
  sGeraet: { flex: 1.3, fontSize: 8.5 },
  sZeichen: { width: 64, fontSize: 8.5 },
  kasten: { width: 9, height: 9, borderWidth: 0.8, borderColor: SCHWARZ, marginRight: 6 },
  fuss: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: GRAU, borderTopWidth: 0.6, borderTopColor: LINIE, paddingTop: 6 },
});

const OBEN = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const UNTEN = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

function Feld({ etikett, wert }: { etikett: string; wert: string | null }) {
  return (
    <View style={s.feld}>
      <Text style={s.etikett}>{t(etikett)}</Text>
      <Text style={s.wert}>{t(wert || '–')}</Text>
    </View>
  );
}

function Zahn({ fdi, marke }: { fdi: number; marke: ZahnMarke | undefined }) {
  const hintergrund = marke === 'voll' ? SCHWARZ : marke === 'teil' ? FLAECHE : undefined;
  return (
    <View style={[s.zahn, hintergrund ? { backgroundColor: hintergrund } : {}]}>
      <Text style={[s.zahnZahl, { color: marke === 'voll' ? '#ffffff' : SCHWARZ }]}>{marke === 'extraktion' ? `${fdi} ×` : String(fdi)}</Text>
    </View>
  );
}

function Zahnreihe({ zaehne, marken }: { zaehne: number[]; marken: Map<number, ZahnMarke> }) {
  return (
    <View style={s.zahnReihe}>
      {zaehne.slice(0, 8).map((f) => (
        <Zahn key={f} fdi={f} marke={marken.get(f)} />
      ))}
      <View style={s.mitte} />
      {zaehne.slice(8).map((f) => (
        <Zahn key={f} fdi={f} marke={marken.get(f)} />
      ))}
    </View>
  );
}

export function LaufzettelPdf({ d, gedruckt }: { d: LaufzettelDaten; gedruckt: Date }) {
  const qrMass = 84;
  return (
    <Document title={`Laufzettel ${d.orderNo}`} author="Digital Dental Lab" creator="DDL Laborsystem" producer="DDL Laborsystem" language="de-AT">
      <Page size="A4" style={s.seite}>
        <View style={s.kopf}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={s.marke}>DIGITAL DENTAL LAB · LAUFZETTEL</Text>
            <Text style={s.nummer}>{d.orderNo}</Text>
            <Text style={s.behandlung}>{t([d.behandlung, d.zaehneText].filter(Boolean).join(' · '))}</Text>
            {istEilig(d.tempo) ? <Text style={d.tempo === 'same_day' ? [s.tempo, s.sameDay] : s.tempo}>{TEMPO_KURZ[d.tempo].toUpperCase()}</Text> : null}
          </View>
          <View style={s.qrKasten}>
            <Svg width={qrMass} height={qrMass} viewBox={`-2 -2 ${d.qr.groesse + 4} ${d.qr.groesse + 4}`}>
              <Path d={d.qr.pfad} fill={SCHWARZ} />
            </Svg>
            <Text style={s.qrText}>Scannen: Schritt erledigt</Text>
          </View>
        </View>

        <View style={s.raster}>
          <Feld etikett="Patienten-ID" wert={d.patientCode} />
          <Feld etikett="Ordination" wert={d.praxis} />
          <Feld etikett="Behandler" wert={d.behandler} />
          <Feld etikett="Lieferart" wert={d.lieferart} />
          <Feld etikett="Zahnfarbe" wert={d.farbe} />
          <Feld etikett="Termin" wert={d.termin} />
          <Feld etikett="Eingereicht" wert={d.eingereicht ? datum(d.eingereicht) : null} />
          <Feld etikett="Zuständig" wert={d.zustaendig} />
          <View style={[s.feld, { width: '100%' }]}>
            <Text style={s.etikett}>Material und Charge</Text>
            <Text style={s.wert}>{t(d.material.length ? d.material.join(' · ') : '____________________')}</Text>
          </View>
        </View>

        {d.zaehne.size ? (
          <View style={s.abschnitt} wrap={false}>
            <Text style={s.titel}>Zahnschema</Text>
            <Zahnreihe zaehne={OBEN} marken={d.zaehne} />
            <Zahnreihe zaehne={UNTEN} marken={d.zaehne} />
            <Text style={{ fontSize: 7, color: GRAU, marginTop: 5 }}>Schwarz: Versorgung · Grau: Basis/Klammer · ×: Extraktion</Text>
          </View>
        ) : null}

        {d.auswahl.length ? (
          <View style={s.abschnitt}>
            <Text style={s.titel}>Auftrag</Text>
            {d.auswahl.map((a, i) => (
              <View key={i} style={s.zeile} wrap={false}>
                <Text style={s.zeileTitel}>{t(a.titel)}</Text>
                <Text style={s.zeileWert}>{t(a.wert)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {d.hinweise ? (
          <View style={s.abschnitt}>
            <Text style={s.titel}>Hinweise der Ordination</Text>
            <Text style={{ fontSize: 9.5, lineHeight: 1.3 }}>{t(d.hinweise.slice(0, 1500))}</Text>
          </View>
        ) : null}

        <View style={s.abschnitt}>
          <Text style={s.titel}>Arbeitsschritte</Text>
          <View style={s.tabKopf}>
            <Text style={s.sNr}>Nr.</Text>
            <Text style={[s.sName, { fontSize: 7.5, color: GRAU }]}>SCHRITT</Text>
            <Text style={[s.sAm, { fontSize: 7.5, color: GRAU }]}>ERLEDIGT AM</Text>
            <Text style={[s.sGeraet, { fontSize: 7.5, color: GRAU }]}>GERÄT / CHARGE</Text>
            <Text style={[s.sZeichen, { fontSize: 7.5, color: GRAU }]}>ZEICHEN</Text>
          </View>
          {d.schritte.map((z, i) => (
            <View key={z.key} style={s.tabZeile} wrap={false}>
              <Text style={s.sNr}>{String(i + 1).padStart(2, '0')}</Text>
              <View style={[s.sName, { flexDirection: 'row', alignItems: 'center' }]}>
                <View style={[s.kasten, z.zustand === 'erledigt' ? { backgroundColor: SCHWARZ } : {}]} />
                <Text>{t(z.label)}</Text>
              </View>
              <Text style={s.sAm}>{z.zustand === 'erledigt' && z.am ? t(datumZeit(z.am)) : z.zustand === 'aktuell' ? 'aktuell' : ''}</Text>
              <Text style={s.sGeraet}>{t(z.geraet ?? '')}</Text>
              <Text style={s.sZeichen}>{t(z.zustand === 'erledigt' ? (z.kurz ?? '') : '')}</Text>
            </View>
          ))}
        </View>

        <View style={s.fuss} fixed>
          <Text>{t(`Digital Dental Lab · Laufzettel ${d.orderNo} · nur Patienten-ID`)}</Text>
          <Text render={({ pageNumber, totalPages }) => t(`gedruckt ${datumZeit(gedruckt)} · Seite ${pageNumber}/${totalPages}`)} />
        </View>
      </Page>
    </Document>
  );
}
