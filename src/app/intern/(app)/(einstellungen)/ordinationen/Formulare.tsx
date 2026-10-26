'use client';

import { useFormAktion } from '@/components/ui/useFormAktion';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Auswahl, Feld, Textfeld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import type { Ergebnis } from '@/lib/aktion';
import {
  behandlerAnlegen,
  behandlerSpeichern,
  ordinationAnlegen,
  ordinationSpeichern,
  praxisZugangAktivUmschalten,
  praxisZugangEinladen,
  praxisZugangErneut,
} from './actions';

export type OrdinationWerte = {
  id: string;
  name: string;
  street: string | null;
  zip: string | null;
  city: string | null;
  uidNumber: string | null;
  phone: string | null;
  email: string | null;
  billingEmail: string | null;
  billingMode: 'sammel' | 'einzel';
  defaultDeliveryKind: 'design' | 'fertigung' | null;
  tourId: string | null;
  deliveryNotes: string | null;
  isActive: boolean;
};

/** فرم Ordination، برای ساختن و ویرایش. فیلدها مثل فرم Zusammenarbeit سایت. */
export function OrdinationFormular({ werte, touren, vorgabe }: { werte?: OrdinationWerte; touren: { id: string; name: string }[]; vorgabe?: { email?: string; phone?: string } }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(werte ? ordinationSpeichern : ordinationAnlegen, null);
  return (
    <form onSubmit={aktion} className="grid max-w-[880px] grid-cols-1 gap-6 md:grid-cols-2">
      {werte ? <input type="hidden" name="id" value={werte.id} /> : null}
      <div className="md:col-span-2">
        <Feld label="Name der Ordination" name="name" defaultValue={werte?.name} required autoComplete="off" />
      </div>
      <div className="md:col-span-2">
        <Feld label="Straße und Hausnummer" name="street" defaultValue={werte?.street ?? ''} autoComplete="off" />
      </div>
      <Feld label="PLZ" name="zip" defaultValue={werte?.zip ?? ''} inputMode="numeric" autoComplete="off" />
      <Feld label="Ort" name="city" defaultValue={werte?.city ?? ''} autoComplete="off" />
      <Feld label="Telefon" name="phone" type="tel" defaultValue={werte?.phone ?? vorgabe?.phone ?? ''} autoComplete="off" />
      <Feld label="E-Mail der Ordination" name="email" type="email" defaultValue={werte?.email ?? vorgabe?.email ?? ''} autoComplete="off" />
      <Feld label="UID-Nummer" name="uidNumber" defaultValue={werte?.uidNumber ?? ''} placeholder="ATU12345678" autoComplete="off" hinweis="Optional." />
      <Auswahl
        label="Abrechnung"
        name="billingMode"
        defaultValue={werte?.billingMode ?? 'sammel'}
        optionen={[
          { wert: 'sammel', label: 'Sammelrechnung (monatlich)' },
          { wert: 'einzel', label: 'Einzelrechnung (pro Auftrag)' },
        ]}
      />
      <Feld
        label="E-Mail für Rechnungen"
        name="billingEmail"
        type="email"
        defaultValue={werte?.billingEmail ?? ''}
        autoComplete="off"
        hinweis="Optional. Wenn leer, gehen Rechnungen an die allgemeine Adresse."
      />
      <Auswahl
        label="Lieferart im Auftragsformular"
        name="defaultDeliveryKind"
        defaultValue={werte?.defaultDeliveryKind ?? ''}
        optionen={[
          { wert: '', label: 'Jedes Mal fragen' },
          { wert: 'fertigung', label: 'Fertige Arbeit vorauswählen' },
          { wert: 'design', label: 'Nur Design (Datei) vorauswählen' },
        ]}
      />
      {touren.length ? (
        <Auswahl
          label="Tour"
          name="tourId"
          defaultValue={werte?.tourId ?? ''}
          optionen={[{ wert: '', label: 'Keine Tour' }, ...touren.map((t) => ({ wert: t.id, label: t.name }))]}
        />
      ) : null}
      {werte ? (
        <Auswahl
          label="Status"
          name="isActive"
          defaultValue={werte.isActive ? 'ja' : 'nein'}
          optionen={[
            { wert: 'ja', label: 'Aktiv' },
            { wert: 'nein', label: 'Deaktiviert (Portal gesperrt)' },
          ]}
        />
      ) : null}
      <div className="md:col-span-2">
        <Textfeld label="Lieferhinweise" name="deliveryNotes" defaultValue={werte?.deliveryNotes ?? ''} rows={3} />
      </div>
      <div className="space-y-5 md:col-span-2">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? 'Wird gespeichert …' : werte ? 'Speichern' : 'Ordination anlegen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export type BehandlerWerte = { id: string; title: string | null; firstName: string; lastName: string; email: string | null; isActive: boolean };

function BehandlerFelder({ werte }: { werte?: BehandlerWerte }) {
  return (
    <>
      <Feld label="Titel" name="title" defaultValue={werte?.title ?? ''} placeholder="Dr." autoComplete="off" />
      <Feld label="Vorname" name="firstName" defaultValue={werte?.firstName} required autoComplete="off" />
      <Feld label="Nachname" name="lastName" defaultValue={werte?.lastName} required autoComplete="off" />
      <Feld label="E-Mail" name="email" type="email" defaultValue={werte?.email ?? ''} autoComplete="off" hinweis="Optional." />
    </>
  );
}

export function BehandlerNeu({ practiceId }: { practiceId: string }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(behandlerAnlegen, null, { zuruecksetzenBeiErfolg: true });
  return (
    <form onSubmit={aktion} className="grid grid-cols-1 gap-6 md:grid-cols-[120px_1fr_1fr_1fr] md:items-start">
      <input type="hidden" name="practiceId" value={practiceId} />
      <BehandlerFelder />
      <div className="space-y-5 md:col-span-4">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird angelegt …' : 'Behandler hinzufügen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function BehandlerZeile({ b, bearbeitbar }: { b: BehandlerWerte; bearbeitbar: boolean }) {
  const [offen, setOffen] = useState(false);
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(behandlerSpeichern, null);
  const name = [b.title, b.firstName, b.lastName].filter(Boolean).join(' ');
  return (
    <li className="border-b border-line py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div>
          <p className={`text-[18px] font-light ${b.isActive ? '' : 'text-muted line-through'}`}>{name}</p>
          <p className="text-[13px] text-muted">{b.email ?? 'keine E-Mail'}{b.isActive ? '' : ' · nicht mehr aktiv'}</p>
        </div>
        {bearbeitbar ? (
          <Button variant="text" onClick={() => setOffen(!offen)} aria-expanded={offen} aria-label={`${name} bearbeiten`}>
            {offen ? 'Schließen' : 'Bearbeiten'}
          </Button>
        ) : null}
      </div>
      {offen ? (
        <form onSubmit={aktion} className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-[120px_1fr_1fr_1fr] md:items-start">
          <input type="hidden" name="id" value={b.id} />
          <BehandlerFelder werte={b} />
          <Auswahl
            label="Status"
            name="isActive"
            defaultValue={b.isActive ? 'ja' : 'nein'}
            optionen={[
              { wert: 'ja', label: 'Aktiv' },
              { wert: 'nein', label: 'Nicht mehr aktiv' },
            ]}
          />
          <div className="space-y-5 md:col-span-4">
            <Button type="submit" variant="secondary" disabled={laeuft}>
              {laeuft ? 'Wird gespeichert …' : 'Speichern'}
            </Button>
            <div aria-live="polite">
              <Rueckmeldung zustand={zustand} />
            </div>
          </div>
        </form>
      ) : null}
    </li>
  );
}

export function ZugangEinladen({ practiceId }: { practiceId: string }) {
  const [zustand, aktion, laeuft] = useFormAktion<Ergebnis>(praxisZugangEinladen, null, { zuruecksetzenBeiErfolg: true });
  return (
    <form onSubmit={aktion} className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_1fr_220px] md:items-start">
      <input type="hidden" name="practiceId" value={practiceId} />
      <Feld label="Name" name="name" required autoComplete="off" />
      <Feld label="E-Mail-Adresse" name="email" type="email" required autoComplete="off" />
      <Auswahl
        label="Rolle"
        name="rolle"
        defaultValue="praxis_admin"
        optionen={[
          { wert: 'praxis_admin', label: 'Praxis-Admin' },
          { wert: 'mitarbeiter', label: 'Mitarbeiter' },
        ]}
      />
      <div className="space-y-5 md:col-span-3">
        <Button type="submit" variant="secondary" disabled={laeuft}>
          {laeuft ? 'Wird gesendet …' : 'Zum Portal einladen'}
        </Button>
        <div aria-live="polite">
          <Rueckmeldung zustand={zustand} />
        </div>
      </div>
    </form>
  );
}

export function ZugangAktionen({ id, aktiv, eingerichtet }: { id: string; aktiv: boolean; eingerichtet: boolean }) {
  const [az, aktivAktion, aktivLaeuft] = useFormAktion<Ergebnis>(praxisZugangAktivUmschalten, null);
  const [ez, erneutAktion, erneutLaeuft] = useFormAktion<Ergebnis>(praxisZugangErneut, null);
  const meldung = ez ?? az;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <form onSubmit={aktivAktion}>
          <input type="hidden" name="id" value={id} />
          <Button variant="text" type="submit" disabled={aktivLaeuft}>
            {aktiv ? 'Deaktivieren' : 'Aktivieren'}
          </Button>
        </form>
        <form
          onSubmit={(e) => {
            if (eingerichtet && !confirm('Zugang zurücksetzen? Das bisherige Passwort gilt danach nicht mehr.')) {
              e.preventDefault();
              return;
            }
            erneutAktion(e);
          }}
        >
          <input type="hidden" name="id" value={id} />
          <Button variant="text" type="submit" disabled={erneutLaeuft}>
            {eingerichtet ? 'Zugang zurücksetzen' : 'Einladung erneut senden'}
          </Button>
        </form>
      </div>
      <div aria-live="polite">{meldung ? <Rueckmeldung zustand={meldung} /> : null}</div>
    </div>
  );
}
