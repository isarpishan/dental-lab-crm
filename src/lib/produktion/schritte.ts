import { uebergangErlaubt, type Status, type Umstaende } from '@/lib/orders/status';

/**
 * منطق خالص Kanban تولید (Spec فاز ۱، بخش H)، بدون دیتابیس و قابل‌تست:
 * - کدام مراحل به این سفارش می‌خورند (`planVon`)
 * - کارت در کدام ستون است (`spalteVon`)
 * - آیا کشیدن به ستون دیگر مجاز است و وضعیت پورتال چه می‌شود (`zielPruefen`)
 * - «Erledigt» در هر مرحله یعنی چه (`erledigenVon`)
 *
 * هر مرحله به یک وضعیت پورتال نگاشت می‌شود (brief، بخش ۵). وضعیت فقط از `lib/orders/status.ts`
 * عوض می‌شود؛ این فایل فقط می‌گوید کدام انتقال لازم است.
 */

export type Schritt = { key: string; label: string; portal: Status };

/** وضعیت‌هایی که کارت روی برد ندارند: هنوز ارسال نشده، یا کار لابراتوار تمام است. */
export const NICHT_AUF_BRETT: readonly Status[] = ['entwurf', 'freigegeben', 'geliefert', 'abgeschlossen', 'storniert'];

/** مرحله‌هایی که با کشیدن وارد نمی‌شوند، چون ورودی دیگری لازم دارند. */
const NUR_UEBER_AUFTRAGSSEITE: Record<string, string> = {
  rueckfrage: 'Für eine Rückfrage bitte auf der Auftragsseite den Text eingeben.',
  freigabe_warten: 'Zur Freigabe bitte das Design auf der Auftragsseite hochladen.',
  ueberarbeitung: 'Eine Überarbeitung beginnt mit dem Änderungswunsch der Ordination.',
};

/** در این مراحل دستگاه و Chargeها ثبت می‌شوند (ردیابی MDR). */
export const DRUCK_SCHRITTE: readonly string[] = ['druck'];

const DESIGN_PHASE: readonly Status[] = ['eingereicht', 'in_planung', 'design_freigabe'];
const VOR_FREIGABE: readonly Status[] = ['eingereicht', 'rueckfrage', 'in_planung', 'in_ueberarbeitung'];
const PRODUKTION: readonly Status[] = ['in_produktion', 'einprobe', 'fertig', 'versendet'];

export type PlanEingabe = {
  /** `work_types.step_keys` */
  stepKeys: readonly string[];
  lieferart: 'design' | 'fertigung' | null;
  freigabeNoetig: boolean;
  /** «Einprobe gewünscht» در فرم */
  einprobe: boolean;
};

/**
 * مراحل همین سفارش، به ترتیب برد. `alle` = مراحل فعال به ترتیب `position`.
 * «Nur Design» فقط تا Freigabe؛ Freigabe فقط اگر Behandlung آن را دارد؛ Einprobe فقط اگر خواسته شده.
 * Rückfrage و Überarbeitung جزو plan نیستند: ستون‌های «انحراف» هستند و سفارش از آن‌ها برمی‌گردد.
 */
export function planVon(alle: readonly Schritt[], e: PlanEingabe): Schritt[] {
  return alle.filter((s) => {
    if (!e.stepKeys.includes(s.key)) return false;
    if (s.key === 'freigabe_warten' && !e.freigabeNoetig) return false;
    if (s.key === 'einprobe' && !e.einprobe) return false;
    if (e.lieferart === 'design' && !DESIGN_PHASE.includes(s.portal)) return false;
    return true;
  });
}

/**
 * ستون کارت. اگر `current_step_key` با وضعیت فعلی بخواند، همان؛ وگرنه اولین مرحلهٔ plan با همین
 * وضعیت (مثلاً بعد از Freigabe ← «3D-Druck»). پس اگر وضعیت از جای دیگری عوض شد، ستون خودش درست می‌شود.
 */
export function spalteVon(status: Status, aktuell: string | null, plan: readonly Schritt[], alle: readonly Schritt[]): string | null {
  if (NICHT_AUF_BRETT.includes(status)) return null;
  const passt = (s: Schritt) => s.portal === status;
  if (aktuell && alle.some((s) => s.key === aktuell && passt(s))) return aktuell;
  return (plan.find(passt) ?? alle.find(passt))?.key ?? null;
}

export type Ist = { status: Status; spalte: string | null };
export type ZielErgebnis = { ok: true; nach: Status | null } | { ok: false; grund: string };

/**
 * کشیدن کارت به مرحلهٔ `ziel`: مجاز است؟ و اگر وضعیت پورتال باید عوض شود، به چه؟
 * از «3D-Druck» رو به جلو فقط با «Erledigt» (`perErledigt`)، تا دستگاه و Charge ثبت شوند (MDR).
 */
