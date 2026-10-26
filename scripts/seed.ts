/**
 * پر کردن دیتابیس.
 *   pnpm seed          دادهٔ واقعی پایه (وضعیت‌ها، مراحل، Behandlungها، مواد، دستگاه‌ها، تنظیمات)
 *   pnpm seed --demo   به‌علاوهٔ دادهٔ نمایشی کامل (`scripts/seed-demo.ts`)، **فقط در دیتابیس آزمون**
 *                      (نامش به `_test` تمام می‌شود؛ `pnpm qa` خودش این را می‌سازد)
 *   pnpm seed --clean  فقط دادهٔ نمایشی را پاک می‌کند
 *
 * دادهٔ واقعی هرگز بازنویسی نمی‌شود، جز بخش‌هایی که مال کد هستند
 * (form_schema، فایل‌های لازم، مراحل، تصویر، گروه و ترتیب کاشی‌ها). نام، قیمت‌ها،
 * روشن/خاموش‌بودن و عکسی که Inhaber خودش بالا گذاشته، دست‌نخورده می‌مانند. Behandlungهایی که
 * Inhaber در «Preise» ساخته (نه در `stammdaten.ts`) اصلاً دست نمی‌خورند.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, dbSchliessen } from '@/db/client';
import { devices, materials, portalStatuses, productionSteps, settings, workTypes } from '@/db/schema';
import { HOCHGELADEN } from '@/lib/katalog/auswahl';
import { AUSSTELLER, AUSSTELLER_ALT_NAME, BEHANDLUNGEN, GERAETE, IMPLANTAT_HERSTELLER, MATERIALIEN, PORTAL_STATUS, PRODUKTIONSSCHRITTE, RECHNUNGSDATEN } from '@/lib/katalog/stammdaten';
import { formSchemaSchema } from '@/lib/orders/form-schema';
import { demoAufbauen, demoEntfernen } from './seed-demo';

async function stammdaten() {
  const d = db();

  for (const [i, s] of PORTAL_STATUS.entries()) {
    await d
      .insert(portalStatuses)
      .values({ key: s.key, label: s.label, position: i, needsAction: s.needsAction })
      .onConflictDoUpdate({ target: portalStatuses.key, set: { label: s.label, position: i, needsAction: s.needsAction } });
  }

  for (const [i, s] of PRODUKTIONSSCHRITTE.entries()) {
    await d
      .insert(productionSteps)
      .values({ key: s.key, label: s.label, position: i, portalStatusKey: s.portal })
      .onConflictDoNothing();
  }

  for (const [i, b] of BEHANDLUNGEN.entries()) {
    const formSchema = formSchemaSchema.parse(b.formSchema);
    await d
      .insert(workTypes)
      .values({ ...b, formSchema, position: i })
      .onConflictDoUpdate({
        target: workTypes.key,
        set: {
          formSchema,
          requiredFiles: b.requiredFiles,
          stepKeys: b.stepKeys,
          // عکسی که Inhaber در «Preise» بالا گذاشته (`datei:…`) می‌ماند
          imageKey: sql`case when ${workTypes.imageKey} like ${`${HOCHGELADEN}%`} then ${workTypes.imageKey} else ${b.imageKey} end`,
          groupKey: b.groupKey,
          position: i,
        },
      });
  }

  for (const m of MATERIALIEN) {
    await d.insert(materials).values(m).onConflictDoNothing();
  }
  for (const g of GERAETE) {
    await d.insert(devices).values(g).onConflictDoNothing();
  }

  await d.insert(settings).values({ key: 'aussteller', value: AUSSTELLER }).onConflictDoNothing();
  // صادرکنندهٔ قدیمی (پیش از Gewerbe خود Isar Pishan) یک بار به تازه، فقط اگر دستی تغییر نکرده باشد
  const umgestellt = await d
    .update(settings)
    .set({ value: AUSSTELLER, updatedAt: new Date() })
    .where(and(eq(settings.key, 'aussteller'), sql`${settings.value}->>'name' = ${AUSSTELLER_ALT_NAME}`))
    .returning({ key: settings.key });
  if (umgestellt.length) console.log(`✓ Aussteller umgestellt auf: ${AUSSTELLER.name}`);
  await d.insert(settings).values({ key: 'rechnung', value: RECHNUNGSDATEN }).onConflictDoNothing();
  await d.insert(settings).values({ key: 'implantat_hersteller', value: IMPLANTAT_HERSTELLER }).onConflictDoNothing();

  const aktiv = BEHANDLUNGEN.filter((b) => b.isActive).length;
  console.log(
    `✓ Stammdaten: ${PORTAL_STATUS.length} Status, ${PRODUKTIONSSCHRITTE.length} Produktionsschritte, ` +
      `${BEHANDLUNGEN.length} Behandlungen (${aktiv} aktiv), ${MATERIALIEN.length} Materialien, ${GERAETE.length} Geräte`,
  );
}

try {
  if (process.argv.includes('--clean')) {
    console.log(`✓ Demo-Daten entfernt: ${await demoEntfernen()} Ordinationen`);
  } else {
    await stammdaten();
    if (process.argv.includes('--demo')) await demoAufbauen();
  }
} finally {
  await dbSchliessen();
}
