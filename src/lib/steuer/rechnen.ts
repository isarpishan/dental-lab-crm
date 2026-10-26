import type { Jahreswerte, Tarifstufe } from './werte';

/**
 * «Steuer- und SVS-Vorschau» (Spec فاز ۵، قدم ۵)، بدون دیتابیس و با آزمون. فقط **تخمین**، نه Steuerberatung.
 *
 * Einkommensteuer: روش تفاضلی. Lohnsteuer روی Gehalt قبلاً پرداخت شده (با همان Tarif و Absetzbeträge)؛ پس مالیات اضافه
 * به خاطر DDL = Tarif(Gehalt + Gewinn) − Tarif(Gehalt). Sonderzahlungen (۱۳. و ۱۴.) جدا با ۶ ٪ حساب می‌شوند و بیرون
 * می‌مانند. Gewinn مالیاتی = Einnahmen − Ausgaben − SVS پرداخت‌شده در سال − Gewinnfreibetrag (۱۵ ٪ تا € 33.000).
 *
 * SVS (GSVG): Neugründer در سه سال اول روی Mindestbeitragsgrundlage پرداخت می‌کند (vorläufig). Beitragsgrundlage نهایی =
 * Einkünfte laut Steuerbescheid (یعنی بعد از Gewinnfreibetrag) + PV و KV پرداخت‌شده؛ بین Mindest و Höchst. Nachzahlung:
 * PV همیشه (۱۸٫۵ ٪ فرق)؛ KV فقط از سال سوم (سال ۱ و ۲ ثابت). Selbständigenvorsorge و Unfallversicherung بدون Nachzahlung.
 * همهٔ مبلغ‌ها به سنت.
 */

/** Einkommensteuer nach Tarif für ein Jahreseinkommen in Cent (ohne Absetzbeträge) */
export function tarifSteuerCent(einkommenCent: number, tarif: Tarifstufe[]): number {
  const rest = Math.max(0, einkommenCent) / 100;
  let untergrenze = 0;
  let steuer = 0;
  for (const s of tarif) {
    if (rest <= untergrenze) break;
    const teil = Math.min(rest, s.bis) - untergrenze;
    if (teil > 0) steuer += teil * s.satz;
    untergrenze = s.bis;
  }
  return Math.round(steuer * 100);
}

export type SteuerEingaben = {
  /** steuerpflichtige laufende Bezüge je Monat (»BMG LSt« auf dem Lohnzettel), Cent */
  gehaltMonatCent: number;
  /** wie viele Monate im Jahr Gehalt (ohne 13./14.) */
  gehaltMonate: number;
  /** Beginn der Selbständigkeit (Gewerbe), YYYY-MM-DD */
  beginn: string;
  /** SVS-Vorschreibung je Quartal laut SVS-Brief; null ← Mindestbeiträge rechnen */
  svsQuartalCent: number | null;
  /** schon vorgeschriebene ESt-Vorauszahlungen im Jahr, Cent */
  vorauszahlungenCent: number;
  /** eigene Schätzung des Jahresgewinns; null ← hochrechnen */
  gewinnSchaetzungCent: number | null;
};

export type DdlZahlen = {
  /** Einnahmen − Ausgaben vom 1. Jänner bis heute (EAR), Cent */
  gewinnBisHeuteCent: number;
};

export type SteuerVorschau = {
  jahr: number;
  /** Kalenderjahr der Selbständigkeit: 1 = Gründungsjahr */
  gruendungsjahr: number;
  /** versicherte Monate in diesem Jahr */
  monateSelbstaendig: number;
  /** Monate seit Beginn (bzw. Jahresanfang) bis heute, mindestens 1 */
  monateBisher: number;
  gewinnBisHeuteCent: number;
  gewinnJahrCent: number;
  gewinnQuelle: 'hochgerechnet' | 'schaetzung';
  svsLaufendCent: number;
  svsQuelle: 'vorschreibung' | 'mindest';
  gewinnfreibetragCent: number;
  gewinnSteuerlichCent: number;
  gehaltJahrCent: number;
  steuerOhneCent: number;
  steuerMitCent: number;
  estMehrCent: number;
  estOffenCent: number;
  beitragsgrundlageCent: number;
  pvNachCent: number;
  kvNachCent: number;
  svsNachCent: number;
  /** ESt (nach Vorauszahlungen) + SVS-Nachzahlung; negativ = eher Gutschrift */
  ruecklageCent: number;
  ruecklageMonatCent: number;
  /** Anteil vom Jahresgewinn, der zurückzulegen ist (0..1); ohne Gewinn null */
  ruecklageQuote: number | null;
};

/** Monate ab `beginn` bis Jahresende (im Jahr `jahr`; begonnener Monat zählt) */
export function monateImJahr(beginn: string, jahr: number): number {
  const bj = Number(beginn.slice(0, 4));
  if (bj > jahr) return 0;
  if (bj < jahr) return 12;
  return 12 - Number(beginn.slice(5, 7)) + 1;
}

