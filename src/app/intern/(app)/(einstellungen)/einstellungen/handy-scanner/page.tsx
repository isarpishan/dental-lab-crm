import type { Metadata } from 'next';
import { HandyScannerZugaenge, Wert } from '@/components/einstellungen/HandyScanner';
import { SectionRow } from '@/components/ui/SectionRow';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { zugangListe } from '@/lib/ausgaben/scan-zugang';
import { datumZeit } from '@/lib/format';
import { crmUrl } from '@/lib/produktion/laufzettel';
import { scanZugangAnlegen, scanZugangEntfernen, scanZugangSperren } from './actions';

/** Download-Link im Stil des zweiten Knopfs (rose Rand); der Hauptknopf der Seite ist »Zugang anlegen«. */
const LADEN =
  'inline-block border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10';

export const metadata: Metadata = { title: 'Handy-Scanner · Einstellungen · Digital Dental Lab' };

/**
 * «Einstellungen → Handy-Scanner» (۲۴ اکتبر ۲۰۲۶، فقط با `ausgaben.verwalten`): یک Kurzbefehl آیفون Beleg را اسکن
 * می‌کند و مستقیم به `api/ausgaben/scan` و «Zu prüfen» می‌فرستد. این‌جا کلید هر دستگاه ساخته و Sperren می‌شود،
 * و راهنمای ساختن Kurzbefehl با نام‌های آلمانی خود آیفون هست.
 */
export default async function HandyScannerSeite() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'ausgaben.verwalten')) {
    return <Seitenkopf eyebrow="Einstellungen" titel="Kein Zugriff.">Diese Seite ist nur für den Inhaber.</Seitenkopf>;
  }
  const zugaenge = (await zugangListe()).map((g) => ({
    id: g.id,
    name: g.name,
    von: g.von,
    angelegt: datumZeit(g.angelegt),
    zuletzt: g.zuletzt ? datumZeit(g.zuletzt) : null,
    gesperrt: g.gesperrt ? datumZeit(g.gesperrt) : null,
  }));
  const adresse = crmUrl('/api/ausgaben/scan');
  const host = new URL(adresse).host;

  return (
    <>
      <Seitenkopf
        eyebrow="Einstellungen"
        titel="Handy-Scanner."
        info="Ein Kurzbefehl am iPhone scannt einen Beleg und schickt ihn direkt unter Ausgaben nach »Zu prüfen«, wo Claude ihn liest. Gespeichert wird die Ausgabe erst, wenn Sie dort auf »Übernehmen« klicken. Der Schlüssel eines Geräts kann nur Belege hochladen, nichts ansehen."
      />

      <SectionRow index="01" title="Zugang" lead="Ein Zugang je Gerät. Geht ein iPhone verloren, hier sperren.">
        <HandyScannerZugaenge zugaenge={zugaenge} anlegen={scanZugangAnlegen} sperren={scanZugangSperren} entfernen={scanZugangEntfernen} />
      </SectionRow>

      <SectionRow index="02" title="Kurzbefehl einrichten" lead="Einmal, etwa zwei Minuten. Den Kurzbefehl gibt es fertig; Sie müssen nichts selbst bauen. Diese Seite dafür am iPhone in Safari öffnen.">
        <ol className="max-w-[760px] border-t border-line">
          {[
            <>
              Oben unter »Zugang« einen Namen eingeben (z. B. »iPhone Isar«), <span className="text-white">Zugang anlegen</span> und dann{' '}
              <span className="text-white">Schlüssel kopieren</span>.
            </>,
            <>
              <a href="/api/ausgaben/scan/kurzbefehl" className={LADEN}>
                Kurzbefehl »Beleg scannen« laden
              </a>
              <span className="mt-3 block">
                Safari fragt »Laden?« → <span className="text-white">Laden</span>. Dann in der Adressleiste auf das Symbol mit dem Pfeil nach unten (Downloads)
                tippen und »Beleg scannen« antippen. Die App Kurzbefehle öffnet sich.
              </span>
            </>,
            <>
              Im Feld den Schlüssel einsetzen (lange tippen → <span className="text-white">Einsetzen</span>) und{' '}
              <span className="text-white">Kurzbefehl hinzufügen</span>.
            </>,
            <>
              In der App Kurzbefehle »Beleg scannen« lange drücken → <span className="text-white">Teilen</span> →{' '}
              <span className="text-white">Zum Home-Bildschirm</span>.
            </>,
            <>
              Beim ersten Mal fragt das iPhone nach der Kamera und ob »Beleg scannen« Daten an {host} senden darf → beide Male{' '}
              <span className="text-white">Erlauben</span> bzw. <span className="text-white">Immer erlauben</span>.
            </>,
          ].map((schritt, i) => (
            <li key={i} className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 border-b border-line py-4 text-[15px] font-light text-paragraph">
              <span className="text-[13px] text-rose">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0">{schritt}</div>
            </li>
          ))}
        </ol>
        <details className="mt-8 max-w-[760px] border-t border-line pt-6">
          <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-white">Für Fachleute: Adresse und Aufbau …</summary>
          <p className="mt-4 text-[15px] font-light text-paragraph">
            POST mit dem Beleg (PDF oder JPG) als Inhalt, Kopfzeile <code className="font-mono text-white">Authorization: Bearer ddls_…</code>. Antwort: ein Satz
            als Text.
          </p>
          <Wert wert={adresse} label="Adresse kopieren" />
        </details>
      </SectionRow>

      <SectionRow index="03" title="Benutzen" lead="Auch per Siri: »Beleg scannen«.">
        <ol className="max-w-[760px] list-decimal space-y-2 pl-5 text-[15px] font-light text-paragraph">
          <li>Auf dem Home-Bildschirm auf »Beleg scannen« tippen.</li>
          <li>Die Kamera öffnet sich: den Beleg flach und ganz ins Bild, auslösen, »Foto verwenden«. Mehrseitige Rechnungen: jede Seite einzeln.</li>
          <li>Nach ein paar Sekunden kommt die Mitteilung, z. B. »Gelesen: Henry Schein, € 84,20«.</li>
          <li>Später am Computer unter Abrechnung → Ausgaben → »Zu prüfen« kontrollieren und »Übernehmen«.</li>
        </ol>
      </SectionRow>
    </>
  );
}
