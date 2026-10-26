import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  type AnyPgColumn,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { AUSGABE_KATEGORIEN } from '../lib/ausgaben/text';
import { AUSZUG_STATUS, BANK_BEREICHE, ZUORDNUNGEN } from '../lib/bank/text';
import { LAUF_STATUS, RHYTHMEN } from '../lib/fixkosten/text';
import { PRIVAT_ARTEN, PRIVAT_KATEGORIEN, PRIVAT_QUELLEN } from '../lib/privat/text';
import { TEMPI } from '../lib/katalog/tempo';
import type { VereinbarungInhalt } from '../lib/vereinbarung/text';

/**
 * مدل داده، همه در اسکیمای جدای `ddl` (Spec فاز ۱، بخش «مدل داده»).
 * این فایل قدم به قدم بزرگ می‌شود: پایه، کاربران، Ordinationها، کاتالوگ و (از قدم ۵)
 * سفارش‌ها با فایل‌ها. هر تغییر = یک migration تازه (`pnpm db:generate`).
 *
 * قاعده‌ها:
 * - ایمیل‌ها همیشه با حروف کوچک ذخیره می‌شوند.
 * - هر چیزی که با `_enc` تمام شود رمزگذاری‌شده است (`lib/crypto.ts`).
 * - توکن‌ها فقط به شکل hash ذخیره می‌شوند، هرگز خودشان.
 */
export const ddl = pgSchema('ddl');

const zeit = (name: string) => timestamp(name, { withTimezone: true });
const erstellt = () => zeit('created_at').notNull().defaultNow();

/* ── افراد و دسترسی ─────────────────────────────────────────── */

export const STAFF_ROLLEN = ['inhaber', 'buero', 'techniker', 'fahrer', 'vertrieb', 'nur_lesen'] as const;
export type StaffRolle = (typeof STAFF_ROLLEN)[number];

export const staffUsers = ddl.table('staff_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: STAFF_ROLLEN }).notNull(),
  passwordHash: text('password_hash'),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: zeit('last_login_at'),
  createdAt: erstellt(),
});

export const tours = ddl.table('tours', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  driverId: uuid('driver_id').references(() => staffUsers.id, { onDelete: 'set null' }),
  weekdays: smallint('weekdays').array().notNull().default(sql`'{}'::smallint[]`),
  isActive: boolean('is_active').notNull().default(true),
});

export const practices = ddl.table('practices', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerNo: text('customer_no').notNull().unique(),
  name: text('name').notNull(),
  street: text('street'),
  zip: text('zip'),
  city: text('city'),
  country: text('country').notNull().default('AT'),
  uidNumber: text('uid_number'),
  phone: text('phone'),
  email: text('email'),
  /** گیرندهٔ Rechnungها و Gutschriftها (Spec فاز ۲، قدم ۳)؛ خالی یعنی همان `email` */
  billingEmail: text('billing_email'),
  billingMode: text('billing_mode', { enum: ['sammel', 'einzel'] }).notNull().default('sammel'),
  /** Lieferart پیش‌فرض در فرم سفارش؛ null یعنی هر بار پرسیده شود. */
  defaultDeliveryKind: text('default_delivery_kind', { enum: ['design', 'fertigung'] }),
  tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'set null' }),
  /** ترتیب این Ordination در مسیر تور (Büro عوضش می‌کند؛ کوچک‌تر = زودتر). */
  tourPosition: integer('tour_position').notNull().default(0),
  deliveryNotes: text('delivery_notes'),
  isActive: boolean('is_active').notNull().default(true),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: erstellt(),
  updatedAt: zeit('updated_at').notNull().defaultNow(),
});

export const dentists = ddl.table(
  'dentists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    title: text('title'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('dentists_practice_idx').on(t.practiceId)],
);

export const PRAXIS_ROLLEN = ['praxis_admin', 'mitarbeiter'] as const;
export type PraxisRolle = (typeof PRAXIS_ROLLEN)[number];

export const practiceUsers = ddl.table(
  'practice_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    role: text('role', { enum: PRAXIS_ROLLEN }).notNull(),
    passwordHash: text('password_hash'),
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    invitedAt: zeit('invited_at'),
    lastLoginAt: zeit('last_login_at'),
    createdAt: erstellt(),
  },
  (t) => [index('practice_users_practice_idx').on(t.practiceId)],
);

export const USER_ARTEN = ['staff', 'practice'] as const;
export type UserArt = (typeof USER_ARTEN)[number];

export const sessions = ddl.table(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    userKind: text('user_kind', { enum: USER_ARTEN }).notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: erstellt(),
    expiresAt: zeit('expires_at').notNull(),
    lastSeenAt: zeit('last_seen_at').notNull().defaultNow(),
    revokedAt: zeit('revoked_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userKind, t.userId)],
);

export const oneTimeTokens = ddl.table('one_time_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  purpose: text('purpose', { enum: ['einladung', 'passwort_reset'] }).notNull(),
  userKind: text('user_kind', { enum: USER_ARTEN }).notNull(),
  userId: uuid('user_id').notNull(),
  expiresAt: zeit('expires_at').notNull(),
  usedAt: zeit('used_at'),
  createdAt: erstellt(),
});

export const rateLimits = ddl.table('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: zeit('window_start').notNull(),
  count: integer('count').notNull(),
});

/* ── بیمار (حداقل داده، رمزگذاری‌شده) ───────────────────────── */

export const patients = ddl.table(
  'patients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'restrict' }),
    code: text('code').notNull().unique(),
    firstNameEnc: text('first_name_enc').notNull(),
    lastNameEnc: text('last_name_enc').notNull(),
    birthDateEnc: text('birth_date_enc'),
    createdByKind: text('created_by_kind', { enum: USER_ARTEN }).notNull(),
    createdById: uuid('created_by_id').notNull(),
    createdAt: erstellt(),
    updatedAt: zeit('updated_at').notNull().defaultNow(),
  },
  (t) => [index('patients_practice_idx').on(t.practiceId)],
);

/* ── کاتالوگ و تولید ─────────────────────────────────────────── */

export const portalStatuses = ddl.table('portal_statuses', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  needsAction: boolean('needs_action').notNull().default(false),
});

export const productionSteps = ddl.table('production_steps', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  portalStatusKey: text('portal_status_key')
    .notNull()
    .references(() => portalStatuses.key),
  isActive: boolean('is_active').notNull().default(true),
});

export type LieferOption = { preisAb: number | null; einheit: 'Zahn' | 'Glied' | 'Kiefer' | 'Fall' };
export type LieferOptionen = Partial<Record<'design' | 'fertigung', LieferOption>>;
/** هزینهٔ اضافهٔ Express یا Same-Day. تا Inhaber مبلغی وارد نکرده: «… nach Prüfung». */
export type Zuschlag = { betrag: number | null; einheit: LieferOption['einheit'] | 'Auftrag' };

