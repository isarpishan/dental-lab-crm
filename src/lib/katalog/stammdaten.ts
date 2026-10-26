import type { LieferOptionen, Zuschlag } from '@/db/schema';
import type { Block, DateiPlatz, FormSchema } from '@/lib/orders/form-schema';

/**
 * دادهٔ واقعی اولیهٔ DDL برای seed. منبع: docs/00-ddl-brief.md که از سایت و
 * دانش چت‌بات DDL گرفته شده است (۱ اکتبر ۲۰۲۶). این‌ها دادهٔ نمایشی نیستند
 * و با `seed --clean` پاک نمی‌شوند. بعد از seed، Inhaber همه را در Stammdaten
 * عوض می‌کند (قیمت‌ها، روشن/خاموش، …). seed دوباره تغییرهای او را بازنویسی نمی‌کند.
 */

export const PORTAL_STATUS = [
  { key: 'entwurf', label: 'Entwurf', needsAction: false },
  { key: 'eingereicht', label: 'Eingereicht', needsAction: false },
  { key: 'rueckfrage', label: 'Rückfrage', needsAction: true },
  { key: 'in_planung', label: 'In Planung', needsAction: false },
  { key: 'design_freigabe', label: 'Design zur Freigabe', needsAction: true },
  { key: 'in_ueberarbeitung', label: 'In Überarbeitung', needsAction: false },
  { key: 'freigegeben', label: 'Freigegeben', needsAction: false },
  { key: 'in_produktion', label: 'In Produktion', needsAction: false },
  { key: 'einprobe', label: 'Einprobe', needsAction: true },
  { key: 'fertig', label: 'Fertig', needsAction: false },
  { key: 'versendet', label: 'Versendet', needsAction: false },
  { key: 'geliefert', label: 'Geliefert', needsAction: false },
  { key: 'abgeschlossen', label: 'Abgeschlossen', needsAction: false },
  { key: 'storniert', label: 'Storniert', needsAction: false },
] as const;

/** مراحل داخلی برد تولید ← وضعیتی که Ordination می‌بیند (brief، بخش ۵). */
export const PRODUKTIONSSCHRITTE = [
  { key: 'eingang', label: 'Eingang / Datenprüfung', portal: 'eingereicht' },
  { key: 'rueckfrage', label: 'Rückfrage', portal: 'rueckfrage' },
  { key: 'cad_design', label: 'CAD-Design', portal: 'in_planung' },
  { key: 'freigabe_warten', label: 'Warten auf Freigabe', portal: 'design_freigabe' },
  { key: 'ueberarbeitung', label: 'Überarbeitung', portal: 'in_ueberarbeitung' },
  { key: 'druck', label: '3D-Druck', portal: 'in_produktion' },
  { key: 'nachhaertung', label: 'Reinigung & Nachhärtung', portal: 'in_produktion' },
  { key: 'einprobe', label: 'Einprobe', portal: 'einprobe' },
  { key: 'ausarbeitung', label: 'Ausarbeitung / Farbanpassung', portal: 'in_produktion' },
  { key: 'qualitaetskontrolle', label: 'Qualitätskontrolle', portal: 'fertig' },
  { key: 'uebergabe', label: 'Übergabe', portal: 'versendet' },
] as const;

const STANDARD_SCHRITTE = ['eingang', 'cad_design', 'freigabe_warten', 'druck', 'nachhaertung', 'ausarbeitung', 'qualitaetskontrolle', 'uebergabe'];
const PROTHESEN_SCHRITTE = ['eingang', 'cad_design', 'freigabe_warten', 'druck', 'nachhaertung', 'einprobe', 'ausarbeitung', 'qualitaetskontrolle', 'uebergabe'];

const OK_UK_BISS: DateiPlatz[] = ['ok', 'uk', 'biss'];
const ZUSCHLAG_OFFEN: Zuschlag = { betrag: null, einheit: 'Auftrag' };
const ohnePreis = (einheit: 'Zahn' | 'Glied' | 'Kiefer' | 'Fall'): LieferOptionen => ({
  design: { preisAb: null, einheit },
  fertigung: { preisAb: null, einheit },
});

