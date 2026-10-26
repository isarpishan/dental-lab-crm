import { createHash } from 'node:crypto';

/**
 * متن «Vereinbarung zu Datenschutz und Portalnutzung» بین DDL و هر Ordination. پورتال تا پذیرش نسخهٔ
 * فعلی بسته است (`lib/auth/guard.ts`). متن آلمانی محصول است و پیش‌نویسی است که باید یک حقوق‌دان در
 * اتریش بازبینی کند (docs/betrieb.md، بخش ۱۰).
 *
 * ⚠️ هر تغییری در متن یعنی نسخهٔ تازه: `VEREINBARUNG_VERSION` را بالا ببر. همهٔ Ordinationها باید
 * دوباره بپذیرند، و متنی که هر کدام پذیرفته‌اند جدا در `practice_agreements.inhalt` می‌ماند.
 */
export const VEREINBARUNG_VERSION = '1.1';
export const VEREINBARUNG_STAND = 'Oktober 2026';
export const VEREINBARUNG_TITEL = 'Vereinbarung zu Datenschutz und Portalnutzung';

export type Partei = { name: string; zusatz?: string; adresse: string };
export type Abschnitt = { titel: string; absaetze: string[] };
export type VereinbarungInhalt = {
  version: string;
  stand: string;
  titel: string;
  labor: Partei;
  praxis: Partei;
  abschnitte: Abschnitt[];
};

const partei = (p: Partei, rolle: string) => [p.name, p.zusatz, p.adresse].filter(Boolean).join(', ') + ` – im Folgenden „${rolle}“`;

