/**
 * دادهٔ نمایشی کامل (Spec فاز ۱، بخش N)، **فقط برای دیتابیس جدای آزمون** (نامش به `_test` تمام می‌شود؛
 * انتخاب کاربر، ۲ اکتبر ۲۰۲۶: برنامهٔ اصلی فقط دادهٔ واقعی را نشان می‌دهد).
 *
 * همه‌چیز خیالی است: ۵ Ordination در وین و Niederösterreich با ۲ یا ۳ Behandler، ۳۰ بیمار، ۴۰ سفارش در
 * همهٔ وضعیت‌ها (با مسیر وضعیت، پیام‌های «ereignis»، مراحل تولید با دستگاه و Charge، نسخه‌های طرح و
 * درخواست تغییر)، پیام‌ها، یک Reklamation، ۲ تور و ۲ Abholung. Ordinationها `is_demo` دارند؛ تورها با
 * «Demo ·» و Chargeها با «DEMO-» شروع می‌شوند. تاریخ‌ها نسبت به امروز ساخته می‌شوند.
 *
 * سندها (Lieferschein، Konformitätserklärung) ساخته نمی‌شوند: فقط خود برنامه آن‌ها را صادر می‌کند.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  complaints,
  dentists,
  designRevisions,
  materialLots,
  orderFeedback,
  orderFiles,
  orderMaterials,
  orderMessages,
  orders,
  orderStatusHistory,
  orderSteps,
  orderTeeth,
  patients,
  pickupRequests,
  practices,
  practiceAgreements,
  practiceUsers,
  staffUsers,
  tours,
} from '@/db/schema';
import { config } from '@/lib/config';
import { verschluesseln } from '@/lib/crypto';
import { heuteIso } from '@/lib/format';
import { BEHANDLUNGEN } from '@/lib/katalog/stammdaten';
import { istEilig, TEMPO_ZEIT, zuschlagVon, type Eilig, type Tempo } from '@/lib/katalog/tempo';
import { auftragsnummer, belegnummer, naechsteNummer } from '@/lib/nummern';
import { formSchemaSchema, type Block } from '@/lib/orders/form-schema';
import { farbeKurz, zaehneAus } from '@/lib/orders/pruefung';
import { EREIGNIS_TEXT, type Status } from '@/lib/orders/status';
import { patientenCode } from '@/lib/patienten/suche';
import { adresseZeile, pruefsumme, VEREINBARUNG_VERSION, vereinbarungInhalt } from '@/lib/vereinbarung/text';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

const TAG = 86_400_000;
const STAFF_MAIL = 'demo-technik@example.invalid';

/* ── Ordinationها، Behandlerها، تورها ─────────────────────────── */

const PRAXEN = [
  { customerNo: 'K-9001', kurz: 'berger', name: 'Demo · Ordination Dr. Anna Berger', street: 'Musterstraße 12', zip: '1010', city: 'Wien', billingMode: 'sammel', tour: 0, behandler: [['Dr.', 'Anna', 'Berger'], ['Dr.', 'Lukas', 'Huber']] },
  { customerNo: 'K-9002', kurz: 'leitner', name: 'Demo · Zahnarztpraxis Leitner', street: 'Beispielgasse 3', zip: '1200', city: 'Wien', billingMode: 'einzel', tour: 0, behandler: [['DDr.', 'Martina', 'Leitner'], ['Dr.', 'Paul', 'Novak']] },
  { customerNo: 'K-9003', kurz: 'moedling', name: 'Demo · Ordination Mödling Süd', street: 'Probeweg 7', zip: '2340', city: 'Mödling', billingMode: 'sammel', tour: 1, behandler: [['Dr.', 'Stefan', 'Gruber'], ['Dr.', 'Eva', 'Wimmer'], ['Dr.', 'Jakob', 'Bauer']] },
  { customerNo: 'K-9004', kurz: 'baden', name: 'Demo · Zahnambulatorium Baden', street: 'Testplatz 2', zip: '2500', city: 'Baden', billingMode: 'sammel', tour: 1, behandler: [['Dr.', 'Sabine', 'Koller'], ['Dr.', 'Thomas', 'Fuchs']] },
  { customerNo: 'K-9005', kurz: 'pichler', name: 'Demo · Ordination Dr. Pichler', street: 'Übungsweg 9', zip: '1030', city: 'Wien', billingMode: 'einzel', tour: 0, behandler: [['Dr.', 'Clara', 'Pichler'], ['Dr.', 'Florian', 'Steiner']], lieferart: 'design' as const },
] as const;

const TOUREN = [
  { name: 'Demo · Tour Wien', weekdays: [1, 2, 3, 4, 5] },
  { name: 'Demo · Tour Niederösterreich', weekdays: [2, 4] },
];

const NAMEN = [
  ['Johanna', 'Aigner'], ['Felix', 'Brandstätter'], ['Lena', 'Csar'], ['Tobias', 'Doppler'], ['Katharina', 'Eder'], ['Moritz', 'Fasching'],
  ['Sophie', 'Gratzl'], ['Elias', 'Haider'], ['Valentina', 'Illek'], ['Leon', 'Jandl'], ['Anna', 'Kogler'], ['David', 'Lechner'],
  ['Marie', 'Mayrhofer'], ['Simon', 'Nußbaumer'], ['Laura', 'Oberhauser'], ['Julian', 'Prinz'], ['Hannah', 'Quast'], ['Niklas', 'Riedl'],
  ['Emma', 'Strobl'], ['Paul', 'Thaler'], ['Lea', 'Unger'], ['Lukas', 'Vogl'], ['Mia', 'Wallner'], ['Jonas', 'Zach'],
  ['Clara', 'Auer'], ['Benedikt', 'Binder'], ['Theresa', 'Danzer'], ['Fabian', 'Ebner'], ['Ida', 'Friedl'], ['Raphael', 'Grill'],
] as const;

