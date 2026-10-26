import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Mahnstufe } from '@/lib/abrechnung/mahnwesen';
import { MAHNSTUFE_NAMEN } from '@/lib/abrechnung/mahnwesen';
import type { AusstellerStand, Empfaenger } from '@/lib/abrechnung/rechnung';
import { ibanFormat } from '@/lib/abrechnung/rechnungsdaten';
import { centText } from '@/lib/abrechnung/geld';
import { datum, isoDatumText } from '@/lib/format';
import { b, Briefkopf, Fusszeile, LINIE, SCHWARZ, VorschauStempel, Zeile } from './beleg';
import { pdfText as t } from './text';

/**
 * Zahlungserinnerung، 1. Mahnung یا 2. Mahnung (Spec فاز ۲، قدم ۴): یک Rechnung، مبلغ باز، مهلت تازه
 * و داده‌های پرداخت. لحن مرحلهٔ اول دوستانه است. بدون هزینه و بدون بهره. سیاه‌وسفید مثل Rechnung.
 */
const r = StyleSheet.create({
  betrag: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 0.6, borderBottomColor: LINIE },
  summe: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 0.8, borderTopColor: SCHWARZ, marginTop: 4 },
});

/** ردیف مبلغ: عنوان چپ، مبلغ راست (مثل جمع پایین) */
function Betrag({ titel, wert }: { titel: string; wert: string }) {
  return (
    <View style={r.betrag}>
      <Text style={b.zeileTitel}>{t(titel)}</Text>
      <Text style={[b.text, { fontSize: 9.5 }]}>{wert}</Text>
    </View>
  );
}

const geld = (cent: number) => t(centText(cent).replace(/ /g, ' '));

export type MahnungDaten = {
  stufe: Mahnstufe;
  am: Date;
  frist: string;
  aussteller: AusstellerStand;
  empfaenger: Empfaenger;
  rechnung: { nummer: string; am: Date; faelligAm: string | null; summeCent: number };
  gutschriftenCent: number;
  gezahltCent: number;
  offenCent: number;
  /** frühere Schreiben zu dieser Rechnung, für den Bezug im Text */
  vorher: { stufe: Mahnstufe; am: Date } | null;
  /** پیش‌نمایش پیش از ساختن: مُهر «VORSCHAU» */
  vorschau?: boolean;
};

function einleitung(d: MahnungDaten): string[] {
  const rg = `Rechnung ${d.rechnung.nummer} vom ${datum(d.rechnung.am)}`;
  const frist = isoDatumText(d.frist);
  // «trotz unserer Zahlungserinnerung vom …»؛ بدون نامهٔ قبلی (نباید پیش بیاید) جمله بدون آن
  const trotz = d.vorher ? `trotz unserer ${MAHNSTUFE_NAMEN[d.vorher.stufe]} vom ${datum(d.vorher.am)} ` : '';
  if (d.stufe === 1) {
    return [
      'Sehr geehrte Damen und Herren,',
      `bei der Durchsicht unserer Buchhaltung haben wir festgestellt, dass die ${rg} noch offen ist. Sicher ist das nur übersehen worden.`,
      `Bitte überweisen Sie den offenen Betrag bis ${frist}. Sollten Sie inzwischen bezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.`,
    ];
  }
  if (d.stufe === 2) {
    return [
      'Sehr geehrte Damen und Herren,',
      trotz ? `${trotz}ist die ${rg} noch nicht bezahlt.` : `die ${rg} ist noch nicht bezahlt.`,
      `Bitte überweisen Sie den offenen Betrag bis spätestens ${frist}. Sollten Sie inzwischen bezahlt haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.`,
    ];
  }
  return [
    'Sehr geehrte Damen und Herren,',
    `leider ist die ${rg} ${trotz}weiterhin offen.`,
    `Bitte überweisen Sie den offenen Betrag bis spätestens ${frist}. Falls es zu dieser Rechnung Fragen oder Unklarheiten gibt, melden Sie sich bitte bei uns, damit wir sie gemeinsam klären können.`,
  ];
}

export function MahnungPdf(d: MahnungDaten) {
  const titel = MAHNSTUFE_NAMEN[d.stufe];
  return (
    <Document title={`${d.vorschau ? 'Vorschau ' : ''}${titel} ${d.rechnung.nummer}`} author="Digital Dental Lab" creator="DDL Laborsystem" producer="DDL Laborsystem" language="de-AT">
      <Page size="A4" style={b.seite}>
        {d.vorschau ? <VorschauStempel /> : null}
        <Briefkopf aussteller={d.aussteller} titel={titel} nummer={`zu Rechnung ${d.rechnung.nummer}`} datum={`Datum: ${datum(d.am)}`} />

        <View style={{ flexDirection: 'row', marginTop: 18 }}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Text style={b.etikett}>An</Text>
            <Text style={b.text}>{t([d.empfaenger.name, ...d.empfaenger.zeilen].join('\n'))}</Text>
          </View>
          <View style={{ width: 250 }}>
            <Zeile titel="Kundennummer" wert={d.empfaenger.kundennummer} />
            <Zeile titel="Rechnung" wert={`${d.rechnung.nummer} vom ${datum(d.rechnung.am)}`} />
            <Zeile titel="Ursprünglich fällig" wert={isoDatumText(d.rechnung.faelligAm)} />
            <Zeile titel="Neue Frist" wert={isoDatumText(d.frist)} />
          </View>
        </View>

        <View style={{ marginTop: 22 }}>
          {einleitung(d).map((a, i) => (
            <Text key={i} style={[b.text, { marginBottom: 8 }]}>
              {t(a)}
            </Text>
          ))}
        </View>

        <View style={{ alignSelf: 'flex-end', width: 280, marginTop: 10 }} wrap={false}>
          <Betrag titel="Rechnungsbetrag" wert={geld(d.rechnung.summeCent)} />
          {d.gutschriftenCent ? <Betrag titel="Gutschriften" wert={geld(d.gutschriftenCent)} /> : null}
          {d.gezahltCent ? <Betrag titel="Bereits bezahlt" wert={geld(-d.gezahltCent)} /> : null}
          <View style={r.summe}>
            <Text style={[b.text, { fontFamily: 'Helvetica-Bold' }]}>Offener Betrag</Text>
            <Text style={[b.text, { fontFamily: 'Helvetica-Bold' }]}>{geld(d.offenCent)}</Text>
          </View>
        </View>

        <View style={{ marginTop: 22 }} wrap={false}>
          <Text style={b.text}>
            {t(
              `Bitte überweisen Sie ${centText(d.offenCent).replace(/ /g, ' ')} bis ${isoDatumText(d.frist)} auf IBAN ${ibanFormat(d.aussteller.iban)}${d.aussteller.bic ? `, BIC ${d.aussteller.bic}` : ''}, Empfänger ${d.aussteller.name}. Verwendungszweck: ${d.rechnung.nummer}.`,
            )}
          </Text>
          <Text style={[b.text, { marginTop: 14 }]}>Mit freundlichen Grüßen</Text>
          <Text style={b.text}>{t(d.aussteller.name)}</Text>
        </View>

        <Fusszeile aussteller={d.aussteller} nummer={`${titel} zu ${d.rechnung.nummer}`} />
      </Page>
    </Document>
  );
}
