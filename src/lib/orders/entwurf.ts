import 'server-only';
import { and, asc, count, desc, eq, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { dentists, messageFiles, orderFiles, orders, orderTeeth, patients, practices, workTypes } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { config as appConfig } from '@/lib/config';
import { entschluesseln, verschluesseln } from '@/lib/crypto';
import { ABLAGEN, dateiPruefen, istAblage, type Ablage } from '@/lib/dateien/regeln';
import { zugriffProtokollieren } from '@/lib/datenzugriff';
import { AppError, istDoppelt } from '@/lib/errors';
import { datum, heuteIso } from '@/lib/format';
import { auswahlKatalogAusDb } from '@/lib/katalog/aus-datenbank';
import { istEilig, TEMPO_ZEIT, zuschlagVon } from '@/lib/katalog/tempo';
import { auftragsnummer, naechsteNummer } from '@/lib/nummern';
import { gleicherName, passt, patientenCode } from '@/lib/patienten/suche';
import { loeschen, speichern, ZuGross } from '@/lib/storage';
import { DATEI_NAMEN } from './form-schema';
import { auftragPruefen, entwurfSchema, farbeKurz, zaehneAus, type EntwurfDaten, type SchrittFehler } from './pruefung';
import { statusWechseln } from './status';

/**
 * عملیات فرم «Neuer Auftrag» در سرور، مشترک بین پورتال و پنل داخلی (Spec فاز ۱،
 * بخش D). server actionها و route handlerها فقط `Bearbeiter` را از نشست می‌سازند
 * و این‌ها را صدا می‌زنند. هر خطای کاربر `AppError` آلمانی است.
 *
 * Entwurf همان ردیف `orders` با status «entwurf» است و با اولین انتخاب بیمار ساخته
 * می‌شود؛ از آن به بعد هر تغییر فرم (با debounce) ذخیره می‌شود.
 */

export type PatientTreffer = { id: string; code: string; name: string; geburtsdatum: string | null; zuletzt: string | null };
export type DateiInfo = { id: string; platz: Ablage; name: string; groesse: number };
export type BehandlerOption = { id: string; name: string };

const MAX_DATEIEN = 60;
/** Status, in denen das Labor ein (neues) Design hochladen darf. */
export const DESIGN_STATUS: readonly string[] = ['eingereicht', 'in_planung', 'in_ueberarbeitung', 'design_freigabe'];
const uuid = z.uuid();

/* ── دسترسی ───────────────────────────────────────────────────── */

/** Ordination این کار: در پورتال از نشست؛ در پنل داخلی از ورودی، فقط اگر فعال باشد. */
async function praxisFuer(b: Bearbeiter, ordinationId: string | null | undefined): Promise<string> {
  if (b.seite === 'praxis') return b.practiceId;
  const id = uuid.safeParse(ordinationId);
  if (id.success) {
    const [p] = await db()
      .select({ id: practices.id })
      .from(practices)
      .where(and(eq(practices.id, id.data), eq(practices.isActive, true)))
      .limit(1);
    if (p) return p.id;
  }
  throw new AppError('Ordination nicht gefunden.');
}

/** Entwurf فقط برای طرفی است که آن را ساخته: Ordination در پورتال، لابراتوار برای سفارش تلفنی. */
export const quelleVon = (b: Bearbeiter) => (b.seite === 'praxis' ? 'portal' : 'labor');

/**
 * سفارش، فقط اگر این Bearbeiter اجازهٔ دیدنش را دارد؛ وگرنه null (برای بیرون: «nicht gefunden»).
 * Ordination فقط سفارش‌های خودش را می‌بیند؛ Entwurf طرف دیگر برای هیچ‌کس دیده نمی‌شود.
 */
export async function auftragFuer(b: Bearbeiter, orderId: string) {
  if (!uuid.safeParse(orderId).success) return null;
  const [o] = await db()
    .select()
    .from(orders)
    .where(b.seite === 'praxis' ? and(eq(orders.id, orderId), eq(orders.practiceId, b.practiceId)) : eq(orders.id, orderId))
    .limit(1);
  if (!o || (o.status === 'entwurf' && o.source !== quelleVon(b))) return null;
  return o;
}

async function entwurfOderFehler(b: Bearbeiter, orderId: string) {
  const o = await auftragFuer(b, orderId);
  if (!o) throw new AppError('Auftrag nicht gefunden.');
  if (o.status !== 'entwurf') throw new AppError('Dieser Auftrag wurde bereits abgeschickt.');
  return o;
}

const akteurVon = (b: Bearbeiter) => ({ kind: b.kind, id: b.id, label: b.label });

/* ── Behandler ────────────────────────────────────────────────── */

export async function behandlerVon(practiceId: string): Promise<BehandlerOption[]> {
  const zeilen = await db()
    .select()
    .from(dentists)
    .where(and(eq(dentists.practiceId, practiceId), eq(dentists.isActive, true)))
    .orderBy(asc(dentists.lastName), asc(dentists.firstName));
  return zeilen.map((d) => ({ id: d.id, name: [d.title, d.firstName, d.lastName].filter(Boolean).join(' ') }));
}

/* ── Patienten ────────────────────────────────────────────────── */

type PatientZeile = typeof patients.$inferSelect;

function klartext(p: PatientZeile) {
  return {
    vorname: entschluesseln(p.firstNameEnc),
    nachname: entschluesseln(p.lastNameEnc),
    geburtsdatum: p.birthDateEnc ? entschluesseln(p.birthDateEnc) : null,
  };
}

function trefferAus(p: PatientZeile, k: ReturnType<typeof klartext>, zuletzt: string | null): PatientTreffer {
  return {
    id: p.id,
    code: p.code,
    name: `${k.vorname} ${k.nachname}`,
    geburtsdatum: k.geburtsdatum ? k.geburtsdatum.split('-').reverse().join('.') : null,
    zuletzt,
  };
}

/** نام یک بیمار برای نمایش، با ثبت در Data-Access-Log. */
export async function patientAnzeigen(b: Bearbeiter, patientId: string, orderId: string | null, ip: string | null): Promise<PatientTreffer | null> {
  const [p] = await db().select().from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!p || (b.seite === 'praxis' && p.practiceId !== b.practiceId)) return null;
  await zugriffProtokollieren({ akteur: b, aktion: 'entschluesseln', patientIds: [p.id], orderId, ip });
  return trefferAus(p, klartext(p), null);
}