/* ── سفارش‌ها ────────────────────────────────────────────────── */

type Wt = 'krone' | 'bruecke' | 'inlay' | 'veneer' | 'implantatkrone' | 'teilprothese' | 'totalprothese' | 'schiene' | 'smile_design';

const A2 = { system: 'vita_classical', farbe: 'A2' };
const KONFIG: Record<Wt, (i: number) => Record<string, unknown>> = {
  krone: (i) => ({ zaehne: { [[16, 26, 36, 46, 15][i % 5]]: { art: 'krone' } }, versorgung: i % 4 === 3 ? 'provisorium' : 'definitiv', farbe: { system: 'vita_classical', farbe: ['A2', 'A3', 'B2'][i % 3] } }),
  bruecke: (i) =>
    i % 2
      ? { zaehne: { 24: { art: 'bruecke_anker', spanne: 'b26-24' }, 25: { art: 'bruecke_glied', spanne: 'b26-24' }, 26: { art: 'bruecke_anker', spanne: 'b26-24' } }, versorgung: 'definitiv', farbe: A2 }
      : { zaehne: { 14: { art: 'bruecke_anker', spanne: 'b16-14' }, 15: { art: 'bruecke_glied', spanne: 'b16-14' }, 16: { art: 'bruecke_anker', spanne: 'b16-14' } }, versorgung: 'definitiv', farbe: A2 },
  inlay: (i) => ({ zaehne: { [[36, 46, 26][i % 3]]: { art: 'inlay' } }, art: i % 2 ? 'onlay' : 'inlay', farbe: { system: 'vita_classical', farbe: 'A3' } }),
  veneer: () => ({ zaehne: { 11: { art: 'veneer' }, 21: { art: 'veneer' } }, aesthetik: { merkmale: ['Länge', 'Symmetrie'], text: 'Natürliche Form, Schneidekanten leicht verlängert.' }, farbe: { system: 'vita_classical', farbe: 'A1' } }),
  implantatkrone: () => ({
    zaehne: { 36: { art: 'implantatkrone' } },
    implantat: { hersteller: 'Straumann', system: 'BLT RC', scanbodyHersteller: 'Straumann', scanbodyTyp: 'CARES Mono Scanbody' },
    farbe: A2,
  }),
  teilprothese: (i) => ({
    zaehne: { 14: { zahn: 'ersatzzahn', basis: true }, 15: { zahn: 'ersatzzahn', basis: true }, 13: { klammer: true }, 16: { klammer: true } },
    prothesenform: i % 2 ? 'nesbit' : 'flipper',
    klammern: 'mit',
    gaumen: 'hufeisen',
    einprobe: true,
    farbe: { system: 'vita_classical', farbe: 'A3' },
  }),
  totalprothese: (i) => ({ kiefer: i % 2 ? 'UK' : 'OK', einprobe: true, farbe: { system: 'vita_classical', farbe: 'A3' } }),
  schiene: (i) => ({ kiefer: i % 2 ? 'UK' : 'OK', schienenart: i % 2 ? 'flexibel' : 'fest' }),
  smile_design: () => ({
    zaehne: { 12: { art: 'veneer' }, 11: { art: 'veneer' }, 21: { art: 'veneer' }, 22: { art: 'veneer' } },
    aesthetik: { merkmale: ['Zahnform', 'Proportionen', 'Mittellinie'], text: 'Mock-up für das Beratungsgespräch.' },
    farbe: { system: 'vita_classical', farbe: 'A1' },
  }),
};

/** ماده‌های مرحلهٔ چاپ برای هر Behandlung (MDR: Charge کنار سفارش) */
const MATERIAL: Record<Wt, string[]> = {
  krone: ['sr_crown'],
  bruecke: ['sr_crown'],
  inlay: ['sr_ceramic_crown'],
  veneer: ['sr_ceramic_crown'],
  implantatkrone: ['sr_crown'],
  teilprothese: ['sr_apex_base', 'sr_apex_teeth'],
  totalprothese: ['sr_apex_base', 'sr_apex_teeth'],
  schiene: ['sr_nightguard_firm_2'],
  smile_design: [],
};

type Plan = {
  p: number;
  wt: Wt;
  status: Status;
  design?: boolean;
  /** چند روز از ارسال گذشته */
  tage: number;
  /** مرحلهٔ فعلی تولید (فقط `in_produktion`) */
  schritt?: 'druck' | 'nachhaertung' | 'ausarbeitung';
  tempo?: Tempo;
  /** Liefertermin نسبت به امروز (روز) */
  faellig?: number;
  /** دو نسخهٔ طرح: اولی با درخواست تغییر */
  zweiVersionen?: boolean;
  /** مستقیم با «Daten werden nachgereicht» (بدون Biss) */
  nachgereicht?: boolean;
  telefon?: boolean;
};