export const workTypes = ddl.table('work_types', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  imageKey: text('image_key'),
  /** کاشی مشترک در قدم اول فرم (مثلاً «prothese»)؛ گروه‌ها در `lib/katalog/stammdaten.ts`. */
  groupKey: text('group_key'),
  /** زمان «Standard» («ca. 2 Wochen»، «nach Prüfung»). */
  turnaroundLabel: text('turnaround_label').notNull(),
  /** «Express < 24 Stunden» برای این Behandlung هست (Service-Levelها در `lib/katalog/tempo.ts`). */
  expressAvailable: boolean('express_available').notNull().default(true),
  expressSurcharge: jsonb('express_surcharge').$type<Zuschlag>().notNull().default({ betrag: null, einheit: 'Auftrag' }),
  /** «Same-Day» (همان Werktag) فقط جایی که این روند شدنی است (Krone، Inlay/Onlay)؛ پیش‌فرض خاموش. */
  sameDayAvailable: boolean('same_day_available').notNull().default(false),
  /** جدا از Expresszuschlag (خواستهٔ کاربر، ۵ اکتبر ۲۰۲۶). */
  sameDaySurcharge: jsonb('same_day_surcharge').$type<Zuschlag>().notNull().default({ betrag: null, einheit: 'Auftrag' }),
  deliveryOptions: jsonb('delivery_options').$type<LieferOptionen>().notNull(),
  needsFreigabe: boolean('needs_freigabe').notNull().default(true),
  badges: text('badges').array().notNull().default(sql`'{}'::text[]`),
  formSchema: jsonb('form_schema').notNull(),
  requiredFiles: text('required_files').array().notNull().default(sql`'{}'::text[]`),
  stepKeys: text('step_keys').array().notNull(),
  warrantyMonths: integer('warranty_months').notNull().default(24),
  position: integer('position').notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

export const MATERIAL_EINHEITEN = ['flasche', 'kapsel'] as const;
export type MaterialEinheit = (typeof MATERIAL_EINHEITEN)[number];

/**
 * هر Resin. `unit`: بطری (کم شدن فقط با «Flasche leer») یا Kapsel (MIDAS؛ در «3D-Druck» با عدد کم می‌شود).
 * `shades`: رنگ‌هایی که این Material دارد (مثلاً A1، A2، A3)؛ هر Charge یکی از آن‌هاست.
 */
export const materials = ddl.table('materials', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  manufacturer: text('manufacturer').notNull(),
  indications: text('indications').array().notNull().default(sql`'{}'::text[]`),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  unit: text('unit', { enum: MATERIAL_EINHEITEN }).notNull().default('flasche'),
  shades: text('shades').array().notNull().default(sql`'{}'::text[]`),
});

/**
 * هر Charge (شمارهٔ Lot روی بطری یا جعبهٔ Kapsel). در «3D-Druck» انتخاب می‌شود و برای ردیابی MDR در
 * `order_materials` می‌ماند. Charge تمام‌شده «aufgebraucht» می‌شود، پاک نمی‌شود. `quantity`: چند بطری یا Kapsel
 * خریده شد؛ `stock`: چند تا مانده (null: شمرده نمی‌شود، Chargeهای پیش از ۲۴ اکتبر ۲۰۲۶).
 */
export const materialLots = ddl.table(
  'material_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    materialKey: text('material_key')
      .notNull()
      .references(() => materials.key),
    lotNo: text('lot_no').notNull(),
    expiryDate: date('expiry_date'),
    receivedAt: date('received_at'),
    usedUpAt: zeit('used_up_at'),
    createdAt: erstellt(),
    shade: text('shade'),
    quantity: integer('quantity'),
    stock: integer('stock'),
    /** فقط بطری: چند چهارم از بطریِ بازِ این Charge مانده (۴ پر … ۱ یک‌چهارم؛ null: پر یا ثبت‌نشده). ۲۴ اکتبر ۲۰۲۶ */
    fillQuarters: integer('fill_quarters'),
  },
  (t) => [
    uniqueIndex('material_lots_material_lot_uq').on(t.materialKey, t.lotNo),
    check('material_lots_menge', sql`(${t.quantity} is null or ${t.quantity} > 0) and (${t.stock} is null or ${t.stock} >= 0)`),
    check('material_lots_fuellung', sql`${t.fillQuarters} is null or ${t.fillQuarters} between 1 and 4`),
  ],
);

export const devices = ddl.table('devices', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['drucker', 'scanner', 'nachhaertung'] }).notNull(),
  isActive: boolean('is_active').notNull().default(true),
});

/* ── سفارش ───────────────────────────────────────────────────── */

export const LIEFERARTEN = ['design', 'fertigung'] as const;
export const AUTOR_ARTEN = ['praxis', 'labor', 'system'] as const;

/**
 * یک سفارش، از Entwurf تا تحویل. Entwurf همان ردیف است با status «entwurf»؛ شمارهٔ
 * «A-2026-0001» فقط موقع ارسال گرفته می‌شود تا Entwurfهای پاک‌شده جای خالی در شماره‌ها نگذارند.
 * وضعیت فقط از `lib/orders/status.ts` عوض می‌شود (CLAUDE.md، قانون ۵).
 */
export const orders = ddl.table(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNo: text('order_no').unique(),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'restrict' }),
    dentistId: uuid('dentist_id').references(() => dentists.id, { onDelete: 'set null' }),
    patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'restrict' }),
    workTypeKey: text('work_type_key').references(() => workTypes.key),
    deliveryKind: text('delivery_kind', { enum: LIEFERARTEN }),
    /** جواب‌های فرم، با کلید `id` هر قطعهٔ `form_schema`. موقع ارسال با zod همان schema پاک‌سازی می‌شود. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** حالت فرم نیمه‌کاره (کدام قدم‌ها تأیید شده‌اند و …)، فقط برای ادامهٔ Entwurf. */
    draftState: jsonb('draft_state').$type<Record<string, unknown>>(),
    treatmentPlan: text('treatment_plan'),
    /** خلاصهٔ Zahnfarbe برای Laufzettel و Kanban («A3,5»، «Farbe folgt»). */
    shade: text('shade'),
    /** Service-Level: Standard، «Express < 24 Stunden» یا «Same-Day» (`lib/katalog/tempo.ts`). null یعنی در Entwurf هنوز پرسیده نشده. */
    tempo: text('tempo', { enum: TEMPI }),
    /** قیمت «ab» و Expresszuschlag در لحظهٔ ارسال، تا تغییر قیمت بعدی روی این سفارش اثر نگذارد. */
    priceSnapshot: jsonb('price_snapshot'),
    desiredDate: date('desired_date'),
    dueDate: date('due_date'),
    status: text('status')
      .notNull()
      .default('entwurf')
      .references(() => portalStatuses.key),
    /** مرحلهٔ تولید (ستون Kanban). وقتی با وضعیت نخواند، ستون از وضعیت حساب می‌شود (`lib/produktion/schritte.ts`). */
    currentStepKey: text('current_step_key'),
    /** «Zuständig»: تکنیسین مسئول این سفارش (حروف اول روی کارت Kanban). */
    assigneeId: uuid('assignee_id').references(() => staffUsers.id, { onDelete: 'set null' }),
    /** Neuanfertigung nach einer Reklamation: der ursprüngliche Auftrag (Spec فاز ۱، بخش J). */
    remakeOfId: uuid('remake_of_id').references((): AnyPgColumn => orders.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['portal', 'labor'] }).notNull(),
    submittedAt: zeit('submitted_at'),
    approvedAt: zeit('approved_at'),
    deliveredAt: zeit('delivered_at'),
    canceledAt: zeit('canceled_at'),
    cancelReason: text('cancel_reason'),
    createdByKind: text('created_by_kind', { enum: USER_ARTEN }).notNull(),
    createdById: uuid('created_by_id').notNull(),
    createdAt: erstellt(),
    updatedAt: zeit('updated_at').notNull().defaultNow(),
  },
  (t) => [index('orders_practice_status_idx').on(t.practiceId, t.status), index('orders_patient_idx').on(t.patientId)],
);