/**
 * جست‌وجوی بیمار در همان Ordination. نام‌ها رمزگذاری شده‌اند، پس همه رمزگشایی و این‌جا
 * فیلتر می‌شوند (برای حجم DDL کافی است؛ Spec D.۱). فقط نتیجه‌هایی که برمی‌گردند ثبت می‌شوند.
 * بدون متن جست‌وجو: آخرین بیماران.
 */
export async function patientenSuchen(b: Bearbeiter, e: { suche: string; ordinationId?: string | null; ip: string | null }): Promise<PatientTreffer[]> {
  const practiceId = await praxisFuer(b, e.ordinationId);
  const suche = e.suche.slice(0, 80);
  const [zeilen, letzte] = await Promise.all([
    db().select().from(patients).where(eq(patients.practiceId, practiceId)),
    db()
      .select({ patientId: orders.patientId, name: workTypes.name, am: orders.submittedAt })
      .from(orders)
      .innerJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .where(and(eq(orders.practiceId, practiceId), ne(orders.status, 'entwurf')))
      .orderBy(desc(orders.submittedAt)),
  ]);
  const zuletzt = new Map<string, { text: string; am: Date }>();
  for (const l of letzte) {
    if (l.patientId && l.am && !zuletzt.has(l.patientId)) zuletzt.set(l.patientId, { text: `${l.name} · ${datum(l.am)}`, am: l.am });
  }
  const aktivitaet = (p: PatientZeile) => Math.max(p.updatedAt.getTime(), zuletzt.get(p.id)?.am.getTime() ?? 0);

  const treffer = zeilen
    .map((p) => ({ p, k: klartext(p) }))
    .filter(({ p, k }) => passt(suche, { ...k, code: p.code }))
    .sort((a, b2) => aktivitaet(b2.p) - aktivitaet(a.p))
    .slice(0, suche.trim() ? 20 : 6)
    .map(({ p, k }) => trefferAus(p, k, zuletzt.get(p.id)?.text ?? null));

  if (treffer.length) await zugriffProtokollieren({ akteur: b, aktion: 'entschluesseln', patientIds: treffer.map((t) => t.id), ip: e.ip });
  return treffer;
}

