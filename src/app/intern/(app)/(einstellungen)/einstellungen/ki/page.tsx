import type { Metadata } from 'next';
import { KiFormular } from '@/components/einstellungen/KiFormular';
import { ReiterBereich, ReiterLeiste, reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { kiVerbrauch } from '@/lib/ausgaben/eingang';
import { monatTitel } from '@/lib/ausgaben/text';
import { kiStand } from '@/lib/ki/einstellungen';
import { KI_MODELLE, kostenUsd } from '@/lib/ki/modelle';
import { kiEinstellungenSpeichern, kiSchluesselEntfernen, kiTesten } from './actions';

export const metadata: Metadata = { title: 'KI · Einstellungen · Digital Dental Lab' };

const usd = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * «Einstellungen → KI» (Ausgaben قدم ۲، ۲۴ اکتبر ۲۰۲۶؛ فقط Inhaber): کلید Anthropic و مدل برای خواندن خودکار
 * Belegها، و مصرف هر ماه. کلید رمزگذاری‌شده در `settings` (`lib/ki/einstellungen.ts`)؛ تنها مسیر به AI
 * `lib/ai-safe.ts` است و فقط Beleg خرید از آن می‌گذرد.
 */
export default async function KiEinstellungen({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'einstellungen.verwalten')) {
    return <Seitenkopf eyebrow="Einstellungen" titel="Kein Zugriff.">Diese Seite ist nur für den Inhaber.</Seitenkopf>;
  }
  const [stand, verbrauch, { tab: t }] = await Promise.all([kiStand(), kiVerbrauch(), searchParams]);
  const tab = reiterWahl(t, ['schluessel', 'verbrauch'] as const);
  const monate = [...new Set(verbrauch.map((v) => v.monat))].map((monat) => {
    const zeilen = verbrauch.filter((v) => v.monat === monat);
    const kosten = zeilen.map((v) => kostenUsd(v.modell, v.eingabe, v.ausgabe));
    return {
      monat,
      anzahl: zeilen.reduce((s, v) => s + v.anzahl, 0),
      kosten: kosten.every((k) => k !== undefined) ? kosten.reduce<number>((s, k) => s + (k ?? 0), 0) : undefined,
      modelle: zeilen.map((v) => KI_MODELLE.find((m) => m.id === v.modell)?.name ?? v.modell),
    };
  });

  return (
    <>
      <Seitenkopf eyebrow="Einstellungen" titel="KI." info="Claude liest hochgeladene Belege unter »Ausgaben« und füllt das Formular vor. Es geht nur der Beleg selbst an Anthropic, nie Daten von Aufträgen, Patienten oder Ordinationen. Gespeichert wird erst, wenn Sie unter »Zu prüfen« auf »Übernehmen« klicken." />

      <ReiterLeiste
        label="Abschnitte"
        reiter={[
          { key: 'schluessel', href: '?tab=schluessel', aktiv: tab === 'schluessel', inhalt: 'Schlüssel' },
          { key: 'verbrauch', href: '?tab=verbrauch', aktiv: tab === 'verbrauch', inhalt: 'Verbrauch' },
        ]}
      />

      {tab === 'schluessel' ? (
      <ReiterBereich titel="Schlüssel" hinweis="Für jedes Lesen verrechnet Anthropic ein paar Cent direkt über Ihr eigenes Konto.">
        <KiFormular stand={stand} speichern={kiEinstellungenSpeichern} testen={kiTesten} entfernen={kiSchluesselEntfernen} />
        <details className="mt-10 max-w-[760px] border-t border-line pt-6">
          <summary className="cursor-pointer list-none text-[13px] text-muted hover:text-white">So kommen Sie zu einem Schlüssel …</summary>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] font-light text-paragraph">
            <li>
              <span className="text-white">console.anthropic.com</span> öffnen und ein Konto anlegen (mit der E-Mail des Labors).
            </li>
            <li>Unter »Billing« Guthaben aufladen. $ 10 reichen für einige hundert Belege.</li>
            <li>Unter »API Keys« auf »Create Key« klicken, einen Namen wie »DDL CRM« geben und den Schlüssel kopieren.</li>
            <li>Hier einfügen und »Speichern«. Die Verbindung wird gleich geprüft.</li>
          </ol>
        </details>
      </ReiterBereich>
    ) : null}

      {tab === 'verbrauch' ? (
      <ReiterBereich titel="Verbrauch" hinweis="Ungefähre Kosten nach den Listenpreisen von Anthropic. Maßgeblich ist die Abrechnung im Anthropic-Konto.">
        {monate.length ? (
          <ul aria-label="Verbrauch nach Monat" className="max-w-[760px] border-t border-line">
            {monate.map((m) => (
              <li key={m.monat} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 border-b border-line py-4">
                <span className="min-w-0">
                  <span className="block text-[17px] font-light">{monatTitel(m.monat)}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {m.anzahl} {m.anzahl === 1 ? 'Beleg' : 'Belege'} gelesen · {m.modelle.join(', ')}
                  </span>
                </span>
                <span className="text-right text-[17px] font-light">{m.kosten === undefined ? '–' : `≈ ${usd.format(m.kosten)}`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] font-light text-muted">Noch kein Beleg gelesen.</p>
        )}
      </ReiterBereich>
    ) : null}
    </>
  );
}
