import 'server-only';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { dentists, orderFiles, orders, orderStatusHistory, patients, portalStatuses, practices, workTypes, type LieferOption, type Zuschlag } from '@/db/schema';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { entschluesseln } from '@/lib/crypto';
import { istAblage, type Ablage } from '@/lib/dateien/regeln';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { isoDatumText } from '@/lib/format';
import { eintragAus } from '@/lib/katalog/auswahl';
import { TEMPO_KURZ, type Tempo } from '@/lib/katalog/tempo';
import { blockText, blockTitel, LIEFERART_NAMEN, sichtbareBloecke } from './assistent';
import { auftragFuer, patientAnzeigen, type DateiInfo } from './entwurf';
import type { Block, DateiPlatz } from './form-schema';
import { AKTION_NOETIG, fortschritt, type Fortschritt } from './fortschritt';
import { terminText } from './listen';
import { nachrichtenVon, ungelesen, type Nachricht } from './nachrichten';
import { designVon, feedbackVon, type DesignStand } from './design';
import { DESIGN_STATUS } from './entwurf';
import { moeglicheUebergaenge, uebergangErlaubt, type Status } from './status';
import { LABOR_SCHRITTE } from './vorgang';
import { lieferTourTag } from '@/lib/touren/portal';
import { darf } from '@/lib/auth/roles';
import { dokumenteVon, type DokumentInfo } from '@/lib/dokumente/liste';
import { reklamationenZuAuftrag, type ReklamationInfo } from '@/lib/reklamationen/liste';
import { reklamierbar } from '@/lib/reklamationen/regeln';
import { faelle } from '@/lib/abrechnung/daten';
import { preisAusPositionen, type PreisUebersicht } from './preis';
import { loeschSperre } from './loeschen';

/**
 * همهٔ دادهٔ صفحهٔ هر سفارش (Spec فاز ۱، بخش F): ستون کناری، نوار پیشرفت با تاریخ‌ها، پیام‌ها،
 * فایل‌ها و جزئیات. نام بیمار فقط در پورتال رمزگشایی می‌شود (و ثبت می‌شود)؛ در پنل داخلی فقط
 * کد، و نام با «Name anzeigen». هر بار نمایش صفحه یک ردیف Data-Access-Log.
 */

export type PreisStand = {
  lieferart: 'design' | 'fertigung';
  preisAb: number | null;
  einheit: LieferOption['einheit'] | null;
  /** Zuschlag همان Tempo (Express یا Same-Day)؛ در Standard null */
  zuschlag: Zuschlag | null;
  bearbeitungszeit: string | null;
  /** Neuanfertigung nach Reklamation (Spec J) */
  neuanfertigung?: { reklamation: string; kostenlos: boolean };
};