const nameFeld = z
  .string()
  .trim()
  .min(1, 'Bitte Vor- und Nachnamen angeben.')
  .max(80, 'Der Name ist zu lang.')
  // بدون نویسهٔ کنترلی در نام
  .refine((n) => !/[\u0000-\u001f\u007f<>]/.test(n), 'Der Name enthält ungültige Zeichen.');

export const patientEingabe = z.object({
  vorname: nameFeld,
  nachname: nameFeld,
  geburtsdatum: z
    .string()
    .trim()
    .refine((d) => d === '' || (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))), 'Bitte ein gültiges Geburtsdatum angeben.')
    .refine((d) => d === '' || (d >= '1900-01-01' && d <= heuteIso()), 'Bitte ein gültiges Geburtsdatum angeben.'),
  /** «Trotzdem neu anlegen» nach dem Hinweis auf einen gleichnamigen Patienten. */
  trotzdem: z.boolean().default(false),
});

/**
 * بیمار تازه. اگر بیماری با همین نام (و اگر هر دو دارند، همین تاریخ تولد) هست، اول
 * همان را پیشنهاد می‌دهد؛ با `trotzdem` در هر حال ساخته می‌شود.
 */
export async function patientAnlegen(
  b: Bearbeiter,
  e: { eingabe: unknown; ordinationId?: string | null; ip: string | null },
): Promise<{ patient: PatientTreffer } | { doppelt: PatientTreffer }> {
  const r = patientEingabe.safeParse(e.eingabe);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { vorname, nachname, geburtsdatum, trotzdem } = r.data;
  const practiceId = await praxisFuer(b, e.ordinationId);

  if (!trotzdem) {
    const vorhanden = await db().select().from(patients).where(eq(patients.practiceId, practiceId));
    for (const p of vorhanden) {
      const k = klartext(p);
      if (gleicherName(k, { vorname, nachname }) && (!k.geburtsdatum || !geburtsdatum || k.geburtsdatum === geburtsdatum)) {
        await zugriffProtokollieren({ akteur: b, aktion: 'entschluesseln', patientIds: [p.id], ip: e.ip });
        return { doppelt: trefferAus(p, k, null) };
      }
    }
  }

  for (let versuch = 0; versuch < 6; versuch++) {
    const code = patientenCode();
    try {
      const [p] = await db()
        .insert(patients)
        .values({
          practiceId,
          code,
          firstNameEnc: verschluesseln(vorname),
          lastNameEnc: verschluesseln(nachname),
          birthDateEnc: geburtsdatum ? verschluesseln(geburtsdatum) : null,
          createdByKind: b.kind,
          createdById: b.id,
        })
        .returning();
      // ohne Namen: Patientendaten gehören nicht ins Audit-Log
      await logAudit({ aktion: 'patient_angelegt', akteur: akteurVon(b), ziel: { typ: 'patient', id: p.id }, details: { code }, ip: e.ip });
      return { patient: trefferAus(p, { vorname, nachname, geburtsdatum: geburtsdatum || null }, null) };
    } catch (err) {
      if (!istDoppelt(err)) throw err; // Code schon vergeben → neuer Versuch
    }
  }
  throw new AppError('Der Patient konnte nicht angelegt werden. Bitte erneut versuchen.');
}