const AUFTRAEGE: Plan[] = [
  { p: 0, wt: 'krone', status: 'entwurf', tage: 0 },
  { p: 4, wt: 'smile_design', status: 'entwurf', design: true, tage: 0 },
  { p: 0, wt: 'krone', status: 'eingereicht', tage: 0, tempo: 'express', faellig: 1 },
  { p: 1, wt: 'bruecke', status: 'eingereicht', tage: 1, faellig: 5 },
  { p: 2, wt: 'implantatkrone', status: 'eingereicht', tage: 0, telefon: true },
  { p: 3, wt: 'schiene', status: 'eingereicht', tage: 1, faellig: 0 },
  { p: 1, wt: 'inlay', status: 'rueckfrage', tage: 2 },
  { p: 3, wt: 'teilprothese', status: 'rueckfrage', tage: 1, nachgereicht: true },
  { p: 0, wt: 'veneer', status: 'in_planung', tage: 2, faellig: 3 },
  { p: 2, wt: 'krone', status: 'in_planung', tage: 4, faellig: -1 },
  { p: 4, wt: 'smile_design', status: 'in_planung', design: true, tage: 2 },
  { p: 3, wt: 'totalprothese', status: 'in_planung', tage: 3 },
  { p: 0, wt: 'krone', status: 'design_freigabe', tage: 3, faellig: 2 },
  { p: 1, wt: 'bruecke', status: 'design_freigabe', tage: 7 },
  { p: 4, wt: 'krone', status: 'design_freigabe', design: true, tage: 2 },
  { p: 2, wt: 'veneer', status: 'in_ueberarbeitung', tage: 5 },
  { p: 4, wt: 'smile_design', status: 'in_ueberarbeitung', design: true, tage: 6 },
  { p: 4, wt: 'smile_design', status: 'freigegeben', design: true, tage: 9, zweiVersionen: true },
  { p: 1, wt: 'inlay', status: 'freigegeben', design: true, tage: 5 },
  { p: 0, wt: 'krone', status: 'in_produktion', schritt: 'druck', tage: 0, tempo: 'same_day', faellig: 0 },
  { p: 1, wt: 'bruecke', status: 'in_produktion', schritt: 'nachhaertung', tage: 9, zweiVersionen: true, faellig: 2 },
  { p: 2, wt: 'implantatkrone', status: 'in_produktion', schritt: 'ausarbeitung', tage: 6, faellig: 1 },
  { p: 3, wt: 'schiene', status: 'in_produktion', schritt: 'druck', tage: 4 },
  { p: 0, wt: 'inlay', status: 'in_produktion', schritt: 'nachhaertung', tage: 5, faellig: 2 },
  { p: 3, wt: 'teilprothese', status: 'in_produktion', schritt: 'druck', tage: 6 },
  { p: 2, wt: 'teilprothese', status: 'einprobe', tage: 8, faellig: 6 },
  { p: 3, wt: 'totalprothese', status: 'einprobe', tage: 10 },
  { p: 0, wt: 'krone', status: 'fertig', tage: 6, faellig: 1 },
  { p: 1, wt: 'veneer', status: 'fertig', tage: 8 },
  { p: 2, wt: 'krone', status: 'versendet', tage: 7, faellig: 0 },
  { p: 3, wt: 'schiene', status: 'versendet', tage: 6, faellig: 0 },
  { p: 0, wt: 'bruecke', status: 'geliefert', tage: 12 },
  { p: 1, wt: 'krone', status: 'geliefert', tage: 18 },
  { p: 2, wt: 'inlay', status: 'geliefert', tage: 25 },
  { p: 3, wt: 'teilprothese', status: 'geliefert', tage: 20 },
  { p: 0, wt: 'krone', status: 'abgeschlossen', tage: 50 },
  { p: 4, wt: 'smile_design', status: 'abgeschlossen', design: true, tage: 35 },
  { p: 2, wt: 'schiene', status: 'abgeschlossen', tage: 70 },
  { p: 1, wt: 'krone', status: 'storniert', tage: 4 },
  { p: 3, wt: 'inlay', status: 'storniert', tage: 6 },
];

/** مسیر سفارش تا وضعیت فعلی، همان‌طور که `status.ts` اجازه می‌دهد */
function wegZu(a: Plan): Status[] {
  const vorne: Status[] = a.nachgereicht ? ['rueckfrage'] : ['eingereicht'];
  const planung: Status[] = [...vorne, 'in_planung'];
  const freigabe: Status[] = [...planung, 'design_freigabe'];
  const produktion: Status[] = [...freigabe, 'in_produktion'];
  const einprobe = a.wt === 'teilprothese' || a.wt === 'totalprothese';
  const fertig: Status[] = [...produktion, ...(einprobe ? (['einprobe', 'in_produktion'] as Status[]) : []), 'fertig'];
  switch (a.status) {
    case 'entwurf':
      return [];
    case 'eingereicht':
      return ['eingereicht'];
    case 'rueckfrage':
      return a.nachgereicht ? ['rueckfrage'] : ['eingereicht', 'in_planung', 'rueckfrage'];
    case 'in_planung':
      return planung;
    case 'design_freigabe':
      return freigabe;
    case 'in_ueberarbeitung':
      return [...freigabe, 'in_ueberarbeitung'];
    case 'freigegeben':
      return [...freigabe, ...(a.zweiVersionen ? (['in_ueberarbeitung', 'design_freigabe'] as Status[]) : []), 'freigegeben'];
    case 'in_produktion':
      return a.zweiVersionen ? [...freigabe, 'in_ueberarbeitung', 'design_freigabe', 'in_produktion'] : produktion;
    case 'einprobe':
      return [...produktion, 'einprobe'];
    case 'fertig':
      return fertig;
    case 'versendet':
      return [...fertig, 'versendet'];
    case 'geliefert':
      return [...fertig, 'versendet', 'geliefert'];
    case 'abgeschlossen':
      return a.design ? [...freigabe, 'freigegeben', 'abgeschlossen'] : [...fertig, 'versendet', 'geliefert', 'abgeschlossen'];
    case 'storniert':
      return a.wt === 'inlay' ? ['eingereicht', 'in_planung', 'storniert'] : ['eingereicht', 'storniert'];
  }
}

