import { AUSGABE_KATEGORIEN } from '@/lib/ausgaben/text';
import { passtZurArt, type PrivatKategorie } from '@/lib/privat/text';

/**
 * پیشنهاد برای هر ردیف بانک (Spec فاز ۵، قدم ۴)، بدون دیتابیس و با آزمون. ترتیب:
 * ۱. ورودی با شمارهٔ Rechnung در متن ← همان Rechnung (مطمئن).
 * ۲. ردیف موجود با همان مبلغ و تاریخ نزدیک ← «verbinden» (Ausgabe لابراتوار یا Privat؛ اول Bereich پیشنهادی KI).
 *    خروجی‌ای که به Fixkosten لابراتوار با سررسید باز و همان مبلغ می‌خورد ← از همان Fixkosten یک Ausgabe بساز.
 *    (Fixkosten Privat خودش Privat-Buchung می‌سازد و همین‌جا «verbinden» می‌شود.)
 * ۳. ورودی با مبلغی برابر مانده دقیقاً یک Rechnung ← همان (نامطمئن).
 * ۴. بر اساس Bereich پیشنهادی: Privat ← Buchung تازه با Kategorie؛ DDL ← «Beleg fehlt»؛ وگرنه «Ignorieren».
 * هر ردیف موجود فقط یک بار پیشنهاد می‌شود (به ترتیب ردیف‌ها).
 * «sicher»: بدون پرسش با «Sichere Vorschläge übernehmen» تأیید می‌شود.
 */

export type BankZeile = {
  id: string;
  buchungstag: string;
  betragCent: number;
  text: string;
  gegenpartei: string | null;
  bereich: 'ddl' | 'privat' | 'ignorieren';
  kategorie: string | null;
  privatKategorie: string | null;
  rechnungsnummer: string | null;
};

export type Kandidaten = {
  rechnungen: { id: string; nummer: string; offenCent: number; praxis: string }[];
  ausgaben: { id: string; bruttoCent: number; bezahltAm: string; lieferant: string }[];
  privat: { id: string; art: 'ausgabe' | 'einnahme'; betragCent: number; datum: string; titel: string }[];
  /** fällige, noch offene Fixkosten des Labors (ein Lauf je Fälligkeit) */
  fixkosten?: { id: string; betragCent: number; faelligAm: string; titel: string }[];
};

export type Vorschlag =
  | { aktion: 'rechnung'; id: string; text: string; betragCent: number; sicher: boolean }
  | { aktion: 'ausgabe'; id: string; text: string; sicher: boolean }
  | { aktion: 'privat_verbinden'; id: string; text: string; sicher: boolean }
  | { aktion: 'fixkosten'; id: string; text: string; sicher: boolean }
  | { aktion: 'privat_neu'; kategorie: PrivatKategorie; sicher: boolean }
  | { aktion: 'ddl_offen'; kategorie: string | null; sicher: false }
  | { aktion: 'ignorieren'; sicher: false };

const TAG = 86_400_000;
export const tageAbstand = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / TAG;

/** «R-2026-0012», «R 2026 0012», «R2026/0012» ← «R20260012» */
export const nummerNormal = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** alle Rechnungsnummern (R-JJJJ-NNNN) in einem Verwendungszweck */
export function rechnungsnummernIn(text: string): string[] {
  return [...text.toUpperCase().matchAll(/R[\s\-/]?(\d{4})[\s\-/]?(\d{3,5})/g)].map((m) => `R${m[1]}${m[2]}`);
}

const wortGleich = (a: string, b: string) => {
  const w = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((x) => x.length >= 4));
  const x = w(a);
  return [...w(b)].some((y) => x.has(y));
};

