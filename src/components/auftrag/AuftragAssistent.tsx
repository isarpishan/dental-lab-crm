'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { DateienWahl } from '@/components/auftrag/DateienWahl';
import { Kacheln } from '@/components/auftrag/Kacheln';
import { PlanFelder } from '@/components/auftrag/PlanFelder';
import { SchrittOffen, SchrittZu } from '@/components/auftrag/Schritt';
import type { UploadSteuerung } from '@/components/auftrag/useUploads';
import { ImplantatAngabenFeld } from '@/components/auftrag/bloecke/ImplantatAngabenFeld';
import { MehrfachOptionen, Optionen } from '@/components/auftrag/bloecke/Optionen';
import { ZahnfarbeWahl } from '@/components/auftrag/bloecke/ZahnfarbeWahl';
import { ZeilenWahl } from '@/components/auftrag/bloecke/ZeilenWahl';
import { PreisKasten } from '@/components/auftrag/PreisKasten';
import { Button } from '@/components/ui/Button';
import { Meldung, Textfeld } from '@/components/ui/Formular';
import { Kieferbogen } from '@/components/zahnschema/Kieferbogen';
import { Zahnleiste } from '@/components/zahnschema/Zahnleiste';
import type { AuswahlKatalog, GruppenEintrag, KatalogEintrag } from '@/lib/katalog/auswahl';
import { lieferPreis, preisZeilen } from '@/lib/katalog/lieferpreise';
import { TEMPO_BESCHREIBUNG, TEMPO_KURZ, TEMPO_NAMEN, ZUSCHLAG_NAMEN, type Tempo } from '@/lib/katalog/tempo';
import {
  AESTHETIK_MERKMALE,
  blockFehler,
  blockFrage,
  blockText,
  blockTitel,
  implantatPositionen,
  KIEFER_NAMEN,
  LIEFERART_NAMEN,
  sichtbareBloecke,
  type Aesthetik,
  type ImplantatAngaben,
  type Lieferart,
  type Zahnfarbe,
} from '@/lib/orders/assistent';
import type { ZahnAuswahl } from '@/lib/orders/bridge';
import { ABLAGE_NAMEN } from '@/lib/dateien/regeln';
import { isoDatumText } from '@/lib/format';
import type { BehandlerOption, PatientTreffer } from '@/lib/orders/entwurf';
import { DATEI_NAMEN, type Block } from '@/lib/orders/form-schema';
import type { ProthesenAuswahl } from '@/lib/orders/prothese';
import { preisSchaetzung, type PreisUebersicht } from '@/lib/orders/preis';
import { fehlendeDateien, LEERER_ENTWURF, wunschterminFehler, type EntwurfDaten, type SchrittFehler } from '@/lib/orders/pruefung';

/**
 * فرم «Neuer Auftrag»، قدم‌به‌قدم (خواستهٔ کاربر، ۱ اکتبر ۲۰۲۶):
 * ۱. چه چیزی؟ (Krone، Brücke، Inlay/Onlay، …، Prothese)
 * ۲. اگر کاشی یک گروه بود (Prothese): کدام؟ (Teilprothese / Totalprothese)
 * ۳. قطعه‌های `form_schema` همان Behandlung، هر کدام یک قدم و به همان ترتیب
 * ۴. Lieferart، اگر Behandlung هر دو را دارد
 * ۵. Tempo: Standard، «Express < 24 Stunden» یا Same-Day، فقط آنچه همان Behandlung دارد (`lib/katalog/tempo.ts`).
 *    Behandlungی که فقط Standard دارد (Prothese) این قدم را ندارد.
 *
 * در سفارش واقعی (`echt`، قدم ۵) سه قدم دیگر هم هست: «Patient» در ابتدا، و «Dateien» و
 * «Hinweise» در انتها، و به‌جای «Auswahl vollständig» خلاصه با «Auftrag absenden». بدون
 * `echt` (صفحهٔ `/vorschau`) فقط انتخاب‌ها، بدون ذخیره.
 *
 * همیشه فقط یک قدم باز است. قدم‌های جواب‌داده در یک خط جمع می‌شوند و با «Ändern»
 * دوباره باز می‌شوند. قدم بعدی تا وقتی جواب قبلی کامل نیست دیده نمی‌شود.
 * انتخاب‌های تکی (کاشی، گزینه) فوراً جلو می‌روند؛ بقیه دکمهٔ «Weiter» دارند.
 */