/** بیمار Entwurf را تعیین می‌کند؛ اگر Entwurf هنوز نیست، می‌سازدش. */
export async function patientFestlegen(
  b: Bearbeiter,
  e: { entwurfId: string | null; patientId: string; ordinationId?: string | null },
): Promise<{ entwurfId: string }> {
  const entwurf = e.entwurfId ? await entwurfOderFehler(b, e.entwurfId) : null;
  const practiceId = entwurf?.practiceId ?? (await praxisFuer(b, e.ordinationId));
  const [p] = uuid.safeParse(e.patientId).success
    ? await db()
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, e.patientId), eq(patients.practiceId, practiceId)))
        .limit(1)
    : [];
  if (!p) throw new AppError('Patient nicht gefunden.');

  if (entwurf) {
    await db().update(orders).set({ patientId: p.id, updatedAt: new Date() }).where(eq(orders.id, entwurf.id));
    return { entwurfId: entwurf.id };
  }
  const [neu] = await db()
    .insert(orders)
    .values({ practiceId, patientId: p.id, source: quelleVon(b), createdByKind: b.kind, createdById: b.id })
    .returning({ id: orders.id });
  return { entwurfId: neu.id };
}

/* ── Entwurf ──────────────────────────────────────────────────── */

type Zustand = { auswahl?: string | null; bestaetigt?: Record<string, boolean>; nachgereicht?: boolean };

export async function entwurfSpeichern(b: Bearbeiter, entwurfId: string, roh: unknown): Promise<void> {
  const o = await entwurfOderFehler(b, entwurfId);
  const r = entwurfSchema.safeParse(roh);
  if (!r.success) throw new AppError('Der Entwurf konnte nicht gespeichert werden.');
  const d = r.data;

  if (d.behandlung) {
    const [wt] = await db()
      .select({ key: workTypes.key })
      .from(workTypes)
      .where(and(eq(workTypes.key, d.behandlung), eq(workTypes.isActive, true)))
      .limit(1);
    if (!wt) throw new AppError('Diese Behandlung ist nicht mehr verfügbar.');
  }
  let dentistId: string | null = null;
  if (d.plan.behandlerId) {
    const [x] = await db()
      .select({ id: dentists.id })
      .from(dentists)
      .where(and(eq(dentists.id, d.plan.behandlerId), eq(dentists.practiceId, o.practiceId)))
      .limit(1);
    dentistId = x?.id ?? null;
  }
  const zustand: Zustand = { auswahl: d.auswahl, bestaetigt: d.bestaetigt, nachgereicht: d.nachgereicht };
  await db()
    .update(orders)
    .set({
      workTypeKey: d.behandlung,
      config: d.antworten,
      deliveryKind: d.lieferart,
      tempo: d.tempo,
      dentistId,
      desiredDate: d.plan.wunschtermin,
      treatmentPlan: d.plan.text.trim() || null,
      draftState: zustand,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.id, o.id), eq(orders.status, 'entwurf')));
}

/** Entwurf برای ادامهٔ کار. نام بیمار و نام فایل‌ها رمزگشایی و ثبت می‌شوند. */
export async function entwurfLaden(b: Bearbeiter, entwurfId: string, ip: string | null) {
  const o = await auftragFuer(b, entwurfId);
  if (!o) return null;
  if (o.status !== 'entwurf') return { abgeschickt: true as const, id: o.id };
  const z = (o.draftState ?? {}) as Zustand;
  const daten: EntwurfDaten = {
    auswahl: z.auswahl ?? null,
    behandlung: o.workTypeKey,
    antworten: o.config,
    bestaetigt: z.bestaetigt ?? {},
    lieferart: o.deliveryKind,
    tempo: o.tempo,
    nachgereicht: z.nachgereicht ?? false,
    plan: { behandlerId: o.dentistId, wunschtermin: o.desiredDate, text: o.treatmentPlan ?? '' },
  };
  const [patient, dateien] = await Promise.all([o.patientId ? patientAnzeigen(b, o.patientId, o.id, ip) : null, dateienVon(o.id)]);
  return { abgeschickt: false as const, id: o.id, practiceId: o.practiceId, daten, patient, dateien };
}

