'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Auswahl, Feld } from '@/components/ui/Formular';
import { Rueckmeldung } from '@/components/ui/Rueckmeldung';
import { useFormAktion } from '@/components/ui/useFormAktion';
import type { Ergebnis } from '@/lib/aktion';
import { anfrageEinladen, anfrageErledigt, anfragenJetztAbrufen } from './actions';

export type AnfrageZeile = {
  id: string;
  eingegangen: string;
  vorname: string;
  nachname: string;
  email: string;
  telefon: string | null;
  ordination: { id: string; name: string } | null;
  zugang: { ordinationId: string; ordination: string } | null;
};

function Kopieren({ text }: { text: string }) {
  const [stand, setStand] = useState<'' | 'ok' | 'fehler'>('');
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setStand('ok');
        } catch {
          setStand('fehler');
        }
      }}
      className="border-b border-current pb-0.5 text-[13px] text-muted transition-colors duration-[180ms] hover:text-white"
    >
      {stand === 'ok' ? 'Kopiert' : stand === 'fehler' ? 'Bitte markieren und kopieren' : 'E-Mail kopieren'}
    </button>
  );
}

/**
 * درخواست‌های «Praxisportal-Zugang» از فرم تماس سایت (خواستهٔ کاربر، ۴ اکتبر ۲۰۲۶). برای هر درخواست: کپی
 * ایمیل، «Einladen» همین‌جا (Ordination انتخاب می‌شود؛ نام و ایمیل از فرم سایت)، «Neue Ordination» با
 * ایمیل و تلفن، یا «Erledigt». بی‌درخواست فقط یک خط. این بخش همیشه سر جایش می‌ماند، تا پیام آخرین
 * رسیدگی دیده شود، حتی وقتی ردیفش از فهرست بیرون رفته است.
 */
