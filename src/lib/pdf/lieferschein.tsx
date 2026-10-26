import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { Aussteller } from '@/lib/dokumente/aussteller';
import type { DokumentDaten } from '@/lib/dokumente/daten';
import { datum } from '@/lib/format';
import { b, Briefkopf, Fusszeile, GRAU, LINIE, SCHWARZ } from './beleg';
import { pdfText as t } from './text';

/**
 * Lieferschein (Spec فاز ۱، بخش K): موقع رفتن کار به «Übergabe» (`versendet`) ساخته و قفل می‌شود.
 * بدون قیمت؛ قیمت روی Rechnung می‌آید (فاز ۲). فقط کد بیمار.
 */
export function LieferscheinPdf({ d, aussteller, nr, am, konformitaet }: { d: DokumentDaten; aussteller: Aussteller; nr: string; am: Date; konformitaet: string | null }) {
  const beschreibung = [
    `Auftrag ${d.orderNo}`,
    `Patienten-ID ${d.patientCode}`,
    d.farbe ? `Zahnfarbe ${d.farbe}` : null,
    d.behandler ? `Behandler: ${d.behandler}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Document title={`Lieferschein ${nr}`} author="Digital Dental Lab" creator="DDL Laborsystem" producer="DDL Laborsystem" language="de-AT">
      <Page size="A4" style={b.seite}>
        <Briefkopf aussteller={aussteller} titel="Lieferschein" nummer={nr} datum={`Datum: ${datum(am)}`} />

        <View style={[b.abschnitt, { flexDirection: 'row' }]}>
          <View style={{ flex: 1 }}>
            <Text style={b.etikett}>Empfänger</Text>
            <Text style={b.text}>{t([d.praxis.name, d.praxis.strasse, d.praxis.ort].filter(Boolean).join('\n'))}</Text>
          </View>
          <View style={{ width: 170 }}>
            <Text style={b.etikett}>Kundennummer</Text>
            <Text style={b.text}>{t(d.praxis.kundennr)}</Text>
          </View>
        </View>

        <View style={[b.abschnitt, { marginTop: 26 }]}>
          <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: SCHWARZ }}>
            <Text style={{ width: 34, fontSize: 7.5, color: GRAU }}>POS.</Text>
            <Text style={{ flex: 1, fontSize: 7.5, color: GRAU }}>LEISTUNG</Text>
            <Text style={{ width: 60, fontSize: 7.5, color: GRAU, textAlign: 'right' }}>MENGE</Text>
          </View>
          <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 0.6, borderBottomColor: LINIE }} wrap={false}>
            <Text style={{ width: 34, fontSize: 10 }}>1</Text>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 11, lineHeight: 1.3 }}>{t([d.behandlung, d.zaehne ? `Zähne ${d.zaehne}` : null].filter(Boolean).join(' · '))}</Text>
              <Text style={[b.klein, { marginTop: 3 }]}>{t(beschreibung)}</Text>
              <Text style={[b.klein, { marginTop: 1 }]}>Sonderanfertigung</Text>
            </View>
            <Text style={{ width: 60, fontSize: 10, textAlign: 'right' }}>1</Text>
          </View>
        </View>

        {konformitaet ? (
          <View style={b.abschnitt}>
            <Text style={b.etikett}>Beilage</Text>
            <Text style={b.text}>{t(`Konformitätserklärung ${konformitaet} (Sonderanfertigung, MDR Anhang XIII)`)}</Text>
          </View>
        ) : null}

        <View style={b.abschnitt}>
          <Text style={b.klein}>Die Rechnung folgt gesondert.</Text>
        </View>

        <View style={b.unterschrift} wrap={false}>
          <View style={b.unterschriftFeld}>
            <Text style={b.klein}>Übernommen am</Text>
          </View>
          <View style={[b.unterschriftFeld, { marginRight: 0 }]}>
            <Text style={b.klein}>Unterschrift / Stempel der Ordination</Text>
          </View>
        </View>

        <Fusszeile aussteller={aussteller} nummer={nr} />
      </Page>
    </Document>
  );
}