const farbe = { typ: 'zahnfarbe', id: 'farbe', pflicht: true, farbanpassung: true } as const;
const versorgung: Block = {
  typ: 'auswahl',
  id: 'versorgung',
  pflicht: true,
  label: 'Versorgung',
  optionen: [
    { wert: 'definitiv', label: 'Definitiv' },
    { wert: 'provisorium', label: 'Provisorium' },
  ],
};

/**
 * چند Behandlung که در قدم اول فرم یک کاشی مشترک دارند. با انتخاب کاشی، سؤال
 * `frage` با کاشی‌های همان گروه می‌آید (مثلاً «Prothese» ← Teilprothese / Totalprothese).
 */
export const BEHANDLUNGSGRUPPEN = [{ key: 'prothese', name: 'Prothese', imageKey: 'prothese.webp', frage: 'Welche Prothese?' }] as const;
export type GruppenKey = (typeof BEHANDLUNGSGRUPPEN)[number]['key'];

export type BehandlungDef = {
  key: string;
  name: string;
  category: string;
  /** فایل در `public/bilder/auswahl/` (تکه‌های عکس «Arbeiten» سایت). */
  imageKey: string | null;
  groupKey: GruppenKey | null;
  /** زمان «Standard». */
  turnaroundLabel: string;
  /**
   * Service-Levelها (`lib/katalog/tempo.ts`، خواستهٔ کاربر، ۵ اکتبر ۲۰۲۶): «Express < 24 Stunden» برای همه
   * جز Prothese؛ «Same-Day» فقط Krone و Inlay/Onlay (سایت و چت‌بات). مبلغ هر دو Zuschlag را Inhaber
   * بعداً خودش در «Preise» وارد می‌کند.
   */
  expressAvailable: boolean;
  expressSurcharge: Zuschlag;
  sameDayAvailable: boolean;
  sameDaySurcharge: Zuschlag;
  deliveryOptions: LieferOptionen;
  needsFreigabe: boolean;
  badges: string[];
  formSchema: FormSchema;
  requiredFiles: DateiPlatz[];
  stepKeys: string[];
  isActive: boolean;
};

/**
 * ترتیب همان ترتیب کاشی‌ها در قدم اول فرم است. هر قطعهٔ `form_schema` در فرم
 * یک قدم جداست و فقط بعد از جواب قدم قبلی ظاهر می‌شود (خواستهٔ کاربر، ۱ اکتبر ۲۰۲۶).
 * برای همین هر Zahnleiste فقط ابزار همان Behandlung را دارد.
 *
 * سؤال Material در فرم نیست (تصمیم کاربر، ۱ اکتبر ۲۰۲۶): ماده برای هر کار مشخص
 * است و لابراتوار آن را در تولید ثبت می‌کند (Charge).
 */