export function vereinbarungInhalt(labor: Partei, praxis: Partei): VereinbarungInhalt {
  return {
    version: VEREINBARUNG_VERSION,
    stand: VEREINBARUNG_STAND,
    titel: VEREINBARUNG_TITEL,
    labor,
    praxis,
    abschnitte: [
      {
        titel: 'Vertragsparteien',
        absaetze: [`Diese Vereinbarung wird geschlossen zwischen ${partei(labor, 'DDL')} – und ${partei(praxis, 'Ordination')} –.`],
      },
      {
        titel: '§ 1 Gegenstand',
        absaetze: [
          '(1) DDL stellt der Ordination ein Online-Portal zur Verfügung. Darüber übermittelt die Ordination zahntechnische Aufträge, lädt Scan- und Bilddaten hoch, gibt Designs frei, kommuniziert mit DDL und sieht den Bearbeitungsstand ihrer Aufträge.',
          '(2) DDL fertigt auf Grundlage dieser Aufträge zahntechnische Sonderanfertigungen im Sinne der Verordnung (EU) 2017/745 über Medizinprodukte (MDR) oder erbringt Designleistungen.',
          '(3) Diese Vereinbarung regelt den Umgang mit personenbezogenen Daten, insbesondere mit Gesundheitsdaten von Patientinnen und Patienten (Art. 9 DSGVO), sowie die Bedingungen für die Nutzung des Portals. Sie gilt für alle Aufträge, die über das Portal oder auf anderem Weg erteilt werden. In Fragen des Datenschutzes geht sie anderen Vereinbarungen der Parteien vor.',
          '(4) DDL stellt Rechnungen und Gutschriften elektronisch aus: als PDF per E-Mail an die Adresse, die die Ordination dafür angibt, und zum Abruf im Portal. Die Ordination stimmt dieser elektronischen Übermittlung von Rechnungen zu (§ 11 Abs. 2 UStG).',
        ],
      },
      {
        titel: '§ 2 Rollen der Parteien',
        absaetze: [
          '(1) Die Ordination ist Verantwortliche im Sinne des Art. 4 Z 7 DSGVO für die Daten, die sie im Rahmen der Behandlung erhebt, und für die Zulässigkeit ihrer Übermittlung an DDL.',
          '(2) Soweit DDL Daten verarbeitet, um die beauftragte Sonderanfertigung herzustellen und eigene gesetzliche Pflichten zu erfüllen – insbesondere die Dokumentations- und Aufbewahrungspflichten nach Art. 52 Abs. 8 und Anhang XIII MDR sowie unternehmens- und abgabenrechtliche Pflichten –, handelt DDL als eigenständig Verantwortliche. Rechtsgrundlagen sind insbesondere Art. 6 Abs. 1 lit. b und c sowie Art. 9 Abs. 2 lit. h in Verbindung mit Abs. 3 und lit. i DSGVO.',
          '(3) Soweit DDL das Portal als technische Plattform bereitstellt, über die die Ordination Daten speichert, abruft und mit DDL austauscht, verarbeitet DDL diese Daten als Auftragsverarbeiterin der Ordination nach Art. 28 DSGVO. Dafür gilt ergänzend Anlage 1.',
        ],
      },
      {
        titel: '§ 3 Pflichten der Ordination',
        absaetze: [
          '(1) Die Ordination übermittelt nur Daten, die für den jeweiligen Auftrag erforderlich sind. Die im Portal abgefragten Patientendaten (Vor- und Nachname, freiwillig das Geburtsdatum) dienen der eindeutigen Zuordnung und dem Schutz vor Verwechslungen. Weitere Gesundheitsdaten übermittelt die Ordination nur, soweit sie für die Anfertigung nötig sind.',
          '(2) Die Ordination stellt sicher, dass die Übermittlung an DDL rechtmäßig und mit ihrer berufsrechtlichen Verschwiegenheitspflicht vereinbar ist und dass ihre Patientinnen und Patienten nach Art. 13 DSGVO darüber informiert sind, dass Daten zur Herstellung von Zahnersatz an ein zahntechnisches Labor weitergegeben werden.',
          '(3) Die Ordination hält Zugangsdaten geheim, verwendet sichere Passwörter, lässt Zugänge nur für eigene Mitarbeiterinnen und Mitarbeiter einrichten und teilt DDL unverzüglich mit, wenn eine Person ausscheidet, damit DDL ihren Zugang sperrt. Bei Verdacht auf Missbrauch eines Zugangs informiert sie DDL unverzüglich.',
          '(4) Die Ordination ist für die Richtigkeit und Vollständigkeit ihrer Auftragsangaben, Scans und Freigaben verantwortlich. Die zahnärztliche Verantwortung für Indikation, Planung und Eingliederung bleibt bei der Ordination; mit der Freigabe eines Designs bestätigt sie dieses fachlich.',
          '(5) Die Ordination nutzt das Portal nur für Aufträge an DDL und lädt keine Inhalte hoch, die damit nicht im Zusammenhang stehen.',
        ],
      },
      {
        titel: '§ 4 Pflichten von DDL und Datensicherheit',
        absaetze: [
          '(1) DDL verarbeitet die Daten nur für die in § 1 genannten Zwecke. Sie gibt sie nicht an Dritte weiter, ausgenommen an die in Anlage 1 genannten Unterauftragsverarbeiter oder soweit eine gesetzliche Pflicht besteht.',
          '(2) Alle Personen, die bei DDL mit den Daten arbeiten, sind zur Verschwiegenheit verpflichtet (Datengeheimnis nach § 6 DSG). Diese Pflicht gilt auch nach dem Ende ihrer Tätigkeit.',
          '(3) DDL trifft angemessene technische und organisatorische Maßnahmen nach Art. 32 DSGVO (Anlage 2). Patientendaten werden nicht an Anbieter künstlicher Intelligenz übermittelt. Außerhalb der Europäischen Union und des Europäischen Wirtschaftsraums werden Daten nur durch die in Anlage 1 genannten Unterauftragsverarbeiter und nur in Ländern mit einem Angemessenheitsbeschluss der Europäischen Kommission verarbeitet.',
          '(4) DDL informiert die Ordination unverzüglich nach Kenntnis über jede Verletzung des Schutzes personenbezogener Daten, die Daten der Ordination betrifft, und unterstützt sie bei Meldungen nach Art. 33 und 34 DSGVO.',
        ],
      },
      {
        titel: '§ 5 Rechte der betroffenen Personen',
        absaetze: [
          '(1) Jede Partei beantwortet Anfragen betroffener Personen für ihren eigenen Verantwortungsbereich. Erreicht DDL eine Anfrage, die Daten der Ordination betrifft, leitet DDL sie unverzüglich an die Ordination weiter und unterstützt sie bei der Beantwortung.',
          '(2) Unterliegen Daten einer gesetzlichen Aufbewahrungspflicht (§ 6), werden sie auf Verlangen nicht gelöscht, sondern in ihrer Verarbeitung eingeschränkt.',
        ],
      },
      {
        titel: '§ 6 Aufbewahrung und Löschung',
        absaetze: [
          '(1) Unterlagen zu Sonderanfertigungen bewahrt DDL nach Anhang XIII MDR mindestens zehn Jahre auf, bei implantierbaren Produkten mindestens fünfzehn Jahre. Buchhaltungsunterlagen bewahrt DDL sieben Jahre auf (§ 132 BAO).',
          '(2) Andere Daten, die nicht zu diesen Unterlagen gehören, löscht DDL nach dem Ende der Zusammenarbeit oder auf Weisung der Ordination, soweit keine Aufbewahrungspflicht entgegensteht.',
          '(3) In verschlüsselten Datensicherungen können gelöschte Daten bis zu 24 Monate erhalten bleiben. Sie werden ausschließlich zur Wiederherstellung nach einem Datenverlust verwendet.',
        ],
      },
      {
        titel: '§ 7 Verfügbarkeit des Portals',
        absaetze: [
          '(1) DDL bemüht sich um eine hohe Verfügbarkeit des Portals, schuldet aber keine ununterbrochene Erreichbarkeit. Wartungsarbeiten, Stromausfälle und technische Störungen können zu Unterbrechungen führen.',
          '(2) Aufträge und dringende Mitteilungen kann die Ordination jederzeit auch per E-Mail oder telefonisch an DDL richten.',
        ],
      },
      {
        titel: '§ 8 Haftung',
        absaetze: [
          '(1) Gegenüber betroffenen Personen haften die Parteien nach Art. 82 DSGVO. Im Verhältnis zueinander trägt jede Partei den Schaden, der auf Verstöße in ihrem Verantwortungsbereich zurückgeht (Art. 82 Abs. 5 DSGVO).',
          '(2) Die Ordination hält DDL schad- und klaglos, wenn DDL von Dritten, insbesondere von Patientinnen und Patienten oder Behörden, in Anspruch genommen wird, weil die Ordination Daten ohne Rechtsgrundlage übermittelt, ihre Informationspflichten verletzt oder Zugangsdaten nicht ausreichend geschützt hat.',
          '(3) Im Übrigen haftet DDL gegenüber der Ordination nur für Vorsatz und grobe Fahrlässigkeit. Diese Beschränkung gilt nicht für Personenschäden; die Haftung nach dem Produkthaftungsgesetz bleibt unberührt.',
        ],
      },
      {
        titel: '§ 9 Laufzeit und Kündigung',
        absaetze: [
          '(1) Die Vereinbarung gilt auf unbestimmte Zeit. Jede Partei kann sie mit einer Frist von einem Monat zum Monatsende schriftlich kündigen; eine E-Mail genügt.',
          '(2) Das Recht zur Kündigung aus wichtigem Grund bleibt unberührt. Bei einem schwerwiegenden Verstoß gegen diese Vereinbarung darf DDL Portal-Zugänge sofort sperren.',
          '(3) Mit dem Ende der Vereinbarung endet die Nutzung des Portals. Für die Daten gilt § 6.',
        ],
      },
      {
        titel: '§ 10 Änderungen',
        absaetze: [
          'DDL kann diese Vereinbarung ändern, insbesondere bei geänderter Rechtslage. Die neue Fassung wird im Portal angezeigt; die weitere Nutzung des Portals setzt ihre Annahme voraus. Für Aufträge, die vorher erteilt wurden, gilt die bisherige Fassung weiter.',
        ],
      },
      {
        titel: '§ 11 Schlussbestimmungen',
        absaetze: [
          '(1) Es gilt österreichisches Recht unter Ausschluss der Verweisungsnormen und des UN-Kaufrechts. Gerichtsstand ist das sachlich zuständige Gericht in Wien.',
          '(2) Die Vereinbarung wird elektronisch im Portal geschlossen. Dies erfüllt das Erfordernis eines elektronischen Formats nach Art. 28 Abs. 9 DSGVO. DDL speichert die angenommene Fassung, bestätigt den Zugang der Annahme per E-Mail und stellt die Fassung der Ordination jederzeit im Portal als PDF zur Verfügung.',
          '(3) Wer die Vereinbarung im Portal annimmt, bestätigt, zur Vertretung der Ordination berechtigt zu sein.',
          '(4) Ist eine Bestimmung unwirksam, bleiben die übrigen Bestimmungen wirksam. An die Stelle der unwirksamen Bestimmung tritt eine wirksame, die ihrem Zweck am nächsten kommt.',
        ],
      },
      {
        titel: 'Anlage 1 – Auftragsverarbeitung nach Art. 28 DSGVO',
        absaetze: [
          '(1) Gegenstand und Dauer: Bereitstellung des Portals für Speicherung, Abruf und Austausch von Auftragsdaten, für die Dauer dieser Vereinbarung.',
          '(2) Art und Zweck: Speichern, Übermitteln und Anzeigen von Daten zur Abwicklung zahntechnischer Aufträge.',
          '(3) Arten von Daten: Patientendaten (Vor- und Nachname, freiwillig Geburtsdatum, Patientencode); Gesundheitsdaten (Zahnbefund, Arbeitsanweisungen, Scans und Fotos); Inhalte der Kommunikation zu Aufträgen; Daten der Portal-Nutzerinnen und -Nutzer (Name, E-Mail-Adresse, Anmelde- und Protokolldaten).',
          '(4) Betroffene Personen: Patientinnen und Patienten sowie Mitarbeiterinnen und Mitarbeiter der Ordination.',
          '(5) Weisungen: Die Ordination erteilt Weisungen durch die Nutzung des Portals und schriftlich, auch per E-Mail. DDL verarbeitet die Daten nur auf dokumentierte Weisung, außer wenn eine gesetzliche Pflicht besteht, und informiert die Ordination, wenn eine Weisung nach Ansicht von DDL gegen Datenschutzrecht verstößt.',
          '(6) Vertraulichkeit und Sicherheit: siehe § 4 und Anlage 2.',
          '(7) Unterauftragsverarbeiter: Die Ordination genehmigt die folgenden Unterauftragsverarbeiter. Über neue oder geänderte Unterauftragsverarbeiter informiert DDL vorab schriftlich, auch per E-Mail; die Ordination kann binnen 14 Tagen aus sachlichem Grund widersprechen.',
          '– netcup GmbH, Emmy-Noether-Straße 10, 76131 Karlsruhe, Deutschland: Betrieb eines Zugangsservers, der verschlüsselte Verbindungen zum Server von DDL weiterleitet, ohne Zugriff auf Inhalte. Rechenzentrum in der Europäischen Union.',
          '– Hoststar – Multimedia Networks AG, Schweiz: Versand von E-Mail-Benachrichtigungen und Rechnungen. Diese enthalten keine Patientennamen; Benachrichtigungen nennen nur Auftragsnummer und Patientencode, Rechnungen zusätzlich die erbrachte Leistung. Rechenzentren in Deutschland; für die Schweiz besteht ein Angemessenheitsbeschluss der Europäischen Kommission.',
          '(8) Unterstützung: DDL unterstützt die Ordination bei der Erfüllung der Rechte betroffener Personen und der Pflichten nach Art. 32 bis 36 DSGVO.',
          '(9) Nach Ende der Verarbeitung: Löschung oder Rückgabe der Daten nach Wahl der Ordination, soweit keine Aufbewahrungspflicht besteht (§ 6).',
          '(10) Nachweise und Kontrollen: DDL stellt der Ordination die zum Nachweis nötigen Informationen zur Verfügung und ermöglicht Kontrollen nach vorheriger Anmeldung zu den Geschäftszeiten. Die Kosten trägt die Ordination, außer die Kontrolle deckt einen Verstoß von DDL auf.',
          '(11) Ort der Verarbeitung: Der Server steht in den Räumen von DDL in Wien. Datensicherungen liegen verschlüsselt auf Datenträgern in Österreich.',
        ],
      },
      {
        titel: 'Anlage 2 – Technische und organisatorische Maßnahmen',
        absaetze: [
          '– Server in den Räumen von DDL in Wien. Die Systemfestplatte ist vollständig verschlüsselt, die Datensicherungen ebenfalls.',
          '– Übertragung ausschließlich verschlüsselt (HTTPS). Am Standort sind keine Ports zum Internet geöffnet; der Zugang erfolgt über einen verschlüsselten Tunnel.',
          '– Patientennamen werden zusätzlich verschlüsselt gespeichert. In der Produktion, auf Laufzetteln und in E-Mails erscheint nur der Patientencode.',
          '– Jede Ordination sieht nur ihre eigenen Daten. Mitarbeiterinnen und Mitarbeiter von DDL melden sich mit Zwei-Faktor-Anmeldung an und erhalten nur die Rechte, die ihre Rolle erfordert.',
          '– Jede Anzeige eines Patientennamens und jeder Download von Patientendateien wird protokolliert; wichtige Änderungen werden mit Person und Zeitpunkt aufgezeichnet.',
          '– Tägliche verschlüsselte Datensicherung auf eine getrennte Festplatte, wöchentlich auf wechselnde externe Datenträger, die außerhalb des Standorts aufbewahrt werden; regelmäßige Tests der Wiederherstellung.',
          '– Automatische Sicherheitsupdates und laufende Überwachung mit Alarmierung per E-Mail.',
          '– Keine Übermittlung von Patientendaten an Dienste künstlicher Intelligenz.',
        ],
      },
    ],
  };
}

/** متن ساده و یکتا برای پیوست ایمیل یا جست‌وجو، و پایهٔ `pruefsumme`. */
export function klartext(i: VereinbarungInhalt): string {
  return [`${i.titel} · Version ${i.version} · Stand ${i.stand}`, ...i.abschnitte.map((a) => [a.titel, ...a.absaetze].join('\n'))].join('\n\n');
}

/** sha256 متن: همان چیزی که کاربر دید، همان است که ثبت می‌شود (فرم آن را با خودش می‌فرستد). */
export function pruefsumme(i: VereinbarungInhalt): string {
  return createHash('sha256').update(klartext(i), 'utf8').digest('hex');
}

/** نشانی یک‌خطی Ordination یا لابراتوار برای بخش «Vertragsparteien». */
export function adresseZeile(teile: (string | null | undefined)[]): string {
  return teile.map((t) => t?.trim()).filter(Boolean).join(', ');
}
