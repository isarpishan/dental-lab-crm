import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { AusstellerStand, Empfaenger, Zeile as RechnungsZeile } from '@/lib/abrechnung/rechnung';
import { ibanFormat } from '@/lib/abrechnung/rechnungsdaten';
import { centText } from '@/lib/abrechnung/geld';
import { rabattAnzeige } from '@/lib/abrechnung/positionen';
import { datum, isoDatumText } from '@/lib/format';
import { b, Briefkopf, Fusszeile, GRAU, LINIE, SCHWARZ, VorschauStempel, Zeile } from './beleg';
import { pdfText as t } from './text';

/**
 * Rechnung، Stornorechnung و Gutschrift (Spec فاز ۲، قدم ۲؛ § 11 UStG): نام و نشانی صادرکننده و
 * گیرنده، تاریخ صدور، شمارهٔ پیوسته، Leistungsdatum یا Leistungszeitraum، شرح و مبلغ هر ردیف، جمع،
 * متن معافیت مالیاتی و داده‌های پرداخت. سیاه‌وسفید مثل Lieferschein. فقط Patienten-ID، نه نام بیمار.
 */
const r = StyleSheet.create({
  kopf: { flexDirection: 'row', borderBottomWidth: 0.8, borderBottomColor: SCHWARZ, paddingBottom: 4, marginTop: 20 },
  zeile: { flexDirection: 'row', borderBottomWidth: 0.6, borderBottomColor: LINIE, paddingVertical: 5 },
  spalteKopf: { fontSize: 7, letterSpacing: 0.9, color: GRAU, textTransform: 'uppercase' },
  zahl: { fontSize: 9.5, lineHeight: 1.35, textAlign: 'right' },
  summe: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  // بدون `flex` (برخلاف `b.zeileWert`): در یک ستون متن‌ها وگرنه روی هم می‌افتند
  text: { fontSize: 9.5, lineHeight: 1.35 },
});

// Helvetica در PDF فاصلهٔ ثابت Intl را نشان نمی‌دهد: «€120,00» ← «€ 120,00»
const geld = (cent: number) => t(centText(cent).replace(/\u00a0/g, ' '));

const POS = 26;
const MENGE = 62;
const PREIS = 70;
const BETRAG = 78;
const RABATT = 62;

export type RechnungTitel = 'Rechnung' | 'Stornorechnung' | 'Gutschrift';