/** دندان‌های هر سفارش، از Zahnleiste یا Kieferbogen، برای جست‌وجو و Laufzettel. هم اینجا و هم در `config`. */
export const orderTeeth = ddl.table(
  'order_teeth',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fdi: smallint('fdi').notNull(),
    treatment: text('treatment').notNull(),
    spanId: text('span_id'),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.fdi, t.treatment] })],
);

export const orderStatusHistory = ddl.table(
  'order_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    at: zeit('at').notNull().defaultNow(),
    byKind: text('by_kind', { enum: [...USER_ARTEN, 'system'] }).notNull(),
    byId: uuid('by_id'),
  },
  (t) => [index('order_status_history_order_idx').on(t.orderId, t.at)],
);

export const DATEI_ARTEN = ['scan', 'foto', 'dokument', 'design'] as const;

/**
 * فایل‌های هر سفارش. فایل روی دیسک با نام تصادفی (`storage_key`) ذخیره می‌شود. نام اصلی
 * رمزگذاری‌شده است، چون اسکنرها نام بیمار را اغلب در نام فایل می‌گذارند.
 */
export const orderFiles = ddl.table(
  'order_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    origin: text('origin', { enum: ['praxis', 'labor'] }).notNull(),
    kind: text('kind', { enum: DATEI_ARTEN }).notNull(),
    /** ok | uk | biss | scanbody | fotos | sonstiges */
    slot: text('slot'),
    designRevision: integer('design_revision'),
    storageKey: text('storage_key').notNull().unique(),
    filenameEnc: text('filename_enc').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    uploadedByKind: text('uploaded_by_kind', { enum: USER_ARTEN }).notNull(),
    uploadedById: uuid('uploaded_by_id').notNull(),
    createdAt: erstellt(),
    deletedAt: zeit('deleted_at'),
  },
  (t) => [index('order_files_order_idx').on(t.orderId)],
);

/**
 * گفت‌وگوی هر سفارش (تب «Kommunikation»، قدم ۶). از قدم ۵: پیام خودکار وقتی فایل‌های
 * لازم با «Daten werden nachgereicht» فرستاده نشده‌اند. پیام `is_internal` هرگز در کوئری پورتال نیست.
 */
export const orderMessages = ddl.table(
  'order_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    authorKind: text('author_kind', { enum: AUTOR_ARTEN }).notNull(),
    authorId: uuid('author_id'),
    kind: text('kind', { enum: ['nachricht', 'aenderung', 'reklamation', 'ereignis'] }).notNull(),
    body: text('body').notNull(),
    designRevision: integer('design_revision'),
    isInternal: boolean('is_internal').notNull().default(false),
    createdAt: erstellt(),
  },
  (t) => [index('order_messages_order_idx').on(t.orderId, t.createdAt)],
);

/**
 * هر نسخهٔ طرح لابراتوار (Spec فاز ۱، بخش G): فایل‌ها در `order_files` با `kind = 'design'` و
 * همین شمارهٔ `design_revision`. نسخهٔ تازه جای نسخهٔ باز قبلی را می‌گیرد («ersetzt»).
 * تصمیم Ordination با نام، زمان سرور و IP ثبت می‌شود و فقط یک بار (`status = 'offen'`).
 */
export const designRevisions = ddl.table(
  'design_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    note: text('note'),
    uploadedBy: uuid('uploaded_by').notNull(),
    uploadedAt: zeit('uploaded_at').notNull().defaultNow(),
    status: text('status', { enum: ['offen', 'freigegeben', 'aenderung', 'ersetzt'] }).notNull().default('offen'),
    decidedAt: zeit('decided_at'),
    decidedBy: uuid('decided_by'),
    decidedName: text('decided_name'),
    decidedIp: text('decided_ip'),
    changeMessageId: uuid('change_message_id'),
  },
  (t) => [uniqueIndex('design_revisions_order_revision_uq').on(t.orderId, t.revision)],
);

/** «Wie gefällt Ihnen das Design?» – ein Urteil pro Auftrag. */
export const orderFeedback = ddl.table('order_feedback', {
  orderId: uuid('order_id')
    .primaryKey()
    .references(() => orders.id, { onDelete: 'cascade' }),
  rating: text('rating', { enum: ['up', 'down'] }).notNull(),
  comment: text('comment'),
  createdBy: uuid('created_by').notNull(),
  createdAt: erstellt(),
});

/**
 * مراحل تولید هر سفارش (Spec فاز ۱، بخش H): چه وقت شروع و تمام شد، چه کسی، با کدام دستگاه.
 * ردیف فقط وقتی ساخته می‌شود که در آن مرحله اتفاقی بیفتد؛ فهرست مراحل خود سفارش از
 * Behandlung و Lieferart حساب می‌شود (`lib/produktion/schritte.ts`).
 */
export const orderSteps = ddl.table(
  'order_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    stepKey: text('step_key')
      .notNull()
      .references(() => productionSteps.key),
    deviceKey: text('device_key').references(() => devices.key),
    startedAt: zeit('started_at'),
    doneAt: zeit('done_at'),
    doneBy: uuid('done_by').references(() => staffUsers.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('order_steps_order_step_uq').on(t.orderId, t.stepKey)],
);

/** Chargeهایی که برای این سفارش استفاده شد (ردیابی MDR، بعداً روی Konformitätserklärung). */
export const orderMaterials = ddl.table(
  'order_materials',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => materialLots.id, { onDelete: 'restrict' }),
    stepKey: text('step_key').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: erstellt(),
    /** چند Kapsel از این Charge برای این سفارش کم شد (بطری: ۰) */
    quantity: integer('quantity').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.lotId] })],
);

/** پیوست‌های هر پیام (فایل‌ها در `order_files` با slot «nachricht»). */
export const messageFiles = ddl.table(
  'message_files',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => orderMessages.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => orderFiles.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.fileId] }), index('message_files_file_idx').on(t.fileId)],
);