export async function dateienVon(orderId: string): Promise<DateiInfo[]> {
  const zeilen = await db()
    .select()
    .from(orderFiles)
    .where(and(eq(orderFiles.orderId, orderId), isNull(orderFiles.deletedAt)))
    .orderBy(asc(orderFiles.createdAt));
  const platzVon = (slot: string | null): Ablage => (slot && istAblage(slot) ? slot : 'sonstiges');
  return zeilen
    .map((f) => ({ id: f.id, platz: platzVon(f.slot), name: entschluesseln(f.filenameEnc), groesse: f.size }))
    .sort((a, b) => ABLAGEN.indexOf(a.platz) - ABLAGEN.indexOf(b.platz)); // OK, UK, Biss, …, Weitere
}

export async function entwurfVerwerfen(b: Bearbeiter, entwurfId: string, ip: string | null): Promise<void> {
  const o = await entwurfOderFehler(b, entwurfId);
  const dateien = await db().select({ key: orderFiles.storageKey }).from(orderFiles).where(eq(orderFiles.orderId, o.id));
  await db()
    .delete(orders)
    .where(and(eq(orders.id, o.id), eq(orders.status, 'entwurf')));
  for (const d of dateien) await loeschen(d.key);
  await logAudit({ aktion: 'entwurf_verworfen', akteur: akteurVon(b), ziel: { typ: 'auftrag', id: o.id }, details: { dateien: dateien.length }, ip });
}

/* ── Dateien ──────────────────────────────────────────────────── */

export type HochladenErgebnis = { ok: true; datei: DateiInfo } | { ok: false; status: number; fehler: string };

/**
 * یک فایل را مستقیم از بدنهٔ درخواست روی دیسک می‌نویسد (بدون نگه‌داشتن در حافظه)،
 * با سقف `UPLOAD_MAX_MB`. در Entwurf، و بعد از ارسال برای «Daten nachreichen»، فایل‌های
 * بیشتر و پیوست پیام‌ها (تا وقتی سفارش storniert یا abgeschlossen نیست).
 */
export async function dateiHinzufuegen(
  b: Bearbeiter,
  e: { orderId: string; platz: string | null; name: string | null; laenge: number | null; inhalt: ReadableStream<Uint8Array> | null },
): Promise<HochladenErgebnis> {
  const o = await auftragFuer(b, e.orderId);
  if (!o) return { ok: false, status: 404, fehler: 'Auftrag nicht gefunden.' };
  // Entwurf, oder ein gesendeter Auftrag, der noch läuft (Daten nachreichen, Anhänge von Nachrichten);
  // abgeschlossen: nur noch Anhänge von Nachrichten (z. B. Fotos zu einer Reklamation)
  if (o.status === 'storniert' || (o.status === 'abgeschlossen' && e.platz !== 'nachricht')) return { ok: false, status: 409, fehler: 'Dieser Auftrag ist abgeschlossen.' };
  // Anhänge von Nachrichten gibt es erst nach dem Absenden (Kommunikation)
  if (!e.platz || !istAblage(e.platz) || (e.platz === 'nachricht' && o.status === 'entwurf')) return { ok: false, status: 400, fehler: 'Unbekannter Ablageplatz.' };
  // Design-Dateien lädt nur das Labor hoch, solange am Design gearbeitet wird (Spec G)
  if (e.platz === 'design' && (b.seite !== 'labor' || !DESIGN_STATUS.includes(o.status))) return { ok: false, status: 403, fehler: 'Design-Dateien können gerade nicht hochgeladen werden.' };
  const maxBytes = appConfig().UPLOAD_MAX_MB * 1024 * 1024;
  const pruefung = dateiPruefen(e.name ?? '', e.laenge, maxBytes);
  if (!pruefung.ok) return { ok: false, status: 400, fehler: pruefung.fehler };
  if (!e.inhalt) return { ok: false, status: 400, fehler: 'Die Datei ist leer.' };
  const [{ anzahl }] = await db()
    .select({ anzahl: count() })
    .from(orderFiles)
    .where(and(eq(orderFiles.orderId, o.id), isNull(orderFiles.deletedAt)));
  if (anzahl >= MAX_DATEIEN) return { ok: false, status: 409, fehler: `Pro Auftrag sind höchstens ${MAX_DATEIEN} Dateien möglich.` };

  let gespeichert: Awaited<ReturnType<typeof speichern>>;
  try {
    gespeichert = await speichern(e.inhalt, maxBytes);
  } catch (err) {
    if (err instanceof ZuGross) return { ok: false, status: 413, fehler: `Die Datei ist größer als ${appConfig().UPLOAD_MAX_MB} MB.` };
    return { ok: false, status: 400, fehler: 'Die Übertragung wurde unterbrochen. Bitte erneut versuchen.' };
  }
  if (gespeichert.groesse === 0) {
    await loeschen(gespeichert.key);
    return { ok: false, status: 400, fehler: 'Die Datei ist leer.' };
  }
  const [f] = await db()
    .insert(orderFiles)
    .values({
      orderId: o.id,
      origin: b.seite,
      kind: e.platz === 'design' ? 'design' : pruefung.art,
      slot: e.platz,
      storageKey: gespeichert.key,
      filenameEnc: verschluesseln(pruefung.name),
      mime: pruefung.mime,
      size: gespeichert.groesse,
      sha256: gespeichert.sha256,
      uploadedByKind: b.kind,
      uploadedById: b.id,
    })
    .returning({ id: orderFiles.id });
  await db().update(orders).set({ updatedAt: new Date() }).where(eq(orders.id, o.id));
  return { ok: true, datei: { id: f.id, platz: e.platz, name: pruefung.name, groesse: gespeichert.groesse } };
}

