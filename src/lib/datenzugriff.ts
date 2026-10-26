import 'server-only';
import { db } from '@/db/client';
import { dataAccessLog, type UserArt } from '@/db/schema';

/**
 * Data-Access-Log (DSGVO Art. 9؛ CLAUDE.md، قانون ۲): هر بار که نام بیماری رمزگشایی
 * و نشان داده می‌شود، یا فایلی از سفارش دانلود می‌شود، یک ردیف. برای فهرست‌ها یک
 * ردیف برای هر بیماری که واقعاً نشان داده شد، نه برای همهٔ بیماران Ordination.
 */
export async function zugriffProtokollieren(e: {
  akteur: { kind: UserArt; id: string };
  aktion: 'ansehen' | 'herunterladen' | 'entschluesseln';
  patientIds?: readonly string[];
  orderId?: string | null;
  fileId?: string | null;
  ip?: string | null;
}) {
  const patienten = e.patientIds?.length ? e.patientIds : [null];
  await db()
    .insert(dataAccessLog)
    .values(
      patienten.map((patientId) => ({
        actorKind: e.akteur.kind,
        actorId: e.akteur.id,
        action: e.aktion,
        patientId,
        orderId: e.orderId ?? null,
        fileId: e.fileId ?? null,
        ip: e.ip ?? null,
      })),
    );
}