export type AuftragDetail = {
  id: string;
  orderNo: string;
  status: Status;
  statusLabel: string;
  aktionNoetig: boolean;
  eingereicht: Date | null;
  praxis: { id: string; name: string; customerNo: string };
  patient: { id: string; code: string; name: string | null } | null;
  behandlung: { key: string; name: string; bild: string | null };
  lieferart: string | null;
  tempo: Tempo;
  termin: string | null;
  behandler: string | null;
  bearbeitungszeit: string | null;
  /** قیمت با جمع (فرم، صفحهٔ سفارش): تخمین، تعیین‌شده توسط Büro، یا روی Rechnung */
  preisUebersicht: PreisUebersicht | null;
  zeilen: { titel: string; wert: string }[];
  /** Zahnleiste/Kieferbogen für die Ansicht »Auftragsdetails«. */
  zahnschema: { block: Block; wert: unknown }[];
  fortschritt: Fortschritt;
  /** Datum jeder Etappe (letzter Eintrag im Statusverlauf), sonst null. */
  etappenDatum: (Date | null)[];
  dateien: DateiInfo[];
  nachrichten: Nachricht[];
  ungelesen: number;
  storno: { grund: string | null; am: Date | null } | null;
  pflichtDateien: DateiPlatz[];
  fehlendeDateien: DateiPlatz[];
  design: DesignStand;
  feedback: { bewertung: 'up' | 'down'; kommentar: string | null } | null;
  /** die Frage des Labors bei einer Rückfrage */
  rueckfrage: string | null;
  /** zugesagter Liefertermin (ISO) für das Eingabefeld im Labor */
  liefertermin: string | null;
  /** Zähne des Auftrags, für »Änderung anfordern« */
  zaehne: number[];
  /** einfache nächste Schritte des Labors */
  laborSchritte: { nach: Status; label: string }[];
  /** Ordination, Status »Versendet«: nächster Tourtag ihrer Tour (ISO), sonst null */
  lieferTour: string | null;
  freigabeNoetig: boolean;
  geliefertAm: Date | null;
  /** Konformitätserklärung und Lieferschein (ab »Übergabe«) */
  dokumente: DokumentInfo[];
  reklamationen: ReklamationInfo[];
  /** dieser Auftrag ist eine Neuanfertigung von … */
  neuanfertigungVon: { id: string; nr: string } | null;
  kann: {
    stornieren: boolean;
    nachreichen: boolean;
    dateien: boolean;
    schreiben: boolean;
    design: boolean;
    rueckfrage: boolean;
    freigeben: boolean;
    aenderung: boolean;
    feedback: boolean;
    reklamieren: boolean;
    /** Labor: Neuanfertigung, Reparatur, Ablehnung (Inhaber, Büro) */
    reklamationEntscheiden: boolean;
    /** Labor, nur Inhaber: irrtümlich angelegt und noch nichts daran gearbeitet (`loeschen.ts`) */
    loeschen: boolean;
  };
};

