'use server';

import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db/client';
import { kiNutzung } from '@/db/schema';
import { zahlenFragen } from '@/lib/ai-safe';
import { mitBerechtigung } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { AppError } from '@/lib/errors';
import { FRAGEN_PRO_TAG, werkzeugAusfuehren, werkzeugLink, WERKZEUGE } from '@/lib/fragen/werkzeuge';
import { heuteIso } from '@/lib/format';
import { kiLaden } from '@/lib/ki/einstellungen';

/** «Frag deine Zahlen» (Spec فاز ۵، قدم ۶؛ فقط Inhaber، چون Privat هم در جواب‌هاست). فقط خواندن؛ چیزی ذخیره نمی‌شود جز مصرف KI. */

export type FragenErgebnis = { antwort: string; quellen: { text: string; href: string }[] } | { fehler: string };

const verlaufSchema = z
  .array(z.object({ frage: z.string().max(500), antwort: z.string().max(6000) }))
  .max(3);

export async function zahlenFragenAktion(frage: string, verlauf: unknown): Promise<FragenErgebnis> {
  try {
    const { user } = await mitBerechtigung('ausgaben.verwalten');
    if (!darf(user.role, 'privat.verwalten')) throw new AppError('Diese Seite ist nur für den Inhaber.');
    const f = frage.trim();
    if (!f) throw new AppError('Bitte eine Frage eingeben.');
    if (f.length > 500) throw new AppError('Die Frage ist zu lang (höchstens 500 Zeichen).');
    const v = verlaufSchema.safeParse(verlauf);
    const heute = heuteIso();
    const [{ n }] = await db()
      .select({ n: sql<number>`count(*)::int` })
      .from(kiNutzung)
      .where(and(eq(kiNutzung.zweck, 'zahlen_fragen'), sql`to_char(${kiNutzung.am} at time zone 'Europe/Vienna', 'YYYY-MM-DD') = ${heute}`));
    if (n >= FRAGEN_PRO_TAG) throw new AppError(`Heute sind schon ${FRAGEN_PRO_TAG} Fragen gestellt. Morgen geht es weiter.`);
    const ki = await kiLaden();
    if (!ki.schluessel) throw new AppError('Die KI ist aus: unter Einstellungen → KI den Schlüssel von Anthropic eintragen.');

    const r = await zahlenFragen(f, v.success ? v.data : [], WERKZEUGE, werkzeugAusfuehren, { schluessel: ki.schluessel, modell: ki.modell }, heute);
    await db().insert(kiNutzung).values({ zweck: 'zahlen_fragen', modell: r.modell, eingabeTokens: r.eingabeTokens, ausgabeTokens: r.ausgabeTokens, erfolgreich: r.ok });
    if (!r.ok) return { fehler: r.fehler };
    // jede Liste nur einmal als »Grundlage«
    const quellen = [...new Map(r.aufrufe.map((a) => werkzeugLink(a.name, a.eingabe)).filter((x) => x != null).map((x) => [x.href + x.text, x])).values()];
    return { antwort: r.antwort, quellen };
  } catch (e) {
    if (e instanceof AppError) return { fehler: e.message };
    throw e;
  }
}
