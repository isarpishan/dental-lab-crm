import 'server-only';
import { and, asc, eq, ilike, inArray, max, notInArray, or, type SQL } from 'drizzle-orm';
import { db } from '@/db/client';
import { orders, orderStatusHistory, orderSteps, orderTeeth, patients, practices, staffUsers, workTypes } from '@/db/schema';
import type { Bearbeiter } from '@/lib/auth/bearbeiter';
import { heuteIso, seitTagen } from '@/lib/format';
import { tempoRang, type Tempo } from '@/lib/katalog/tempo';
import { terminText } from '@/lib/orders/listen';
import type { Status } from '@/lib/orders/status';
import { aktiveSchritte, lageVon } from './lage';
import { erledigenVon, initialen, NICHT_AUF_BRETT, zaehneKurz, zielPruefen, type Schritt } from './schritte';

/**
 * داده‌های مراحل تولید (Spec فاز ۱، بخش H). صفحهٔ Kanban «Produktion» از ۲۶ اکتبر ۲۰۲۶ حذف شد (خواستهٔ کاربر: با دست جلو
 * می‌رفت و اگر فراموش می‌شد، تصویر غلط می‌داد)؛ حالا فقط برای شمارش «Produktion» در Übersicht. مراحل در صفحهٔ سفارش و با QR
 * جلو می‌روند. ستون‌ها = مراحل فعال. روی کارت فقط **کد بیمار**؛
 * نام بیمار در این کوئری اصلاً خوانده نمی‌شود. برای هر کارت از قبل حساب می‌شود به کدام
 * ستون‌ها می‌شود کشید و اگر نه، چرا (همان `zielPruefen` که سرور هنگام ذخیره دوباره چک می‌کند).
 */

export type Karte = {
  id: string;
  orderNo: string;
  patientCode: string | null;
  behandlung: string;
  zaehne: string | null;
  praxis: string;
  tempo: Tempo;
  termin: string | null;
  ueberfaellig: boolean;
  zustaendig: string | null;
  zustaendigName: string | null;
  seit: string;
  spalte: string;
  status: Status;
  /** Ziel-Schritt → null (erlaubt) oder Grund, warum nicht */
  ziele: Record<string, string | null>;
  /** wie es weitergeht, wenn nichts zu ziehen ist (Design hochladen, Ordination) */
  hinweis: string | null;
  /** »Erledigt« möglich (Seite `/s/<Nummer>`, wie nach dem QR-Code) */
  erledigbar: boolean;
};
export type Spalte = Schritt & { karten: Karte[] };

/** `tempo`: «express» یا «same_day»؛ خالی یعنی همه. */
export type BrettFilter = { suche: string; ordination: string; behandlung: string; tempo: Tempo | ''; meine: boolean };

