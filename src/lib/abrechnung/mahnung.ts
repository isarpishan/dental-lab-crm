import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createElement } from 'react';
import { db } from '@/db/client';
import { dunningLetters, invoices, jobs, payments, practices } from '@/db/schema';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { heuteIso } from '@/lib/format';
import { MahnungPdf, type MahnungDaten } from '@/lib/pdf/mahnung';
import { ausPuffer, speichern } from '@/lib/storage';
import { belegDateiname } from './beleg';
import { mahnungMail } from './mail';
import { mahnwesenLaden } from './mahnung-daten';
import { faelligeStufe, MAHNSTUFE_NAMEN, tageZwischen, type Mahnstufe } from './mahnwesen';
import { zahlstand } from './offen';
import { mitDateien, rechnungsdatenLaden, type Empfaenger } from './rechnung';
import { faelligAm } from './rechnungsdaten';
import { rechnungenLink, rechnungsAdresse } from './versand';

/**
 * Zahlungserinnerung و Mahnung (Spec فاز ۲، قدم ۴). هیچ‌چیز خودکار نمی‌رود: `faelligeMahnungen` فهرست را
 * می‌دهد و Büro با یک کلیک `mahnen` را صدا می‌زند. `mahnen` در یک تراکنش با قفل هر Ordination (همان قفل
 * Rechnung، Gutschrift و پرداخت) دوباره حساب می‌کند که مرحله واقعاً رسیده، PDF می‌سازد و نگه می‌دارد، و
 * اگر آدرس هست، آن را همراه خود Rechnung با ایمیل می‌فرستد.
 */
type StaffAkteur = { kind: 'staff'; id: string; label: string };
type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

const DATEI: Record<Mahnstufe, string> = { 1: 'Zahlungserinnerung', 2: '1-Mahnung', 3: '2-Mahnung' };

/** وضعیت یک Rechnung با نامهٔ آخر، داخل همان تراکنش */
async function standVon(q: Tx | ReturnType<typeof db>, rechnungId: string, heute: string) {
  const [r] = await q.select().from(invoices).where(eq(invoices.id, rechnungId)).limit(1);
  if (!r || r.art !== 'rechnung') return null;
  const [g] = await q
    .select({ cent: sql<number>`coalesce(sum(${invoices.summeCent}), 0)::int`, storno: sql<boolean>`coalesce(bool_or(${invoices.storno}), false)` })
    .from(invoices)
    .where(and(eq(invoices.bezugId, r.id), eq(invoices.art, 'gutschrift')));
  const [z] = await q.select({ cent: sql<number>`coalesce(sum(${payments.betragCent}), 0)::int` }).from(payments).where(eq(payments.invoiceId, r.id));
  const [letzte] = await q.select().from(dunningLetters).where(eq(dunningLetters.invoiceId, r.id)).orderBy(desc(dunningLetters.stufe)).limit(1);
  const stand = zahlstand({ summeCent: r.summeCent, gutschriftenCent: g.cent, gezahltCent: z.cent, storniert: g.storno, faelligAm: r.faelligAm }, heute);
  return { r, gutschriftenCent: g.cent, gezahltCent: z.cent, stand, letzte: letzte ?? null };
}

export type FaelligeMahnung = {
  rechnungId: string;
  nummer: string;
  practiceId: string;
  praxis: string;
  offenCent: number;
  faelligAm: string;
  tageUeber: number;
  stufe: Mahnstufe;
  an: string | null;
};

