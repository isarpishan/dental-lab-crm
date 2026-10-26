import { rahmen } from '@/lib/email/vorlagen';
import { datum, isoDatumText } from '@/lib/format';
import type { BelegTitel } from './beleg';
import { centText } from './geld';
import { MAHNSTUFE_NAMEN, type Mahnstufe } from './mahnwesen';
import { ibanFormat } from './rechnungsdaten';

/**
 * ایمیل یک Rechnung، Stornorechnung یا Gutschrift به Ordination (Spec فاز ۲، قدم ۳). خود سند PDF پیوست
 * است. متن ایمیل هیچ نام بیمار و هیچ شرح کاری ندارد، فقط شماره، تاریخ، مبلغ و داده‌های پرداخت.
 */
export type RechnungMailDaten = {
  titel: BelegTitel;
  nummer: string;
  am: Date;
  summeCent: number;
  faelligAm: string | null;
  zeitraum: [string, string] | null;
  bezug: { nummer: string; am: Date } | null;
  ordination: string;
  aussteller: { name: string; iban: string; bic: string };
  /** بخش «Rechnungen» در پورتال؛ فقط اگر Ordination یک Praxis-Admin با دسترسی پورتال دارد */
  portalLink: string | null;
};

// «€ 120,00» با فاصلهٔ ثابت Intl؛ در ایمیل‌خوان‌ها همان‌طور که هست درست نشان داده می‌شود
const betrag = (cent: number) => centText(cent);

function zeitraumText(z: [string, string] | null) {
  if (!z) return '';
  return z[0] === z[1] ? ` (Leistung vom ${isoDatumText(z[0])})` : ` (Leistungszeitraum ${isoDatumText(z[0])} – ${isoDatumText(z[1])})`;
}

export function rechnungMail(d: RechnungMailDaten) {
  const absaetze = ['Guten Tag,'];
  const fakten: [string, string][] = [[d.titel, d.nummer], ['Datum', datum(d.am)]];
  let betreff: string;
  if (d.titel === 'Rechnung') {
    betreff = `Rechnung ${d.nummer} – Digital Dental Lab`;
    absaetze.push(`anbei erhalten Sie unsere Rechnung ${d.nummer} vom ${datum(d.am)} für ${d.ordination}${zeitraumText(d.zeitraum)}.`);
    absaetze.push(
      `Bitte überweisen Sie ${betrag(d.summeCent)}${d.faelligAm ? ` bis ${isoDatumText(d.faelligAm)}` : ''} auf das unten angegebene Konto und geben Sie als Verwendungszweck die Rechnungsnummer an.`,
    );
    fakten.push(['Betrag', betrag(d.summeCent)]);
    if (d.faelligAm) fakten.push(['Fällig am', isoDatumText(d.faelligAm)]);
    fakten.push(['Empfänger', d.aussteller.name], ['IBAN', ibanFormat(d.aussteller.iban)]);
    if (d.aussteller.bic) fakten.push(['BIC', d.aussteller.bic]);
    fakten.push(['Verwendungszweck', d.nummer]);
  } else {
    const zu = d.bezug ? ` zur Rechnung ${d.bezug.nummer}` : '';
    betreff = `${d.titel} ${d.nummer}${zu} – Digital Dental Lab`;
    const vom = d.bezug ? ` vom ${datum(d.bezug.am)}` : '';
    absaetze.push(
      d.titel === 'Stornorechnung'
        ? `anbei erhalten Sie die Stornorechnung ${d.nummer}${zu}${vom}. Die Rechnung${d.bezug ? ` ${d.bezug.nummer}` : ''} ist damit vollständig aufgehoben.`
        : `anbei erhalten Sie die Gutschrift ${d.nummer} über ${betrag(Math.abs(d.summeCent))}${zu}${vom}. Sie mindert den Betrag dieser Rechnung.`,
    );
    fakten.push(['Betrag', betrag(d.summeCent)]);
    if (d.bezug) fakten.push(['Zu Rechnung', d.bezug.nummer]);
  }
  if (d.portalLink) absaetze.push('Alle Rechnungen und Gutschriften finden Sie auch im Portal unter „Rechnungen“.');

  const fussnote = `Die ${d.titel} ist als PDF angehängt. Auf Rechnungen und in E-Mails stehen nie Patientennamen, nur Auftragsnummer und Patienten-ID.`;
  const text = [absaetze.join('\n\n'), fakten.map(([k, v]) => `${k}: ${v}`).join('\n'), d.portalLink ? `Portal: ${d.portalLink}` : null, fussnote, `${d.aussteller.name} · lab@drpishan.at`]
    .filter(Boolean)
    .join('\n\n');
  return {
    betreff,
    text,
    html: rahmen(`${d.titel} ${d.nummer}`, absaetze, d.portalLink ? { text: 'Rechnungen im Portal', url: d.portalLink } : undefined, { fakten, fussnote }),
  };
}

/**
 * ایمیل Zahlungserinnerung یا Mahnung (Spec فاز ۲، قدم ۴): نامه و خود Rechnung پیوست‌اند. لحن مرحلهٔ
 * اول دوستانه؛ بدون نام بیمار، بدون شرح کار.
 */
export function mahnungMail(d: {
  stufe: Mahnstufe;
  nummer: string;
  offenCent: number;
  frist: string;
  aussteller: { name: string; iban: string; bic: string };
  portalLink: string | null;
}) {
  const name = MAHNSTUFE_NAMEN[d.stufe];
  const betreff = `${name} zur Rechnung ${d.nummer} – Digital Dental Lab`;
  const absaetze = [
    'Guten Tag,',
    d.stufe === 1
      ? `für unsere Rechnung ${d.nummer} haben wir noch keine Zahlung erhalten. Sicher ist das nur übersehen worden.`
      : `unsere Rechnung ${d.nummer} ist trotz unserer Erinnerung noch offen.`,
    `Bitte überweisen Sie den offenen Betrag von ${betrag(d.offenCent)} bis ${isoDatumText(d.frist)}. Sollten Sie inzwischen bezahlt haben, betrachten Sie diese E-Mail bitte als gegenstandslos.`,
  ];
  if (d.portalLink) absaetze.push('Alle Rechnungen und ihren Stand finden Sie auch im Portal unter „Rechnungen“.');
  const fakten: [string, string][] = [
    [name, `zu Rechnung ${d.nummer}`],
    ['Offener Betrag', betrag(d.offenCent)],
    ['Neue Frist', isoDatumText(d.frist)],
    ['Empfänger', d.aussteller.name],
    ['IBAN', ibanFormat(d.aussteller.iban)],
  ];
  if (d.aussteller.bic) fakten.push(['BIC', d.aussteller.bic]);
  fakten.push(['Verwendungszweck', d.nummer]);
  const fussnote = `Das Schreiben und die Rechnung sind als PDF angehängt. Auf Rechnungen und in E-Mails stehen nie Patientennamen.`;
  const text = [absaetze.join('\n\n'), fakten.map(([k, v]) => `${k}: ${v}`).join('\n'), d.portalLink ? `Portal: ${d.portalLink}` : null, fussnote, `${d.aussteller.name} · lab@drpishan.at`]
    .filter(Boolean)
    .join('\n\n');
  return { betreff, text, html: rahmen(`${name} zu ${d.nummer}`, absaetze, d.portalLink ? { text: 'Rechnungen im Portal', url: d.portalLink } : undefined, { fakten, fussnote }) };
}
