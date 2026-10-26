import 'server-only';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { dunningLetters, jobs, settings } from '@/db/schema';
import { mahnwesenAus, type Mahnstufe, type Mahnwesen } from './mahnwesen';

/**
 * خواندن Mahnwesen (Spec فاز ۲، قدم ۴): تنظیم‌ها و نامه‌های ساخته‌شدهٔ هر Rechnung با وضعیت ارسال. جدا از
 * `mahnung.ts`، تا `rechnung.ts` بدون حلقهٔ import از آن بخواند.
 */
export async function mahnwesenLaden(): Promise<Mahnwesen> {
  const [z] = await db().select({ value: settings.value }).from(settings).where(eq(settings.key, 'mahnwesen')).limit(1);
  return mahnwesenAus(z?.value);
}

export type Mahnung = {
  id: string;
  stufe: Mahnstufe;
  am: Date;
  frist: string;
  offenCent: number;
  an: string | null;
  /** «offen»: ساخته شده ولی هنوز فرستاده نشده (مثلاً بدون آدرس) */
  status: 'offen' | 'wartend' | 'gesendet' | 'fehler';
  gesendetAm: Date | null;
  fehler: string | null;
};

/** نامه‌های هر Rechnung به ترتیب مرحله */
export async function mahnungenVon(rechnungIds: string[]): Promise<Map<string, Mahnung[]>> {
  const aus = new Map<string, Mahnung[]>();
  if (!rechnungIds.length) return aus;
  const zeilen = await db()
    .select({ m: dunningLetters, status: jobs.status, fertig: jobs.finishedAt, fehler: jobs.error })
    .from(dunningLetters)
    .leftJoin(jobs, eq(jobs.id, dunningLetters.jobId))
    .where(inArray(dunningLetters.invoiceId, rechnungIds))
    .orderBy(asc(dunningLetters.stufe));
  for (const z of zeilen) {
    const status: Mahnung['status'] = !z.m.jobId ? 'offen' : z.status === 'fertig' ? 'gesendet' : z.status === 'fehler' ? 'fehler' : 'wartend';
    const liste = aus.get(z.m.invoiceId) ?? [];
    liste.push({
      id: z.m.id,
      stufe: z.m.stufe as Mahnstufe,
      am: z.m.erstelltAm,
      frist: z.m.frist,
      offenCent: z.m.offenCent,
      an: z.m.an,
      status,
      gesendetAm: status === 'gesendet' ? z.fertig : null,
      fehler: status === 'fehler' ? z.fehler : null,
    });
    aus.set(z.m.invoiceId, liste);
  }
  return aus;
}
