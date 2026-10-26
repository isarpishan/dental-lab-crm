import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { Aussteller } from '@/lib/dokumente/aussteller';
import type { DokumentDaten } from '@/lib/dokumente/daten';
import { datum } from '@/lib/format';
import { b, Briefkopf, Fusszeile, Zeile } from './beleg';
import { pdfText as t } from './text';

/**
 * Konformitätserklärung برای Sonderanfertigung (Spec فاز ۱، بخش K؛ MDR Art. 52 Abs. 8 و Anhang XIII
 * Abschnitt 1). موقع رفتن کار به «Übergabe» ساخته و قفل می‌شود، یعنی بعد از قبول‌شدن Qualitätskontrolle.
 *
 * ⚠️ متن حقوقی پایین پیش‌نویس است و باید پیش از استفادهٔ واقعی Landeszahnärztekammer für Wien یا
 * مشاور حقوقی آن را تأیید کند. برای همین همهٔ جمله‌ها همین‌جا در یک ثابت جدا هستند تا راحت عوض شوند.
 * سندهایی که قبلاً صادر شده‌اند عوض نمی‌شوند (غیرقابل‌تغییر)؛ متن تازه فقط روی سندهای بعدی می‌آید.
 */
export const KONFORMITAET_TEXT = {
  titel: 'Konformitätserklärung',
  untertitel: 'für Sonderanfertigungen gemäß Artikel 52 Absatz 8 und Anhang XIII Abschnitt 1 der Verordnung (EU) 2017/745 über Medizinprodukte (MDR)',
  bestimmung: (code: string) => `Diese Sonderanfertigung ist ausschließlich für die Patientin oder den Patienten mit dem Code ${code} bestimmt.`,
  erklaerung: [
    'Der Hersteller erklärt in alleiniger Verantwortung, dass das oben genannte Produkt den grundlegenden Sicherheits- und Leistungsanforderungen nach Anhang I der Verordnung (EU) 2017/745 entspricht.',
    'Es gibt keine grundlegenden Sicherheits- und Leistungsanforderungen, die nicht vollständig eingehalten wurden.',
    'Das Produkt enthält keinen Stoff, der als Arzneimittel gilt, keine Derivate aus menschlichem Blut oder Plasma und keine Gewebe oder Zellen menschlichen oder tierischen Ursprungs oder deren Derivate.',
  ],
  aufbewahrung: (implantat: boolean) =>
    `Die Dokumentation zu dieser Sonderanfertigung wird mindestens ${implantat ? '15' : '10'} Jahre nach dem Inverkehrbringen aufbewahrt.`,
} as const;

export function KonformitaetPdf({ d, aussteller, nr, am, freigabe }: { d: DokumentDaten; aussteller: Aussteller; nr: string; am: Date; freigabe: string }) {
  const praxis = [d.praxis.name, d.praxis.strasse, d.praxis.ort].filter(Boolean).join(', ');
  return (
    <Document title={`Konformitätserklärung ${nr}`} author="Digital Dental Lab" creator="DDL Laborsystem" producer="DDL Laborsystem" language="de-AT">
      <Page size="A4" style={b.seite}>
        <Briefkopf aussteller={aussteller} titel={KONFORMITAET_TEXT.titel} nummer={nr} datum={`Datum: ${datum(am)}`} />
        <Text style={[b.klein, { marginTop: 10 }]}>{t(KONFORMITAET_TEXT.untertitel)}</Text>

        <View style={b.abschnitt}>
          <Text style={b.etikett}>Hersteller und Produkt</Text>
          <Zeile titel="Hersteller" wert={[aussteller.name, aussteller.zusatz, `${aussteller.strasse}, ${aussteller.ort}, ${aussteller.land}`].filter(Boolean).join('\n')} />
          <Zeile titel="Sonderanfertigung" wert={[d.behandlung, d.zaehne ? `Zähne ${d.zaehne}` : null, d.farbe ? `Zahnfarbe ${d.farbe}` : null].filter(Boolean).join(' · ')} />
          <Zeile titel="Auftragsnummer" wert={d.orderNo} />
          <Zeile titel="Bestimmt für" wert={KONFORMITAET_TEXT.bestimmung(d.patientCode)} />
          <Zeile titel="Verordnet von" wert={d.behandler} />
          <Zeile titel="Ordination" wert={praxis} />
        </View>

        {d.merkmale.length ? (
          <View style={b.abschnitt}>
            <Text style={b.etikett}>Merkmale laut Verordnung</Text>
            {d.merkmale.map((m, i) => (
              <Zeile key={i} titel={m.titel} wert={m.wert} />
            ))}
          </View>
        ) : null}

        <View style={b.abschnitt}>
          <Text style={b.etikett}>Werkstoffe und Herstellung</Text>
          <Zeile titel="Werkstoffe (Charge)" wert={d.material.length ? d.material.map((m) => `${m.name}, LOT ${m.lotNo}`).join('\n') : null} />
          <Zeile titel="Fertigungsgerät" wert={d.geraete.join(', ') || null} />
          <Zeile titel="Hergestellt" wert={datum(am)} />
        </View>

        {/* Erklärung und Unterschrift bleiben zusammen, auch wenn viele Merkmale eine zweite Seite brauchen */}
        <View style={b.abschnitt} wrap={false}>
          <Text style={b.etikett}>Erklärung</Text>
          {KONFORMITAET_TEXT.erklaerung.map((s, i) => (
            <Text key={i} style={[b.text, { fontSize: 9.5, marginBottom: 4 }]}>
              {t(s)}
            </Text>
          ))}
          <Text style={[b.klein, { marginTop: 1 }]}>{t(KONFORMITAET_TEXT.aufbewahrung(d.implantat))}</Text>
          <View style={b.unterschrift}>
            <View style={b.unterschriftFeld}>
              <Text style={b.klein}>{t(`${aussteller.ort.replace(/^\d+\s*/, '')}, ${datum(am)}`)}</Text>
              <Text style={[b.klein, { marginTop: 2 }]}>{t(`Freigabe nach Qualitätskontrolle: ${freigabe}`)}</Text>
            </View>
            <View style={[b.unterschriftFeld, { marginRight: 0 }]}>
              <Text style={b.klein}>{t(`Für den Hersteller: ${aussteller.name}`)}</Text>
            </View>
          </View>
        </View>

        <Fusszeile aussteller={aussteller} nummer={nr} />
      </Page>
    </Document>
  );
}