/** تا کجا هر کاربر پیام‌های یک سفارش را خوانده است (شمارندهٔ «ungelesen» روی تب Kommunikation). */
export const messageReads = ddl.table(
  'message_reads',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    readerKind: text('reader_kind', { enum: USER_ARTEN }).notNull(),
    readerId: uuid('reader_id').notNull(),
    lastReadAt: zeit('last_read_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.readerKind, t.readerId] })],
);

/* ── تور و Abholung ──────────────────────────────────────────── */

export const ABHOL_STATUS = ['offen', 'eingeplant', 'erledigt', 'storniert'] as const;

/**
 * «Abholung anfordern» از پورتال (Spec فاز ۱، بخش I): Ordination می‌خواهد چیزی برداشته شود (مثلاً
 * Einprobe برگشتی). Büro آن را در یک تور و روز می‌گذارد؛ راننده «Abgeholt» می‌زند.
 * توقف‌های تحویل جدول ندارند: هر روز از سفارش‌های آمادهٔ تحویل حساب می‌شوند (`lib/touren/tag.ts`).
 */
export const pickupRequests = ddl.table(
  'pickup_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    /** optional: zu welchem Auftrag (z. B. Einprobe zurück) */
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    desiredDate: date('desired_date').notNull(),
    note: text('note'),
    status: text('status', { enum: ABHOL_STATUS }).notNull().default('offen'),
    tourId: uuid('tour_id').references(() => tours.id, { onDelete: 'set null' }),
    plannedDate: date('planned_date'),
    requestedByKind: text('requested_by_kind', { enum: USER_ARTEN }).notNull(),
    requestedById: uuid('requested_by_id').notNull(),
    doneAt: zeit('done_at'),
    doneBy: uuid('done_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: erstellt(),
  },
  (t) => [index('pickup_requests_status_idx').on(t.status, t.plannedDate), index('pickup_requests_practice_idx').on(t.practiceId)],
);

/* ── اسناد و Reklamation ─────────────────────────────────────── */

export const DOKUMENT_ARTEN = ['konformitaet', 'lieferschein'] as const;
export type DokumentArt = (typeof DOKUMENT_ARTEN)[number];

/**
 * اسناد غیرقابل‌تغییر (CLAUDE.md، قانون ۶؛ Spec فاز ۱، بخش K): Konformitätserklärung و Lieferschein،
 * هر کدام یک بار برای هر سفارش. PDF روی دیسک (`storage_key`) با sha256 همان لحظه. یک trigger در
 * Postgres (migration `0010`) هر UPDATE و DELETE را رد می‌کند؛ پس `issued_by` کلید خارجی ندارد.
 */
export const documents = ddl.table(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: DOKUMENT_ARTEN }).notNull(),
    docNo: text('doc_no').notNull().unique(),
    storageKey: text('storage_key').notNull().unique(),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    issuedAt: zeit('issued_at').notNull().defaultNow(),
    issuedBy: uuid('issued_by'),
    issuedByLabel: text('issued_by_label').notNull(),
  },
  (t) => [uniqueIndex('documents_order_kind_uq').on(t.orderId, t.kind)],
);

/**
 * پوزیشن‌های فاکتور یک سفارش، فقط وقتی Büro پیشنهاد خودکار (`lib/abrechnung/positionen.ts`) را
 * ویرایش کرده باشد؛ اگر ردیفی نباشد، همان پیشنهاد معتبر است. مبلغ‌ها به سنت. با صدور فاکتور قفل
 * می‌شوند (Spec فاز ۲، قدم ۲).
 */
/**
 * Rabatt یک پوزیشن (خواستهٔ کاربر، ۶ اکتبر ۲۰۲۶): درصد یا مبلغ ثابت، از مبلغ همان ردیف کم می‌شود.
 * `rabatt_wert`: درصد به صدم درصد (1000 = 10 %)، مبلغ به سنت. هر دو خالی یعنی بدون Rabatt.
 */
export const RABATT_ARTEN = ['prozent', 'betrag'] as const;
export type RabattArt = (typeof RABATT_ARTEN)[number];

export const orderPositions = ddl.table(
  'order_positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    bezeichnung: text('bezeichnung').notNull(),
    menge: integer('menge').notNull(),
    einheit: text('einheit').notNull(),
    einzelpreisCent: integer('einzelpreis_cent').notNull(),
    rabattArt: text('rabatt_art', { enum: RABATT_ARTEN }),
    rabattWert: integer('rabatt_wert'),
    createdById: uuid('created_by_id').notNull(),
    createdByLabel: text('created_by_label').notNull(),
    createdAt: erstellt(),
  },
  (t) => [
    uniqueIndex('order_positions_order_pos_uq').on(t.orderId, t.position),
    check(
      'order_positions_rabatt',
      sql`(${t.rabattArt} is null and ${t.rabattWert} is null) or (${t.rabattArt} = 'betrag' and ${t.rabattWert} > 0) or (${t.rabattArt} = 'prozent' and ${t.rabattWert} between 1 and 10000)`,
    ),
  ],
);

export const RECHNUNGS_ARTEN = ['rechnung', 'gutschrift'] as const;
export type RechnungsArt = (typeof RECHNUNGS_ARTEN)[number];

/**
 * Rechnung و Gutschrift (Spec فاز ۲، قدم ۲). پیش‌نویس ذخیره نمی‌شود: پیش‌نمایش هر بار از سفارش‌ها
 * ساخته می‌شود و فقط سند صادرشده اینجا می‌آید، با گیرنده، صادرکننده و ردیف‌ها همان‌طور که روی PDF
 * چاپ شدند. غیرقابل‌تغییر (trigger، migration 0014)؛ اصلاح فقط با Gutschrift (`storno` = کل مبلغ).
 */
export const invoices = ddl.table(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nummer: text('nummer').notNull().unique(),
    art: text('art', { enum: RECHNUNGS_ARTEN }).notNull(),
    /** Gutschrift برای کل مبلغ یک Rechnung: سفارش‌های آن دوباره باز می‌شوند */
    storno: boolean('storno').notNull().default(false),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'restrict' }),
    bezugId: uuid('bezug_id').references((): AnyPgColumn => invoices.id, { onDelete: 'restrict' }),
    abrechnung: text('abrechnung', { enum: ['sammel', 'einzel', 'gutschrift'] }).notNull(),
    zeitraumVon: date('zeitraum_von'),
    zeitraumBis: date('zeitraum_bis'),
    ausgestelltAm: zeit('ausgestellt_am').notNull().defaultNow(),
    faelligAm: date('faellig_am'),
    summeCent: integer('summe_cent').notNull(),
    empfaenger: jsonb('empfaenger').notNull(),
    aussteller: jsonb('aussteller').notNull(),
    grund: text('grund'),
    storageKey: text('storage_key').notNull().unique(),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    ausgestelltVon: uuid('ausgestellt_von'),
    ausgestelltVonLabel: text('ausgestellt_von_label').notNull(),
  },
  (t) => [index('invoices_practice_idx').on(t.practiceId), index('invoices_bezug_idx').on(t.bezugId)],
);