/** همهٔ Rechnungهایی که الان مرحلهٔ بعدی‌شان رسیده؛ قدیمی‌ترین سررسید اول. */
export async function faelligeMahnungen(heute = heuteIso()): Promise<FaelligeMahnung[]> {
  const [m, alle, gezahlt, briefe] = await Promise.all([
    mahnwesenLaden(),
    db()
      .select({ id: invoices.id, nummer: invoices.nummer, art: invoices.art, storno: invoices.storno, bezugId: invoices.bezugId, practiceId: invoices.practiceId, summeCent: invoices.summeCent, faelligAm: invoices.faelligAm })
      .from(invoices),
    db().select({ invoiceId: payments.invoiceId, cent: sql<number>`sum(${payments.betragCent})::int` }).from(payments).groupBy(payments.invoiceId),
    db().select({ invoiceId: dunningLetters.invoiceId, stufe: dunningLetters.stufe, frist: dunningLetters.frist }).from(dunningLetters),
  ]);
  const zahlungen = new Map(gezahlt.map((z) => [z.invoiceId, z.cent]));
  const kandidaten = alle.flatMap((r) => {
    if (r.art !== 'rechnung' || !r.faelligAm) return [];
    const gs = alle.filter((g) => g.bezugId === r.id);
    const stand = zahlstand(
      { summeCent: r.summeCent, gutschriftenCent: gs.reduce((s, g) => s + g.summeCent, 0), gezahltCent: zahlungen.get(r.id) ?? 0, storniert: gs.some((g) => g.storno), faelligAm: r.faelligAm },
      heute,
    );
    const letzte = briefe.filter((b) => b.invoiceId === r.id).sort((a, b) => b.stufe - a.stufe)[0] ?? null;
    const stufe = faelligeStufe({ faelligAm: r.faelligAm, stand, letzte }, heute, m);
    return stufe ? [{ r, stand, stufe }] : [];
  });
  if (!kandidaten.length) return [];
  const praxen = new Map(
    (await db().select({ id: practices.id, name: practices.name, email: practices.email, billingEmail: practices.billingEmail }).from(practices).where(inArray(practices.id, [...new Set(kandidaten.map((k) => k.r.practiceId))]))).map(
      (p) => [p.id, p],
    ),
  );
  return kandidaten
    .map(({ r, stand, stufe }) => {
      const p = praxen.get(r.practiceId);
      return {
        rechnungId: r.id,
        nummer: r.nummer,
        practiceId: r.practiceId,
        praxis: p?.name ?? '–',
        offenCent: stand.offenCent,
        faelligAm: r.faelligAm!,
        tageUeber: tageZwischen(r.faelligAm!, heute),
        stufe,
        an: p ? rechnungsAdresse(p) : null,
      };
    })
    .sort((a, b) => a.faelligAm.localeCompare(b.faelligAm) || a.nummer.localeCompare(b.nummer));
}

type Stand = NonNullable<Awaited<ReturnType<typeof standVon>>>;

const mahnungDaten = (s: Stand, stufe: Mahnstufe, am: Date, frist: string): Omit<MahnungDaten, 'aussteller'> => ({
  stufe,
  am,
  frist,
  empfaenger: s.r.empfaenger as Empfaenger,
  rechnung: { nummer: s.r.nummer, am: s.r.ausgestelltAm, faelligAm: s.r.faelligAm, summeCent: s.r.summeCent },
  gutschriftenCent: s.gutschriftenCent,
  gezahltCent: s.gezahltCent,
  offenCent: s.stand.offenCent,
  vorher: s.letzte ? { stufe: s.letzte.stufe as Mahnstufe, am: s.letzte.erstelltAm } : null,
});

const mahnungPdf = (d: MahnungDaten) => renderToBuffer(createElement(MahnungPdf, d) as Parameters<typeof renderToBuffer>[0]);

/**
 * پیش‌نمایش نامهٔ مرحله‌ای که الان رسیده، پیش از ساختن و فرستادن: همان PDF با مُهر «VORSCHAU». چیزی
 * ذخیره یا فرستاده نمی‌شود. null: Rechnung نیست یا الان مرحله‌ای نرسیده است.
 */
export async function mahnungVorschau(rechnungId: string): Promise<Buffer | null> {
  const heute = heuteIso();
  const [m, { aussteller, daten }, s] = await Promise.all([mahnwesenLaden(), rechnungsdatenLaden(), standVon(db(), rechnungId, heute)]);
  if (!s) return null;
  const stufe = faelligeStufe({ faelligAm: s.r.faelligAm, stand: s.stand, letzte: s.letzte }, heute, m);
  if (!stufe) return null;
  return mahnungPdf({ ...mahnungDaten(s, stufe, new Date(), faelligAm(heute, m.fristTage)), aussteller: { ...aussteller, ...daten }, vorschau: true });
}

