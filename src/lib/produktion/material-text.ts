/**
 * کمک‌های بدون دیتابیس برای «Materialien» (هم سرور، هم مرورگر): واحد (Flasche/Kapsel)، رنگ‌ها و ترتیب سازنده‌ها
 * در Grid (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶: اول SprintRay، بعد Formlabs، بعد بقیه، هر کدام با رنگ خودش).
 */

export type Einheit = 'flasche' | 'kapsel';

/** «1 Flasche»، «3 Kapseln» */
export function mengeText(n: number, einheit: Einheit): string {
  if (einheit === 'kapsel') return `${n} ${n === 1 ? 'Kapsel' : 'Kapseln'}`;
  return `${n} ${n === 1 ? 'Flasche' : 'Flaschen'}`;
}

export const EINHEIT_NAMEN: Record<Einheit, string> = { flasche: 'Flasche', kapsel: 'Kapsel (MIDAS)' };

/** برای مقایسهٔ رنگ Charge با Zahnfarbe سفارش: «a3,5 » ← «A3.5» */
export function farbeNormal(farbe: string): string {
  return farbe.trim().toUpperCase().replace(',', '.').replace(/\s+/g, '');
}

/** «A1, A2 ,a3» ← ['A1', 'A2', 'A3']، بدون تکرار؛ خطا برای ورودی نادرست. */
export function farbenLesen(text: string): { farben: string[] } | { fehler: string } {
  const teile = text
    .split(/[,;\n]/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  const falsch = teile.find((t) => t.length > 12 || !/^[A-Z0-9][A-Z0-9 .\-/]*$/.test(t));
  if (falsch) return { fehler: `»${falsch}« ist keine gültige Farbe (z. B. A2, B1, Bleach).` };
  const farben = [...new Set(teile)];
  if (farben.length > 30) return { fehler: 'Höchstens 30 Farben.' };
  return { farben };
}

const HERSTELLER_REIHE = ['sprintray', 'formlabs'];

/** Rang im Raster: SprintRay, Formlabs, dann alle anderen alphabetisch. */
export function herstellerRang(hersteller: string): number {
  const i = HERSTELLER_REIHE.indexOf(hersteller.trim().toLowerCase());
  return i < 0 ? HERSTELLER_REIHE.length : i;
}

/** Farbmarke je Hersteller, in der Farbe der Geräte (Foto aus dem Labor): SprintRay rot, Formlabs orange, andere grau. */
export function herstellerFarbe(hersteller: string): 'sprintray' | 'formlabs' | 'andere' {
  return (['sprintray', 'formlabs'] as const)[herstellerRang(hersteller)] ?? 'andere';
}

/** CSS-Klassen der Farbmarke: Punkt vor dem Hersteller und Linie über der Gruppe */
export const MARKE: Record<ReturnType<typeof herstellerFarbe>, { punkt: string; linie: string }> = {
  sprintray: { punkt: 'bg-sprintray', linie: 'border-sprintray' },
  formlabs: { punkt: 'bg-formlabs', linie: 'border-formlabs' },
  andere: { punkt: 'bg-muted', linie: 'border-line' },
};

/** «Flasche»/«Flaschen», «Kapsel»/«Kapseln» ohne Zahl (für die große Bestandszahl). Einzahl nur für mehr als 0 bis 1: «½ Flasche», «0 Flaschen». */
export function einheitWort(n: number, einheit: Einheit): string {
  const eins = n > 0 && n <= 1;
  if (einheit === 'kapsel') return eins ? 'Kapsel' : 'Kapseln';
  return eins ? 'Flasche' : 'Flaschen';
}

/**
 * Wofür ein Material ist, allgemein statt jeder Behandlung (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶): «Prothesen» statt
 * «Teilprothese, Totalprothese». Unbekannte Behandlungen bleiben mit ihrem Namen (`namen`).
 */
export function verwendung(keys: string[], namen: Record<string, string> = {}): string {
  const k = new Set(keys);
  const teile: string[] = [];
  const restaurativ = ['krone', 'implantatkrone', 'inlay', 'veneer', 'bruecke'].filter((x) => k.has(x));
  if (restaurativ.length) teile.push(k.has('bruecke') ? 'Kronen & Brücken' : restaurativ.some((x) => x === 'krone' || x === 'implantatkrone') ? 'Kronen & Veneers' : 'Inlays & Veneers');
  const gruppen: [string, string[]][] = [
    ['Prothesen', ['teilprothese', 'totalprothese', 'hybridprothese']],
    ['Schienen', ['schiene', 'retainer', 'sportmundschutz', 'klebetray']],
    ['Modelle', ['modell', 'gingivamaske', 'loeffel']],
    ['Bohrschablonen', ['bohrschablone']],
  ];
  for (const [name, mitglieder] of gruppen) if (mitglieder.some((x) => k.has(x))) teile.push(name);
  const bekannt = new Set(['krone', 'implantatkrone', 'inlay', 'veneer', 'bruecke', ...gruppen.flatMap(([, m]) => m)]);
  for (const x of keys) if (!bekannt.has(x)) teile.push(namen[x] ?? x);
  return teile.join(' · ');
}

export type LagerStufe = 'gut' | 'mittel' | 'knapp';

/** Lagerstand als Anteil vom Gekauften: über 50 % gut, ab 20 % mittel, darunter (und leer) knapp. */
export function lagerStand(bestand: number, gekauft: number): { prozent: number; stufe: LagerStufe } {
  const prozent = gekauft > 0 ? Math.max(0, Math.min(100, Math.round((bestand / gekauft) * 100))) : 0;
  return { prozent, stufe: bestand <= 0 || prozent < 20 ? 'knapp' : prozent <= 50 ? 'mittel' : 'gut' };
}

/** Farben des Lagerbalkens und der Bestandszahl */
export const LAGER_FARBE: Record<LagerStufe, { text: string; balken: string }> = {
  gut: { text: 'text-lager-gut', balken: 'bg-lager-gut' },
  mittel: { text: 'text-lager-mittel', balken: 'bg-lager-mittel' },
  knapp: { text: 'text-lager-knapp', balken: 'bg-lager-knapp' },
};

/**
 * Flaschen mit angebrochener Flasche (خواستهٔ کاربر، ۲۴ اکتبر ۲۰۲۶): `bestand` ganze und angebrochene Flaschen,
 * `viertel` = wie viel von der offenen Flasche noch da ist (4 voll … 1 ein Viertel; null = voll). Ergebnis in Flaschen.
 */
export function flaschenStand(bestand: number, viertel: number | null): number {
  if (bestand <= 0) return 0;
  return bestand - 1 + (viertel ?? 4) / 4;
}

const BRUCH: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** 2.5 → «2½», 0.25 → «¼», 3 → «3» */
export function zahlMitBruch(n: number): string {
  const ganz = Math.floor(n);
  const rest = Math.round((n - ganz) * 4) / 4;
  const bruch = BRUCH[rest] ?? '';
  return ganz === 0 && bruch ? bruch : `${ganz}${bruch}`;
}

export const FUELLUNG_NAMEN: Record<number, string> = { 4: 'Voll', 3: '¾', 2: '½', 1: '¼' };