/** این قدمِ مسیر را Ordination برداشته است؟ (ارسال، Freigabe، Änderung، Storno پیش از Planung) */
function werVonPraxis(weg: Status[], k: number): boolean {
  const s = weg[k];
  if (k === 0) return true;
  if (weg[k - 1] === 'design_freigabe' && ['freigegeben', 'in_produktion', 'in_ueberarbeitung'].includes(s)) return true;
  return s === 'storniert' && !weg.includes('in_planung');
}

/** مراحل تولیدی که پیش از وضعیت فعلی تمام شده‌اند */
function erledigteSchritte(a: Plan, weg: Status[]): string[] {
  const einprobe = a.wt === 'teilprothese' || a.wt === 'totalprothese';
  const alle = ['eingang', 'cad_design', 'freigabe_warten', 'druck', 'nachhaertung', ...(einprobe ? ['einprobe'] : []), 'ausarbeitung', 'qualitaetskontrolle', 'uebergabe'];
  const bis = (k: string) => alle.slice(0, alle.indexOf(k));
  if (a.status === 'storniert' || a.status === 'entwurf' || a.status === 'eingereicht') return [];
  if (a.status === 'rueckfrage') return weg.includes('in_planung') ? ['eingang'] : [];
  if (a.status === 'in_planung') return ['eingang'];
  if (['design_freigabe', 'in_ueberarbeitung'].includes(a.status)) return ['eingang', 'cad_design'];
  if (a.status === 'freigegeben' || (a.status === 'abgeschlossen' && a.design)) return ['eingang', 'cad_design', 'freigabe_warten'];
  if (a.status === 'in_produktion') return bis(a.schritt ?? 'druck');
  if (a.status === 'einprobe') return bis('einprobe');
  if (a.status === 'fertig') return bis('qualitaetskontrolle');
  if (a.status === 'versendet') return bis('uebergabe');
  return alle; // geliefert, abgeschlossen
}

const AKTUELLER_SCHRITT: Partial<Record<Status, string>> = {
  eingereicht: 'eingang',
  rueckfrage: 'rueckfrage',
  in_planung: 'cad_design',
  design_freigabe: 'freigabe_warten',
  in_ueberarbeitung: 'ueberarbeitung',
  einprobe: 'einprobe',
  fertig: 'qualitaetskontrolle',
  versendet: 'uebergabe',
  geliefert: 'uebergabe',
  abgeschlossen: 'uebergabe',
};

/* ── فایل‌ها ─────────────────────────────────────────────────── */

