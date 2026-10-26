'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuftragAssistent, LEER, type AssistentZustand } from '@/components/auftrag/AuftragAssistent';
import { PatientWahl, type PatientAktionen } from '@/components/auftrag/PatientWahl';
import { useUploads } from '@/components/auftrag/useUploads';
import type { AuswahlKatalog } from '@/lib/katalog/auswahl';
import type { Lieferart } from '@/lib/orders/assistent';
import type { BehandlerOption, DateiInfo, PatientTreffer } from '@/lib/orders/entwurf';
import type { EntwurfDaten, SchrittFehler } from '@/lib/orders/pruefung';

/**
 * server actionهای فرم. پورتال و پنل داخلی هر کدام نسخهٔ خودشان را دارند (نشست و
 * Ordination فرق می‌کند)، با همین امضا. `ordinationId` فقط در پنل داخلی خوانده می‌شود.
 */
export type AuftragAktionen = {
  suchen: (ordinationId: string | null, suche: string) => Promise<{ treffer?: PatientTreffer[]; fehler?: string }>;
  anlegen: (
    ordinationId: string | null,
    eingabe: { vorname: string; nachname: string; geburtsdatum: string; trotzdem: boolean },
  ) => Promise<{ patient?: PatientTreffer; doppelt?: PatientTreffer; fehler?: string }>;
  patientFestlegen: (ordinationId: string | null, entwurfId: string | null, patientId: string) => Promise<{ entwurfId?: string; fehler?: string }>;
  speichern: (entwurfId: string, daten: EntwurfDaten) => Promise<{ fehler?: string }>;
  dateiEntfernen: (dateiId: string) => Promise<{ fehler?: string }>;
  absenden: (entwurfId: string, daten: EntwurfDaten) => Promise<{ fehler?: string; schritte?: SchrittFehler[]; orderId?: string }>;
  verwerfen: (entwurfId: string) => Promise<{ fehler?: string }>;
};

export type AuftragStart = {
  entwurfId: string | null;
  daten: EntwurfDaten | null;
  patient: PatientTreffer | null;
  dateien: DateiInfo[];
  behandler: BehandlerOption[];
  standardLieferart: Lieferart | null;
  ordinationId: string | null;
  maxBytes: number;
  heute: string;
};

type Speicherstand = { art: 'ruhe' } | { art: 'laeuft' } | { art: 'ok'; um: string } | { art: 'fehler'; text: string };

const uhrzeit = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna' });

/**
 * فرم «Neuer Auftrag» با ذخیره (Spec فاز ۱، بخش D): Entwurf با انتخاب بیمار ساخته
 * می‌شود و آدرس صفحه `?entwurf=…` می‌گیرد، تا با بستن و باز کردن دوباره چیزی گم نشود.
 * بعد از آن هر تغییر با تأخیر کوتاه ذخیره می‌شود.
 */
