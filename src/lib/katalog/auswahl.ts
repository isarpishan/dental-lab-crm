import type { LieferOptionen, Zuschlag } from '@/db/schema';
import { formSchemaSchema, type DateiPlatz, type FormSchema } from '@/lib/orders/form-schema';
import { abPreise, type AbPreise } from './lieferpreise';
import { angeboteneTempi, SAME_DAY_TAG, zuschlagText, zuschlagVon, type Eilig, type Tempo, type TempoQuelle } from './tempo';
import type { Lieferart } from '@/lib/orders/assistent';
import { BEHANDLUNGEN, BEHANDLUNGSGRUPPEN, IMPLANTAT_HERSTELLER } from './stammdaten';

/**
 * دادهٔ فرم «Neuer Auftrag»، به شکلی که مرورگر لازم دارد. از جدول `work_types`
 * خوانده می‌شود (`aus-datenbank.ts`)، پس قیمت‌ها و زمان‌هایی که Inhaber در صفحهٔ
 * «Preise» وارد می‌کند فوراً در فرم دیده می‌شوند.
 */

export const BILD_ORDNER = '/bilder/auswahl';
/** عکسی که Inhaber در «Preise» بالا گذاشته: `datei:<uuid>` در `image_key`، فایل در `STORAGE_DIR` (`lib/katalog/verwaltung.ts`). */
export const HOCHGELADEN = 'datei:';

/** آدرس عکس هر Behandlung: فایل ثابت در `public/bilder/auswahl/` یا عکس بارگذاری‌شده از `api/behandlungsbilder/`. */
export function bildUrl(imageKey: string | null): string | null {
  if (!imageKey) return null;
  return imageKey.startsWith(HOCHGELADEN) ? `/api/behandlungsbilder/${imageKey.slice(HOCHGELADEN.length)}` : `${BILD_ORDNER}/${imageKey}`;
}

export type KatalogEintrag = {
  key: string;
  name: string;
  bild: string | null;
  tags: string[];
  /** زمان «Standard». */
  bearbeitungszeit: string;
  /** Service-Levelهای این Behandlung، Standard اول (`lib/katalog/tempo.ts`). */
  tempi: Tempo[];
  /** فقط برای Levelهای موجود: «Expresszuschlag € 40 pro Auftrag»، یا «… nach Prüfung» تا Inhaber مبلغی وارد کند. */
  zuschlaege: Partial<Record<Eilig, string>>;
  lieferOptionen: Lieferart[];
  preise: AbPreise;
  /** همان قیمت‌ها به عدد (یورو)، برای جمع تخمینی در فرم (`lib/orders/preis.ts`) */
  optionen: LieferOptionen;
  /** Zuschlag هر Tempo به عدد؛ `betrag: null` یعنی «nach Prüfung» */
  zuschlagWerte: Partial<Record<Eilig, Zuschlag>>;
  groupKey: string | null;
  formSchema: FormSchema;
  requiredFiles: DateiPlatz[];
};

export type GruppenEintrag = { key: string; name: string; bild: string; frage: string; tags: string[]; preise: AbPreise };

export type AuswahlKatalog = {
  behandlungen: KatalogEintrag[];
  gruppen: GruppenEintrag[];
  implantatHersteller: string[];
};

/** آنچه از هر Behandlung لازم است؛ هم ردیف `work_types` و هم `BehandlungDef` این شکل را دارند. */
export type KatalogQuelle = TempoQuelle & {
  key: string;
  name: string;
  imageKey: string | null;
  groupKey: string | null;
  turnaroundLabel: string;
  deliveryOptions: LieferOptionen;
  badges: string[];
  formSchema: unknown;
  requiredFiles: string[];
  isActive: boolean;
};

/** برچسب‌های کاشی: برچسب‌های خود Behandlung و «Same-Day möglich» اگر Same-Day دارد. */
const tagsVon = (b: KatalogQuelle) => [...b.badges, ...(b.sameDayAvailable ? [SAME_DAY_TAG] : [])];

/** یک Behandlung به شکل فرم؛ برای سفارش‌های قبلی هم (حتی اگر Behandlung حالا خاموش است). */
export function eintragAus(b: KatalogQuelle): KatalogEintrag {
  const lieferOptionen = (['fertigung', 'design'] as const).filter((l) => b.deliveryOptions[l]);
  const tempi = angeboteneTempi(b);
  return {
    key: b.key,
    name: b.name,
    bild: bildUrl(b.imageKey),
    tags: tagsVon(b),
    bearbeitungszeit: b.turnaroundLabel,
    tempi,
    zuschlaege: Object.fromEntries(tempi.filter((t) => t !== 'standard').map((t) => [t, zuschlagText(t, zuschlagVon(b, t))])),
    lieferOptionen,
    preise: abPreise(b.deliveryOptions),
    optionen: b.deliveryOptions,
    zuschlagWerte: Object.fromEntries(tempi.filter((t) => t !== 'standard').map((t) => [t, zuschlagVon(b, t)])),
    groupKey: b.groupKey,
    formSchema: formSchemaSchema.parse(b.formSchema),
    requiredFiles: b.requiredFiles as DateiPlatz[],
  };
}

/** فقط Behandlungهای فعال، به ترتیب ورودی. گروهی که عضو فعال ندارد کاشی هم ندارد. */
export function katalogAus(quellen: KatalogQuelle[], implantatHersteller: string[]): AuswahlKatalog {
  const aktiv = quellen.filter((b) => b.isActive);
  const behandlungen = aktiv.map(eintragAus);
  const gruppen = BEHANDLUNGSGRUPPEN.flatMap((g) => {
    const mitglieder = aktiv.filter((b) => b.groupKey === g.key);
    if (!mitglieder.length) return [];
    return [
      {
        key: g.key,
        name: g.name,
        bild: `${BILD_ORDNER}/${g.imageKey}`,
        frage: g.frage,
        tags: [...new Set(mitglieder.flatMap(tagsVon))],
        preise: abPreise(...mitglieder.map((b) => b.deliveryOptions)),
      },
    ];
  });
  return { behandlungen, gruppen, implantatHersteller };
}

/** بدون دیتابیس، مستقیم از `stammdaten.ts` (برای تست‌ها). */
export function ausStammdaten(): AuswahlKatalog {
  return katalogAus(BEHANDLUNGEN, IMPLANTAT_HERSTELLER);
}
