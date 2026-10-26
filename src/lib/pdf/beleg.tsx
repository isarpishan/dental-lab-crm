import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Font, Image, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Aussteller } from '@/lib/dokumente/aussteller';
import { pdfText as t } from './text';

/**
 * اجزای مشترک اسنادی که به Ordination می‌روند (Lieferschein، Konformitätserklärung، Rechnung، Mahnung و
 * Vereinbarung): سربرگ با لوگوی سایت و صادرکننده، شمارهٔ سند و تاریخ، و پانویس ثابت. Helvetica پایهٔ PDF.
 */

// keine Silbentrennung: Namen, Nummern und Codes bleiben ganz
Font.registerHyphenationCallback((wort) => [wort]);

export const SCHWARZ = '#050505';
export const GRAU = '#5c5c5c';
export const LINIE = '#cfcac3';

export const b = StyleSheet.create({
  seite: { paddingTop: 36, paddingBottom: 60, paddingHorizontal: 48, fontFamily: 'Helvetica', fontSize: 10, color: SCHWARZ },
  kopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: SCHWARZ },
  markeZeile: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 56, height: 48, marginRight: 12 },
  marke: { fontSize: 8, letterSpacing: 1.6, color: SCHWARZ },
  absender: { fontSize: 8.5, lineHeight: 1.35, color: GRAU, marginTop: 10 },
  titel: { fontSize: 22, lineHeight: 1.15, textAlign: 'right' },
  nummer: { fontSize: 11, lineHeight: 1.3, marginTop: 6, textAlign: 'right' },
  datum: { fontSize: 9, lineHeight: 1.3, color: GRAU, marginTop: 2, textAlign: 'right' },
  abschnitt: { marginTop: 14 },
  etikett: { fontSize: 7, letterSpacing: 0.9, color: GRAU, textTransform: 'uppercase', marginBottom: 4 },
  text: { fontSize: 10, lineHeight: 1.4 },
  klein: { fontSize: 8.5, lineHeight: 1.35, color: GRAU },
  zeile: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.6, borderBottomColor: LINIE },
  zeileTitel: { width: 130, fontSize: 9, lineHeight: 1.35, color: GRAU },
  zeileWert: { flex: 1, fontSize: 9.5, lineHeight: 1.35 },
  unterschrift: { flexDirection: 'row', marginTop: 26 },
  unterschriftFeld: { flex: 1, marginRight: 28, borderTopWidth: 0.8, borderTopColor: SCHWARZ, paddingTop: 4 },
  fuss: { position: 'absolute', bottom: 26, left: 48, right: 48, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: GRAU, borderTopWidth: 0.6, borderTopColor: LINIE, paddingTop: 6 },
});

// لوگوی سایت (`public/druck/ddl-mark.png`، نسخهٔ کوچک‌شدهٔ `public/ddl-mark.png` برای چاپ). یک بار خوانده
// می‌شود؛ اگر فایل نباشد، سند بدون لوگو ساخته می‌شود، نه این‌که اصلاً ساخته نشود.
let logo: Buffer | null | undefined;
function logoDaten() {
  if (logo === undefined) {
    try {
      logo = readFileSync(path.join(process.cwd(), 'public/druck/ddl-mark.png'));
    } catch {
      logo = null;
    }
  }
  return logo;
}

/** لوگو و «DIGITAL DENTAL LAB» کنار هم، مثل سربرگ سایت */
export function Marke() {
  const daten = logoDaten();
  return (
    <View style={b.markeZeile}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- Image از react-pdf است، نه <img>؛ alt ندارد */}
      {daten ? <Image src={{ data: daten, format: 'png' }} style={b.logo} /> : null}
      <Text style={b.marke}>DIGITAL DENTAL LAB</Text>
    </View>
  );
}

/**
 * مُهر «VORSCHAU» روی پیش‌نمایش‌ها: درشت، کم‌رنگ و مورب، روی هر صفحه و زیر متن (اول در Page می‌آید).
 * پیش‌نمایش هیچ‌وقت سند معتبر نیست، حتی اگر کسی آن را ذخیره یا چاپ کند.
 */
export function VorschauStempel() {
  return (
    // A4 = 595 × 842 pt؛ جعبهٔ متن دور مرکز صفحه می‌چرخد
    <Text
      fixed
      style={{
        position: 'absolute',
        width: 760,
        left: (595 - 760) / 2,
        top: 842 / 2 - 55,
        textAlign: 'center',
        fontFamily: 'Helvetica-Bold',
        fontSize: 84,
        lineHeight: 1.2,
        letterSpacing: 6,
        color: '#ebe7e1',
        transformOrigin: '50% 50%',
        transform: 'rotate(-35deg)',
      }}
    >
      VORSCHAU
    </Text>
  );
}

export function Briefkopf({ aussteller, titel, nummer, datum }: { aussteller: Aussteller; titel: string; nummer: string; datum: string }) {
  return (
    <View style={b.kopf}>
      <View style={{ flex: 1, paddingRight: 24 }}>
        <Marke />
        <Text style={b.absender}>{t([aussteller.name, aussteller.strasse, `${aussteller.ort}, ${aussteller.land}`].join('\n'))}</Text>
      </View>
      <View style={{ maxWidth: 280 }}>
        <Text style={b.titel}>{t(titel)}</Text>
        <Text style={b.nummer}>{t(nummer)}</Text>
        <Text style={b.datum}>{t(datum)}</Text>
      </View>
    </View>
  );
}

export function Zeile({ titel, wert }: { titel: string; wert: string | null | undefined }) {
  return (
    <View style={b.zeile} wrap={false}>
      <Text style={b.zeileTitel}>{t(titel)}</Text>
      <Text style={b.zeileWert}>{t(wert || '–')}</Text>
    </View>
  );
}

export function Fusszeile({ aussteller, nummer }: { aussteller: Aussteller; nummer: string }) {
  return (
    <View style={b.fuss} fixed>
      <Text>{t([aussteller.zusatz || aussteller.name, aussteller.telefon, aussteller.email, aussteller.web].filter(Boolean).join(' · '))}</Text>
      <Text render={({ pageNumber, totalPages }) => t(`${nummer} · Seite ${pageNumber}/${totalPages}`)} />
    </View>
  );
}