export function RechnungPdf({
  titel,
  nummer,
  am,
  aussteller,
  empfaenger,
  zeitraum,
  faellig,
  zeilen,
  summeCent,
  bezug,
  grund,
  vorschau = false,
}: {
  titel: RechnungTitel;
  nummer: string;
  am: Date;
  aussteller: AusstellerStand;
  empfaenger: Empfaenger;
  zeitraum: [string, string] | null;
  faellig: string | null;
  zeilen: RechnungsZeile[];
  summeCent: number;
  bezug?: { nummer: string; am: Date };
  grund?: string;
  /** پیش‌نمایش پیش از صدور: مُهر «VORSCHAU» و شمارهٔ «voraussichtlich» */
  vorschau?: boolean;
}) {
  const rechnung = titel === 'Rechnung';
  // ستون Rabatt فقط وقتی دست‌کم یک ردیف Rabatt دارد؛ فاکتور بدون Rabatt همان شکل قبلی را دارد
  const mitRabatt = zeilen.some((z) => rabattAnzeige(z));
  return (
    <Document title={`${vorschau ? 'Vorschau ' : ''}${titel} ${nummer}`} author="Digital Dental Lab" creator="DDL Laborsystem" producer="DDL Laborsystem" language="de-AT">
      <Page size="A4" style={b.seite}>
        {vorschau ? <VorschauStempel /> : null}
        <Briefkopf aussteller={aussteller} titel={titel} nummer={vorschau ? `${nummer} (voraussichtlich)` : nummer} datum={`Datum: ${datum(am)}`} />

        <View style={{ flexDirection: 'row', marginTop: 18 }}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Text style={b.etikett}>{rechnung ? 'Rechnung an' : 'Gutschrift an'}</Text>
            <Text style={b.text}>{t([empfaenger.name, ...empfaenger.zeilen].join('\n'))}</Text>
          </View>
          <View style={{ width: 250 }}>
            <Zeile titel="Kundennummer" wert={empfaenger.kundennummer} />
            {zeitraum ? (
              <Zeile
                titel={zeitraum[0] === zeitraum[1] ? 'Leistungsdatum' : 'Leistungszeitraum'}
                wert={zeitraum[0] === zeitraum[1] ? isoDatumText(zeitraum[0]) : `${isoDatumText(zeitraum[0])} – ${isoDatumText(zeitraum[1])}`}
              />
            ) : null}
            {bezug ? <Zeile titel="Zu Rechnung" wert={`${bezug.nummer} vom ${datum(bezug.am)}`} /> : null}
            {faellig ? <Zeile titel="Fällig am" wert={isoDatumText(faellig)} /> : null}
            {empfaenger.uid ? <Zeile titel="UID Empfänger" wert={empfaenger.uid} /> : null}
            {aussteller.uid ? <Zeile titel="Unsere UID" wert={aussteller.uid} /> : null}
          </View>
        </View>
        {grund ? <Text style={[b.text, { marginTop: 12 }]}>{t(`Grund: ${grund}`)}</Text> : null}

        <View style={r.kopf} fixed>
          <Text style={[r.spalteKopf, { width: POS }]}>Pos</Text>
          <Text style={[r.spalteKopf, { flex: 1 }]}>Leistung</Text>
          <Text style={[r.spalteKopf, { width: MENGE, textAlign: 'right' }]}>Menge</Text>
          <Text style={[r.spalteKopf, { width: PREIS, textAlign: 'right' }]}>Einzelpreis</Text>
          {mitRabatt ? <Text style={[r.spalteKopf, { width: RABATT, textAlign: 'right' }]}>Rabatt</Text> : null}
          <Text style={[r.spalteKopf, { width: BETRAG, textAlign: 'right' }]}>Betrag</Text>
        </View>
        {zeilen.map((z, i) => {
          const rabatt = rabattAnzeige(z);
          return (
            <View key={i} style={r.zeile} wrap={false}>
              <Text style={[r.text, { width: POS }]}>{i + 1}</Text>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={r.text}>{t(z.bezeichnung)}</Text>
                {z.auftragsnummer ? (
                  <Text style={b.klein}>
                    {t(
                      [`Auftrag ${z.auftragsnummer}`, z.patientencode ? `Patienten-ID ${z.patientencode}` : null, z.leistungsdatum ? `Leistung ${isoDatumText(z.leistungsdatum)}` : null]
                        .filter(Boolean)
                        .join(' · '),
                    )}
                  </Text>
                ) : null}
              </View>
              <Text style={[r.zahl, { width: MENGE }]}>{t(`${z.menge} ${z.einheit}`)}</Text>
              <Text style={[r.zahl, { width: PREIS }]}>{geld(z.einzelpreisCent)}</Text>
              {mitRabatt ? (
                <View style={{ width: RABATT }}>
                  <Text style={r.zahl}>{rabatt ? t((rabatt.prozent ?? rabatt.betrag).replace(/\u00a0/g, ' ')) : ''}</Text>
                  {rabatt?.prozent ? <Text style={[b.klein, { textAlign: 'right' }]}>{t(rabatt.betrag.replace(/\u00a0/g, ' '))}</Text> : null}
                </View>
              ) : null}
              <Text style={[r.zahl, { width: BETRAG }]}>{geld(z.betragCent)}</Text>
            </View>
          );
        })}

        <View style={{ alignSelf: 'flex-end', width: 250, marginTop: 10 }} wrap={false}>
          <View style={[r.summe, { borderTopWidth: 0.8, borderTopColor: SCHWARZ }]}>
            <Text style={[b.text, { fontFamily: 'Helvetica-Bold' }]}>{rechnung ? 'Rechnungsbetrag' : 'Gutschriftsbetrag'}</Text>
            <Text style={[b.text, { fontFamily: 'Helvetica-Bold' }]}>{geld(summeCent)}</Text>
          </View>
          <Text style={b.klein}>{t(aussteller.hinweis)}</Text>
        </View>

        <View style={{ marginTop: 22 }} wrap={false}>
          {rechnung && faellig ? (
            <Text style={b.text}>
              {t(
                `Bitte überweisen Sie den Betrag ohne Abzug bis ${isoDatumText(faellig)} auf IBAN ${ibanFormat(aussteller.iban)}${aussteller.bic ? `, BIC ${aussteller.bic}` : ''}. Verwendungszweck: ${nummer}.`,
              )}
            </Text>
          ) : null}
          {!rechnung && bezug ? <Text style={b.text}>{t(`Diese ${titel} bezieht sich auf die Rechnung ${bezug.nummer} vom ${datum(bezug.am)}.`)}</Text> : null}
          {aussteller.fusstext ? <Text style={[b.text, { marginTop: 8 }]}>{t(aussteller.fusstext)}</Text> : null}
        </View>

        <Fusszeile aussteller={aussteller} nummer={nummer} />
      </Page>
    </Document>
  );
}