export function steuerVorschau(jahr: number, heute: string, e: SteuerEingaben, d: DdlZahlen, w: Jahreswerte): SteuerVorschau {
  const gruendungsjahr = jahr - Number(e.beginn.slice(0, 4)) + 1;
  const monateSelbstaendig = monateImJahr(e.beginn, jahr);
  // bisher vergangene Monate der Selbständigkeit in diesem Jahr (laufender Monat zählt)
  const startMonat = Number(e.beginn.slice(0, 4)) < jahr ? 1 : Number(e.beginn.slice(5, 7));
  const heuteMonat = Number(heute.slice(0, 4)) > jahr ? 12 : Number(heute.slice(5, 7));
  const monateBisher = Math.max(1, Math.min(monateSelbstaendig, heuteMonat - startMonat + 1));

  const gewinnJahrCent =
    e.gewinnSchaetzungCent ?? (monateBisher >= monateSelbstaendig ? d.gewinnBisHeuteCent : Math.round((d.gewinnBisHeuteCent / monateBisher) * monateSelbstaendig));

  // SVS laufend (vorläufig): Vorschreibung je Quartal, sonst Mindestbeiträge
  const mindestJahr = w.svs.mindestMonat * monateSelbstaendig;
  const pvVorl = Math.round(mindestJahr * w.svs.pv * 100);
  const kvVorl = Math.round(mindestJahr * w.svs.kv * 100);
  const mindestBeitragCent = pvVorl + kvVorl + Math.round(mindestJahr * w.svs.sv * 100) + Math.round(w.svs.uvMonat * monateSelbstaendig * 100);
  const svsLaufendCent = e.svsQuartalCent != null ? Math.round((e.svsQuartalCent * monateSelbstaendig) / 3) : mindestBeitragCent;

  const vorGfb = gewinnJahrCent - svsLaufendCent;
  const gewinnfreibetragCent = vorGfb > 0 ? Math.round(Math.min(vorGfb, w.gewinnfreibetrag.bis * 100) * w.gewinnfreibetrag.satz) : 0;
  const gewinnSteuerlichCent = vorGfb - gewinnfreibetragCent;

  const gehaltJahrCent = e.gehaltMonatCent * e.gehaltMonate;
  const steuerOhneCent = tarifSteuerCent(gehaltJahrCent, w.tarif);
  const steuerMitCent = tarifSteuerCent(gehaltJahrCent + gewinnSteuerlichCent, w.tarif);
  const estMehrCent = steuerMitCent - steuerOhneCent;
  const estOffenCent = estMehrCent - e.vorauszahlungenCent;

  // endgültige Beitragsgrundlage: Einkünfte (nach GFB) + bezahlte PV und KV, zwischen Mindest und Höchst
  const pvKvBezahlt = e.svsQuartalCent != null ? Math.round(svsLaufendCent * ((w.svs.pv + w.svs.kv) / (w.svs.pv + w.svs.kv + w.svs.sv))) : pvVorl + kvVorl;
  const roh = gewinnSteuerlichCent + pvKvBezahlt;
  const beitragsgrundlageCent = monateSelbstaendig ? Math.min(Math.max(roh, Math.round(mindestJahr * 100)), Math.round(w.svs.hoechstMonat * monateSelbstaendig * 100)) : 0;
  const ueberMindest = Math.max(0, beitragsgrundlageCent - Math.round(mindestJahr * 100));
  const pvNachCent = Math.round(ueberMindest * w.svs.pv);
  const kvNachCent = gruendungsjahr >= 3 ? Math.round(ueberMindest * w.svs.kv) : 0;
  const svsNachCent = pvNachCent + kvNachCent;

  const ruecklageCent = estOffenCent + svsNachCent;
  return {
    jahr,
    gruendungsjahr,
    monateSelbstaendig,
    monateBisher,
    gewinnBisHeuteCent: d.gewinnBisHeuteCent,
    gewinnJahrCent,
    gewinnQuelle: e.gewinnSchaetzungCent != null ? 'schaetzung' : 'hochgerechnet',
    svsLaufendCent,
    svsQuelle: e.svsQuartalCent != null ? 'vorschreibung' : 'mindest',
    gewinnfreibetragCent,
    gewinnSteuerlichCent,
    gehaltJahrCent,
    steuerOhneCent,
    steuerMitCent,
    estMehrCent,
    estOffenCent,
    beitragsgrundlageCent,
    pvNachCent,
    kvNachCent,
    svsNachCent,
    ruecklageCent,
    ruecklageMonatCent: monateSelbstaendig ? Math.round(Math.max(0, ruecklageCent) / monateSelbstaendig) : 0,
    ruecklageQuote: gewinnJahrCent > 0 ? Math.max(0, ruecklageCent) / gewinnJahrCent : null,
  };
}