export function vorschlaegeBerechnen(zeilen: BankZeile[], k: Kandidaten): Map<string, Vorschlag> {
  const vergeben = new Set<string>();
  const offenNach = new Map(k.rechnungen.map((r) => [r.id, r.offenCent]));
  const aus = new Map<string, Vorschlag>();

  for (const z of zeilen) {
    const betrag = Math.abs(z.betragCent);
    const name = `${z.gegenpartei ?? ''} ${z.text}`;
    let v: Vorschlag | null = null;

    if (z.betragCent > 0) {
      const nummern = new Set([...rechnungsnummernIn(z.text), ...(z.rechnungsnummer ? [nummerNormal(z.rechnungsnummer)] : [])]);
      const r = k.rechnungen.find((x) => nummern.has(nummerNormal(x.nummer)) && (offenNach.get(x.id) ?? 0) > 0);
      if (r) {
        const offen = offenNach.get(r.id)!;
        v = { aktion: 'rechnung', id: r.id, text: `${r.nummer} · ${r.praxis}`, betragCent: Math.min(betrag, offen), sicher: betrag <= offen };
      }
    }

    // vorhandene Zeile mit gleichem Betrag in der Nähe
    if (!v) {
      const art = z.betragCent > 0 ? 'einnahme' : 'ausgabe';
      const privat = k.privat
        .filter((p) => !vergeben.has(p.id) && p.art === art && p.betragCent === betrag && tageAbstand(p.datum, z.buchungstag) <= 7)
        .sort((a, b) => tageAbstand(a.datum, z.buchungstag) - tageAbstand(b.datum, z.buchungstag))[0];
      const ausgabe =
        z.betragCent < 0
          ? k.ausgaben
              .filter((a) => !vergeben.has(a.id) && a.bruttoCent === betrag && tageAbstand(a.bezahltAm, z.buchungstag) <= 10)
              .sort((a, b) => tageAbstand(a.bezahltAm, z.buchungstag) - tageAbstand(b.bezahltAm, z.buchungstag))[0]
          : undefined;
      const vonAusgabe = ausgabe && {
        aktion: 'ausgabe' as const,
        id: ausgabe.id,
        text: ausgabe.lieferant,
        sicher: tageAbstand(ausgabe.bezahltAm, z.buchungstag) <= 3 || wortGleich(ausgabe.lieferant, name),
      };
      const vonPrivat = privat && { aktion: 'privat_verbinden' as const, id: privat.id, text: privat.titel, sicher: tageAbstand(privat.datum, z.buchungstag) <= 3 };
      const lauf =
        z.betragCent < 0
          ? (k.fixkosten ?? [])
              .filter((l) => !vergeben.has(l.id) && l.betragCent === betrag && tageAbstand(l.faelligAm, z.buchungstag) <= 10)
              .sort((a, b) => tageAbstand(a.faelligAm, z.buchungstag) - tageAbstand(b.faelligAm, z.buchungstag))[0]
          : undefined;
      const vonFixkosten = lauf && { aktion: 'fixkosten' as const, id: lauf.id, text: lauf.titel, sicher: tageAbstand(lauf.faelligAm, z.buchungstag) <= 5 };
      v = (z.bereich === 'privat' ? (vonPrivat ?? vonAusgabe ?? vonFixkosten) : (vonAusgabe ?? vonFixkosten ?? vonPrivat)) ?? null;
    }

    if (!v && z.betragCent > 0) {
      const gleich = k.rechnungen.filter((r) => offenNach.get(r.id) === betrag);
      if (gleich.length === 1) v = { aktion: 'rechnung', id: gleich[0].id, text: `${gleich[0].nummer} · ${gleich[0].praxis}`, betragCent: betrag, sicher: false };
    }

    if (!v) {
      if (z.bereich === 'privat') {
        const art = z.betragCent > 0 ? 'einnahme' : 'ausgabe';
        const kat = z.privatKategorie && passtZurArt(art, z.privatKategorie) ? z.privatKategorie : null;
        v = { aktion: 'privat_neu', kategorie: kat ?? (art === 'einnahme' ? 'sonstige_einnahme' : 'sonstiges'), sicher: Boolean(kat) };
      } else if (z.bereich === 'ddl') {
        const kat = z.kategorie && (AUSGABE_KATEGORIEN as readonly string[]).includes(z.kategorie) ? z.kategorie : null;
        v = { aktion: 'ddl_offen', kategorie: kat, sicher: false };
      } else v = { aktion: 'ignorieren', sicher: false };
    }

    if (v.aktion === 'ausgabe' || v.aktion === 'privat_verbinden' || v.aktion === 'fixkosten') vergeben.add(v.id);
    if (v.aktion === 'rechnung') offenNach.set(v.id, (offenNach.get(v.id) ?? 0) - v.betragCent);
    aus.set(z.id, v);
  }
  return aus;
}