export const invoiceLines = ddl.table(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    auftragsnummer: text('auftragsnummer'),
    patientencode: text('patientencode'),
    leistungsdatum: date('leistungsdatum'),
    bezeichnung: text('bezeichnung').notNull(),
    menge: integer('menge').notNull(),
    einheit: text('einheit').notNull(),
    einzelpreisCent: integer('einzelpreis_cent').notNull(),
    /** Rabatt همان‌طور که روی PDF آمد (مثل `order_positions`)؛ `rabatt_cent` مبلغ کسرشده، در Storno منفی */
    rabattArt: text('rabatt_art', { enum: RABATT_ARTEN }),
    rabattWert: integer('rabatt_wert'),
    rabattCent: integer('rabatt_cent').notNull().default(0),
    /** menge × einzelpreis − rabatt */
    betragCent: integer('betrag_cent').notNull(),
  },
  (t) => [
    uniqueIndex('invoice_lines_invoice_pos_uq').on(t.invoiceId, t.position),
    index('invoice_lines_order_idx').on(t.orderId),
    check(
      'invoice_lines_rabatt',
      sql`(${t.rabattArt} is null and ${t.rabattWert} is null and ${t.rabattCent} = 0) or (${t.rabattArt} in ('prozent', 'betrag') and ${t.rabattWert} > 0)`,
    ),
  ],
);

/**
 * هر بار که یک Rechnung یا Gutschrift با ایمیل فرستاده می‌شود (Spec فاز ۲، قدم ۳): به چه آدرسی، کی و
 * به دست چه کسی. خود ایمیل یک کار `email_mit_anhang` در صف است و وضعیت ارسال از همان کار خوانده می‌شود.
 * پاک‌شدن فقط همراه فاکتور، که خودش فقط در آزمون ممکن است.
 */
export const invoiceDispatches = ddl.table(
  'invoice_dispatches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    an: text('an').notNull(),
    jobId: uuid('job_id').references((): AnyPgColumn => jobs.id, { onDelete: 'set null' }),
    angefordertAm: zeit('angefordert_am').notNull().defaultNow(),
    angefordertVon: uuid('angefordert_von'),
    angefordertVonLabel: text('angefordert_von_label').notNull(),
  },
  (t) => [index('invoice_dispatches_invoice_idx').on(t.invoiceId)],
);

export const ZAHLUNGSARTEN = ['ueberweisung', 'bar', 'karte', 'sonstige'] as const;
export type Zahlungsart = (typeof ZAHLUNGSARTEN)[number];

/**
 * پرداخت‌های دریافتی برای یک Rechnung (Spec فاز ۲، قدم ۳)، به سنت و همیشه مثبت. Büro آن‌ها را از روی
 * صورت‌حساب بانک ثبت می‌کند. خودشان سند حسابداری نیستند (سند، صورت‌حساب بانک است)؛ ثبت اشتباه با audit
 * پاک می‌شود. `practice_id` همان Ordination فاکتور است، برای Saldo.
 */
export const payments = ddl.table(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'restrict' }),
    betragCent: integer('betrag_cent').notNull(),
    eingegangenAm: date('eingegangen_am').notNull(),
    art: text('art', { enum: ZAHLUNGSARTEN }).notNull().default('ueberweisung'),
    notiz: text('notiz'),
    erfasstAm: zeit('erfasst_am').notNull().defaultNow(),
    erfasstVon: uuid('erfasst_von'),
    erfasstVonLabel: text('erfasst_von_label').notNull(),
  },
  (t) => [
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_practice_idx').on(t.practiceId),
    check('payments_betrag_positiv', sql`${t.betragCent} > 0`),
  ],
);


/**
 * «Ausgaben» (Einnahmen-Ausgaben-Rechnung، خواستهٔ کاربر ۲۴ اکتبر ۲۰۲۶): هر هزینه از روی Rechnung فروشنده، با
 * Netto، MwSt و Brutto. DDL بدون MwSt کار می‌کند (§6 Abs. 1 Z 20 UStG) و Vorsteuer پس نمی‌گیرد؛ پس Ausgabe همان
 * Brutto است. ماه و سال بر اساس `bezahlt_am` (Abflussprinzip). Beleg (عکس یا PDF) کنار ردیف در `STORAGE_DIR`؛
 * وقتی ثبت شد، عوض و پاک نمی‌شود (BAO § 132، ۷ سال؛ trigger در migration 0025). حذف فقط با `geloescht_am`.
 */
export const expenses = ddl.table(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rechnungsdatum: date('rechnungsdatum').notNull(),
    bezahltAm: date('bezahlt_am').notNull(),
    lieferant: text('lieferant').notNull(),
    rechnungsnummer: text('rechnungsnummer'),
    kategorie: text('kategorie', { enum: AUSGABE_KATEGORIEN }).notNull(),
    beschreibung: text('beschreibung'),
    nettoCent: integer('netto_cent').notNull(),
    /** 20, 13, 10 oder 0 Prozent; null = Betrag direkt eingegeben (gemischte Sätze, ausländische Rechnung) */
    mwstSatz: smallint('mwst_satz'),
    mwstCent: integer('mwst_cent').notNull(),
    bruttoCent: integer('brutto_cent').notNull(),
    belegKey: text('beleg_key').unique(),
    belegSha256: text('beleg_sha256'),
    belegGroesse: integer('beleg_groesse'),
    belegTyp: text('beleg_typ'),
    belegName: text('beleg_name'),
    belegAm: zeit('beleg_am'),
    erfasstAm: zeit('erfasst_am').notNull().defaultNow(),
    erfasstVon: uuid('erfasst_von'),
    erfasstVonLabel: text('erfasst_von_label').notNull(),
    geaendertAm: zeit('geaendert_am'),
    geloeschtAm: zeit('geloescht_am'),
    geloeschtVonLabel: text('geloescht_von_label'),
  },
  (t) => [
    index('expenses_bezahlt_idx').on(t.bezahltAm),
    check('expenses_betraege', sql`${t.nettoCent} > 0 and ${t.mwstCent} >= 0 and ${t.bruttoCent} = ${t.nettoCent} + ${t.mwstCent}`),
    check('expenses_mwst_satz', sql`${t.mwstSatz} is null or ${t.mwstSatz} in (0, 10, 13, 20)`),
    check('expenses_beleg', sql`(${t.belegKey} is null) = (${t.belegSha256} is null)`),
  ],
);

/** Zustand eines hochgeladenen Belegs im Eingang «Zu prüfen» */
export const BELEG_EINGANG_STATUS = ['neu', 'gelesen', 'fehler'] as const;

/**
 * «Zu prüfen» (Ausgaben قدم ۲، ۲۴ اکتبر ۲۰۲۶): عکس یا PDF که بالا آمده ولی هنوز Ausgabe نشده. Claude آن را می‌خواند
 * (`lib/ai-safe.ts`) و پیشنهاد در `vorschlag` می‌ماند؛ Inhaber آن را بررسی و «Übernehmen» می‌کند. آن وقت فیلدهای
 * Beleg به ردیف `expenses` منتقل می‌شوند و این ردیف پاک می‌شود. «Verwerfen» ردیف و فایل را پاک می‌کند (هنوز
 * ثبت نشده بود). مصرف KI جدا در `ki_nutzung`.
 */