/** نامهٔ مرحلهٔ رسیده را می‌سازد و، اگر آدرس هست، می‌فرستد. */
export async function mahnen(rechnungId: string, akteur: StaffAkteur, ip: string | null): Promise<{ id: string; nummer: string; stufe: Mahnstufe; an: string | null }> {
  const heute = heuteIso();
  const [m, { aussteller, daten, fehlt }] = await Promise.all([mahnwesenLaden(), rechnungsdatenLaden()]);
  if (fehlt.length) throw new AppError(`Bitte zuerst in den Einstellungen ergänzen: ${fehlt.join(', ')}.`);
  const neu = await mitDateien((dateien) =>
    db().transaction(async (tx) => {
      const [vorher] = await tx.select({ practiceId: invoices.practiceId }).from(invoices).where(eq(invoices.id, rechnungId)).limit(1);
      if (!vorher) throw new AppError('Rechnung nicht gefunden.');
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rechnung:${vorher.practiceId}`}))`);
      const s = await standVon(tx, rechnungId, heute);
      if (!s) throw new AppError('Rechnung nicht gefunden.');
      const stufe = faelligeStufe({ faelligAm: s.r.faelligAm, stand: s.stand, letzte: s.letzte }, heute, m);
      if (!stufe) throw new AppError(`Für ${s.r.nummer} ist gerade keine Mahnung fällig.`);
      const frist = faelligAm(heute, m.fristTage);
      const inhalt = await mahnungPdf({ ...mahnungDaten(s, stufe, new Date(), frist), aussteller: { ...aussteller, ...daten } });
      const f = await speichern(ausPuffer(new Uint8Array(inhalt)), 20 * 1024 * 1024);
      dateien.push(f.key);
      const [brief] = await tx
        .insert(dunningLetters)
        .values({ invoiceId: s.r.id, practiceId: s.r.practiceId, stufe, offenCent: s.stand.offenCent, frist, erstelltVon: akteur.id, erstelltVonLabel: akteur.label, storageKey: f.key, sha256: f.sha256, size: f.groesse })
        .returning({ id: dunningLetters.id });
      return { id: brief.id, nummer: s.r.nummer, stufe, offenCent: s.stand.offenCent };
    }),
  );
  await logAudit({ aktion: 'mahnung_erstellt', akteur, ziel: { typ: 'rechnung', id: rechnungId }, details: { nummer: neu.nummer, stufe: neu.stufe, offenCent: neu.offenCent }, ip });
  // ohne Adresse bleibt das Schreiben als PDF zum Ausdrucken; sonst gleich per E-Mail
  const an = await mahnungSenden(neu.id, akteur, ip).then(
    (v) => v.an,
    (e) => {
      if (e instanceof AppError) return null;
      throw e;
    },
  );
  return { id: neu.id, nummer: neu.nummer, stufe: neu.stufe, an };
}

/** نامه را (دوباره) با ایمیل می‌فرستد: خودش و خود Rechnung، هر دو PDF. */
export async function mahnungSenden(mahnungId: string, akteur: StaffAkteur, ip: string | null): Promise<{ an: string; nummer: string; stufe: Mahnstufe }> {
  const [z] = await db()
    .select({ brief: dunningLetters, r: invoices, praxis: practices })
    .from(dunningLetters)
    .innerJoin(invoices, eq(invoices.id, dunningLetters.invoiceId))
    .innerJoin(practices, eq(practices.id, dunningLetters.practiceId))
    .where(eq(dunningLetters.id, mahnungId))
    .limit(1);
  if (!z) throw new AppError('Dieses Schreiben gibt es nicht.');
  const an = rechnungsAdresse(z.praxis);
  if (!an) throw new AppError(`Für ${z.praxis.name} ist keine E-Mail-Adresse hinterlegt. Bitte in den Stammdaten der Ordination »E-Mail für Rechnungen« eintragen.`);
  const stufe = z.brief.stufe as Mahnstufe;
  const { aussteller, daten } = await rechnungsdatenLaden();
  const mail = mahnungMail({ stufe, nummer: z.r.nummer, offenCent: z.brief.offenCent, frist: z.brief.frist, aussteller: { name: aussteller.name, iban: daten.iban, bic: daten.bic }, portalLink: await rechnungenLink(z.praxis) });
  await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`mahnung:${mahnungId}`}))`);
    const [jetzt] = await tx.select({ status: jobs.status }).from(dunningLetters).innerJoin(jobs, eq(jobs.id, dunningLetters.jobId)).where(eq(dunningLetters.id, mahnungId)).limit(1);
    if (jetzt && (jetzt.status === 'wartend' || jetzt.status === 'laufend')) throw new AppError(`Die ${MAHNSTUFE_NAMEN[stufe]} zu ${z.r.nummer} wird gerade gesendet.`);
    const [job] = await tx
      .insert(jobs)
      .values({
        type: 'email_mit_anhang',
        payload: {
          an,
          betreff: mail.betreff,
          text: mail.text,
          html: mail.html,
          anhaenge: [
            { key: z.brief.storageKey, dateiname: mahnungDateiname(stufe, z.r.nummer), sha256: z.brief.sha256 },
            { key: z.r.storageKey, dateiname: belegDateiname(z.r), sha256: z.r.sha256 },
          ],
        },
      })
      .returning({ id: jobs.id });
    await tx.update(dunningLetters).set({ an, jobId: job.id }).where(eq(dunningLetters.id, mahnungId));
  });
  await logAudit({ aktion: 'mahnung_versendet', akteur, ziel: { typ: 'rechnung', id: z.r.id }, details: { nummer: z.r.nummer, stufe, an }, ip });
  return { an, nummer: z.r.nummer, stufe };
}

export const mahnungDateiname = (stufe: Mahnstufe, nummer: string) => `${DATEI[stufe]}_${nummer}.pdf`;
