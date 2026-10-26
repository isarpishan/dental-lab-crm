import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { workTypes, type LieferOptionen, type Zuschlag } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { ausPuffer, ganzLesen, loeschen, speichern } from '@/lib/storage';
import { HOCHGELADEN } from './auswahl';
import { behandlungsSchluessel, bildTyp, type BildTyp } from './neu';
import { PREIS_EINHEITEN } from './preise';

/**
 * «Neue Behandlung» و «Bild ändern» در صفحهٔ «Preise» (خواستهٔ کاربر، ۶ اکتبر ۲۰۲۶)، فقط Inhaber.
 *
 * Behandlung تازه فرم سفارش (`form_schema`)، Scanهای لازم و مراحل تولید را از یک Behandlung موجود
 * می‌گیرد («Auftragsformular wie …»)؛ پس بدون برنامه‌نویسی در فرم، Kanban، Laufzettel و Abrechnung کار
 * می‌کند. خاموش ساخته می‌شود تا Inhaber اول قیمت‌ها را وارد کند. Materialها را بعداً در «Materialien».
 *
 * عکس‌ها را مرورگر پیش از ارسال ۴۸۰ × ۳۶۰ می‌کند (`BildWahl.tsx`)؛ اینجا فقط نوع (از بایت‌های اول)
 * و اندازه چک می‌شود. فایل در `STORAGE_DIR`، در `image_key` به شکل `datei:<uuid>`، نمایش از
 * `api/behandlungsbilder/[id]`.
 */

const BILD_MAX_BYTES = 2 * 1024 * 1024;
const ZUSCHLAG_OFFEN: Zuschlag = { betrag: null, einheit: 'Auftrag' };

const uuidVon = (imageKey: string) => imageKey.slice(HOCHGELADEN.length);
const speicherKey = (uuid: string) => `${uuid.slice(0, 2)}/${uuid}`;

async function bildSpeichern(datei: File): Promise<string> {
  if (!datei.size) throw new AppError('Die Bilddatei ist leer.');
  if (datei.size > BILD_MAX_BYTES) throw new AppError('Das Bild ist zu groß (höchstens 2 MB).');
  const inhalt = new Uint8Array(await datei.arrayBuffer());
  if (!bildTyp(inhalt)) throw new AppError('Bitte ein Bild als JPG, PNG oder WebP wählen.');
  const { key } = await speichern(ausPuffer(inhalt), BILD_MAX_BYTES);
  return `${HOCHGELADEN}${key.split('/')[1]}`;
}

async function bildEntfernen(imageKey: string | null) {
  if (imageKey?.startsWith(HOCHGELADEN)) await loeschen(speicherKey(uuidVon(imageKey))).catch(() => {});
}

/** عکس بارگذاری‌شده، فقط اگر هنوز عکس یکی از Behandlungها باشد (نه هر فایلی در `STORAGE_DIR`). */
export async function behandlungsBild(uuid: string): Promise<{ inhalt: Buffer; typ: BildTyp } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) return null;
  const [w] = await db().select({ key: workTypes.key }).from(workTypes).where(eq(workTypes.imageKey, `${HOCHGELADEN}${uuid}`)).limit(1);
  if (!w) return null;
  const inhalt = await ganzLesen(speicherKey(uuid)).catch(() => null);
  const typ = inhalt ? bildTyp(inhalt) : null;
  return inhalt && typ ? { inhalt, typ } : null;
}

export const neueBehandlungSchema = z.object({
  name: z.string().trim().min(2, 'Bitte einen Namen für die Behandlung eingeben.').max(60, 'Der Name ist zu lang (höchstens 60 Zeichen).'),
  vorlage: z.string().min(1, 'Bitte wählen, wie das Auftragsformular aussehen soll.'),
  lieferarten: z.array(z.enum(['fertigung', 'design'])).min(1, 'Bitte »Fertige Arbeit«, »Nur Design« oder beides wählen.'),
  einheit: z.enum(PREIS_EINHEITEN, { error: 'Bitte wählen, wofür der Preis gilt.' }),
});

export async function behandlungAnlegen(roh: unknown, bild: File | null) {
  const r = neueBehandlungSchema.safeParse(roh);
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const { name, lieferarten, einheit } = r.data;

  const alle = await db().select({ key: workTypes.key, name: workTypes.name, position: workTypes.position }).from(workTypes);
  if (alle.some((w) => w.name.toLocaleLowerCase('de-AT') === name.toLocaleLowerCase('de-AT'))) throw new AppError(`Eine Behandlung »${name}« gibt es schon.`);
  const [vorlage] = await db().select().from(workTypes).where(eq(workTypes.key, r.data.vorlage)).limit(1);
  if (!vorlage) throw new AppError('Die gewählte Vorlage gibt es nicht mehr. Bitte die Seite neu laden.');

  const key = behandlungsSchluessel(name, new Set(alle.map((w) => w.key)));
  const deliveryOptions: LieferOptionen = Object.fromEntries(lieferarten.map((l) => [l, { preisAb: null, einheit }]));
  const imageKey = bild ? await bildSpeichern(bild) : null;
  const neu = await db()
    .insert(workTypes)
    .values({
      key,
      name,
      category: vorlage.category,
      imageKey,
      // eigene Kachel, auch wenn die Vorlage zu einer Gruppe gehört (z. B. »Prothese«)
      groupKey: null,
      turnaroundLabel: vorlage.turnaroundLabel,
      expressAvailable: vorlage.expressAvailable,
      expressSurcharge: ZUSCHLAG_OFFEN,
      // Same-Day nur, wo das Labor es ausdrücklich anbietet: erst in »Preise« einschalten
      sameDayAvailable: false,
      sameDaySurcharge: ZUSCHLAG_OFFEN,
      deliveryOptions,
      needsFreigabe: vorlage.needsFreigabe,
      badges: [],
      formSchema: vorlage.formSchema,
      requiredFiles: vorlage.requiredFiles,
      stepKeys: vorlage.stepKeys,
      warrantyMonths: vorlage.warrantyMonths,
      position: Math.max(-1, ...alle.map((w) => w.position)) + 1,
      isActive: false,
    })
    .onConflictDoNothing()
    .returning({ key: workTypes.key });
  if (!neu.length) {
    await bildEntfernen(imageKey);
    throw new AppError('Die Behandlung konnte nicht angelegt werden. Bitte noch einmal versuchen.');
  }
  return { key, name, vorlage: vorlage.name, lieferarten, einheit, bild: Boolean(imageKey) };
}

export async function bildAendern(key: string, bild: File) {
  const [alt] = await db().select({ name: workTypes.name, imageKey: workTypes.imageKey }).from(workTypes).where(eq(workTypes.key, key)).limit(1);
  if (!alt) throw new AppError('Diese Behandlung gibt es nicht mehr. Bitte die Seite neu laden.');
  const imageKey = await bildSpeichern(bild);
  await db().update(workTypes).set({ imageKey }).where(eq(workTypes.key, key));
  await bildEntfernen(alt.imageKey);
  return { name: alt.name, von: alt.imageKey, zu: imageKey };
}