export async function produktionsBrett(b: Bearbeiter, f: BrettFilter): Promise<{ spalten: Spalte[]; anzahl: number }> {
  const bedingungen: SQL[] = [notInArray(orders.status, [...NICHT_AUF_BRETT])];
  if (/^[0-9a-f-]{36}$/.test(f.ordination)) bedingungen.push(eq(orders.practiceId, f.ordination));
  if (f.behandlung) bedingungen.push(eq(orders.workTypeKey, f.behandlung));
  if (f.tempo) bedingungen.push(eq(orders.tempo, f.tempo));
  if (f.meine) bedingungen.push(eq(orders.assigneeId, b.id));
  if (f.suche) {
    const muster = `%${f.suche.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    bedingungen.push(or(ilike(orders.orderNo, muster), ilike(patients.code, muster), ilike(practices.name, muster))!);
  }

  const [alle, zeilen] = await Promise.all([
    aktiveSchritte(),
    db()
      .select({
        o: orders,
        wt: { name: workTypes.name, stepKeys: workTypes.stepKeys, needsFreigabe: workTypes.needsFreigabe },
        praxis: practices.name,
        code: patients.code,
        zustaendig: staffUsers.name,
      })
      .from(orders)
      .leftJoin(workTypes, eq(workTypes.key, orders.workTypeKey))
      .leftJoin(practices, eq(practices.id, orders.practiceId))
      .leftJoin(patients, eq(patients.id, orders.patientId))
      .leftJoin(staffUsers, eq(staffUsers.id, orders.assigneeId))
      .where(and(...bedingungen))
      .orderBy(asc(orders.submittedAt))
      .limit(500),
  ]);
  const ids = zeilen.map((z) => z.o.id);
  const [gestartet, statusSeit, zaehne] = ids.length
    ? await Promise.all([
        db().select({ orderId: orderSteps.orderId, step: orderSteps.stepKey, at: orderSteps.startedAt }).from(orderSteps).where(inArray(orderSteps.orderId, ids)),
        db().select({ orderId: orderStatusHistory.orderId, at: max(orderStatusHistory.at) }).from(orderStatusHistory).where(inArray(orderStatusHistory.orderId, ids)).groupBy(orderStatusHistory.orderId),
        db().select({ orderId: orderTeeth.orderId, fdi: orderTeeth.fdi }).from(orderTeeth).where(inArray(orderTeeth.orderId, ids)),
      ])
    : [[], [], []];

  const heute = heuteIso();
  const jetzt = new Date();
  const spalten: Spalte[] = alle.map((s) => ({ ...s, karten: [] }));
  for (const z of zeilen) {
    const lage = lageVon(z.o, z.wt, alle);
    const spalte = spalten.find((s) => s.key === lage.ist.spalte);
    if (!spalte) continue;
    const start = gestartet.find((g) => g.orderId === z.o.id && g.step === spalte.key)?.at;
    const wechsel = statusSeit.find((g) => g.orderId === z.o.id)?.at;
    const seit = [start, wechsel].filter((d): d is Date => Boolean(d)).sort((a, c) => c.getTime() - a.getTime())[0] ?? z.o.submittedAt ?? jetzt;
    const termin = z.o.dueDate ?? z.o.desiredDate;
    const erledigen = erledigenVon(lage.ist, lage.umstaende, lage.plan);
    spalte.karten.push({
      id: z.o.id,
      orderNo: z.o.orderNo ?? '–',
      patientCode: z.code,
      behandlung: z.wt?.name ?? '–',
      zaehne: zaehneKurz(zaehne.filter((t) => t.orderId === z.o.id).map((t) => t.fdi)),
      praxis: z.praxis ?? '–',
      tempo: z.o.tempo ?? 'standard',
      termin: terminText(z.o),
      ueberfaellig: Boolean(termin && termin < heute),
      zustaendig: initialen(z.zustaendig),
      zustaendigName: z.zustaendig,
      seit: seitTagen(seit, jetzt),
      spalte: spalte.key,
      status: lage.ist.status,
      ziele: Object.fromEntries(
        alle.filter((s) => s.key !== spalte.key).map((s) => {
          const r = zielPruefen(lage.ist, s, lage.umstaende, lage.plan);
          return [s.key, r.ok ? null : r.grund];
        }),
      ),
      hinweis: erledigen.art === 'design' || erledigen.art === 'warten' ? erledigen.text : null,
      erledigbar: erledigen.art === 'weiter' || erledigen.art === 'geliefert',
    });
  }
  // Same-Day zuerst, dann Express, dann nach Termin, dann nach Eingang
  for (const s of spalten) {
    s.karten.sort((a, c) => tempoRang(c.tempo) - tempoRang(a.tempo) || terminWert(a) - terminWert(c));
  }
  return { spalten, anzahl: spalten.reduce((n, s) => n + s.karten.length, 0) };
}

/** Termin als Zahl zum Sortieren; ohne Termin ans Ende. */
function terminWert(k: Karte): number {
  const m = k.termin?.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : 99_999_999;
}