export const belegEingang = ddl.table(
  'beleg_eingang',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    belegKey: text('beleg_key').notNull().unique(),
    belegSha256: text('beleg_sha256').notNull(),
    belegGroesse: integer('beleg_groesse').notNull(),
    belegTyp: text('beleg_typ').notNull(),
    belegName: text('beleg_name').notNull(),
    status: text('status', { enum: BELEG_EINGANG_STATUS }).notNull().default('neu'),
    vorschlag: jsonb('vorschlag'),
    fehler: text('fehler'),
    kiModell: text('ki_modell'),
    gelesenAm: zeit('gelesen_am'),
    hochgeladenAm: zeit('hochgeladen_am').notNull().defaultNow(),
    hochgeladenVon: uuid('hochgeladen_von'),
    hochgeladenVonLabel: text('hochgeladen_von_label').notNull(),
    /**
     * برای کدام Bereich (Spec فاز ۵، قدم ۲): «privat» اگر در «Privat» بالا آمد؛ وگرنه بعد از خواندن، پیشنهاد KI؛
     * null = DDL. فقط تعیین می‌کند Beleg زیر کدام «Zu prüfen» دیده شود؛ هنگام «Übernehmen» می‌شود عوضش کرد.
     */
    bereich: text('bereich', { enum: ['ddl', 'privat'] }),
  },
  (t) => [index('beleg_eingang_sha_idx').on(t.belegSha256)],
);

/**
 * «Privat» (Spec فاز ۵، قدم ۲؛ فقط Inhaber): پول شخصی، کاملاً جدا از `expenses`، تا هرگز وارد اسناد و Export
 * لابراتوار نشود. مبلغ همیشه مثبت؛ `art` می‌گوید خرج است یا درآمد. Beleg اختیاری، از «Zu prüfen» یا بعداً از فرم.
 * حذف فقط با `geloescht_am`، مثل Ausgaben (دادهٔ کم، برگشت‌پذیر بودن مهم‌تر از جا).
 */
export const privatBuchungen = ddl.table(
  'privat_buchungen',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    art: text('art', { enum: PRIVAT_ARTEN }).notNull(),
    datum: date('datum').notNull(),
    betragCent: integer('betrag_cent').notNull(),
    kategorie: text('kategorie', { enum: PRIVAT_KATEGORIEN }).notNull(),
    haendler: text('haendler'),
    notiz: text('notiz'),
    quelle: text('quelle', { enum: PRIVAT_QUELLEN }).notNull().default('hand'),
    belegKey: text('beleg_key').unique(),
    belegSha256: text('beleg_sha256'),
    belegGroesse: integer('beleg_groesse'),
    belegTyp: text('beleg_typ'),
    belegName: text('beleg_name'),
    belegAm: zeit('beleg_am'),
    erfasstAm: zeit('erfasst_am').notNull().defaultNow(),
    erfasstVon: uuid('erfasst_von'),
    erfasstVonLabel: text('erfasst_von_label').notNull(),
    geaendertAm: zeit('geaendert_am'),
    geloeschtAm: zeit('geloescht_am'),
  },
  (t) => [
    index('privat_buchungen_datum_idx').on(t.datum),
    check('privat_buchungen_betrag', sql`${t.betragCent} > 0`),
    check('privat_buchungen_beleg', sql`(${t.belegKey} is null) = (${t.belegSha256} is null)`),
  ],
);

/**
 * «Fixkosten» (Spec فاز ۵، قدم ۳؛ فقط Inhaber): هزینه یا درآمد تکرارشونده، برای DDL یا Privat. `ab` = اولین سررسید
 * (روزش = `tag`)، `bis` = آخرین روزی که هنوز سررسید دارد. `kategorie` بسته به Bereich از فهرست Ausgaben یا Privat
 * (در کد بررسی می‌شود). DDL فقط Ausgabe، با `mwst_satz` برای پیشنهاد Netto/MwSt. حذف فقط تا وقتی هنوز اجرا نشده.
 */
export const fixkostenVorlagen = ddl.table(
  'fixkosten_vorlagen',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bereich: text('bereich', { enum: ['ddl', 'privat'] }).notNull(),
    art: text('art', { enum: PRIVAT_ARTEN }).notNull().default('ausgabe'),
    titel: text('titel').notNull(),
    gegenpartei: text('gegenpartei'),
    kategorie: text('kategorie').notNull(),
    betragCent: integer('betrag_cent').notNull(),
    mwstSatz: smallint('mwst_satz'),
    rhythmus: text('rhythmus', { enum: RHYTHMEN }).notNull(),
    ab: date('ab').notNull(),
    tag: smallint('tag').notNull(),
    bis: date('bis'),
    aktiv: boolean('aktiv').notNull().default(true),
    notiz: text('notiz'),
    erstelltAm: erstellt(),
    erstelltVonLabel: text('erstellt_von_label').notNull(),
    geaendertAm: zeit('geaendert_am'),
  },
  (t) => [
    check('fixkosten_vorlagen_betrag', sql`${t.betragCent} > 0`),
    check('fixkosten_vorlagen_tag', sql`${t.tag} between 1 and 31`),
    check('fixkosten_vorlagen_ddl', sql`${t.bereich} = 'privat' or (${t.art} = 'ausgabe' and ${t.mwstSatz} is not null)`),
  ],
);

/**
 * هر سررسید یک Vorlage، دقیقاً یک بار (unique روی Vorlage و Periode): دو اجرای هم‌زمان یا تکراری هرگز ردیف دوم
 * نمی‌سازند. Privat همان لحظه یک `privat_buchungen` می‌سازد («gebucht»)؛ DDL «offen» می‌ماند تا در «Zu prüfen»
 * «Übernehmen» (← `expenses`) یا «Überspringen» شود.
 */
export const fixkostenLaeufe = ddl.table(
  'fixkosten_laeufe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vorlageId: uuid('vorlage_id')
      .notNull()
      .references(() => fixkostenVorlagen.id, { onDelete: 'restrict' }),
    periode: text('periode').notNull(),
    faelligAm: date('faellig_am').notNull(),
    status: text('status', { enum: LAUF_STATUS }).notNull(),
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
    privatBuchungId: uuid('privat_buchung_id').references(() => privatBuchungen.id, { onDelete: 'set null' }),
    erstelltAm: erstellt(),
    erledigtAm: zeit('erledigt_am'),
  },
  (t) => [uniqueIndex('fixkosten_laeufe_einmal').on(t.vorlageId, t.periode), index('fixkosten_laeufe_status_idx').on(t.status)],
);

/**
 * «Bank» (Spec فاز ۵، قدم ۴؛ فقط Inhaber): هر Kontoauszug PDF یک بار (sha256)، با کنترل کامل‌بودن. اگر خواندن
 * نشد، با `fehler` می‌ماند تا «Erneut lesen» یا حذف. PDF در `STORAGE_DIR`.
 */
export const bankAuszuege = ddl.table('bank_auszuege', {
  id: uuid('id').primaryKey().defaultRandom(),
  dateiKey: text('datei_key').notNull().unique(),
  dateiSha256: text('datei_sha256').notNull().unique(),
  dateiGroesse: integer('datei_groesse').notNull(),
  dateiName: text('datei_name').notNull(),
  status: text('status', { enum: AUSZUG_STATUS }).notNull(),
  fehler: text('fehler'),
  iban: text('iban'),
  auszugNummer: text('auszug_nummer'),
  auszugDatum: date('auszug_datum'),
  alterCent: integer('alter_cent'),
  neuerCent: integer('neuer_cent'),
  umsaetzeNeu: integer('umsaetze_neu').notNull().default(0),
  umsaetzeSchonDa: integer('umsaetze_schon_da').notNull().default(0),
  kiModell: text('ki_modell'),
  hochgeladenAm: zeit('hochgeladen_am').notNull().defaultNow(),
  hochgeladenVonLabel: text('hochgeladen_von_label').notNull(),
});