export const BEHANDLUNGEN: BehandlungDef[] = [
  {
    key: 'krone',
    name: 'Krone',
    category: 'Festsitzend',
    imageKey: 'krone.webp',
    groupKey: null,
    turnaroundLabel: 'nach Prüfung',
    expressAvailable: true,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: true,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Zahn'),
    needsFreigabe: true,
    badges: [],
    formSchema: { bloecke: [{ typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['krone'] }, versorgung, farbe] },
    requiredFiles: OK_UK_BISS,
    stepKeys: STANDARD_SCHRITTE,
    isActive: true,
  },
  {
    key: 'bruecke',
    name: 'Brücke',
    category: 'Festsitzend',
    imageKey: 'bruecke.webp',
    groupKey: null,
    turnaroundLabel: 'nach Prüfung',
    expressAvailable: true,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: false,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Glied'),
    needsFreigabe: true,
    badges: [],
    formSchema: { bloecke: [{ typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['bruecke'] }, versorgung, farbe] },
    requiredFiles: OK_UK_BISS,
    stepKeys: STANDARD_SCHRITTE,
    isActive: true,
  },
  {
    key: 'inlay',
    name: 'Inlay / Onlay',
    category: 'Festsitzend',
    imageKey: 'inlay.webp',
    groupKey: null,
    turnaroundLabel: 'nach Prüfung',
    expressAvailable: true,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: true,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Zahn'),
    needsFreigabe: true,
    badges: [],
    formSchema: {
      bloecke: [
        { typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['inlay'] },
        {
          typ: 'auswahl',
          id: 'art',
          pflicht: true,
          label: 'Inlay oder Onlay',
          optionen: [
            { wert: 'inlay', label: 'Inlay' },
            { wert: 'onlay', label: 'Onlay' },
          ],
        },
        farbe,
      ],
    },
    requiredFiles: OK_UK_BISS,
    stepKeys: STANDARD_SCHRITTE,
    isActive: true,
  },
  {
    key: 'veneer',
    name: 'Veneer',
    category: 'Ästhetik',
    imageKey: 'veneer.webp',
    groupKey: null,
    turnaroundLabel: 'nach Prüfung',
    expressAvailable: true,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: false,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Zahn'),
    needsFreigabe: true,
    badges: [],
    formSchema: { bloecke: [{ typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['veneer'] }, { typ: 'aesthetik', id: 'aesthetik', pflicht: false }, farbe] },
    requiredFiles: OK_UK_BISS,
    stepKeys: STANDARD_SCHRITTE,
    isActive: true,
  },
  {
    key: 'implantatkrone',
    name: 'Implantatkrone',
    category: 'Implantat',
    imageKey: 'implantatkrone.webp',
    groupKey: null,
    turnaroundLabel: 'nach Prüfung',
    expressAvailable: true,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: false,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Zahn'),
    needsFreigabe: true,
    badges: [],
    formSchema: {
      bloecke: [{ typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['implantatkrone', 'bruecke'] }, { typ: 'implantat', id: 'implantat', pflicht: true }, farbe],
    },
    requiredFiles: ['scanbody', 'gegenkiefer', 'biss'], // Scan mit Scanbody + Gegenkiefer + Biss (Chatbot-Wissen)
    stepKeys: STANDARD_SCHRITTE,
    isActive: true,
  },
  {
    key: 'teilprothese',
    name: 'Teilprothese',
    category: 'Herausnehmbar',
    imageKey: 'teilprothese.webp',
    groupKey: 'prothese',
    turnaroundLabel: 'ca. 2 Wochen',
    expressAvailable: false,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: false,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Kiefer'),
    needsFreigabe: true,
    badges: [],
    formSchema: {
      bloecke: [
        { typ: 'kieferbogen', id: 'zaehne', pflicht: true },
        {
          typ: 'bildauswahl',
          id: 'prothesenform',
          pflicht: true,
          label: 'Prothesenform',
          optionen: [
            { wert: 'flipper', label: 'Flipper', bild: 'prothesenform-flipper' },
            { wert: 'nesbit', label: 'Nesbit', bild: 'prothesenform-nesbit' },
          ],
        },
        {
          typ: 'bildauswahl',
          id: 'klammern',
          pflicht: true,
          label: 'Klammern',
          optionen: [
            { wert: 'mit', label: 'Mit Klammern', bild: 'klammer-mit' },
            { wert: 'ohne', label: 'Ohne Klammern', bild: 'klammer-ohne' },
          ],
        },
        {
          typ: 'bildauswahl',
          id: 'gaumen',
          pflicht: false,
          nurWenn: { kiefer: 'OK' },
          label: 'Gaumenabdeckung',
          optionen: [
            { wert: 'hufeisen', label: 'Hufeisen', bild: 'gaumen-hufeisen' },
            { wert: 'vollstaendig', label: 'Vollständig', bild: 'gaumen-vollstaendig' },
          ],
        },
        { typ: 'schalter', id: 'einprobe', pflicht: false, label: 'Einprobe gewünscht' },
        farbe,
      ],
    },
    requiredFiles: OK_UK_BISS,
    stepKeys: PROTHESEN_SCHRITTE,
    isActive: true,
  },
  {
    key: 'totalprothese',
    name: 'Totalprothese',
    category: 'Herausnehmbar',
    imageKey: 'totalprothese.webp',
    groupKey: 'prothese',
    turnaroundLabel: 'ca. 2 Wochen',
    expressAvailable: false,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: false,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Kiefer'),
    needsFreigabe: true,
    badges: [],
    formSchema: {
      bloecke: [
        { typ: 'kiefer', id: 'kiefer', pflicht: true, label: 'Kiefer' },
        { typ: 'schalter', id: 'einprobe', pflicht: false, label: 'Einprobe gewünscht' },
        farbe,
      ],
    },
    requiredFiles: OK_UK_BISS,
    stepKeys: PROTHESEN_SCHRITTE,
    isActive: true,
  },
  {
    key: 'schiene',
    name: 'Schiene',
    category: 'Schienen',
    imageKey: 'schiene.webp',
    groupKey: null,
    turnaroundLabel: 'nach Prüfung',
    expressAvailable: true,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: false,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: ohnePreis('Kiefer'),
    needsFreigabe: true,
    badges: [],
    formSchema: {
      bloecke: [
        { typ: 'kiefer', id: 'kiefer', pflicht: true, label: 'Kiefer' },
        {
          typ: 'auswahl',
          id: 'schienenart',
          pflicht: true,
          label: 'Schienenart',
          optionen: [
            { wert: 'fest', label: 'Fest (Aufbissschiene)' },
            { wert: 'flexibel', label: 'Flexibel' },
          ],
        },
      ],
    },
    requiredFiles: OK_UK_BISS,
    stepKeys: STANDARD_SCHRITTE,
    isActive: true,
  },
  {
    key: 'smile_design',
    name: 'Smile Design',
    category: 'Ästhetik',
    imageKey: 'smile-design.webp',
    groupKey: null,
    turnaroundLabel: 'nach Prüfung',
    expressAvailable: true,
    expressSurcharge: ZUSCHLAG_OFFEN,
    sameDayAvailable: false,
    sameDaySurcharge: ZUSCHLAG_OFFEN,
    deliveryOptions: { design: { preisAb: null, einheit: 'Fall' } },
    needsFreigabe: true,
    badges: [],
    formSchema: { bloecke: [{ typ: 'zahnleiste', id: 'zaehne', pflicht: true, werkzeuge: ['veneer', 'krone'] }, { typ: 'aesthetik', id: 'aesthetik', pflicht: true }, farbe] },
    requiredFiles: [...OK_UK_BISS, 'fotos'],
    stepKeys: STANDARD_SCHRITTE,
    isActive: true,
  },
];