export function zielPruefen(ist: Ist, ziel: Schritt, u: Umstaende, plan: readonly Schritt[], perErledigt = false): ZielErgebnis {
  if (ist.spalte === ziel.key) return { ok: true, nach: null };
  if (ist.status === 'design_freigabe') return { ok: false, grund: 'Das Design liegt bei der Ordination zur Freigabe. Weiter geht es mit ihrer Entscheidung.' };
  const nurSeite = NUR_UEBER_AUFTRAGSSEITE[ziel.key];
  if (nurSeite) return { ok: false, grund: nurSeite };
  if (!plan.some((s) => s.key === ziel.key)) return { ok: false, grund: `„${ziel.label}“ gehört nicht zu diesem Auftrag.` };
  const vorwaerts = plan.findIndex((s) => s.key === ziel.key) > plan.findIndex((s) => s.key === ist.spalte);
  if (!perErledigt && ist.spalte && DRUCK_SCHRITTE.includes(ist.spalte) && vorwaerts) {
    return { ok: false, grund: 'Den 3D-Druck bitte mit „Erledigt“ abschließen, damit Drucker und Charge festgehalten werden.' };
  }
  if (ziel.portal === ist.status) return { ok: true, nach: null };
  if (uebergangErlaubt(ist.status, ziel.portal, 'labor', u)) return { ok: true, nach: ziel.portal };
  if (u.freigabeNoetig && PRODUKTION.includes(ziel.portal) && VOR_FREIGABE.includes(ist.status)) {
    return { ok: false, grund: 'Vor der Produktion braucht es die Freigabe der Ordination.' };
  }
  return { ok: false, grund: `Von hier aus geht es nicht direkt zu „${ziel.label}“.` };
}

export type Erledigen =
  | { art: 'weiter'; ziel: Schritt; nach: Status | null }
  /** «Übergabe» erledigt ← Geliefert (کارت از برد می‌رود) */
  | { art: 'geliefert' }
  /** ادامه فقط با بارگذاری طرح در صفحهٔ سفارش */
  | { art: 'design'; text: string }
  | { art: 'warten'; text: string }
  | { art: 'nichts'; text: string };

/** دکمهٔ «Erledigt» در مرحلهٔ فعلی چه می‌کند (صفحهٔ «Schritt erledigt» و صفحهٔ سفارش). */
export function erledigenVon(ist: Ist, u: Umstaende, plan: readonly Schritt[]): Erledigen {
  const s = ist.spalte;
  if (!s) return { art: 'nichts', text: 'In der Produktion ist für diesen Auftrag nichts mehr zu tun.' };
  if (s === 'rueckfrage') return { art: 'warten', text: 'Wartet auf die Antwort der Ordination.' };
  if (s === 'freigabe_warten') return { art: 'warten', text: 'Wartet auf die Freigabe der Ordination.' };
  if (s === 'uebergabe') return { art: 'geliefert' };

  // Überarbeitung geht wie das Design weiter
  const i = plan.findIndex((x) => x.key === (s === 'ueberarbeitung' ? 'cad_design' : s));
  const naechster = i >= 0 ? plan[i + 1] : undefined;
  if ((s === 'cad_design' || s === 'ueberarbeitung') && (u.freigabeNoetig || u.lieferart === 'design' || !naechster)) {
    return {
      art: 'design',
      text: u.freigabeNoetig ? 'Weiter mit dem Design: auf der Auftragsseite hochladen und zur Freigabe senden.' : 'Weiter mit dem Design: auf der Auftragsseite hochladen.',
    };
  }
  if (!naechster) return { art: 'nichts', text: 'Das ist der letzte Schritt dieses Auftrags.' };
  const r = zielPruefen(ist, naechster, u, plan, true);
  return r.ok ? { art: 'weiter', ziel: naechster, nach: r.nach } : { art: 'nichts', text: r.grund };
}

/** «IP» ← «Isar Pishan» (روی کارت Kanban). */
export function initialen(name: string | null | undefined): string | null {
  const teile = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return null;
  return (teile.length === 1 ? teile[0].slice(0, 2) : `${teile[0][0]}${teile[teile.length - 1][0]}`).toUpperCase();
}

/** ترتیب دندان‌ها در دهان: بالا ۱۸ ← ۱۱ | ۲۱ ← ۲۸، پایین ۴۸ ← ۴۱ | ۳۱ ← ۳۸. */
const MUNDREIHE = [
  ...[18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  ...[48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
];

/**
 * دندان‌ها کوتاه برای کارت Kanban و Laufzettel: «14–16»، «12–22»، «36, 46».
 * دندان‌های پشت‌سرهم در دهان یک بازه می‌شوند (در یک ربع از کوچک به بزرگ).
 */
export function zaehneKurz(fdis: readonly number[]): string | null {
  const pos = [...new Set(fdis)].map((f) => MUNDREIHE.indexOf(f)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (!pos.length) return null;
  const laeufe: number[][] = [];
  for (const i of pos) {
    const letzter = laeufe[laeufe.length - 1];
    // 28 und 48 sind keine Nachbarn (anderer Kiefer)
    if (letzter && i === letzter[letzter.length - 1] + 1 && i !== 16) letzter.push(i);
    else laeufe.push([i]);
  }
  if (laeufe.length > 4) return `${pos.length} Zähne`;
  return laeufe
    .map((l) => {
      const a = MUNDREIHE[l[0]];
      const b = MUNDREIHE[l[l.length - 1]];
      if (a === b) return String(a);
      const gleicherQuadrant = Math.floor(a / 10) === Math.floor(b / 10);
      return gleicherQuadrant ? `${Math.min(a, b)}–${Math.max(a, b)}` : `${a}–${b}`;
    })
    .join(', ');
}