export type AssistentZustand = EntwurfDaten & {
  /** قدمی که با «Ändern» دوباره باز شده است؛ null یعنی اولین قدم ناتمام. */
  offen: string | null;
};

export const LEER: AssistentZustand = { ...LEERER_ENTWURF, offen: null };

/** آنچه فقط سفارش واقعی دارد (پورتال و پنل داخلی)، نه پیش‌نمایش. */
export type EchterAuftrag = {
  patient: PatientTreffer | null;
  /** محتوای قدم «Patient»؛ `fertig` آن را بعد از انتخاب می‌بندد. */
  patientWahl: (fertig: () => void) => React.ReactNode;
  behandler: BehandlerOption[];
  /** Lieferart پیش‌فرض این Ordination (Stammdaten)، اگر Behandlung آن را دارد. */
  standardLieferart: Lieferart | null;
  uploads: UploadSteuerung;
  heute: string;
  /** با هر تغییر؛ ذخیرهٔ Entwurf با debounce در `AuftragFormular`. */
  onAenderung: (daten: EntwurfDaten) => void;
  /** خطاهای سرور، یا null وقتی ارسال شد (صفحه عوض می‌شود). */
  absenden: (daten: EntwurfDaten) => Promise<SchrittFehler[] | null>;
};

type Schritt =
  | { id: 'patient'; art: 'patient' }
  | { id: 'behandlung'; art: 'behandlung' }
  | { id: 'gruppe'; art: 'gruppe'; gruppe: GruppenEintrag }
  | { id: string; art: 'block'; block: Block }
  | { id: 'lieferart'; art: 'lieferart' }
  | { id: 'tempo'; art: 'tempo' }
  | { id: 'dateien'; art: 'dateien' }
  | { id: 'plan'; art: 'plan' };

/**
 * یک خط توضیح هر Tempo. Express و Same-Day = قیمت Standard به‌اضافهٔ Zuschlag جدای خودشان؛ مبلغ‌ها را
 * Inhaber در «Preise» وارد می‌کند، تا آن وقت «… nach Prüfung» (مثل سایت و چت‌بات).
 */
function tempoText(eintrag: KatalogEintrag, tempo: Tempo): string {
  if (tempo === 'standard') return `Bearbeitungszeit: ${eintrag.bearbeitungszeit}`;
  return `${TEMPO_BESCHREIBUNG[tempo]} · zzgl. ${eintrag.zuschlaege[tempo] ?? `${ZUSCHLAG_NAMEN[tempo]} nach Prüfung`}`;
}

const preisVon = (eintrag: KatalogEintrag, lieferart: Lieferart | null) =>
  lieferart ? lieferPreis(eintrag.preise, lieferart) : preisZeilen(eintrag.preise).join(' · ');

const lieferartTexte: Record<Lieferart, string> = {
  fertigung: 'Wir fertigen und liefern die Arbeit.',
  design: 'Sie erhalten die Datei nach Freigabe und drucken selbst.',
};

/** با یک Behandler، همان یکی؛ با فقط Standard، همان Tempo. هیچ‌کدام لازم نیست پرسیده شود. */
function mitStandardwerten(z: AssistentZustand, echt: EchterAuftrag | undefined, eintrag: KatalogEintrag | null): EntwurfDaten {
  const { offen: _offen, ...rest } = z;
  const daten = eintrag?.tempi.length === 1 && rest.tempo !== eintrag.tempi[0] ? { ...rest, tempo: eintrag.tempi[0] } : rest;
  if (!echt || daten.plan.behandlerId || echt.behandler.length !== 1) return daten;
  return { ...daten, plan: { ...daten.plan, behandlerId: echt.behandler[0].id } };
}