/**
 * فایلی که اشتباه آپلود شده (و از دیسک) برداشته می‌شود: در Entwurf، یا پیوستی که همین کاربر
 * بالا برده و هنوز با پیامی فرستاده نشده است. فایل‌های ارسال‌شده می‌مانند.
 */
export async function dateiEntfernen(b: Bearbeiter, dateiId: string): Promise<void> {
  if (!uuid.safeParse(dateiId).success) throw new AppError('Datei nicht gefunden.');
  const [f] = await db().select().from(orderFiles).where(eq(orderFiles.id, dateiId)).limit(1);
  if (!f) throw new AppError('Datei nicht gefunden.');
  const o = await auftragFuer(b, f.orderId);
  if (!o) throw new AppError('Datei nicht gefunden.');
  if (o.status !== 'entwurf') {
    // noch nicht gesendetes Design (Labor) oder noch nicht gesendeter Anhang (eigener)
    const designOffen = f.kind === 'design' && f.designRevision === null && b.seite === 'labor';
    const [verknuepft] = await db().select({ id: messageFiles.fileId }).from(messageFiles).where(eq(messageFiles.fileId, f.id)).limit(1);
    if (!designOffen && (f.slot !== 'nachricht' || f.uploadedById !== b.id || verknuepft)) throw new AppError('Gesendete Dateien können nicht entfernt werden.');
  }
  await db().delete(orderFiles).where(eq(orderFiles.id, f.id));
  await loeschen(f.storageKey);
}

/* ── Absenden ─────────────────────────────────────────────────── */

const jahrWien = () => Number(heuteIso().slice(0, 4));

/**
 * ارسال: همهٔ قاعده‌های فرم دوباره در سرور بررسی می‌شوند. شمارهٔ «A-2026-0001»، دندان‌ها،
 * قیمت لحظهٔ ارسال و وضعیت در یک تراکنش ذخیره می‌شوند. اگر فایل لازمی با «Daten werden
 * nachgereicht» نیامده، وضعیت مستقیم «rueckfrage» است و پیام خودکار می‌گوید چه چیزی کم است.
 */