/** موادی که DDL دارد ولی به‌عنوان خدمت در سایت تأیید نشده‌اند: در کاتالوگ خاموش. */
const AUS = (key: string, name: string, category: string, einheit: 'Kiefer' | 'Fall', expressAvailable = true, imageKey: string | null = null): BehandlungDef => ({
  key,
  name,
  category,
  imageKey,
  groupKey: null,
  turnaroundLabel: 'nach Prüfung',
  expressAvailable,
  expressSurcharge: ZUSCHLAG_OFFEN,
  sameDayAvailable: false,
  sameDaySurcharge: ZUSCHLAG_OFFEN,
  deliveryOptions: ohnePreis(einheit),
  needsFreigabe: true,
  badges: [],
  formSchema: { bloecke: [{ typ: 'kiefer', id: 'kiefer', pflicht: true, label: 'Kiefer' }, { typ: 'text', id: 'hinweise', pflicht: false, label: 'Hinweise' }] },
  requiredFiles: OK_UK_BISS,
  stepKeys: STANDARD_SCHRITTE,
  isActive: false,
});

BEHANDLUNGEN.push(
  AUS('bohrschablone', 'Bohrschablone', 'Implantat', 'Fall'),
  AUS('modell', 'Modell', 'Modelle', 'Kiefer', true, 'modell.webp'), // Bild vom Inhaber, 6. Oktober 2026
  AUS('retainer', 'Retainer', 'Schienen', 'Kiefer'),
  AUS('sportmundschutz', 'Sportmundschutz', 'Schienen', 'Kiefer'),
  AUS('gingivamaske', 'Gingivamaske', 'Modelle', 'Fall'),
  AUS('loeffel', 'Individueller Löffel', 'Modelle', 'Kiefer'),
  AUS('klebetray', 'Klebetray (IDB)', 'Schienen', 'Kiefer'),
  AUS('hybridprothese', 'Hybridprothese', 'Implantat', 'Kiefer', false),
);

/**
 * مواد تأییدشده از knowledge-base/materials.md، با Behandlungهایی که به آن‌ها می‌خورند. مواد MIDAS با Kapsel
 * (`unit`)؛ رنگ‌ها (`shades`) را Inhaber در «Materialien» کامل می‌کند (migration 0022 همین را برای دیتابیس‌های موجود).
 */