/**
 * هر ردیف بانک یک بار (`fingerabdruck`: مرجع بانک، وگرنه تاریخ/مبلغ/متن). `betrag_cent` ورودی مثبت، خروجی منفی.
 * پیشنهاد KI در `bereich`/`kategorie`/`privat_kategorie`؛ تصمیم Inhaber در `zuordnung` و یکی از ارجاع‌ها. تا وقتی
 * `zuordnung` خالی است، ردیف «zu klären» است. Zahlung/Privat-Buchung که از اینجا ساخته شد با `erstellt_hier`.
 */
export const bankUmsaetze = ddl.table(
  'bank_umsaetze',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auszugId: uuid('auszug_id')
      .notNull()
      .references(() => bankAuszuege.id, { onDelete: 'restrict' }),
    fingerabdruck: text('fingerabdruck').notNull().unique(),
    buchungstag: date('buchungstag').notNull(),
    valuta: date('valuta'),
    betragCent: integer('betrag_cent').notNull(),
    gegenpartei: text('gegenpartei'),
    iban: text('iban'),
    text: text('text').notNull(),
    referenz: text('referenz'),
    rechnungsnummer: text('rechnungsnummer'),
    bereich: text('bereich', { enum: BANK_BEREICHE }).notNull(),
    kategorie: text('kategorie'),
    privatKategorie: text('privat_kategorie'),
    zuordnung: text('zuordnung', { enum: ZUORDNUNGEN }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    expenseId: uuid('expense_id').references(() => expenses.id, { onDelete: 'set null' }),
    privatBuchungId: uuid('privat_buchung_id').references(() => privatBuchungen.id, { onDelete: 'set null' }),
    erstelltHier: boolean('erstellt_hier').notNull().default(false),
    zugeordnetAm: zeit('zugeordnet_am'),
  },
  (t) => [
    index('bank_umsaetze_tag_idx').on(t.buchungstag),
    index('bank_umsaetze_zuordnung_idx').on(t.zuordnung),
    check('bank_umsaetze_betrag', sql`${t.betragCent} <> 0`),
    uniqueIndex('bank_umsaetze_expense_einmal').on(t.expenseId),
    uniqueIndex('bank_umsaetze_privat_einmal').on(t.privatBuchungId),
  ],
);

/** Verbrauch der KI je gelesenem Beleg (bleibt, auch wenn der Eingang übernommen oder verworfen wird) */
export const kiNutzung = ddl.table(
  'ki_nutzung',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    zweck: text('zweck').notNull(),
    modell: text('modell').notNull(),
    eingabeTokens: integer('eingabe_tokens').notNull(),
    ausgabeTokens: integer('ausgabe_tokens').notNull(),
    erfolgreich: boolean('erfolgreich').notNull(),
    am: zeit('am').notNull().defaultNow(),
  },
  (t) => [index('ki_nutzung_am_idx').on(t.am)],
);

/**
 * «Handy-Scanner» (۲۴ اکتبر ۲۰۲۶): کلید یک دستگاه (Kurzbefehl آیفون) که **فقط** اجازهٔ فرستادن Beleg به «Zu prüfen»
 * را دارد (`api/ausgaben/scan`). مثل نشست‌ها فقط sha256 کلید ذخیره می‌شود؛ کلید یک بار نشان داده می‌شود.
 * «Sperren» = `revoked_at`. کاربر باید فعال بماند و حق `ausgaben.verwalten` داشته باشد.
 */
export const scanZugaenge = ddl.table(
  'scan_zugaenge',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    staffUserId: uuid('staff_user_id')
      .notNull()
      .references(() => staffUsers.id, { onDelete: 'cascade' }),
    createdAt: erstellt(),
    lastUsedAt: zeit('last_used_at'),
    revokedAt: zeit('revoked_at'),
  },
  (t) => [index('scan_zugaenge_user_idx').on(t.staffUserId)],
);

/**
 * Zahlungserinnerung و Mahnungها (Spec فاز ۲، قدم ۴): `stufe` ۱ = Zahlungserinnerung، ۲ = 1. Mahnung،
 * ۳ = 2. Mahnung؛ هر مرحله برای هر Rechnung فقط یک بار. مبلغ باز و مهلت تازه همان‌طور که روی PDF آمد.
 * `an` و `job_id`: آخرین ارسال با ایمیل (خالی = هنوز فرستاده نشده، مثلاً بدون آدرس).
 */
export const dunningLetters = ddl.table(
  'dunning_letters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'restrict' }),
    stufe: smallint('stufe').notNull(),
    offenCent: integer('offen_cent').notNull(),
    frist: date('frist').notNull(),
    erstelltAm: zeit('erstellt_am').notNull().defaultNow(),
    erstelltVon: uuid('erstellt_von'),
    erstelltVonLabel: text('erstellt_von_label').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    sha256: text('sha256').notNull(),
    size: integer('size').notNull(),
    an: text('an'),
    jobId: uuid('job_id').references((): AnyPgColumn => jobs.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('dunning_letters_invoice_stufe_uq').on(t.invoiceId, t.stufe),
    index('dunning_letters_practice_idx').on(t.practiceId),
    check('dunning_letters_stufe', sql`${t.stufe} between 1 and 3`),
  ],
);

/**
 * «Vereinbarung zu Datenschutz und Portalnutzung» (`lib/vereinbarung/`): هر Ordination هر نسخه را یک بار
 * می‌پذیرد و تا آن موقع پورتالش بسته است. متن کاملی که دیده شد (`inhalt`، با نام دو طرف) و sha256 آن
 * می‌ماند، به‌عنوان مدرک. مثل `documents` با trigger غیرقابل‌تغییر است (migration 0012).
 */
export const practiceAgreements = ddl.table(
  'practice_agreements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'restrict' }),
    version: text('version').notNull(),
    inhalt: jsonb('inhalt').$type<VereinbarungInhalt>().notNull(),
    sha256: text('sha256').notNull(),
    acceptedById: uuid('accepted_by_id')
      .notNull()
      .references(() => practiceUsers.id, { onDelete: 'restrict' }),
    acceptedByName: text('accepted_by_name').notNull(),
    acceptedByEmail: text('accepted_by_email').notNull(),
    acceptedAt: zeit('accepted_at').notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [uniqueIndex('practice_agreements_practice_version_uq').on(t.practiceId, t.version)],
);

export const REKLAMATIONS_GRUENDE = ['passung', 'bruch', 'farbe', 'form', 'sonstiges'] as const;
export type ReklamationsGrund = (typeof REKLAMATIONS_GRUENDE)[number];
export const ENTSCHEIDUNGEN = ['offen', 'neuanfertigung', 'reparatur', 'abgelehnt'] as const;
export type Entscheidung = (typeof ENTSCHEIDUNGEN)[number];