export async function auftragAbsenden(
  b: Bearbeiter,
  e: { entwurfId: string; daten: unknown; ip: string | null },
): Promise<{ fehler: SchrittFehler[] } | { orderId: string; orderNo: string }> {
  await entwurfSpeichern(b, e.entwurfId, e.daten);
  const o = await entwurfOderFehler(b, e.entwurfId);
  const d = entwurfSchema.parse(e.daten);

  const [katalog, plaetze, behandler, [praxis]] = await Promise.all([
    auswahlKatalogAusDb(),
    db()
      .selectDistinct({ slot: orderFiles.slot })
      .from(orderFiles)
      .where(and(eq(orderFiles.orderId, o.id), isNull(orderFiles.deletedAt))),
    behandlerVon(o.practiceId),
    db().select({ isActive: practices.isActive }).from(practices).where(eq(practices.id, o.practiceId)).limit(1),
  ]);
  if (!praxis?.isActive) throw new AppError('Diese Ordination ist nicht aktiv.');
  const eintrag = katalog.behandlungen.find((k) => k.key === d.behandlung) ?? null;
  const p = auftragPruefen(eintrag, d, {
    dateiPlaetze: plaetze.flatMap((x) => (x.slot ? [x.slot] : [])),
    patientGewaehlt: Boolean(o.patientId),
    behandlerNoetig: behandler.length > 0,
    heute: heuteIso(),
  });
  if (d.plan.behandlerId && !behandler.some((x) => x.id === d.plan.behandlerId)) {
    p.fehler.push({ schritt: 'plan', text: 'Bitte die Behandlerin oder den Behandler wählen.' });
  }
  if (p.fehler.length || !eintrag || !p.lieferart || !d.tempo) return { fehler: p.fehler };
  const lieferart = p.lieferart;
  const tempo = d.tempo;

  const ergebnis = await db().transaction(async (tx) => {
    const [wt] = await tx.select().from(workTypes).where(eq(workTypes.key, eintrag.key)).limit(1);
    const jahr = jahrWien();
    const orderNo = auftragsnummer(jahr, await naechsteNummer(tx, 'auftrag', jahr));
    const nach = p.fehlendeDateien.length ? 'rueckfrage' : 'eingereicht';
    const option = wt.deliveryOptions[lieferart];
    await statusWechseln(tx, {
      orderId: o.id,
      von: 'entwurf',
      nach,
      wer: b.seite,
      akteur: { kind: b.kind, id: b.id },
      umstaende: { lieferart, freigabeNoetig: wt.needsFreigabe },
      ereignis:
        nach === 'rueckfrage'
          ? `Auftrag eingereicht. Es fehlen noch: ${p.fehlendeDateien.map((x) => DATEI_NAMEN[x]).join(', ')}. Bitte reichen Sie die Daten nach.`
          : undefined,
      felder: {
        orderNo,
        workTypeKey: eintrag.key,
        config: p.config,
        deliveryKind: lieferart,
        tempo,
        shade: farbeKurz(eintrag.formSchema.bloecke, p.config),
        priceSnapshot: {
          lieferart,
          preisAb: option?.preisAb ?? null,
          einheit: option?.einheit ?? null,
          // Zuschlag همان Tempo (Expresszuschlag یا Same-Day-Zuschlag)، در لحظهٔ ارسال
          zuschlag: istEilig(tempo) ? zuschlagVon(wt, tempo) : null,
          bearbeitungszeit: istEilig(tempo) ? TEMPO_ZEIT[tempo] : wt.turnaroundLabel,
        },
        dentistId: d.plan.behandlerId,
        desiredDate: d.plan.wunschtermin,
        treatmentPlan: d.plan.text.trim() || null,
        draftState: null,
        submittedAt: new Date(),
      },
    });
    const zaehne = zaehneAus(eintrag.formSchema.bloecke, p.config);
    if (zaehne.length) await tx.insert(orderTeeth).values(zaehne.map((z) => ({ orderId: o.id, ...z })));
    return { orderNo, nach };
  });

  await logAudit({
    aktion: 'auftrag_eingereicht',
    akteur: akteurVon(b),
    ziel: { typ: 'auftrag', id: o.id },
    details: { auftrag: ergebnis.orderNo, status: ergebnis.nach, fehlend: p.fehlendeDateien },
    ip: e.ip,
  });
  return { orderId: o.id, orderNo: ergebnis.orderNo };
}
