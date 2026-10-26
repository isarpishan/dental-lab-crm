'use server';

import { asc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db/client';
import { workTypes, type LieferOptionen, type Zuschlag } from '@/db/schema';
import { aenderungen, akteurVon, ausfuehren, type Ergebnis } from '@/lib/aktion';
import { logAudit } from '@/lib/audit';
import { mitBerechtigung } from '@/lib/auth/guard';
import { anfrageInfo } from '@/lib/auth/sessions';
import { PREIS_EINHEITEN, preisLesen, ZUSCHLAG_EINHEITEN } from '@/lib/katalog/preise';
import { behandlungAnlegen, bildAendern } from '@/lib/katalog/verwaltung';

const text = (form: FormData, feld: string) => {
  const v = form.get(feld);
  return typeof v === 'string' ? v : '';
};
const datei = (form: FormData, feld: string) => {
  const v = form.get(feld);
  return v instanceof File && v.size ? v : null;
};

/**
 * جدول «Preise»: قیمت «ab» برای هر Lieferart، زمان Standard، Express و Same-Day (هر کدام روشن/خاموش
 * با Zuschlag جدا، `lib/katalog/tempo.ts`) و روشن/خاموش‌بودن Behandlung.
 * فقط Inhaber (`preise.bearbeiten`). یک ثبت audit با قبل و بعد هر ردیف تغییرکرده.
 */
export async function katalogSpeichern(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('preise.bearbeiten');
    const zeilen = await db().select().from(workTypes).orderBy(asc(workTypes.position));
    const fehler: string[] = [];
    const geaendert: { key: string; name: string; neu: Partial<typeof workTypes.$inferInsert>; diff: Record<string, unknown> }[] = [];
    const wert = (feld: string) => {
      const v = form.get(feld);
      return typeof v === 'string' ? v : '';
    };

    for (const w of zeilen) {
      if (!form.has(`zeit_${w.key}`)) continue; // این ردیف در فرم نبود
      const betrag = (feld: string) => {
        const r = preisLesen(wert(feld));
        if (!r.ok) fehler.push(`${w.name}: ${r.fehler}`);
        return r.ok ? r.wert : null;
      };
      const einheit = <T extends string>(feld: string, erlaubt: readonly T[], alt: T): T => (erlaubt.includes(wert(feld) as T) ? (wert(feld) as T) : alt);

      const deliveryOptions: LieferOptionen = {};
      for (const l of ['design', 'fertigung'] as const) {
        const alt = w.deliveryOptions[l];
        if (alt) deliveryOptions[l] = { preisAb: betrag(`${l}_${w.key}`), einheit: einheit(`${l}_einheit_${w.key}`, PREIS_EINHEITEN, alt.einheit) };
      }
      // Zuschlag حتی وقتی Express یا Same-Day خاموش است ذخیره می‌ماند
      const zuschlag = (feld: 'express' | 'sameday', alt: Zuschlag): Zuschlag => ({
        betrag: betrag(`${feld}_${w.key}`),
        einheit: einheit(`${feld}_einheit_${w.key}`, ZUSCHLAG_EINHEITEN, alt.einheit),
      });
      const turnaroundLabel = wert(`zeit_${w.key}`).trim().slice(0, 60);
      if (!turnaroundLabel) fehler.push(`${w.name}: Bitte eine Bearbeitungszeit eingeben (z. B. »nach Prüfung«).`);

      const neu = {
        isActive: wert(`aktiv_${w.key}`) === 'ja',
        turnaroundLabel,
        deliveryOptions,
        expressAvailable: wert(`express_an_${w.key}`) === 'ja',
        expressSurcharge: zuschlag('express', w.expressSurcharge),
        sameDayAvailable: wert(`sameday_an_${w.key}`) === 'ja',
        sameDaySurcharge: zuschlag('sameday', w.sameDaySurcharge),
      };
      const diff = aenderungen(w, neu);
      if (Object.keys(diff).length) geaendert.push({ key: w.key, name: w.name, neu, diff });
    }

    if (fehler.length) return { fehler: fehler.slice(0, 3).join(' ') };
    if (!geaendert.length) return { erfolg: 'Keine Änderungen.' };

    await db().transaction(async (tx) => {
      for (const g of geaendert) await tx.update(workTypes).set(g.neu).where(eq(workTypes.key, g.key));
    });
    await logAudit({
      aktion: 'katalog_geaendert',
      akteur: akteurVon(ich),
      ziel: { typ: 'work_types', id: geaendert.map((g) => g.key).join(',') },
      details: Object.fromEntries(geaendert.map((g) => [g.key, g.diff])),
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    revalidatePath('/vorschau');
    return { erfolg: `Gespeichert: ${geaendert.map((g) => g.name).join(', ')}.` };
  });
}

/** «Neue Behandlung»: فرم و مراحل از یک Behandlung موجود، خاموش تا Inhaber قیمت‌ها را وارد کند (`lib/katalog/verwaltung.ts`). */
export async function behandlungNeu(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('preise.bearbeiten');
    const b = await behandlungAnlegen(
      { name: text(form, 'name'), vorlage: text(form, 'vorlage'), lieferarten: form.getAll('lieferart'), einheit: text(form, 'einheit') },
      datei(form, 'bild'),
    );
    await logAudit({
      aktion: 'behandlung_angelegt',
      akteur: akteurVon(ich),
      ziel: { typ: 'work_types', id: b.key },
      details: { name: b.name, vorlage: b.vorlage, lieferarten: b.lieferarten, einheit: b.einheit, bild: b.bild },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    revalidatePath('/vorschau');
    return { erfolg: `»${b.name}« ist angelegt und steht unter »Ausgeschaltet«. Dort Preise eintragen, Häkchen setzen und speichern.` };
  });
}

/** «Bild ändern» برای هر ردیف؛ جدا از فرم بزرگ، تا قیمت‌های ذخیره‌نشده دست نخورند. */
export async function bildHochladen(_: Ergebnis, form: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const { user: ich } = await mitBerechtigung('preise.bearbeiten');
    const bild = datei(form, 'bild');
    if (!bild) return { fehler: 'Bitte ein Bild wählen.' };
    const key = text(form, 'key');
    const b = await bildAendern(key, bild);
    await logAudit({
      aktion: 'behandlung_bild_geaendert',
      akteur: akteurVon(ich),
      ziel: { typ: 'work_types', id: key },
      details: { name: b.name, von: b.von, zu: b.zu },
      ip: (await anfrageInfo()).ip,
    });
    revalidatePath('/intern', 'layout');
    revalidatePath('/vorschau');
    return { erfolg: `Bild für »${b.name}« gespeichert.` };
  });
}