/** STL دودویی یک مکعب (کوچک ولی واقعی: پیش‌نمایش 3D نشانش می‌دهد) */
function quader(h: number) {
  const p = [[0, 0, 0], [10, 0, 0], [10, 8, 0], [0, 8, 0], [0, 0, h], [10, 0, h], [10, 8, h], [0, 8, h]];
  const f = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const b = Buffer.alloc(84 + f.length * 50);
  b.writeUInt32LE(f.length, 80);
  f.forEach((t, i) => t.forEach((k, j) => p[k].forEach((w, ax) => b.writeFloatLE(w, 84 + i * 50 + 12 + j * 12 + ax * 4))));
  return b;
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const DATEINAMEN: Record<string, string> = {
  ok: 'Oberkiefer.stl',
  uk: 'Unterkiefer.stl',
  biss: 'Biss.stl',
  scanbody: 'Scan mit Scanbody.stl',
  gegenkiefer: 'Gegenkiefer.stl',
  fotos: 'Foto frontal.png',
};

async function dateiAblegen(inhalt: Buffer) {
  const id = randomUUID();
  const key = `${id.slice(0, 2)}/${id}`;
  const ziel = path.join(path.resolve(config().STORAGE_DIR), key);
  await mkdir(path.dirname(ziel), { recursive: true });
  await writeFile(ziel, inhalt, { flag: 'wx' });
  return { key, groesse: inhalt.length, sha256: createHash('sha256').update(inhalt).digest('hex') };
}

/* ── ساختن ──────────────────────────────────────────────────── */

const BLOECKE = new Map(BEHANDLUNGEN.map((b) => [b.key, formSchemaSchema.parse(b.formSchema).bloecke as Block[]]));
const DEF = new Map(BEHANDLUNGEN.map((b) => [b.key, b]));

export async function istTestDatenbank(): Promise<boolean> {
  const [z] = await db().execute<{ name: string }>(sql`select current_database() as name`);
  return String(z?.name ?? '').endsWith('_test');
}

export async function demoAufbauen() {
  if (!(await istTestDatenbank())) {
    throw new Error('Demo-Daten nur in der Test-Datenbank (Name endet auf »_test«). Die echte Datenbank bleibt frei davon.');
  }
  await demoEntfernen();
  const jetzt = Date.now();
  const vor = (tage: number) => new Date(jetzt - tage * TAG);
  const heute = heuteIso();
  const tagPlus = (n: number) => heuteIso(new Date(jetzt + n * TAG));
  const jahr = Number(heute.slice(0, 4));

  const dateien: { key: string; groesse: number; sha256: string }[] = [];
  const ablegen = async (inhalt: Buffer) => {
    const d = await dateiAblegen(inhalt);
    dateien.push(d);
    return d;
  };

  try {
    await db().transaction(async (tx: Tx) => {
      const [technik] = await tx.insert(staffUsers).values({ email: STAFF_MAIL, name: 'Demo · Technik', role: 'techniker' }).returning({ id: staffUsers.id });
      const tourIds: string[] = [];
      for (const t of TOUREN) tourIds.push((await tx.insert(tours).values(t).returning({ id: tours.id }))[0].id);

      // هر Ordination با Behandlerها، یک Portal-Zugang (دعوت‌شده، بی‌رمز) و ۶ بیمار
      const praxen: { id: string; nutzer: { id: string; name: string }; behandler: string[]; patienten: string[] }[] = [];
      const position = [0, 0];
      for (const [i, p] of PRAXEN.entries()) {
        const [pr] = await tx
          .insert(practices)
          .values({
            customerNo: p.customerNo,
            name: p.name,
            street: p.street,
            zip: p.zip,
            city: p.city,
            phone: `+43 1 000 00 0${i + 1}`,
            email: `demo-${p.kurz}@example.invalid`,
            billingMode: p.billingMode,
            defaultDeliveryKind: 'lieferart' in p ? p.lieferart : null,
            tourId: tourIds[p.tour],
            tourPosition: ++position[p.tour],
            isDemo: true,
          })
          .returning({ id: practices.id });
        const behandler = await tx
          .insert(dentists)
          .values(p.behandler.map(([title, firstName, lastName]) => ({ practiceId: pr.id, title, firstName, lastName })))
          .returning({ id: dentists.id });
        const name = `Demo · Assistenz ${p.behandler[0][2]}`;
        const [nutzer] = await tx
          .insert(practiceUsers)
          .values({ practiceId: pr.id, email: `demo-${p.kurz}-zugang@example.invalid`, name, role: 'praxis_admin', invitedAt: vor(30) })
          .returning({ id: practiceUsers.id });
        // Ordinationهای نمایشی Vereinbarung را از قبل پذیرفته‌اند، وگرنه پورتالشان بسته بود
        const inhalt = vereinbarungInhalt(
          { name: 'Digital Dental Lab', adresse: 'Adalbert-Stifter-Straße 35/6/1, 1200 Wien, Österreich' },
          { name: p.name, adresse: adresseZeile([p.street, `${p.zip} ${p.city}`]) },
        );
        await tx.insert(practiceAgreements).values({
          practiceId: pr.id,
          version: VEREINBARUNG_VERSION,
          inhalt,
          sha256: pruefsumme(inhalt),
          acceptedById: nutzer.id,
          acceptedByName: name,
          acceptedByEmail: `demo-${p.kurz}-zugang@example.invalid`,
          acceptedAt: vor(30),
        });
        const patIds: string[] = [];
        for (const [vorname, nachname] of NAMEN.slice(i * 6, i * 6 + 6)) {
          const geburt = `19${50 + ((vorname.length * 7 + nachname.length * 3) % 50)}-0${1 + (nachname.length % 9)}-1${vorname.length % 10}`;
          const [pat] = await tx
            .insert(patients)
            .values({
              practiceId: pr.id,
              code: patientenCode(),
              firstNameEnc: verschluesseln(vorname),
              lastNameEnc: verschluesseln(nachname),
              birthDateEnc: verschluesseln(geburt),
              createdByKind: 'practice',
              createdById: nutzer.id,
              createdAt: vor(60),
            })
            .returning({ id: patients.id });
          patIds.push(pat.id);
        }
        praxen.push({ id: pr.id, nutzer: { id: nutzer.id, name }, behandler: behandler.map((b) => b.id), patienten: patIds });
      }

      // Chargeها
      const lots = new Map<string, string>();
      for (const key of [...new Set(Object.values(MATERIAL).flat())]) {
        const [l] = await tx
          .insert(materialLots)
          .values({ materialKey: key, lotNo: `DEMO-${key.toUpperCase().replace(/_/g, '')}-2601`, expiryDate: tagPlus(330), receivedAt: tagPlus(-30), quantity: 4, stock: 3 })
          .returning({ id: materialLots.id });
        lots.set(key, l.id);
      }

      // سفارش‌ها به ترتیب ارسال (شماره‌ها با زمان بالا می‌روند)
      const reihenfolge = AUFTRAEGE.map((a, i) => ({ a, i })).sort((x, y) => y.a.tage - x.a.tage || x.i - y.i);
      const zaehlerProPraxis = [0, 0, 0, 0, 0];
      const ids: string[] = [];
      for (const { a, i } of reihenfolge) {
        const pr = praxen[a.p];
        const n = zaehlerProPraxis[a.p]++;
        const def = DEF.get(a.wt)!;
        const bloecke = BLOECKE.get(a.wt)!;
        const konfig = KONFIG[a.wt](i);
        const lieferart = a.design ? 'design' : 'fertigung';
        const option = def.deliveryOptions[lieferart];
        const weg = wegZu(a);
        const abgeschickt = vor(a.tage);
        // زمان‌ها: یکنواخت از ارسال تا کمی پیش از حالا
        const ende = a.tage > 0 ? vor(Math.min(a.tage * 0.3, 2)) : new Date(jetzt - 2 * 3_600_000);
        const zeit = (k: number) => (weg.length <= 1 ? abgeschickt : new Date(abgeschickt.getTime() + ((ende.getTime() - abgeschickt.getTime()) * k) / (weg.length - 1)));
        const zeitVon = (s: Status) => zeit(weg.lastIndexOf(s));
        const vonPraxis = !a.telefon;
        const ersteller = vonPraxis ? { kind: 'practice' as const, id: pr.nutzer.id } : { kind: 'staff' as const, id: technik.id };
        const aktiv = !['entwurf', 'storniert', 'geliefert', 'abgeschlossen'].includes(a.status);

        const [o] = await tx
          .insert(orders)
          .values({
            orderNo: a.status === 'entwurf' ? null : auftragsnummer(jahr, await naechsteNummer(tx, 'auftrag', jahr)),
            practiceId: pr.id,
            dentistId: pr.behandler[n % pr.behandler.length],
            patientId: pr.patienten[n % pr.patienten.length],
            workTypeKey: a.wt,
            deliveryKind: lieferart,
            config: konfig,
            draftState: a.status === 'entwurf' ? { auswahl: def.groupKey ?? a.wt, bestaetigt: {}, nachgereicht: false } : null,
            treatmentPlan: n % 3 === 0 ? 'Bitte Kontaktpunkte eher stramm gestalten. Danke!' : null,
            shade: farbeKurz(bloecke, konfig),
            tempo: a.tempo ?? 'standard',
            priceSnapshot:
              a.status === 'entwurf'
                ? null
                : {
                    lieferart,
                    preisAb: option?.preisAb ?? null,
                    einheit: option?.einheit ?? null,
                    zuschlag: istEilig(a.tempo ?? null) ? zuschlagVon(def, a.tempo as Eilig) : null,
                    bearbeitungszeit: istEilig(a.tempo ?? null) ? TEMPO_ZEIT[a.tempo as Eilig] : def.turnaroundLabel,
                  },
            desiredDate: n % 4 === 1 && aktiv ? tagPlus(7) : null,
            dueDate: a.faellig !== undefined ? tagPlus(a.faellig) : null,
            status: a.status,
            currentStepKey: a.status === 'in_produktion' ? (a.schritt ?? 'druck') : (AKTUELLER_SCHRITT[a.status] ?? null),
            assigneeId: ['in_produktion', 'einprobe', 'fertig', 'in_planung'].includes(a.status) && n % 2 === 0 ? technik.id : null,
            source: vonPraxis ? 'portal' : 'labor',
            submittedAt: a.status === 'entwurf' ? null : abgeschickt,
            approvedAt: weg.includes('freigegeben') ? zeitVon('freigegeben') : weg.includes('in_produktion') ? zeit(weg.indexOf('in_produktion')) : null,
            deliveredAt: weg.includes('geliefert') ? zeitVon('geliefert') : null,
            canceledAt: a.status === 'storniert' ? zeitVon('storniert') : null,
            cancelReason: a.status === 'storniert' ? (weg.includes('in_planung') ? 'Patient hat den Termin abgesagt.' : 'Doppelt angelegt.') : null,
            createdByKind: ersteller.kind,
            createdById: ersteller.id,
            createdAt: a.status === 'entwurf' ? vor(0.1) : vor(a.tage + 0.05),
            updatedAt: weg.length ? zeit(weg.length - 1) : vor(0.1),
          })
          .returning({ id: orders.id });
        ids[i] = o.id;

        const zaehne = zaehneAus(bloecke, konfig);
        if (zaehne.length) await tx.insert(orderTeeth).values(zaehne.map((z) => ({ orderId: o.id, ...z })));
        if (a.status === 'entwurf') continue;

        // مسیر وضعیت و پیام‌های «ereignis»
        for (const [k, s] of weg.entries()) {
          const at = zeit(k);
          const vonLabor = !werVonPraxis(weg, k);
          await tx.insert(orderStatusHistory).values({ orderId: o.id, status: s, at, byKind: vonLabor ? 'staff' : ersteller.kind, byId: vonLabor ? technik.id : ersteller.id });
          const text =
            k === 0 && s === 'rueckfrage'
              ? 'Auftrag eingereicht. Es fehlen noch: Bissregistrierung. Bitte reichen Sie die Daten nach.'
              : s === 'storniert'
                ? `Auftrag storniert (${weg.includes('in_planung') ? 'vom Labor' : 'von der Ordination'})`
                : EREIGNIS_TEXT[s];
          await tx.insert(orderMessages).values({ orderId: o.id, authorKind: 'system', kind: 'ereignis', body: text, createdAt: at });
        }

        // فایل‌های Ordination
        for (const slot of def.requiredFiles) {
          if (a.nachgereicht && slot === 'biss') continue;
          const foto = slot === 'fotos';
          const d = await ablegen(foto ? PNG : quader(3 + (n % 5)));
          await tx.insert(orderFiles).values({
            orderId: o.id,
            origin: 'praxis',
            kind: foto ? 'foto' : 'scan',
            slot,
            storageKey: d.key,
            filenameEnc: verschluesseln(DATEINAMEN[slot]),
            mime: foto ? 'image/png' : 'model/stl',
            size: d.groesse,
            sha256: d.sha256,
            uploadedByKind: ersteller.kind,
            uploadedById: ersteller.id,
            createdAt: abgeschickt,
          });
        }

        // نسخه‌های طرح
        const versionen = weg.filter((s) => s === 'design_freigabe').length;
        for (let v = 1; v <= versionen; v++) {
          const hoch = zeit(weg.indexOf('design_freigabe') + (v - 1) * 2);
          const letzte = v === versionen;
          const geaendert = !letzte || a.status === 'in_ueberarbeitung';
          const freigegeben = letzte && !geaendert && a.status !== 'design_freigabe' && a.status !== 'storniert';
          const entschieden = geaendert || freigegeben ? new Date(hoch.getTime() + TAG / 2) : null;
          let changeMessageId: string | null = null;
          if (geaendert) {
            const [m] = await tx
              .insert(orderMessages)
              .values({
                orderId: o.id,
                authorKind: 'praxis',
                authorId: pr.nutzer.id,
                kind: 'aenderung',
                body: a.wt === 'smile_design' || a.wt === 'veneer' ? 'Zahn 11, 21: länger · Inzisalkante\nBitte die Schneidekanten etwas länger und weicher gestalten.' : 'Zahn 25: Kontaktpunkte\nBitte den Kontakt zu 24 etwas kräftiger.',
                designRevision: v,
                createdAt: entschieden!,
              })
              .returning({ id: orderMessages.id });
            changeMessageId = m.id;
          }
          await tx.insert(designRevisions).values({
            orderId: o.id,
            revision: v,
            note: v === 2 ? 'Änderungswunsch umgesetzt.' : null,
            uploadedBy: technik.id,
            uploadedAt: hoch,
            status: geaendert ? 'aenderung' : freigegeben ? 'freigegeben' : 'offen',
            decidedAt: entschieden,
            decidedBy: entschieden ? pr.nutzer.id : null,
            decidedName: entschieden ? pr.nutzer.name : null,
            decidedIp: entschieden ? '127.0.0.1' : null,
            changeMessageId,
          });
          const d = await ablegen(quader(6 + v));
          await tx.insert(orderFiles).values({
            orderId: o.id,
            origin: 'labor',
            kind: 'design',
            designRevision: v,
            storageKey: d.key,
            filenameEnc: verschluesseln(`Design ${def.name} V${v}.stl`),
            mime: 'model/stl',
            size: d.groesse,
            sha256: d.sha256,
            uploadedByKind: 'staff',
            uploadedById: technik.id,
            createdAt: hoch,
          });
        }

        // مراحل تولید با دستگاه و Charge
        const erledigt = erledigteSchritte(a, weg);
        for (const [k, s] of erledigt.entries()) {
          const at = new Date(abgeschickt.getTime() + ((ende.getTime() - abgeschickt.getTime()) * (k + 1)) / (erledigt.length + 1));
          const prothese = a.wt === 'teilprothese' || a.wt === 'totalprothese';
          await tx.insert(orderSteps).values({
            orderId: o.id,
            stepKey: s,
            deviceKey: s === 'druck' ? (prothese ? 'formlabs_form_3b' : 'sprintray_midas') : null,
            startedAt: at,
            doneAt: at,
            doneBy: technik.id,
          });
          if (s === 'druck') {
            for (const m of MATERIAL[a.wt]) await tx.insert(orderMaterials).values({ orderId: o.id, lotId: lots.get(m)!, stepKey: 'druck', createdBy: technik.id });
          }
        }
        const laufend = a.status === 'in_produktion' ? (a.schritt ?? 'druck') : AKTUELLER_SCHRITT[a.status];
        if (laufend && aktiv && !erledigt.includes(laufend)) await tx.insert(orderSteps).values({ orderId: o.id, stepKey: laufend, startedAt: ende });
      }

      // گفت‌وگوها
      const nachricht = (orderId: string, von: 'praxis' | 'labor', autor: string, body: string, tageVor: number, intern = false) =>
        tx.insert(orderMessages).values({ orderId, authorKind: von, authorId: autor, kind: 'nachricht', body, isInternal: intern, createdAt: vor(tageVor) });
      await nachricht(ids[6], 'labor', technik.id, 'Der Biss ist im Scan nicht eindeutig.\n\nBitte nachreichen: Bissregistrierung', 1.5);
      await nachricht(ids[12], 'praxis', praxen[0].nutzer.id, 'Bitte die Kontaktpunkte eher stramm. Danke!', 2.5);
      await nachricht(ids[12], 'labor', technik.id, 'Gerne, ist im Design berücksichtigt.', 2);
      await nachricht(ids[13], 'labor', technik.id, 'Das Design liegt zur Freigabe bereit. Bei Fragen rufen Sie uns gerne an.', 0.5);
      await nachricht(ids[19], 'labor', technik.id, 'Intern: Same-Day, heute noch drucken.', 0.02, true);
      await nachricht(ids[25], 'praxis', praxen[2].nutzer.id, 'Einprobe ist für Donnerstag geplant.', 0.3);
      await nachricht(ids[3], 'praxis', praxen[1].nutzer.id, 'Brücke bitte möglichst bis Freitag.', 0.1);

      // Reklamation («In Prüfung») برای یک Krone تحویل‌شده
      const rkOrder = ids[32];
      const [rkO] = await tx.select({ geliefert: orders.deliveredAt }).from(orders).where(eq(orders.id, rkOrder));
      const rkNr = belegnummer('RK', jahr, await naechsteNummer(tx, 'reklamation', jahr));
      const [rkMsg] = await tx
        .insert(orderMessages)
        .values({ orderId: rkOrder, authorKind: 'praxis', authorId: praxen[1].nutzer.id, kind: 'reklamation', body: `Reklamation ${rkNr} · Passung · Zahn 16\nDie Krone sitzt approximal zu stramm.`, createdAt: vor(1) })
        .returning({ id: orderMessages.id });
      const bis = new Date(rkO.geliefert!);
      bis.setMonth(bis.getMonth() + 24);
      await tx.insert(complaints).values({
        complaintNo: rkNr,
        orderId: rkOrder,
        practiceId: praxen[1].id,
        reportedByKind: 'practice',
        reportedById: praxen[1].nutzer.id,
        reason: 'passung',
        description: 'Die Krone sitzt approximal zu stramm.',
        messageId: rkMsg.id,
        warrantyUntil: heuteIso(bis),
        warrantyValid: true,
        createdAt: vor(1),
      });

      // «Wie gefällt Ihnen das Design?»
      await tx.insert(orderFeedback).values({ orderId: ids[18], rating: 'up', createdBy: praxen[1].nutzer.id, createdAt: vor(3) });
      await tx.insert(orderFeedback).values({ orderId: ids[36], rating: 'down', comment: 'Form an 12 etwas zu kantig.', createdBy: praxen[4].nutzer.id, createdAt: vor(30) });

      // Abholungها: یکی باز، یکی برنامه‌ریزی‌شده
      await tx.insert(pickupRequests).values({ practiceId: praxen[0].id, desiredDate: tagPlus(1), note: 'Abdrücke für eine neue Schiene', requestedByKind: 'practice', requestedById: praxen[0].nutzer.id, createdAt: vor(0.2) });
      await tx.insert(pickupRequests).values({
        practiceId: praxen[2].id,
        orderId: ids[25],
        desiredDate: tagPlus(2),
        note: 'Einprobe zurück ins Labor',
        status: 'eingeplant',
        tourId: tourIds[1],
        plannedDate: tagPlus(2),
        requestedByKind: 'practice',
        requestedById: praxen[2].nutzer.id,
        createdAt: vor(0.5),
      });
    });
  } catch (e) {
    for (const d of dateien) await rm(path.join(path.resolve(config().STORAGE_DIR), d.key), { force: true });
    throw e;
  }
  console.log(`✓ Demo: ${PRAXEN.length} Ordinationen, ${NAMEN.length} Patienten, ${AUFTRAEGE.length} Aufträge, 1 Reklamation, ${TOUREN.length} Touren, ${dateien.length} Dateien`);
}

/** همهٔ دادهٔ نمایشی را پاک می‌کند (اگر نباشد، کاری نمی‌کند) */
export async function demoEntfernen() {
  const d = db();
  const praxen = (await d.select({ id: practices.id }).from(practices).where(eq(practices.isDemo, true))).map((p) => p.id);
  let anzahl = 0;
  if (praxen.length) {
    const auftraege = (await d.select({ id: orders.id }).from(orders).where(inArray(orders.practiceId, praxen))).map((o) => o.id);
    if (auftraege.length) {
      const keys = await d.select({ key: orderFiles.storageKey }).from(orderFiles).where(inArray(orderFiles.orderId, auftraege));
      await d.transaction(async (tx) => {
        await tx.delete(complaints).where(inArray(complaints.orderId, auftraege));
        await tx.delete(orders).where(inArray(orders.id, auftraege));
      });
      for (const k of keys) await rm(path.join(path.resolve(config().STORAGE_DIR), k.key), { force: true });
    }
    await d.delete(patients).where(inArray(patients.practiceId, praxen));
    anzahl = await d.transaction(async (tx) => {
      // پذیرش Vereinbarung با trigger قفل است؛ فقط این‌جا (دادهٔ نمایشی) و در آزمون‌ها پاک می‌شود
      await tx.execute(sql`set local ddl.vereinbarung_loeschen = 'qa'`);
      await tx.delete(practiceAgreements).where(inArray(practiceAgreements.practiceId, praxen));
      return (await tx.delete(practices).where(inArray(practices.id, praxen)).returning({ id: practices.id })).length;
    });
  }
  await d.delete(tours).where(like(tours.name, 'Demo · %'));
  await d.delete(materialLots).where(like(materialLots.lotNo, 'DEMO-%'));
  await d.delete(staffUsers).where(eq(staffUsers.email, STAFF_MAIL));
  return anzahl;
}
