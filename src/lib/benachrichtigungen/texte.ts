import type { Benachrichtigung } from '@/db/schema';
import { rahmen } from '@/lib/email/vorlagen';
import { AppError } from '@/lib/errors';
import { istEilig, TEMPO_KURZ, type Tempo } from '@/lib/katalog/tempo';

/**
 * متن ایمیل هر رویداد (آلمانی اتریش، با «Sie»). ⚠️ ورودی عمداً نام بیمار، متن پیام و
 * Begründung ندارد: ایمیل از اینترنت می‌گذرد و در صندوق‌های دیگر می‌ماند (DSGVO Art. 9).
 * فقط شمارهٔ سفارش، Patienten-ID، Behandlung و Ordination.
 */
export type MailDaten = {
  ereignis: Benachrichtigung;
  /** نام گیرنده (کاربر پورتال)، برای خوشامد */
  an: string;
  orderNo: string;
  patientCode: string | null;
  behandlung: string | null;
  lieferart: 'design' | 'fertigung' | null;
  ordination: string;
  link: string;
  einstellungenLink: string;
  tempo?: Tempo | null;
  /** «Daten werden nachgereicht»: سفارش مستقیم به Rückfrage رفته */
  nachreichen?: boolean;
  version?: number | null;
  /** Behandlung بدون Freigabe: طرح مستقیم آماده است */
  ohneFreigabe?: boolean;
  ungelesen?: number;
  reklamation?: { nr: string; entscheidung: 'neuanfertigung' | 'reparatur' | 'abgelehnt'; kostenlos: boolean | null; neuerAuftrag: string | null };
};

type Inhalt = { betreff: string; titel: string; absaetze: string[] };

function inhalt(d: MailDaten): Inhalt {
  const nr = d.orderNo;
  const v = d.version ? ` (Version ${d.version})` : '';
  switch (d.ereignis) {
    case 'auftrag_eingegangen':
      return {
        betreff: `Auftrag ${nr} eingegangen`,
        titel: 'Auftrag eingegangen.',
        absaetze: [
          `vielen Dank, Ihr Auftrag ist bei uns eingegangen${istEilig(d.tempo ?? null) ? ` und als ${TEMPO_KURZ[d.tempo!]} markiert` : ''}.`,
          d.nachreichen
            ? 'Sie haben angegeben, dass Daten nachgereicht werden. Bitte laden Sie diese im Portal hoch, damit wir mit dem Design beginnen können.'
            : 'Wir planen jetzt das Design. Im Portal sehen Sie jederzeit, in welchem Schritt der Auftrag ist.',
        ],
      };
    case 'rueckfrage':
      return {
        betreff: `Rückfrage zu Auftrag ${nr}`,
        titel: 'Wir benötigen noch Informationen.',
        absaetze: [
          'für diesen Auftrag fehlen uns noch Angaben oder Dateien. Was genau fehlt, lesen Sie im Portal unter „Kommunikation“.',
          'Sobald Sie die Daten nachgereicht haben, arbeiten wir weiter.',
        ],
      };
    case 'design_freigabe':
      return d.ohneFreigabe
        ? {
            betreff: `Design fertig: Auftrag ${nr}`,
            titel: 'Ihr Design ist fertig.',
            absaetze: [`das Design${v} ist fertig und kann im Portal heruntergeladen werden.`],
          }
        : {
            betreff: `Design zur Freigabe: Auftrag ${nr}`,
            titel: 'Ihr Design ist bereit zur Prüfung.',
            absaetze: [
              `das Design${v} liegt im Portal bereit. Bitte prüfen Sie es in der 3D-Vorschau und geben Sie es frei, oder fordern Sie eine Änderung an.`,
              d.lieferart === 'design' ? 'Nach der Freigabe können Sie die Dateien herunterladen.' : 'Nach Ihrer Freigabe beginnen wir mit der Produktion.',
            ],
          };
    case 'einprobe':
      return {
        betreff: `Bereit zur Einprobe: Auftrag ${nr}`,
        titel: 'Bereit zur Einprobe.',
        absaetze: [
          'die Arbeit ist für die Einprobe vorbereitet.',
          'Nach der Einprobe geben Sie uns bitte im Portal unter „Kommunikation“ Rückmeldung, dann stellen wir die Arbeit fertig.',
        ],
      };
    case 'versendet':
      return {
        betreff: `Auftrag ${nr} versendet`,
        titel: 'Ihre Arbeit ist unterwegs.',
        absaetze: ['die fertige Arbeit ist geprüft und an die Lieferung übergeben.', 'Lieferschein und Konformitätserklärung finden Sie im Portal beim Auftrag.'],
      };
    case 'neue_nachricht':
      return {
        betreff: `Neue Nachricht zu Auftrag ${nr}`,
        titel: 'Neue Nachricht.',
        absaetze: [
          d.ungelesen && d.ungelesen > 1
            ? `zu diesem Auftrag gibt es ${d.ungelesen} neue Nachrichten von Digital Dental Lab.`
            : 'zu diesem Auftrag gibt es eine neue Nachricht von Digital Dental Lab.',
          'Aus Datenschutzgründen steht der Text nur im Portal.',
        ],
      };
    case 'reklamation_entschieden': {
      const r = d.reklamation;
      if (!r) throw new AppError('Reklamation fehlt.');
      const satz =
        r.entscheidung === 'neuanfertigung'
          ? `wir fertigen die Arbeit neu an. Der neue Auftrag hat die Nummer ${r.neuerAuftrag ?? '–'}.${r.kostenlos ? ' Die Neuanfertigung wird nicht berechnet.' : ''}`
          : r.entscheidung === 'reparatur'
            ? 'wir reparieren die Arbeit. Den weiteren Ablauf sehen Sie im Portal.'
            : 'wir können die Reklamation leider nicht anerkennen. Die Begründung lesen Sie im Portal unter „Kommunikation“.';
      return { betreff: `Reklamation ${r.nr} zu Auftrag ${nr} entschieden`, titel: 'Ihre Reklamation ist entschieden.', absaetze: [satz] };
    }
  }
}

export function benachrichtigungMail(d: MailDaten) {
  const i = inhalt(d);
  const absaetze = [`Guten Tag ${d.an},`, ...i.absaetze];
  const fakten: [string, string][] = [
    ...(d.reklamation ? [['Reklamation', d.reklamation.nr] as [string, string]] : []),
    ['Auftrag', d.orderNo],
    ['Patienten-ID', d.patientCode ?? '–'],
    ['Behandlung', d.behandlung ?? '–'],
    ['Ordination', d.ordination],
  ];
  const fussnote = `Sie erhalten diese E-Mail, weil Sie einen Portal-Zugang für ${d.ordination} haben. Welche E-Mails Ihre Ordination bekommt, legen Sie im Portal unter „Einstellungen“ fest.`;
  return {
    betreff: i.betreff,
    text: [
      ...absaetze,
      fakten.map(([k, w]) => `${k}: ${w}`).join('\n'),
      `Im Portal öffnen: ${d.link}`,
      `${fussnote}\n${d.einstellungenLink}`,
      'Digital Dental Lab · lab@drpishan.at',
    ].join('\n\n'),
    html: rahmen(i.titel, absaetze, { text: 'Im Portal öffnen', url: d.link }, { fakten, fussnote }),
  };
}
