import { kieferVon, sortiert, type Kiefer } from '@/lib/orders/fdi';

/**
 * انتخاب‌های Kieferbogen برای پروتز پارسیل (Teilprothese / Flipper / Nesbit).
 *
 * قواعد:
 * - Ersatzzahn یعنی دندانی که در پروتز جایگزین می‌شود.
 * - Extraktion یعنی دندانی که کشیده می‌شود و آن هم در پروتز جایگزین می‌شود.
 * - هر دندان جایگزین‌شده خودکار Basis زیرش دارد.
 * - Basis جدا هم می‌تواند روی دندان‌های دیگر گذاشته شود (پوشش بیشتر).
 * - Klammer فقط روی دندانی است که می‌ماند. با جایگزین‌کردن دندان، Klammer آن برداشته می‌شود.
 */

export type ProthesenWerkzeug = 'ersatzzahn' | 'extraktion' | 'basis' | 'klammer';
export type ProthesenEintrag = { zahn?: 'ersatzzahn' | 'extraktion'; basis?: boolean; klammer?: boolean };
export type ProthesenAuswahl = Readonly<Record<number, ProthesenEintrag>>;

function aufraeumen(neu: Record<number, ProthesenEintrag>, fdi: number) {
  const e = neu[fdi];
  if (e && !e.zahn && !e.basis && !e.klammer) delete neu[fdi];
}

export function hatBasis(e: ProthesenEintrag | undefined): boolean {
  return Boolean(e?.zahn || e?.basis);
}

/** با ابزار فعال روی دندان کلیک شد. دوباره کلیک با همان ابزار، آن را برمی‌دارد. */
export function anwenden(auswahl: ProthesenAuswahl, fdi: number, werkzeug: ProthesenWerkzeug): ProthesenAuswahl {
  const neu: Record<number, ProthesenEintrag> = { ...auswahl };
  const e: ProthesenEintrag = { ...neu[fdi] };

  if (werkzeug === 'ersatzzahn' || werkzeug === 'extraktion') {
    if (e.zahn === werkzeug) {
      delete e.zahn;
    } else {
      e.zahn = werkzeug;
      delete e.klammer;
    }
  } else if (werkzeug === 'basis') {
    // Basis زیر دندان جایگزین‌شده اجباری است و جدا برداشته نمی‌شود.
    if (e.zahn) return auswahl;
    e.basis = !e.basis;
  } else {
    if (e.zahn) return auswahl;
    e.klammer = !e.klammer;
  }

  neu[fdi] = e;
  aufraeumen(neu, fdi);
  return neu;
}

export function entfernen(auswahl: ProthesenAuswahl, fdi: number): ProthesenAuswahl {
  if (!auswahl[fdi]) return auswahl;
  const neu = { ...auswahl };
  delete neu[fdi];
  return neu;
}

/** کدام فک‌ها در این پروتز درگیرند. مثلاً برای نشان دادن «Gaumenabdeckung» فقط در OK. */
export function betroffeneKiefer(auswahl: ProthesenAuswahl): Kiefer[] {
  const kiefer = new Set<Kiefer>();
  for (const [fdi, e] of Object.entries(auswahl)) {
    if (e.zahn || e.basis || e.klammer) kiefer.add(kieferVon(Number(fdi)));
  }
  return (['OK', 'UK'] as const).filter((k) => kiefer.has(k));
}

/** خطوط «Auswahl-Übersicht»، به آلمانی. */
export function zusammenfassung(auswahl: ProthesenAuswahl): string[] {
  const liste = (filter: (e: ProthesenEintrag) => boolean) =>
    sortiert(
      Object.entries(auswahl)
        .filter(([, e]) => filter(e))
        .map(([fdi]) => Number(fdi)),
    );
  const zeilen: string[] = [];
  const ersatz = liste((e) => e.zahn === 'ersatzzahn');
  const extraktion = liste((e) => e.zahn === 'extraktion');
  const klammern = liste((e) => Boolean(e.klammer));
  const basisExtra = liste((e) => Boolean(e.basis) && !e.zahn);
  if (ersatz.length) zeilen.push(`Ersatzzahn: ${ersatz.join(', ')}`);
  if (extraktion.length) zeilen.push(`Extraktion (wird ersetzt): ${extraktion.join(', ')}`);
  if (klammern.length) zeilen.push(`Klammer: ${klammern.join(', ')}`);
  if (basisExtra.length) zeilen.push(`Zusätzliche Basis: ${basisExtra.join(', ')}`);
  return zeilen;
}