export const MATERIALIEN: { key: string; name: string; manufacturer: string; indications: string[]; unit?: 'flasche' | 'kapsel'; shades?: string[]; isActive?: boolean }[] = [
  { key: 'sr_crown', name: 'Crown', manufacturer: 'SprintRay', indications: ['krone', 'bruecke', 'inlay', 'veneer', 'implantatkrone'] },
  { key: 'sr_crown_ht', name: 'Crown HT', manufacturer: 'SprintRay', indications: ['krone', 'inlay', 'veneer', 'implantatkrone'], unit: 'kapsel', shades: ['A1', 'A2', 'A3'] },
  { key: 'sr_ceramic_crown', name: 'Ceramic Crown', manufacturer: 'SprintRay', indications: ['krone', 'inlay', 'veneer', 'implantatkrone'], unit: 'kapsel' },
  { key: 'sr_midas_restore', name: 'Midas Restore', manufacturer: 'SprintRay', indications: ['krone', 'inlay', 'veneer', 'implantatkrone'], unit: 'kapsel' },
  { key: 'sr_digital_temp', name: 'Digital Temp', manufacturer: 'SprintRay', indications: ['krone', 'bruecke'] },
  { key: 'sr_temp_crown', name: 'Temp Crown', manufacturer: 'SprintRay', indications: ['krone', 'bruecke'] },
  { key: 'sr_apex_base', name: 'Apex Base', manufacturer: 'SprintRay', indications: ['teilprothese', 'totalprothese'] },
  { key: 'sr_apex_flex', name: 'Apex Flex', manufacturer: 'SprintRay', indications: ['teilprothese'] },
  { key: 'sr_apex_teeth', name: 'Apex Teeth', manufacturer: 'SprintRay', indications: ['teilprothese', 'totalprothese'] },
  { key: 'sr_high_impact_base', name: 'High Impact Base', manufacturer: 'SprintRay', indications: ['teilprothese', 'totalprothese'] },
  { key: 'sr_try_in_2', name: 'Try In 2', manufacturer: 'SprintRay', indications: ['teilprothese', 'totalprothese'] },
  { key: 'detax_flex', name: 'Detax flex', manufacturer: 'Detax', indications: ['teilprothese'] },
  // Formlabs: در لابراتوار فقط همین چهار تا (Inhaber، ۲۴ اکتبر ۲۰۲۶، با Dental LT Comfort)؛ بقیهٔ Resinهای Formlabs خاموش‌اند
  { key: 'fl_permanent_crown', name: 'Permanent Crown Resin', manufacturer: 'Formlabs', indications: ['krone', 'inlay', 'veneer'] },
  { key: 'fl_denture_base', name: 'Denture Base Resin', manufacturer: 'Formlabs', indications: ['teilprothese', 'totalprothese'] },
  { key: 'fl_denture_teeth', name: 'Denture Teeth Resin', manufacturer: 'Formlabs', indications: ['teilprothese', 'totalprothese'] },
  { key: 'fl_premium_teeth', name: 'Premium Teeth Resin', manufacturer: 'Formlabs', indications: ['teilprothese', 'totalprothese'], isActive: false },
  { key: 'sr_nightguard_firm_2', name: 'NightGuard Firm 2', manufacturer: 'SprintRay', indications: ['schiene'] },
  { key: 'sr_nightguard_flex', name: 'NightGuard Flex', manufacturer: 'SprintRay', indications: ['schiene'] },
  { key: 'fl_lt_clear_v2', name: 'Dental LT Clear Resin V2', manufacturer: 'Formlabs', indications: ['schiene', 'retainer'], isActive: false },
  { key: 'fl_lt_comfort', name: 'Dental LT Comfort Resin', manufacturer: 'Formlabs', indications: ['schiene'] },
  { key: 'sr_retainer', name: 'Retainer', manufacturer: 'SprintRay', indications: ['retainer'] },
  { key: 'sr_sportsguard', name: 'SportsGuard', manufacturer: 'SprintRay', indications: ['sportmundschutz'] },
  { key: 'sr_surgical_guide_3', name: 'Surgical Guide 3', manufacturer: 'SprintRay', indications: ['bohrschablone'] },
  { key: 'sr_precision_guide', name: 'Precision Guide', manufacturer: 'SprintRay', indications: ['bohrschablone'] },
  { key: 'fl_surgical_guide', name: 'Surgical Guide Resin', manufacturer: 'Formlabs', indications: ['bohrschablone'], isActive: false },
  { key: 'sr_onx_tough_2', name: 'OnX Tough 2', manufacturer: 'SprintRay', indications: ['hybridprothese'] },
  { key: 'sr_gingiva_mask', name: 'Gingiva Mask', manufacturer: 'SprintRay', indications: ['gingivamaske'] },
  { key: 'fl_flexible_80a', name: 'Flexible 80A Resin', manufacturer: 'Formlabs', indications: ['gingivamaske'], isActive: false },
  { key: 'fl_custom_tray', name: 'Custom Tray Resin', manufacturer: 'Formlabs', indications: ['loeffel'], isActive: false },
  { key: 'sr_idb_3', name: 'IDB 3', manufacturer: 'SprintRay', indications: ['klebetray'] },
  { key: 'fl_ibt_flex', name: 'IBT Flex Resin', manufacturer: 'Formlabs', indications: ['klebetray'], isActive: false },
  { key: 'fl_model_v3', name: 'Model Resin V3', manufacturer: 'Formlabs', indications: ['modell'], isActive: false },
  { key: 'sr_die_and_model_2', name: 'Die and Model 2', manufacturer: 'SprintRay', indications: ['modell'] },
  { key: 'sr_dental_model', name: 'Dental Model', manufacturer: 'SprintRay', indications: ['modell'] },
];

