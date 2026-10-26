import { KennzahlLeiste } from '@/components/abrechnung/Kennzahlen';
import { FixkostenListe, NeueFixkosten } from '@/components/fixkosten/Fixkosten';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { centText } from '@/lib/abrechnung/geld';
import type { Bereich } from '@/lib/fixkosten/plan';
import { fixkostenNachziehen, offeneLaeufe, vorlagenListe } from '@/lib/fixkosten/vorlagen';
import { heuteIso, isoDatumText } from '@/lib/format';

/**
 * صفحهٔ «Fixkosten» برای DDL (`/abrechnung/fixkosten`) و Privat (`/privat/fixkosten`)، Spec فاز ۵، قدم ۳.
 * دسترسی را صفحه‌ها پیش از این می‌سنجند. پیش از خواندن، سررسیدهای تا امروز ساخته می‌شوند.
 */
export async function FixkostenSeite({ bereich }: { bereich: Bereich }) {
  await fixkostenNachziehen();
  const heute = heuteIso();
  const [zeilen, offen] = await Promise.all([vorlagenListe(bereich), bereich === 'ddl' ? offeneLaeufe() : Promise.resolve([])]);
  const laufend = zeilen.filter((z) => z.aktiv && z.naechste);
  const proMonat = (art: 'ausgabe' | 'einnahme') => laufend.filter((z) => z.art === art).reduce((s, z) => s + z.proMonatCent, 0);
  const naechste = [...laufend].sort((a, b) => a.naechste!.localeCompare(b.naechste!))[0];

  return (
    <>
      <Seitenkopf
        eyebrow={bereich === 'ddl' ? 'Abrechnung' : 'Privat'}
        titel="Fixkosten"
        kompakt
        info={
          bereich === 'ddl'
            ? 'Regelmäßige Ausgaben des Labors. Jede Fälligkeit erscheint unter Ausgaben → »Zu prüfen« und wird erst mit »Übernehmen« zur Ausgabe; den Beleg dort nachreichen.'
            : 'Regelmäßige private Einnahmen und Ausgaben. Sie werden am Fälligkeitstag automatisch gebucht und erscheinen unter »Buchungen«.'
        }
      />
      <div className="-mt-4 mb-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <NeueFixkosten bereich={bereich} heute={heute} />
      </div>
      <KennzahlLeiste
        label="Fixkosten in Zahlen"
        aktiv=""
        eintraege={[
          { titel: 'Ausgaben pro Monat', wert: centText(proMonat('ausgabe')), zusatz: 'vierteljährliche und jährliche umgerechnet' },
          bereich === 'privat'
            ? { titel: 'Einnahmen pro Monat', wert: centText(proMonat('einnahme')), zusatz: 'z. B. Gehalt' }
            : {
                titel: 'Zu prüfen',
                wert: offen.length ? <span className="text-rose">{offen.length}</span> : '0',
                zusatz: offen.length ? 'unter Ausgaben übernehmen' : 'alles erledigt',
              },
          { titel: 'Laufend', wert: String(laufend.length), zusatz: zeilen.length > laufend.length ? `${zeilen.length - laufend.length} pausiert oder beendet` : 'alle aktiv' },
          { titel: 'Nächste Fälligkeit', wert: naechste ? isoDatumText(naechste.naechste) : '–', zusatz: naechste ? naechste.titel : 'nichts geplant' },
        ]}
      />
      <section aria-label="Liste der Fixkosten" className="pt-10">
        <FixkostenListe bereich={bereich} zeilen={zeilen} heute={heute} />
      </section>
    </>
  );
}