export async function auftragDetail(b: Bearbeiter, id: string, ip: string | null): Promise<AuftragDetail | { entwurf: true } | null> {
  const o = await auftragFuer(b, id);
  if (!o) return null;
  if (o.status === 'entwurf' || !o.workTypeKey || !o.orderNo) return { entwurf: true };
  const status = o.status as Status;

  const [[wt], [praxis], [label], [behandler], [patient], dateiZeilen, verlauf, nachrichten, neu] = await Promise.all([
    db().select().from(workTypes).where(eq(workTypes.key, o.workTypeKey)).limit(1),
    db().select({ id: practices.id, name: practices.name, customerNo: practices.customerNo }).from(practices).where(eq(practices.id, o.practiceId)).limit(1),
    db().select({ label: portalStatuses.label }).from(portalStatuses).where(eq(portalStatuses.key, o.status)).limit(1),
    o.dentistId ? db().select().from(dentists).where(eq(dentists.id, o.dentistId)).limit(1) : Promise.resolve([]),
    o.patientId ? db().select({ id: patients.id, code: patients.code }).from(patients).where(eq(patients.id, o.patientId)).limit(1) : Promise.resolve([]),
    db()
      .select()
      .from(orderFiles)
      .where(and(eq(orderFiles.orderId, o.id), isNull(orderFiles.deletedAt)))
      .orderBy(asc(orderFiles.createdAt)),
    db().select({ status: orderStatusHistory.status, at: orderStatusHistory.at }).from(orderStatusHistory).where(eq(orderStatusHistory.orderId, o.id)).orderBy(desc(orderStatusHistory.at)),
    nachrichtenVon(b, o.id),
    ungelesen(b, [o.id]),
  ]);
  const [design, feedback, dokumente, reklamationen, [ursprung]] = await Promise.all([
    designVon(b, o.id),
    feedbackVon(o.id),
    dokumenteVon([o.id]),
    reklamationenZuAuftrag(o.id),
    o.remakeOfId ? db().select({ id: orders.id, nr: orders.orderNo }).from(orders).where(eq(orders.id, o.remakeOfId)).limit(1) : Promise.resolve([]),
  ]);

  let name: string | null = null;
  if (patient && b.seite === 'praxis') name = (await patientAnzeigen(b, patient.id, o.id, ip))?.name ?? null;
  else await zugriffProtokollieren({ akteur: b, aktion: 'ansehen', patientIds: patient ? [patient.id] : [], orderId: o.id, ip });

  const eintrag = eintragAus(wt);
  // Preis wie in der Abrechnung: gespeicherte Positionen des Büros, sonst der Vorschlag aus dem Preis beim Absenden
  const [fall] = await faelle({ orderIds: [o.id] });
  const preisUebersicht = !fall
    ? null
    : status === 'storniert'
      ? preisAusPositionen(fall.positionen, 'storniert')
      : preisAusPositionen(fall.positionen, fall.rechnung ? 'verrechnet' : fall.gespeichert ? 'festgelegt' : 'schaetzung', fall.rechnung?.nummer ?? null);
  const stand = o.priceSnapshot as PreisStand | null;
  const bloecke = sichtbareBloecke(eintrag.formSchema, o.config).filter((block) => o.config[block.id] !== undefined);
  const zeilen = bloecke.map((block) => ({ titel: blockTitel(block), wert: blockText(block, o.config[block.id]) }));
  const behandlerName = behandler ? [behandler.title, behandler.firstName, behandler.lastName].filter(Boolean).join(' ') : null;
  if (o.deliveryKind) zeilen.push({ titel: 'Lieferart', wert: LIEFERART_NAMEN[o.deliveryKind] });
  const tempo = o.tempo ?? 'standard';
  zeilen.push({ titel: 'Tempo', wert: [TEMPO_KURZ[tempo], stand?.bearbeitungszeit].filter(Boolean).join(' · ') });
  if (behandlerName) zeilen.push({ titel: 'Behandler', wert: behandlerName });
  if (o.desiredDate) zeilen.push({ titel: 'Wunschtermin', wert: isoDatumText(o.desiredDate) });
  if (o.treatmentPlan) zeilen.push({ titel: 'Hinweise', wert: o.treatmentPlan });

  const vorher = verlauf.find((v, i) => i > 0 && v.status !== 'rueckfrage' && v.status !== status)?.status as Status | undefined;
  const umstaende = { lieferart: o.deliveryKind, freigabeNoetig: wt.needsFreigabe };
  const f = fortschritt(status, { ...umstaende, einprobe: o.config.einprobe === true, vorher });
  const etappenDatum = f.etappen.map((e, i) => (i <= f.aktuell ? (verlauf.find((v) => v.status === e.key)?.at ?? null) : null));

  // Ordination: eigene Dateien; Labor: alle
  const dateien: DateiInfo[] = dateiZeilen
    .filter((d) => d.kind !== 'design' && (b.seite === 'labor' || d.origin === 'praxis'))
    .map((d) => ({ id: d.id, platz: (d.slot && istAblage(d.slot) ? d.slot : 'sonstiges') as Ablage, name: entschluesseln(d.filenameEnc), groesse: d.size }));
  const pflicht = eintrag.requiredFiles;
  const offen = !['storniert', 'abgeschlossen'].includes(status);

  return {
    id: o.id,
    orderNo: o.orderNo,
    status,
    statusLabel: label?.label ?? status,
    aktionNoetig: b.seite === 'praxis' && AKTION_NOETIG.includes(status),
    eingereicht: o.submittedAt,
    praxis: praxis ?? { id: o.practiceId, name: '–', customerNo: '–' },
    patient: patient ? { id: patient.id, code: patient.code, name } : null,
    behandlung: { key: eintrag.key, name: eintrag.name, bild: eintrag.bild },
    lieferart: o.deliveryKind ? LIEFERART_NAMEN[o.deliveryKind] : null,
    tempo,
    termin: terminText(o),
    behandler: behandlerName,
    bearbeitungszeit: stand?.bearbeitungszeit ?? null,
    preisUebersicht,
    zeilen,
    zahnschema: bloecke.filter((x) => x.typ === 'zahnleiste' || x.typ === 'kieferbogen').map((block) => ({ block, wert: o.config[block.id] })),
    fortschritt: f,
    etappenDatum,
    dateien,
    nachrichten,
    ungelesen: neu.get(o.id) ?? 0,
    storno: status === 'storniert' ? { grund: o.cancelReason, am: o.canceledAt } : null,
    pflichtDateien: pflicht,
    fehlendeDateien: pflicht.filter((p) => !dateiZeilen.some((d) => d.slot === p)),
    design,
    feedback,
    rueckfrage: status === 'rueckfrage' ? rueckfrageText(nachrichten, verlauf) : null,
    liefertermin: o.dueDate,
    freigabeNoetig: wt.needsFreigabe,
    geliefertAm: o.deliveredAt,
    dokumente: dokumente.get(o.id) ?? [],
    reklamationen,
    neuanfertigungVon: ursprung?.nr ? { id: ursprung.id, nr: ursprung.nr } : null,
    zaehne: zaehneVon(o.config, bloecke),
    lieferTour: b.seite === 'praxis' && status === 'versendet' && o.deliveryKind === 'fertigung' ? await lieferTourTag(o.practiceId) : null,
    laborSchritte:
      b.seite === 'labor'
        ? moeglicheUebergaenge(status, 'labor', umstaende).flatMap((nach) => (LABOR_SCHRITTE[nach] ? [{ nach, label: LABOR_SCHRITTE[nach]! }] : []))
        : [],
    kann: {
      stornieren: moeglicheUebergaenge(status, b.seite, umstaende).includes('storniert'),
      nachreichen: status === 'rueckfrage',
      dateien: offen,
      schreiben: offen || status === 'abgeschlossen',
      design: b.seite === 'labor' && DESIGN_STATUS.includes(status),
      rueckfrage: b.seite === 'labor' && uebergangErlaubt(status, 'rueckfrage', 'labor', umstaende),
      freigeben: b.seite === 'praxis' && status === 'design_freigabe' && design.aktuell?.status === 'offen',
      aenderung:
        b.seite === 'praxis' &&
        ((status === 'design_freigabe' && design.aktuell?.status === 'offen') || (status === 'freigegeben' && o.deliveryKind === 'design' && design.aktuell?.status === 'freigegeben')),
      feedback: b.seite === 'praxis' && Boolean(o.approvedAt) && !feedback && status !== 'storniert',
      reklamieren: reklamierbar(status, o.deliveryKind) && !reklamationen.some((r) => r.entscheidung === 'offen'),
      reklamationEntscheiden: b.seite === 'labor' && darf(b.rolle, 'reklamationen.entscheiden'),
      loeschen: b.seite === 'labor' && darf(b.rolle, 'auftraege.loeschen') && (await loeschSperre(db(), o)) === null,
    },
  };
}

/** Frage des Labors zur aktuellen Rückfrage: letzte Nachricht des Labors seit Beginn der Rückfrage. */
function rueckfrageText(nachrichten: Nachricht[], verlauf: { status: string; at: Date }[]): string | null {
  const seit = verlauf.find((v) => v.status === 'rueckfrage')?.at;
  if (!seit) return null;
  const frage = [...nachrichten].reverse().find((n) => n.von === 'labor' && n.art === 'nachricht' && !n.intern && n.am.getTime() >= seit.getTime() - 5000);
  return frage?.text ?? null;
}

function zaehneVon(config: Record<string, unknown>, bloecke: Block[]): number[] {
  const zaehne = new Set<number>();
  for (const b of bloecke) {
    if ((b.typ === 'zahnleiste' || b.typ === 'kieferbogen') && config[b.id] && typeof config[b.id] === 'object') {
      for (const fdi of Object.keys(config[b.id] as object)) zaehne.add(Number(fdi));
    }
  }
  return [...zaehne].filter(Number.isInteger).sort((a, b2) => a - b2);
}
