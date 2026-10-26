/**
 * عددهای قانونی برای «Steuer- und SVS-Vorschau» (Spec فاز ۵، قدم ۵)، برای هر سال جدا. **هر سال تازه کنترل و اضافه
 * شود** (معمولاً ژانویه). سالی که هنوز اینجا نیست با عددهای آخرین سال موجود و یک هشدار حساب می‌شود.
 *
 * ۲۰۲۶ (کنترل ۲۵ اکتبر ۲۰۲۶):
 * - Tarif § 33 EStG: Trauner Datenblatt 2026 (Stand 1.1.2026)، FreeFinance، selbststaendig-machen.at
 * - SVS (GSVG): WKO «Gewerbliche Sozialversicherungsbeiträge – Ausmaß» و «Neugründer 2026»، WKO Infoblatt SV 2026
 * - Gewinnfreibetrag: Grundfreibetrag 15 % bis € 33.000 (selbststaendig-machen.at، forum-media)
 */

export type Tarifstufe = { bis: number; satz: number };

export type Jahreswerte = {
  jahr: number;
  /** wann die Werte zuletzt mit den Quellen verglichen wurden */
  stand: string;
  /** obere Grenze je Stufe in Euro (jährlich), Satz für den Teil darunter; letzte Stufe `Infinity` */
  tarif: Tarifstufe[];
  svs: {
    pv: number;
    kv: number;
    /** Selbständigenvorsorge */
    sv: number;
    /** Unfallversicherung: fester Betrag je Monat */
    uvMonat: number;
    mindestMonat: number;
    hoechstMonat: number;
  };
  gewinnfreibetrag: { satz: number; bis: number };
};

export const JAHRESWERTE: Record<number, Jahreswerte> = {
  2026: {
    jahr: 2026,
    stand: '2026-10-25',
    tarif: [
      { bis: 13_539, satz: 0 },
      { bis: 21_992, satz: 0.2 },
      { bis: 36_458, satz: 0.3 },
      { bis: 70_365, satz: 0.4 },
      { bis: 104_859, satz: 0.48 },
      { bis: 1_000_000, satz: 0.5 },
      { bis: Infinity, satz: 0.55 },
    ],
    svs: { pv: 0.185, kv: 0.068, sv: 0.0153, uvMonat: 12.95, mindestMonat: 551.1, hoechstMonat: 8_085 },
    gewinnfreibetrag: { satz: 0.15, bis: 33_000 },
  },
};

/** Werte eines Jahres; fehlt das Jahr, die des letzten bekannten Jahres mit `geschaetzt` */
export function werteFuer(jahr: number): { werte: Jahreswerte; geschaetzt: boolean } {
  if (JAHRESWERTE[jahr]) return { werte: JAHRESWERTE[jahr], geschaetzt: false };
  const bekannt = Object.keys(JAHRESWERTE).map(Number).sort((a, b) => a - b);
  const naechstes = [...bekannt].reverse().find((j) => j <= jahr) ?? bekannt[0];
  return { werte: JAHRESWERTE[naechstes], geschaetzt: true };
}
