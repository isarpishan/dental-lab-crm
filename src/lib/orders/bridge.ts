import { kieferVon, position, reiheVon, sortiert } from '@/lib/orders/fdi';

/**
 * انتخاب‌های Zahnleiste و منطق Brücke.
 *
 * هر دندان حداکثر یک نوع کار دارد. Brücke یک «Spanne» است: چند دندان
 * پشت‌سرهم در یک فک. دو سرش همیشه Anker است و دندان‌های بین آن‌ها پیش‌فرض Glied.
 * Spanne از خط وسط عبور می‌کند (12 → 11 → 21 → 22)، چون ترتیب نمایش پیوسته است.
 *
 * همهٔ تابع‌ها خالص‌اند: یک انتخاب تازه برمی‌گردانند و ورودی را عوض نمی‌کنند.
 */

export type Einzelbehandlung = 'krone' | 'implantatkrone' | 'provisorium' | 'veneer' | 'inlay';
export type Behandlung = Einzelbehandlung | 'bruecke_anker' | 'bruecke_glied';

export type ZahnEintrag = { art: Behandlung; spanne?: string };
export type ZahnAuswahl = Readonly<Record<number, ZahnEintrag>>;

export class AuswahlFehler extends Error {}

function ohneSpanne(auswahl: ZahnAuswahl, spanne: string): Record<number, ZahnEintrag> {
  const neu: Record<number, ZahnEintrag> = {};
  for (const [fdi, eintrag] of Object.entries(auswahl)) {
    if (eintrag.spanne !== spanne) neu[Number(fdi)] = eintrag;
  }
  return neu;
}

/** همهٔ دندان‌های یک Spanne، به ترتیب نمایش. */
export function mitgliederVon(auswahl: ZahnAuswahl, spanne: string): number[] {
  return sortiert(
    Object.entries(auswahl)
      .filter(([, e]) => e.spanne === spanne)
      .map(([fdi]) => Number(fdi)),
  );
}

/**
 * گذاشتن یا برداشتن یک کار تکی. کلیک دوباره با همان ابزار، کار را برمی‌دارد.
 * اگر دندان عضو یک Brücke باشد، کل آن Brücke برداشته می‌شود. نیمهٔ Brücke معنا ندارد.
 */
export function einzelUmschalten(auswahl: ZahnAuswahl, fdi: number, art: Einzelbehandlung): ZahnAuswahl {
  const alt = auswahl[fdi];
  const neu = alt?.spanne ? ohneSpanne(auswahl, alt.spanne) : { ...auswahl };
  if (alt?.art === art) {
    delete neu[fdi];
  } else {
    neu[fdi] = { art };
  }
  return neu;
}

/**
 * ساختن Brücke از `von` تا `bis` (هر ترتیبی). Brückeهایی که روی این بازه
 * بیفتند کامل برداشته می‌شوند. کارهای تکی روی این بازه جایشان را به Brücke می‌دهند.
 */
export function brueckeAnlegen(auswahl: ZahnAuswahl, von: number, bis: number): ZahnAuswahl {
  if (kieferVon(von) !== kieferVon(bis)) {
    throw new AuswahlFehler('Eine Brücke muss in einem Kiefer liegen.');
  }
  if (von === bis) {
    throw new AuswahlFehler('Eine Brücke braucht mindestens zwei Zähne.');
  }
  const reihe = reiheVon(kieferVon(von));
  const [a, b] = [position(von), position(bis)].sort((x, y) => x - y);
  const glieder = reihe.slice(a, b + 1);

  let neu: Record<number, ZahnEintrag> = { ...auswahl };
  for (const fdi of glieder) {
    const spanne = neu[fdi]?.spanne;
    if (spanne) neu = ohneSpanne(neu, spanne);
  }

  const id = `b${reihe[a]}-${reihe[b]}`;
  glieder.forEach((fdi, i) => {
    const istEnde = i === 0 || i === glieder.length - 1;
    neu[fdi] = { art: istEnde ? 'bruecke_anker' : 'bruecke_glied', spanne: id };
  });
  return neu;
}

/** دندان‌های وسط Brücke بین Anker و Glied عوض می‌شوند. دو سر همیشه Anker می‌مانند. */
export function brueckenzahnUmschalten(auswahl: ZahnAuswahl, fdi: number): ZahnAuswahl {
  const eintrag = auswahl[fdi];
  if (!eintrag?.spanne) return auswahl;
  const mitglieder = mitgliederVon(auswahl, eintrag.spanne);
  if (fdi === mitglieder[0] || fdi === mitglieder[mitglieder.length - 1]) return auswahl;
  return {
    ...auswahl,
    [fdi]: { ...eintrag, art: eintrag.art === 'bruecke_anker' ? 'bruecke_glied' : 'bruecke_anker' },
  };
}

/** برداشتن هر کاری از روی دندان. برای Brücke، کل Brücke. */
export function entfernen(auswahl: ZahnAuswahl, fdi: number): ZahnAuswahl {
  const eintrag = auswahl[fdi];
  if (!eintrag) return auswahl;
  if (eintrag.spanne) return ohneSpanne(auswahl, eintrag.spanne);
  const neu = { ...auswahl };
  delete neu[fdi];
  return neu;
}

/** آیا دندان بعدی در ردیف نمایش در همان Brücke است؟ برای کشیدن رابط بین تاج‌ها. */
export function verbundenMitNaechstem(auswahl: ZahnAuswahl, fdi: number): boolean {
  const eintrag = auswahl[fdi];
  if (!eintrag?.spanne) return false;
  const reihe = reiheVon(kieferVon(fdi));
  const naechster = reihe[position(fdi) + 1];
  return naechster !== undefined && auswahl[naechster]?.spanne === eintrag.spanne;
}

const NAMEN: Record<Einzelbehandlung, string> = {
  krone: 'Krone',
  implantatkrone: 'Implantatkrone',
  provisorium: 'Provisorium',
  veneer: 'Veneer',
  inlay: 'Inlay/Onlay',
};

/** خطوط «Auswahl-Übersicht»، به آلمانی. */
export function zusammenfassung(auswahl: ZahnAuswahl): string[] {
  const zeilen: string[] = [];
  for (const art of Object.keys(NAMEN) as Einzelbehandlung[]) {
    const zaehne = sortiert(
      Object.entries(auswahl)
        .filter(([, e]) => e.art === art)
        .map(([fdi]) => Number(fdi)),
    );
    if (zaehne.length) zeilen.push(`${NAMEN[art]}: ${zaehne.join(', ')}`);
  }
  const spannen = new Set(Object.values(auswahl).flatMap((e) => (e.spanne ? [e.spanne] : [])));
  for (const spanne of spannen) {
    const mitglieder = mitgliederVon(auswahl, spanne);
    const anker = mitglieder.filter((f) => auswahl[f].art === 'bruecke_anker');
    const glieder = mitglieder.filter((f) => auswahl[f].art === 'bruecke_glied');
    let zeile = `Brücke ${mitglieder[0]}–${mitglieder[mitglieder.length - 1]}: Anker ${anker.join(', ')}`;
    if (glieder.length) zeile += ` · Glied ${glieder.join(', ')}`;
    zeilen.push(zeile);
  }
  return zeilen;
}