export function AuftragFormular({ katalog, aktionen, start }: { katalog: AuswahlKatalog; aktionen: AuftragAktionen; start: AuftragStart }) {
  const router = useRouter();
  const [entwurfId, setEntwurfId] = useState(start.entwurfId);
  const [patient, setPatient] = useState(start.patient);
  const [stand, setStand] = useState<Speicherstand>({ art: 'ruhe' });
  const uploads = useUploads({
    entwurfId,
    start: start.dateien,
    maxBytes: start.maxBytes,
    entfernenAktion: aktionen.dateiEntfernen,
  });

  // آخرین حالت فرم و ذخیرهٔ با تأخیر
  const letzte = useRef<EntwurfDaten | null>(start.daten);
  const zeitgeber = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesendet = useRef(false);
  const idRef = useRef(start.entwurfId);
  useEffect(() => {
    idRef.current = entwurfId;
  }, [entwurfId]);

  const jetztSpeichern = useCallback(async () => {
    zeitgeber.current = null;
    const id = idRef.current;
    const daten = letzte.current;
    if (!id || !daten || gesendet.current) return;
    setStand({ art: 'laeuft' });
    try {
      const r = await aktionen.speichern(id, daten);
      setStand(r.fehler ? { art: 'fehler', text: r.fehler } : { art: 'ok', um: uhrzeit.format(new Date()) });
    } catch {
      setStand({ art: 'fehler', text: 'Nicht gespeichert – bitte Verbindung prüfen.' });
    }
  }, [aktionen]);

  const onAenderung = useCallback(
    (daten: EntwurfDaten) => {
      letzte.current = daten;
      if (!idRef.current || gesendet.current) return;
      if (zeitgeber.current) clearTimeout(zeitgeber.current);
      setStand({ art: 'laeuft' });
      zeitgeber.current = setTimeout(jetztSpeichern, 700);
    },
    [jetztSpeichern],
  );

  // beim Schließen der Seite: der letzte Stand geht mit `keepalive` noch hinaus
  useEffect(() => {
    const vorVerlassen = () => {
      if (!zeitgeber.current || !idRef.current || !letzte.current || gesendet.current) return;
      clearTimeout(zeitgeber.current);
      zeitgeber.current = null;
      void fetch(`/api/auftraege/${idRef.current}/entwurf`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(letzte.current),
      });
    };
    const versteckt = () => document.visibilityState === 'hidden' && vorVerlassen();
    window.addEventListener('pagehide', vorVerlassen);
    document.addEventListener('visibilitychange', versteckt);
    return () => {
      window.removeEventListener('pagehide', vorVerlassen);
      document.removeEventListener('visibilitychange', versteckt);
    };
  }, []);

  const ordinationId = start.ordinationId;
  const patientAktionen = useMemo<PatientAktionen>(
    () => ({
      suchen: (suche) => aktionen.suchen(ordinationId, suche),
      anlegen: (eingabe) => aktionen.anlegen(ordinationId, eingabe),
      waehlen: async (p) => {
        const r = await aktionen.patientFestlegen(ordinationId, idRef.current, p.id);
        if (r.fehler || !r.entwurfId) return r.fehler ?? 'Unbekannter Fehler.';
        setPatient(p);
        if (!idRef.current) {
          idRef.current = r.entwurfId;
          setEntwurfId(r.entwurfId);
          // gleiche Seite, aber jetzt mit Entwurf: Neuladen öffnet ihn wieder
          window.history.replaceState(null, '', `${window.location.pathname}?entwurf=${r.entwurfId}`);
          setStand({ art: 'ok', um: uhrzeit.format(new Date()) });
          if (letzte.current) void jetztSpeichern();
        }
        return null;
      },
    }),
    [aktionen, ordinationId, jetztSpeichern],
  );

  async function absenden(daten: EntwurfDaten): Promise<SchrittFehler[] | null> {
    if (!idRef.current) return [{ schritt: 'patient', text: 'Bitte einen Patienten wählen oder anlegen.' }];
    if (zeitgeber.current) clearTimeout(zeitgeber.current);
    gesendet.current = true;
    const r = await aktionen.absenden(idRef.current, daten);
    if (r.orderId) {
      router.push(`/auftraege/${r.orderId}`);
      return null;
    }
    gesendet.current = false;
    return r.schritte ?? [{ schritt: 'abschluss', text: r.fehler ?? 'Der Auftrag konnte nicht gesendet werden.' }];
  }

  async function verwerfen() {
    if (!entwurfId || !confirm('Entwurf verwerfen? Alle Angaben und hochgeladenen Dateien werden gelöscht.')) return;
    gesendet.current = true;
    const r = await aktionen.verwerfen(entwurfId);
    if (r.fehler) {
      gesendet.current = false;
      setStand({ art: 'fehler', text: r.fehler });
      return;
    }
    router.push('/');
  }

  const startZustand: AssistentZustand = start.daten ? { ...start.daten, offen: null } : LEER;

  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-6 gap-y-2 pb-4 text-[13px] text-muted">
        <p aria-live="polite">
          {!entwurfId
            ? 'Wird als Entwurf gespeichert, sobald der Patient gewählt ist.'
            : stand.art === 'laeuft'
              ? 'Entwurf wird gespeichert …'
              : stand.art === 'fehler'
                ? <span className="text-rose-light">{stand.text}</span>
                : stand.art === 'ok'
                  ? `Entwurf gespeichert · ${stand.um}`
                  : 'Entwurf · wird automatisch gespeichert'}
        </p>
        {entwurfId ? (
          <button type="button" onClick={verwerfen} className="border-b border-current pb-0.5 hover:text-white">
            Entwurf verwerfen
          </button>
        ) : null}
      </div>
      <AuftragAssistent
        katalog={katalog}
        start={startZustand}
        echt={{
          patient,
          patientWahl: (fertig) => <PatientWahl aktionen={patientAktionen} gewaehlt={patient} onFertig={fertig} />,
          behandler: start.behandler,
          standardLieferart: start.standardLieferart,
          uploads,
          heute: start.heute,
          onAenderung,
          absenden,
        }}
      />
    </div>
  );
}