export function AuftragAssistent({ katalog, start = LEER, echt }: { katalog: AuswahlKatalog; start?: AssistentZustand; echt?: EchterAuftrag }) {
  const [z, setZ] = useState<AssistentZustand>(start);
  const [fehler, setFehler] = useState<{ schritt: string; text: string } | null>(null);

  const gruppe = katalog.gruppen.find((g) => g.key === z.auswahl) ?? null;
  const eintrag = katalog.behandlungen.find((b) => b.key === z.behandlung) ?? null;
  const lieferart: Lieferart | null = eintrag?.lieferOptionen.length === 1 ? eintrag.lieferOptionen[0] : z.lieferart;
  const daten = mitStandardwerten(z, echt, eintrag);
  // Preis mit Summe für die Ordination (Wunsch 25.10.2026): aus Zähnen, Lieferart und Tempo
  const preis = eintrag
    ? preisSchaetzung({
        behandlung: eintrag.name,
        lieferart,
        option: lieferart ? eintrag.optionen[lieferart] : null,
        tempo: daten.tempo,
        zuschlag: daten.tempo && daten.tempo !== 'standard' ? eintrag.zuschlagWerte[daten.tempo] : null,
        bloecke: sichtbareBloecke(eintrag.formSchema, z.antworten),
        antworten: z.antworten,
      })
    : null;

  // جاهایی که فایل دارند یا فایلشان در حال آپلود است
  const belegt = echt ? echt.uploads.liste.filter((u) => u.status !== 'fehler').map((u) => u.platz) : [];
  const fehlend = eintrag ? fehlendeDateien(eintrag, belegt) : [];
  const planFehler = echt
    ? echt.behandler.length && !daten.plan.behandlerId
      ? 'Bitte die Behandlerin oder den Behandler wählen.'
      : wunschterminFehler(daten.plan.wunschtermin, echt.heute)
    : null;

  const schritte: Schritt[] = [];
  if (echt) schritte.push({ id: 'patient', art: 'patient' });
  schritte.push({ id: 'behandlung', art: 'behandlung' });
  if (gruppe) schritte.push({ id: 'gruppe', art: 'gruppe', gruppe });
  if (eintrag) {
    for (const block of sichtbareBloecke(eintrag.formSchema, z.antworten)) schritte.push({ id: `b-${block.id}`, art: 'block', block });
    if (eintrag.lieferOptionen.length > 1) schritte.push({ id: 'lieferart', art: 'lieferart' });
    if (eintrag.tempi.length > 1) schritte.push({ id: 'tempo', art: 'tempo' });
    if (echt) schritte.push({ id: 'dateien', art: 'dateien' }, { id: 'plan', art: 'plan' });
  }

  // Entwurf: فقط تغییر واقعی به `AuftragFormular` می‌رود (نه حالت ذخیره‌شدهٔ اول)
  const onAenderung = echt?.onAenderung;
  const datenJson = JSON.stringify(daten);
  const zuletztGemeldet = useRef(datenJson);
  useEffect(() => {
    if (zuletztGemeldet.current === datenJson) return;
    zuletztGemeldet.current = datenJson;
    onAenderung?.(JSON.parse(datenJson) as EntwurfDaten);
  }, [datenJson, onAenderung]);

  function fertig(s: Schritt): boolean {
    switch (s.art) {
      case 'patient':
        return Boolean(echt?.patient);
      case 'dateien':
        return Boolean(z.bestaetigt.dateien) && (!fehlend.length || z.nachgereicht);
      case 'plan':
        return Boolean(z.bestaetigt.plan) && !planFehler;
      case 'behandlung':
        return z.auswahl !== null;
      case 'gruppe':
        return z.behandlung !== null;
      case 'block':
        return Boolean(z.bestaetigt[s.id]) && !blockFehler(s.block, z.antworten[s.block.id]);
      case 'lieferart':
        return z.lieferart !== null;
      case 'tempo':
        return z.tempo !== null && Boolean(eintrag?.tempi.includes(z.tempo));
    }
  }

  const ersterOffener = schritte.find((s) => !fertig(s))?.id ?? null;
  const aktiv = z.offen && schritte.some((s) => s.id === z.offen) ? z.offen : ersterOffener;
  const alleFertig = eintrag !== null && ersterOffener === null;

  /** Lieferart پیش‌فرض Ordination، اگر این Behandlung آن را دارد. */
  const standardFuer = (key: string | null): Lieferart | null => {
    const e = katalog.behandlungen.find((b) => b.key === key);
    const l = echt?.standardLieferart ?? null;
    return e && l && e.lieferOptionen.length > 1 && e.lieferOptionen.includes(l) ? l : null;
  };

  // بعد از هر قدم: قدم تازه را به دید بیاور و فوکوس را روی سؤالش بگذار
  const vorher = useRef(aktiv);
  useEffect(() => {
    if (vorher.current === aktiv) return;
    vorher.current = aktiv;
    const ziel = document.getElementById(`schritt-${aktiv ?? 'abschluss'}`);
    if (!ziel) return;
    const ruhig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ziel.scrollIntoView({ block: 'start', behavior: ruhig ? 'auto' : 'smooth' });
    ziel.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, [aktiv]);

  /* ── تغییرها ─────────────────────────────────────────────── */

  function kachelWaehlen(key: string) {
    setFehler(null);
    setZ((alt) => {
      if (alt.auswahl === key) return { ...alt, offen: null };
      const behandlung = katalog.gruppen.some((g) => g.key === key) ? null : key;
      // Behandlung neu: Antworten zurücksetzen, Hinweise und Behandler behalten
      return { ...LEER, plan: alt.plan, auswahl: key, behandlung, lieferart: standardFuer(behandlung) };
    });
  }

  function behandlungWaehlen(key: string) {
    setFehler(null);
    setZ((alt) =>
      alt.behandlung === key ? { ...alt, offen: null } : { ...LEER, plan: alt.plan, auswahl: alt.auswahl, behandlung: key, lieferart: standardFuer(key) },
    );
  }

  function antworten(blockId: string, wert: unknown) {
    setFehler(null);
    setZ((alt) => ({ ...alt, antworten: { ...alt.antworten, [blockId]: wert } }));
  }

  function bestaetigen(schrittId: string, blockId?: string, wert?: unknown) {
    setFehler(null);
    setZ((alt) => ({
      ...alt,
      antworten: blockId === undefined ? alt.antworten : { ...alt.antworten, [blockId]: wert },
      bestaetigt: { ...alt.bestaetigt, [schrittId]: true },
      offen: null,
    }));
  }

  function weiter(s: Extract<Schritt, { art: 'block' }>) {
    const text = blockFehler(s.block, z.antworten[s.block.id]);
    if (text) setFehler({ schritt: s.id, text });
    else bestaetigen(s.id);
  }

  function oeffnen(id: string) {
    setFehler(null);
    setZ((alt) => ({ ...alt, offen: id }));
  }

  /* ── نمایش هر قدم ───────────────────────────────────────────── */

  const hauptKacheln = [
    ...katalog.behandlungen.filter((b) => !b.groupKey),
    ...katalog.gruppen.map((g) => ({ ...g, groupKey: null as string | null })),
  ];
  // ترتیب: همان جای اولین عضو گروه در کاتالوگ
  const reihenfolge = (key: string) => {
    const i = katalog.behandlungen.findIndex((b) => b.key === key || b.groupKey === key);
    return i === -1 ? 999 : i;
  };
  hauptKacheln.sort((a, b) => reihenfolge(a.key) - reihenfolge(b.key));

  function zuText(s: Schritt): { titel: string; wert: string; bild?: string | null } {
    switch (s.art) {
      case 'patient':
        return { titel: 'Patient', wert: echt?.patient ? `${echt.patient.name} · ${echt.patient.code}` : '–' };
      case 'dateien': {
        const plaetze = [...new Set(belegt)].map((p) => (p === 'sonstiges' ? 'Weitere' : ABLAGE_NAMEN[p]));
        const teile = [`${belegt.length} ${belegt.length === 1 ? 'Datei' : 'Dateien'}${plaetze.length ? ` (${plaetze.join(', ')})` : ''}`];
        if (fehlend.length) teile.push(`folgt: ${fehlend.map((p) => DATEI_NAMEN[p]).join(', ')}`);
        return { titel: 'Dateien', wert: teile.join(' · ') };
      }
      case 'plan': {
        const b = echt?.behandler.find((x) => x.id === daten.plan.behandlerId);
        const text = daten.plan.text.trim();
        const teile = [b?.name, daten.plan.wunschtermin ? `Wunschtermin ${isoDatumText(daten.plan.wunschtermin)}` : null, text ? `„${text.length > 80 ? `${text.slice(0, 80)}…` : text}“` : null];
        return { titel: 'Hinweise', wert: teile.filter(Boolean).join(' · ') || 'keine' };
      }
      case 'behandlung': {
        const k = hauptKacheln.find((h) => h.key === z.auswahl);
        return { titel: 'Behandlung', wert: k?.name ?? '–', bild: k?.bild };
      }
      case 'gruppe':
        return { titel: s.gruppe.name, wert: eintrag?.name ?? '–', bild: eintrag?.bild };
      case 'block':
        return { titel: blockTitel(s.block), wert: blockText(s.block, z.antworten[s.block.id]) };
      case 'lieferart':
        return { titel: 'Lieferart', wert: lieferart ? LIEFERART_NAMEN[lieferart] : '–' };
      case 'tempo':
        return { titel: 'Tempo', wert: z.tempo === 'standard' || !z.tempo ? 'Standard' : `${TEMPO_NAMEN[z.tempo]} · ${tempoText(eintrag!, z.tempo)}` };
    }
  }

  function offenerInhalt(s: Schritt): { frage: string; hinweis?: string; inhalt: React.ReactNode; fuss?: React.ReactNode } {
    switch (s.art) {
      case 'behandlung':
        return {
          frage: 'Was möchten Sie bestellen?',
          inhalt: (
            <Kacheln
              label="Behandlung"
              wert={z.auswahl}
              onWahl={kachelWaehlen}
              kacheln={hauptKacheln.map((k) => ({ wert: k.key, name: k.name, preise: preisZeilen(k.preise, echt?.standardLieferart), tags: k.tags, bild: k.bild ? { foto: k.bild } : null }))}
            />
          ),
        };
      case 'gruppe':
        return {
          frage: s.gruppe.frage,
          inhalt: (
            <Kacheln
              label={s.gruppe.frage}
              wert={z.behandlung}
              onWahl={behandlungWaehlen}
              kacheln={katalog.behandlungen
                .filter((b) => b.groupKey === s.gruppe.key)
                .map((b) => ({ wert: b.key, name: b.name, preise: preisZeilen(b.preise, echt?.standardLieferart), tags: b.tags, bild: b.bild ? { foto: b.bild } : null }))}
            />
          ),
        };
      case 'lieferart':
        return {
          frage: 'Was sollen wir liefern?',
          inhalt: (
            <Kacheln
              label="Lieferart"
              wert={z.lieferart}
              onWahl={(l) => {
                setZ((alt) => ({ ...alt, lieferart: l as Lieferart, offen: null }));
              }}
              kacheln={eintrag!.lieferOptionen.map((l) => ({
                wert: l,
                name: LIEFERART_NAMEN[l],
                zeilen: [lieferartTexte[l], lieferPreis(eintrag!.preise, l)],
                bild: { foto: l === 'design' ? '/bilder/auswahl/nur-design.webp' : (eintrag!.bild ?? '/bilder/auswahl/nur-design.webp') },
              }))}
            />
          ),
        };
      case 'tempo': {
        const eilig = eintrag!.tempi.filter((t) => t !== 'standard').map((t) => TEMPO_KURZ[t]);
        return {
          frage: 'Wie schnell brauchen Sie die Arbeit?',
          hinweis:
            eilig.length > 1
              ? `${eilig.join(' und ')} sind für geeignete Fälle nach Verfügbarkeit möglich, jeweils mit eigenem Zuschlag.`
              : `${eilig[0]} ist für geeignete Fälle nach Verfügbarkeit möglich, mit Zuschlag.`,
          inhalt: (
            <ZeilenWahl
              label="Tempo"
              wert={z.tempo}
              onWahl={(w) => setZ((alt) => ({ ...alt, tempo: w as Tempo, offen: null }))}
              zeilen={eintrag!.tempi.map((t) => ({
                wert: t,
                name: TEMPO_NAMEN[t],
                zusatz: t === 'standard' ? `${tempoText(eintrag!, t)} · ${preisVon(eintrag!, lieferart)}` : tempoText(eintrag!, t),
              }))}
            />
          ),
        };
      }
      case 'block':
        return blockInhalt(s);
      case 'patient':
        return { frage: 'Für welchen Patienten?', inhalt: echt!.patientWahl(() => setZ((alt) => ({ ...alt, offen: null }))) };
      case 'dateien':
        return {
          frage: 'Dateien hochladen',
          hinweis:
            'Für jedes Design brauchen wir vollständige Scans beider Kiefer und die Bissregistrierung. Die Dateien laden im Hintergrund – Sie können währenddessen weiter ausfüllen.',
          inhalt: (
            <DateienWahl
              erforderlich={eintrag!.requiredFiles}
              uploads={{
                ...echt!.uploads,
                hochladen: (platz, d) => {
                  setFehler(null);
                  echt!.uploads.hochladen(platz, d);
                },
              }}
              nachgereicht={z.nachgereicht}
              onNachgereicht={(n) => {
                setFehler(null);
                setZ((alt) => ({ ...alt, nachgereicht: n }));
              }}
            />
          ),
          fuss: (
            <Button
              onClick={() => {
                if (fehlend.length && !z.nachgereicht) {
                  setFehler({
                    schritt: 'dateien',
                    text: `Es fehlen: ${fehlend.map((p) => DATEI_NAMEN[p]).join(', ')}. Bitte hochladen oder »Daten werden nachgereicht« ankreuzen.`,
                  });
                } else bestaetigen('dateien');
              }}
            >
              Weiter
            </Button>
          ),
        };
      case 'plan':
        return {
          frage: 'Noch etwas für uns?',
          inhalt: (
            <PlanFelder
              plan={daten.plan}
              behandler={echt!.behandler}
              heute={echt!.heute}
              onChange={(plan) => {
                setFehler(null);
                setZ((alt) => ({ ...alt, plan }));
              }}
            />
          ),
          fuss: <Button onClick={() => (planFehler ? setFehler({ schritt: 'plan', text: planFehler }) : bestaetigen('plan'))}>Weiter</Button>,
        };
    }
  }

  function blockInhalt(s: Extract<Schritt, { art: 'block' }>) {
    const b = s.block;
    const wert = z.antworten[b.id];
    const frage = blockFrage(b);
    const setzen = (neu: unknown) => antworten(b.id, neu);
    const sofort = (neu: string | boolean) => bestaetigen(s.id, b.id, neu);
    const weiterKnopf = <Button onClick={() => weiter(s)}>Weiter</Button>;
    const ueberspringen = !b.pflicht ? (
      <Button variant="text" onClick={() => bestaetigen(s.id, b.id, undefined)}>
        Überspringen
      </Button>
    ) : null;

    switch (b.typ) {
      case 'zahnleiste':
        return { frage, inhalt: <Zahnleiste werkzeuge={b.werkzeuge} wert={(wert as ZahnAuswahl) ?? {}} onChange={setzen} />, fuss: weiterKnopf };
      case 'kieferbogen':
        return {
          frage,
          hinweis: 'Links das Werkzeug wählen, dann die Zähne anklicken.',
          inhalt: <Kieferbogen wert={(wert as ProthesenAuswahl) ?? {}} onChange={setzen} />,
          fuss: weiterKnopf,
        };
      case 'bildauswahl':
        return {
          frage,
          inhalt: (
            <Kacheln
              label={b.label}
              wert={wert as string}
              onWahl={sofort}
              kacheln={b.optionen.map((o) => ({ wert: o.wert, name: o.label, bild: { illustration: o.bild } }))}
            />
          ),
          fuss: ueberspringen,
        };
      case 'auswahl':
        return { frage, inhalt: <Optionen label={b.label} optionen={b.optionen} wert={wert as string} onWahl={sofort} />, fuss: ueberspringen };
      case 'kiefer':
        return {
          frage,
          inhalt: (
            <Optionen
              label={b.label}
              optionen={(['OK', 'UK', 'beide'] as const).map((k) => ({ wert: k, label: KIEFER_NAMEN[k] }))}
              wert={wert as string}
              onWahl={sofort}
            />
          ),
          fuss: ueberspringen,
        };
      case 'schalter':
        return {
          frage,
          inhalt: (
            <Optionen
              label={b.label}
              optionen={[
                { wert: 'ja', label: 'Ja' },
                { wert: 'nein', label: 'Nein' },
              ]}
              wert={wert === true ? 'ja' : wert === false ? 'nein' : undefined}
              onWahl={(w) => sofort(w === 'ja')}
            />
          ),
        };
      case 'zahnfarbe':
        return { frage, inhalt: <ZahnfarbeWahl wert={wert as Zahnfarbe} onChange={setzen} farbanpassung={b.farbanpassung} />, fuss: weiterKnopf };
      case 'implantat':
        return {
          frage,
          inhalt: (
            <ImplantatAngabenFeld
              wert={wert as ImplantatAngaben}
              onChange={setzen}
              hersteller={katalog.implantatHersteller}
              positionen={implantatPositionen(eintrag!.formSchema.bloecke, z.antworten)}
            />
          ),
          fuss: weiterKnopf,
        };
      case 'aesthetik': {
        const a = (wert as Aesthetik) ?? {};
        return {
          frage,
          hinweis: b.pflicht ? undefined : 'Optional.',
          inhalt: (
            <div className="max-w-[760px] space-y-8">
              <MehrfachOptionen label="Ästhetik" optionen={AESTHETIK_MERKMALE} wert={a.merkmale ?? []} onChange={(m) => setzen({ ...a, merkmale: m })} />
              <Textfeld label="Gewünschte Gesamtästhetik" value={a.text ?? ''} onChange={(e) => setzen({ ...a, text: e.target.value })} />
            </div>
          ),
          fuss: weiterKnopf,
        };
      }
      case 'text':
        return {
          frage,
          inhalt: (
            <div className="max-w-[760px]">
              <Textfeld label={b.label} required={b.pflicht} value={(wert as string) ?? ''} onChange={(e) => setzen(e.target.value)} />
            </div>
          ),
          fuss: weiterKnopf,
        };
    }
  }

  /* ── صفحه ─────────────────────────────────────────────────── */

  const elemente: React.ReactNode[] = [];
  for (const [i, s] of schritte.entries()) {
    if (s.id === aktiv) {
      const o = offenerInhalt(s);
      const meldung = fehler?.schritt === s.id ? <Meldung art="fehler">{fehler.text}</Meldung> : null;
      elemente.push(
        <SchrittOffen key={s.id} id={s.id} nummer={i + 1} frage={o.frage} hinweis={o.hinweis} fuss={o.fuss || meldung ? <>{o.fuss}{meldung}</> : undefined}>
          {o.inhalt}
        </SchrittOffen>,
      );
    } else if (fertig(s)) {
      const t = zuText(s);
      elemente.push(<SchrittZu key={s.id} id={s.id} nummer={i + 1} titel={t.titel} wert={t.wert} bild={t.bild} onAendern={() => oeffnen(s.id)} />);
    } else {
      break;
    }
  }

  return (
    <div>
      {elemente}
      {alleFertig && aktiv === null ? (
        echt ? (
          <Zusammenfassung
            preis={preis}
            eintrag={eintrag}
            lieferart={lieferart}
            tempo={daten.tempo}
            fehlend={fehlend}
            laufend={echt.uploads.laufend}
            absenden={() => echt.absenden(daten)}
            schrittTitel={(id) => {
              const s = schritte.find((x) => x.id === id);
              return s ? zuText(s).titel : null;
            }}
            onOeffnen={oeffnen}
          />
        ) : (
          <Abschluss eintrag={eintrag} lieferart={lieferart} tempo={daten.tempo} preis={preis} onNeu={() => setZ(LEER)} />
        )
      ) : null}
      {!alleFertig ? <div className="border-t border-line" /> : null}
    </div>
  );
}

/** خلاصهٔ انتخاب: Behandlung، Lieferart، Tempo و قیمت؛ زیرش زمان یا Zuschlag همان Tempo. */
function AuswahlZeile({ eintrag, lieferart, tempo }: { eintrag: KatalogEintrag; lieferart: Lieferart | null; tempo: Tempo | null }) {
  return (
    <>
      <p className="mt-4 text-[17px] font-light">
        {eintrag.name}
        {lieferart ? ` · ${LIEFERART_NAMEN[lieferart]}` : ''}
        {tempo ? ` · ${TEMPO_KURZ[tempo]}` : ''} · {preisVon(eintrag, lieferart)}
      </p>
      {tempo ? <p className="mt-1 text-[15px] font-light text-muted">{tempoText(eintrag, tempo)}</p> : null}
    </>
  );
}

function Abschluss({ eintrag, lieferart, tempo, preis, onNeu }: { eintrag: KatalogEintrag; lieferart: Lieferart | null; tempo: Tempo | null; preis: PreisUebersicht | null; onNeu: () => void }) {
  return (
    <section id="schritt-abschluss" aria-labelledby="frage-abschluss" className="scroll-mt-[104px] border-y border-line py-12">
      <div className="grid grid-cols-1 gap-y-2 md:grid-cols-[56px_minmax(0,1fr)]">
        <span aria-hidden className="pt-1.5 text-[11px] text-rose">
          ✓
        </span>
        <div>
          <h2 id="frage-abschluss" tabIndex={-1} className="text-[clamp(26px,3vw,44px)] font-light leading-[1.05]">
            Auswahl vollständig.
          </h2>
          <AuswahlZeile eintrag={eintrag} lieferart={lieferart} tempo={tempo} />
          {preis ? <PreisKasten preis={preis} className="mt-8" /> : null}
          <p className="mt-6 max-w-[620px] text-[15px] font-light leading-relaxed text-muted">
            Als Nächstes folgen im Auftragsformular die Dateien: {eintrag.requiredFiles.map((d) => DATEI_NAMEN[d]).join(', ')}. In dieser Vorschau
            wird nichts gespeichert.
          </p>
          <div className="mt-8">
            <Button variant="text" onClick={onNeu}>
              Neu beginnen
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * پایان سفارش واقعی (Spec فاز ۱، D.۵): قیمت «ab»، Tempo، فایل‌هایی که بعداً می‌آیند، و
 * «Auftrag absenden». تا آپلودی در جریان است، ارسال منتظر می‌ماند. خطاهای سرور با لینک
 * به همان قدم نشان داده می‌شوند.
 */
function Zusammenfassung({
  preis,
  eintrag,
  lieferart,
  tempo,
  fehlend,
  laufend,
  absenden,
  schrittTitel,
  onOeffnen,
}: {
  preis: PreisUebersicht | null;
  eintrag: KatalogEintrag;
  lieferart: Lieferart | null;
  tempo: Tempo | null;
  fehlend: string[];
  laufend: number;
  absenden: () => Promise<SchrittFehler[] | null>;
  schrittTitel: (id: string) => string | null;
  onOeffnen: (id: string) => void;
}) {
  const [fehler, setFehler] = useState<SchrittFehler[]>([]);
  const [sendet, starten] = useTransition();

  return (
    <section id="schritt-abschluss" aria-labelledby="frage-abschluss" className="scroll-mt-[104px] border-y border-line py-12">
      <div className="grid grid-cols-1 gap-y-2 md:grid-cols-[56px_minmax(0,1fr)]">
        <span aria-hidden className="pt-1.5 text-[11px] text-rose">
          ✓
        </span>
        <div>
          <h2 id="frage-abschluss" tabIndex={-1} className="text-[clamp(26px,3vw,44px)] font-light leading-[1.05]">
            Bereit zum Absenden.
          </h2>
          <AuswahlZeile eintrag={eintrag} lieferart={lieferart} tempo={tempo} />
          {preis ? <PreisKasten preis={preis} className="mt-8" /> : null}
          {fehlend.length ? (
            <p className="mt-6 max-w-[620px] text-[15px] font-light leading-relaxed">
              <span className="mr-2 font-medium text-rose" aria-hidden>
                !
              </span>
              Noch nicht hochgeladen: {fehlend.map((p) => DATEI_NAMEN[p as keyof typeof DATEI_NAMEN]).join(', ')}. Der Auftrag geht als »Rückfrage« ein, bis
              die Daten da sind.
            </p>
          ) : null}
          {fehler.length ? (
            <ul role="alert" className="mt-6 space-y-2 text-[15px]">
              {fehler.map((f) => {
                const titel = schrittTitel(f.schritt);
                return (
                  <li key={`${f.schritt}-${f.text}`} className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-medium text-rose" aria-hidden>
                      !
                    </span>
                    <span>{titel ? `${titel}: ${f.text}` : f.text}</span>
                    {titel ? (
                      <button type="button" onClick={() => onOeffnen(f.schritt)} className="border-b border-current pb-0.5 text-[13px] text-muted hover:text-white">
                        Ändern
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
            <Button
              disabled={sendet || laufend > 0}
              onClick={() =>
                starten(async () => {
                  setFehler((await absenden()) ?? []);
                })
              }
            >
              {sendet ? 'Wird gesendet …' : 'Auftrag absenden'}
            </Button>
            {laufend ? (
              <p role="status" className="text-[15px] text-muted">
                {laufend === 1 ? 'Eine Datei wird' : `${laufend} Dateien werden`} noch hochgeladen …
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