export const GERAETE = [
  { key: 'sprintray_midas', name: 'SprintRay MIDAS', kind: 'drucker' },
  { key: 'formlabs_form_3b', name: 'Formlabs Form 3B', kind: 'drucker' },
  { key: 'shining3d_ios', name: 'Shining 3D Intraoralscanner', kind: 'scanner' },
] as const;

/**
 * نام و نشانی صادرکننده روی اسناد و فاکتورها. از ۳ اکتبر ۲۰۲۶ Gewerbe «Digitale Zahntechnik» به نام
 * خود Isar Pishan است (پیش از آن: «ein Bereich der Ordination Dr. Beispiel»). متن دقیق Gewerbe و
 * GISA-Zahl بعد از رسیدن GISA-Auszug. Inhaber در «Einstellungen» عوضش می‌کند.
 */
export const AUSSTELLER = {
  name: 'Isar Pishan · Digital Dental Lab',
  zusatz: 'Digital Dental Lab – Digitale Zahntechnik',
  strasse: 'Adalbert-Stifter-Straße 35/6/1',
  plz: '1200',
  ort: 'Wien',
  land: 'Österreich',
  telefon: '+43 1 332 71 46',
  email: 'lab@drpishan.at',
  web: 'ddl-pishan.at',
};

/** نام صادرکنندهٔ پیش از Gewerbe تازه: seed آن را یک بار به `AUSSTELLER` تازه عوض می‌کند، اگر دستی تغییر نکرده باشد. */
export const AUSSTELLER_ALT_NAME = 'Dr. Beispiel · Digital Dental Lab';

/** داده‌های فاکتور (کاربر، ۳ اکتبر ۲۰۲۶): IBAN، ۱۴ روز مهلت، بدون UID، بدون MwSt (تأیید Steuerberater). */
export const RECHNUNGSDATEN = {
  iban: 'AT611904300234573201',
  bic: '',
  uid: '',
  zahlungszielTage: 14,
  hinweis: 'Steuerfrei gemäß § 6 Abs. 1 Z 20 UStG.',
  fusstext: '',
};

/** لیست قابل ویرایش در تنظیمات؛ «Andere» در فرم همیشه هست. */
export const IMPLANTAT_HERSTELLER = [
  'Straumann',
  'Nobel Biocare',
  'Camlog',
  'Dentsply Sirona',
  'Zimmer Biomet',
  'BioHorizons',
  'MIS',
  'Neodent',
  'Osstem',
  'Megagen',
  'Bego',
  'Medentika',
];
