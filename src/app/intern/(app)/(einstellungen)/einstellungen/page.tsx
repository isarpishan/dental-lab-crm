import { inArray } from 'drizzle-orm';
import type { Metadata } from 'next';
import { LiveVorschau } from '@/components/abrechnung/PdfVorschau';
import { NEBEN_RASTER } from '@/components/abrechnung/vorschau-raster';
import { AusstellerFormular, MahnwesenFormular, RechnungsdatenFormular } from '@/components/einstellungen/EinstellungenFormulare';
import { ReiterBereich, ReiterLeiste, reiterWahl } from '@/components/ui/ReiterLeiste';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { settings } from '@/db/schema';
import { mahnwesenAus } from '@/lib/abrechnung/mahnwesen';
import { ibanFormat, rechnungsdatenAus } from '@/lib/abrechnung/rechnungsdaten';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { AUSSTELLER_STANDARD } from '@/lib/dokumente/aussteller-werte';
import { ausstellerSpeichern, mahnwesenSpeichern, rechnungsdatenSpeichern } from './actions';

export const metadata: Metadata = { title: 'Einstellungen · Digital Dental Lab' };

const roh = (v: unknown, k: string) => (v && typeof v === 'object' && typeof (v as Record<string, unknown>)[k] === 'string' ? ((v as Record<string, string>)[k] ?? '') : '');

/**
 * «Einstellungen» (فقط Inhaber؛ Spec فاز ۲، قدم‌های ۲ و ۴): صادرکننده، داده‌های فاکتور و Mahnwesen. هر تغییر
 * در audit. کنار «Aussteller» و «Rechnungen» یک Musterrechnung زنده (مثل Vorschau در arkan-crm): هر چه
 * نوشته می‌شود، پیش از ذخیره روی PDF دیده می‌شود.
 */
// Vorschau neben dem Formular im Tab: oben bündig mit dem Formular (nicht wie neben SectionRow)
const VORSCHAU_IM_REITER = 'mt-12 xl:sticky xl:top-[100px] xl:mt-0 xl:self-start [&>figure]:max-w-[700px]';
const TABS = ['aussteller', 'rechnungen', 'mahnwesen'] as const;
const TAB_NAMEN = { aussteller: 'Aussteller', rechnungen: 'Rechnungen', mahnwesen: 'Mahnwesen' } as const;

export default async function Einstellungen({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'einstellungen.verwalten')) {
    return <Seitenkopf eyebrow="Einstellungen" titel="Kein Zugriff.">Diese Seite ist nur für den Inhaber.</Seitenkopf>;
  }
  const tab = reiterWahl((await searchParams).tab, TABS);
  const zeilen = await db().select({ key: settings.key, value: settings.value }).from(settings).where(inArray(settings.key, ['aussteller', 'rechnung', 'mahnwesen']));
  const a = zeilen.find((z) => z.key === 'aussteller')?.value;
  const r = rechnungsdatenAus(zeilen.find((z) => z.key === 'rechnung')?.value);
  const m = mahnwesenAus(zeilen.find((z) => z.key === 'mahnwesen')?.value);
  // اگر کد پستی جدا ذخیره نشده (نسخهٔ قدیمی): «1200 Wien» تقسیم می‌شود
  const ortRoh = roh(a, 'ort') || AUSSTELLER_STANDARD.ort;
  const plz = roh(a, 'plz') || (ortRoh.match(/^(\d{4,5})\s/)?.[1] ?? '');
  const ort = roh(a, 'plz') ? ortRoh : ortRoh.replace(/^\d{4,5}\s+/, '');
  const werte = {
    name: roh(a, 'name') || AUSSTELLER_STANDARD.name,
    zusatz: a ? roh(a, 'zusatz') : AUSSTELLER_STANDARD.zusatz,
    strasse: roh(a, 'strasse') || AUSSTELLER_STANDARD.strasse,
    plz,
    ort,
    land: roh(a, 'land') || AUSSTELLER_STANDARD.land,
    telefon: roh(a, 'telefon'),
    email: roh(a, 'email'),
    web: roh(a, 'web'),
  };

  return (
    <>
      <Seitenkopf eyebrow="Einstellungen" titel="Aussteller und Rechnungen." info="Diese Angaben stehen auf Lieferscheinen, Konformitätserklärungen, Rechnungen und in der Vereinbarung mit den Ordinationen. Änderungen gelten nur für neue Dokumente; ausgestellte bleiben, wie sie sind." />
      <ReiterLeiste label="Abschnitte" reiter={TABS.map((x) => ({ key: x, href: `?tab=${x}`, aktiv: x === tab, inhalt: TAB_NAMEN[x] }))} />

      {tab === 'aussteller' ? (
        <ReiterBereich titel="Aussteller" hinweis="Name und Anschrift des Betriebs, auch als Hersteller der Sonderanfertigungen.">
          <LiveVorschau
            basis="/api/abrechnung/vorschau?art=muster"
            titel="Vorschau: Musterrechnung"
            hinweis="Musterrechnung mit diesen Angaben, ändert sich beim Tippen"
            className={NEBEN_RASTER}
            vorschauClassName={VORSCHAU_IM_REITER}
          >
            <AusstellerFormular werte={werte} aktion={ausstellerSpeichern} />
          </LiveVorschau>
        </ReiterBereich>
      ) : null}

      {tab === 'rechnungen' ? (
        <ReiterBereich titel="Rechnungen" hinweis={r.iban ? `Zahlung derzeit auf ${ibanFormat(r.iban)}, ${r.zahlungszielTage} Tage.` : 'Ohne gültige IBAN lassen sich keine Rechnungen ausstellen.'}>
          <LiveVorschau
            basis="/api/abrechnung/vorschau?art=muster"
            titel="Vorschau: Musterrechnung"
            hinweis="Musterrechnung mit diesen Angaben, ändert sich beim Tippen"
            className={NEBEN_RASTER}
            vorschauClassName={VORSCHAU_IM_REITER}
          >
            <RechnungsdatenFormular werte={{ ...r, iban: r.iban ? ibanFormat(r.iban) : '' }} aktion={rechnungsdatenSpeichern} />
          </LiveVorschau>
        </ReiterBereich>
      ) : null}

      {tab === 'mahnwesen' ? (
        <ReiterBereich
          titel="Mahnwesen"
          hinweis="Wann bei offenen Rechnungen die nächste Stufe fällig ist. Nichts geht automatisch hinaus: fällige Schreiben stehen unter »Abrechnung«, gesendet wird mit einem Klick. Ohne Mahngebühren."
        >
          <MahnwesenFormular werte={m} aktion={mahnwesenSpeichern} />
        </ReiterBereich>
      ) : null}
    </>
  );
}