/**
 * Reklamation (Spec فاز ۱، بخش J): Ordination (یا Büro تلفنی) برای یک کار تحویل‌شده ثبت می‌کند.
 * Gewährleistung همان لحظه از تاریخ تحویل و `work_types.warranty_months` حساب و ذخیره می‌شود.
 * متن و عکس‌ها یک پیام «reklamation» در Kommunikation هستند (`message_id`). Büro تصمیم می‌گیرد؛
 * Neuanfertigung یک سفارش تازه است (`new_order_id`، و روی آن `orders.remake_of_id`).
 * هر سفارش در هر لحظه حداکثر یک Reklamation باز دارد.
 */
export const complaints = ddl.table(
  'complaints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    complaintNo: text('complaint_no').notNull().unique(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'restrict' }),
    reportedByKind: text('reported_by_kind', { enum: USER_ARTEN }).notNull(),
    reportedById: uuid('reported_by_id').notNull(),
    reason: text('reason', { enum: REKLAMATIONS_GRUENDE }).notNull(),
    description: text('description').notNull(),
    messageId: uuid('message_id').references(() => orderMessages.id, { onDelete: 'set null' }),
    warrantyUntil: date('warranty_until'),
    warrantyValid: boolean('warranty_valid').notNull(),
    decision: text('decision', { enum: ENTSCHEIDUNGEN }).notNull().default('offen'),
    /** Nachricht an die Ordination (bei «Abgelehnt» die Begründung, Pflicht) */
    decisionNote: text('decision_note'),
    /** Neuanfertigung ohne Berechnung (Gewährleistung oder Kulanz) */
    freeOfCharge: boolean('free_of_charge'),
    newOrderId: uuid('new_order_id').references(() => orders.id, { onDelete: 'set null' }),
    decidedAt: zeit('decided_at'),
    decidedBy: uuid('decided_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    repairedAt: zeit('repaired_at'),
    repairedBy: uuid('repaired_by').references(() => staffUsers.id, { onDelete: 'set null' }),
    createdAt: erstellt(),
  },
  (t) => [
    index('complaints_practice_idx').on(t.practiceId),
    index('complaints_decision_idx').on(t.decision),
    uniqueIndex('complaints_order_offen_uq').on(t.orderId).where(sql`${t.decision} = 'offen'`),
  ],
);

/* ── اعلان‌ها (Spec فاز ۱، بخش M) ───────────────────────────── */

/** رویدادهایی که برای Ordination ایمیل می‌سازند. نام و توضیح آلمانی در `lib/benachrichtigungen/regeln.ts`. */
export const BENACHRICHTIGUNGEN = [
  'auftrag_eingegangen',
  'rueckfrage',
  'design_freigabe',
  'einprobe',
  'versendet',
  'neue_nachricht',
  'reklamation_entschieden',
] as const;
export type Benachrichtigung = (typeof BENACHRICHTIGUNGEN)[number];

/** فقط آنچه Ordination خاموش یا دوباره روشن کرده. ردیف نبودن یعنی «روشن» (پیش‌فرض). */
export const notificationPrefs = ddl.table(
  'notification_prefs',
  {
    practiceId: uuid('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    eventKey: text('event_key', { enum: BENACHRICHTIGUNGEN }).notNull(),
    emailEnabled: boolean('email_enabled').notNull(),
    updatedAt: zeit('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.practiceId, t.eventKey] })],
);

/* ── سیستم ───────────────────────────────────────────────────── */

export const settings = ddl.table('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  valueEnc: text('value_enc'),
  updatedAt: zeit('updated_at').notNull().defaultNow(),
});

export const auditLog = ddl.table(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorKind: text('actor_kind', { enum: ['staff', 'practice', 'system'] }).notNull(),
    actorId: uuid('actor_id'),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    details: jsonb('details'),
    ip: text('ip'),
    createdAt: erstellt(),
  },
  (t) => [index('audit_log_created_idx').on(t.createdAt)],
);

export const dataAccessLog = ddl.table(
  'data_access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorKind: text('actor_kind', { enum: USER_ARTEN }).notNull(),
    actorId: uuid('actor_id').notNull(),
    action: text('action', { enum: ['ansehen', 'herunterladen', 'entschluesseln'] }).notNull(),
    patientId: uuid('patient_id'),
    orderId: uuid('order_id'),
    fileId: uuid('file_id'),
    ip: text('ip'),
    createdAt: erstellt(),
  },
  (t) => [index('data_access_patient_idx').on(t.patientId, t.createdAt)],
);

export const PORTAL_ANFRAGE_STATUS = ['neu', 'eingeladen', 'erledigt'] as const;
export type PortalAnfrageStatus = (typeof PORTAL_ANFRAGE_STATUS)[number];

/**
 * درخواست‌های «Praxisportal-Zugang» از فرم تماس سایت (خواستهٔ کاربر، ۴ اکتبر ۲۰۲۶): worker آن‌ها را از
 * `/api/lab-leads` سایت می‌خواند (`lib/website/anfragen.ts`)، تا در CRM دیده شوند و همان‌جا Einladung
 * فرستاده شود. `id` همان شناسهٔ سایت است. `website_status` آخرین وضعیت در صفحهٔ Evaluation سایت. مثل
 * سایت، ۱۸۰ روز بعد پاک می‌شوند (رضایت فرم).
 */
export const portalAnfragen = ddl.table(
  'portal_anfragen',
  {
    id: uuid('id').primaryKey(),
    eingegangenAm: zeit('eingegangen_am').notNull(),
    vorname: text('vorname').notNull(),
    nachname: text('nachname').notNull(),
    email: text('email').notNull(),
    telefon: text('telefon'),
    websiteStatus: text('website_status').notNull(),
    status: text('status', { enum: PORTAL_ANFRAGE_STATUS }).notNull().default('neu'),
    erledigtAm: zeit('erledigt_am'),
    erledigtVon: uuid('erledigt_von'),
    erledigtVonLabel: text('erledigt_von_label'),
    practiceUserId: uuid('practice_user_id').references(() => practiceUsers.id, { onDelete: 'set null' }),
    abgerufenAm: zeit('abgerufen_am').notNull().defaultNow(),
  },
  (t) => [index('portal_anfragen_status_idx').on(t.status, t.eingegangenAm), index('portal_anfragen_email_idx').on(sql`lower(${t.email})`)],
);

export const numberSequences = ddl.table(
  'number_sequences',
  {
    scope: text('scope').notNull(),
    year: integer('year').notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.year] })],
);

export const jobs = ddl.table(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    /** برای کارهایی که نباید پشت‌سرهم تکرار شوند، مثلاً «neue_nachricht:<orderId>» (حداکثر یکی در ۱۵ دقیقه). */
    dedupeKey: text('dedupe_key'),
    status: text('status', { enum: ['wartend', 'laufend', 'fertig', 'fehler'] }).notNull().default('wartend'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: zeit('run_after').notNull().defaultNow(),
    lockedAt: zeit('locked_at'),
    error: text('error'),
    output: jsonb('output'),
    createdAt: erstellt(),
    finishedAt: zeit('finished_at'),
  },
  (t) => [index('jobs_claim_idx').on(t.status, t.runAfter), index('jobs_dedupe_idx').on(t.dedupeKey, t.runAfter)],
);