export function AnfragenBereich({
  anfragen,
  ordinationen,
  stand,
  standFehler,
}: {
  anfragen: AnfrageZeile[];
  ordinationen: { id: string; name: string; kundennummer: string }[];
  stand: string;
  standFehler: boolean;
}) {
  const [einladung, einladen, laeuftEinladen] = useFormAktion<Ergebnis>(anfrageEinladen, null);
  const [erledigt, erledigen, laeuftErledigt] = useFormAktion<Ergebnis>(anfrageErledigt, null);
  const beschaeftigt = laeuftEinladen || laeuftErledigt;
  const meldungen = (
    <div className="grid max-w-[760px] gap-3 empty:hidden" aria-live="polite">
      <Rueckmeldung zustand={einladung} />
      <Rueckmeldung zustand={erledigt} />
    </div>
  );
  if (!anfragen.length) {
    return (
      <div id="anfragen" className="mb-8 grid scroll-mt-[100px] gap-4">
        {meldungen}
        <AbrufZeile text={`Keine offenen Anfragen für das Praxisportal. ${stand}`} fehler={standFehler} />
      </div>
    );
  }
  return (
    <section id="anfragen" aria-labelledby="anfragen-titel" className="mb-16 scroll-mt-[100px] border-t border-rose/60 pt-8">
      <span className="text-[11px] text-rose">Neu</span>
      <h2 id="anfragen-titel" className="mt-3 text-[clamp(23px,2.6vw,38px)] font-light leading-[1.05]">
        {anfragen.length === 1 ? 'Eine Anfrage' : `${anfragen.length} Anfragen`} für das Praxisportal.
      </h2>
      <p className="mt-3 max-w-[680px] text-[15px] font-light text-muted">
        Über das Kontaktformular der Website (»Praxisportal-Zugang«). Nach der Einladung ist die Anfrage erledigt, auch in der Evaluation der Website.
      </p>
      <div className="mt-4">
        <AbrufZeile text={stand} fehler={standFehler} />
      </div>
      <div className="mb-6 mt-8">{meldungen}</div>
      <ul aria-label="Anfragen für das Praxisportal" className="border-t border-line">
        {anfragen.map((a) => {
          const name = [a.vorname, a.nachname].filter(Boolean).join(' ');
          const neu = new URLSearchParams({ email: a.email, ...(a.telefon ? { telefon: a.telefon } : {}) });
          return (
            <li key={a.id} className="border-b border-line py-6">
              <p className="text-[20px] font-light leading-snug">{name || a.email}</p>
              <p className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="break-all text-[15px]">{a.email}</span>
                <Kopieren text={a.email} />
                {a.telefon ? (
                  <a href={`tel:${a.telefon.replace(/[^\d+]/g, '')}`} className="text-[13px] text-muted hover:text-white">
                    {a.telefon}
                  </a>
                ) : null}
              </p>
              <p className="mt-1 text-[13px] text-muted">Über das Kontaktformular der Website, {a.eingegangen}</p>
              {a.zugang ? (
                <p className="mt-2 text-[13px]">
                  <span className="text-rose">Hat schon einen Portal-Zugang</span> bei{' '}
                  <Link href={`/ordinationen/${a.zugang.ordinationId}?tab=zugaenge`} className="underline underline-offset-4 hover:text-white">
                    {a.zugang.ordination}
                  </Link>
                  . Vielleicht reicht »Erledigt« oder eine neue Einladung dort.
                </p>
              ) : a.ordination ? (
                <p className="mt-2 text-[13px] text-muted">
                  Gleiche E-Mail wie die Ordination{' '}
                  <Link href={`/ordinationen/${a.ordination.id}?tab=zugaenge`} className="underline underline-offset-4 hover:text-white">
                    {a.ordination.name}
                  </Link>
                  .
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-3 text-[13px]">
                <details className="open:basis-full">
                  <summary className="cursor-pointer text-rose hover:text-white">Einladen</summary>
                  <form onSubmit={einladen} className="mt-4 grid max-w-[880px] grid-cols-1 gap-6 md:grid-cols-2" aria-label={`${name || a.email} einladen`}>
                    <input type="hidden" name="anfrageId" value={a.id} />
                    <div className="md:col-span-2">
                      <Auswahl
                        label="Ordination"
                        name="practiceId"
                        required
                        defaultValue={a.ordination?.id ?? ''}
                        optionen={[{ wert: '', label: 'Bitte wählen …' }, ...ordinationen.map((o) => ({ wert: o.id, label: `${o.name} (${o.kundennummer})` }))]}
                      />
                      <span className="mt-2 block text-[13px] text-muted">
                        Noch nicht angelegt?{' '}
                        <Link href={`/ordinationen/neu?${neu}`} className="underline underline-offset-4 hover:text-white">
                          Neue Ordination anlegen
                        </Link>
                        , dann hier einladen.
                      </span>
                    </div>
                    <Feld label="Name" name="name" required defaultValue={name} autoComplete="off" />
                    <Feld label="E-Mail-Adresse" name="email" type="email" required defaultValue={a.email} autoComplete="off" />
                    <Auswahl
                      label="Rolle"
                      name="rolle"
                      defaultValue="praxis_admin"
                      optionen={[
                        { wert: 'praxis_admin', label: 'Praxis-Admin' },
                        { wert: 'mitarbeiter', label: 'Mitarbeiter' },
                      ]}
                    />
                    <div className="md:col-span-2">
                      <Button type="submit" variant="secondary" disabled={beschaeftigt}>
                        {laeuftEinladen ? 'Wird gesendet …' : 'Zum Portal einladen'}
                      </Button>
                    </div>
                  </form>
                </details>
                <Link href={`/ordinationen/neu?${neu}`} className="text-muted hover:text-white">
                  Neue Ordination ↗
                </Link>
                <form onSubmit={erledigen} aria-label={`Anfrage von ${a.email} erledigt`}>
                  <input type="hidden" name="anfrageId" value={a.id} />
                  <button type="submit" disabled={beschaeftigt} className="text-muted transition-colors duration-[180ms] hover:text-white disabled:opacity-50">
                    Erledigt, ohne Einladung
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** «Zuletzt abgerufen …» und «Jetzt abrufen» */
function AbrufZeile({ text, fehler }: { text: string; fehler: boolean }) {
  const [zustand, abrufen, laeuft] = useFormAktion<Ergebnis>(anfragenJetztAbrufen, null);
  return (
    <form onSubmit={abrufen} className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px]">
      <span className={fehler ? 'text-rose' : 'text-muted'}>{text}</span>
      <button type="submit" disabled={laeuft} className="border-b border-current pb-0.5 text-muted transition-colors duration-[180ms] hover:text-white disabled:opacity-50">
        Jetzt abrufen
      </button>
      {zustand?.erfolg ? <span className="text-muted">{zustand.erfolg}</span> : null}
      {zustand?.fehler ? <span className="text-rose">{zustand.fehler}</span> : null}
    </form>
  );
}
