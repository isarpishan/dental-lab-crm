import { Document, Page, Text, View } from '@react-pdf/renderer';
import type { practiceAgreements } from '@/db/schema';
import { datumZeit } from '@/lib/format';
import { b, Marke, Zeile } from './beleg';
import { pdfText as t } from './text';

/**
 * نسخهٔ پذیرفته‌شدهٔ Vereinbarung به‌صورت PDF (§ 11 ECG: متن قرارداد قابل ذخیره و چاپ). همیشه از
 * `practice_agreements.inhalt` ساخته می‌شود، یعنی دقیقاً همان متنی که Ordination دید، حتی اگر متن
 * فعلی برنامه بعداً عوض شده باشد. در پایان: چه کسی، کی، و sha256 متن.
 */
export function VereinbarungPdf({ a }: { a: typeof practiceAgreements.$inferSelect }) {
  const i = a.inhalt;
  const kennung = `Vereinbarung · Version ${i.version}`;
  return (
    <Document title={`${i.titel} – ${i.praxis.name}`} author="Digital Dental Lab" creator="DDL Laborsystem" producer="DDL Laborsystem" language="de-AT">
      <Page size="A4" style={b.seite}>
        <View style={b.kopf}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Marke />
            <Text style={b.absender}>{t([i.labor.name, i.labor.adresse].join('\n'))}</Text>
          </View>
          <View style={{ maxWidth: 300 }}>
            <Text style={[b.titel, { fontSize: 17 }]}>{t(i.titel)}</Text>
            <Text style={b.nummer}>{t(`Version ${i.version} · Stand ${i.stand}`)}</Text>
          </View>
        </View>

        {i.abschnitte.map((ab) => (
          <View key={ab.titel} style={b.abschnitt}>
            <Text style={[b.text, { fontFamily: 'Helvetica-Bold', marginBottom: 3 }]} minPresenceAhead={40}>
              {t(ab.titel)}
            </Text>
            {ab.absaetze.map((p) => (
              <Text key={p} style={[b.text, { marginTop: 3 }, p.startsWith('– ') ? { paddingLeft: 10 } : {}]}>
                {t(p)}
              </Text>
            ))}
          </View>
        ))}

        <View style={[b.abschnitt, { marginTop: 22 }]} wrap={false}>
          <Text style={b.etikett}>Elektronisch angenommen im Portal</Text>
          <Zeile titel="Ordination" wert={[i.praxis.name, i.praxis.adresse].filter(Boolean).join(', ')} />
          <Zeile titel="Angenommen von" wert={`${a.acceptedByName} (${a.acceptedByEmail})`} />
          <Zeile titel="Zeitpunkt" wert={datumZeit(a.acceptedAt)} />
          <Zeile titel="Prüfsumme (SHA-256)" wert={a.sha256} />
        </View>

        <View style={b.fuss} fixed>
          <Text>{t(`${i.labor.name} · ${i.praxis.name}`)}</Text>
          <Text render={({ pageNumber, totalPages }) => t(`${kennung} · Seite ${pageNumber}/${totalPages}`)} />
        </View>
      </Page>
    </Document>
  );
}
