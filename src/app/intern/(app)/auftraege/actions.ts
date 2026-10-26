'use server';

import { bearbeiterIntern } from '@/lib/auth/bearbeiter';
import { anfrageInfo } from '@/lib/auth/sessions';
import { AppError } from '@/lib/errors';
import { patientenNameZeigen } from '@/lib/orders/vorgang';
import { auftragsAktionen, type EntscheidungDaten, type ReklamationDaten } from '@/lib/orders/aktionen';
import type { EntwurfDaten } from '@/lib/orders/pruefung';

/** فرم «Neuer Auftrag» در پنل داخلی (سفارش تلفنی): فقط نقش‌های با `auftraege.anlegen`. */
const a = auftragsAktionen(() => bearbeiterIntern('auftraege.anlegen'));
/** صفحهٔ سفارش (پیام‌ها، Storno، پیوست‌ها): هر کسی که سفارش‌ها را بررسی می‌کند. */
const v = auftragsAktionen(() => bearbeiterIntern('auftraege.bearbeiten'));

export async function suchen(ordination: string | null, suche: string) {
  return a.suchen(ordination, suche);
}
export async function anlegen(ordination: string | null, eingabe: { vorname: string; nachname: string; geburtsdatum: string; trotzdem: boolean }) {
  return a.anlegen(ordination, eingabe);
}
export async function patientFestlegen(ordination: string | null, entwurfId: string | null, patientId: string) {
  return a.patientFestlegen(ordination, entwurfId, patientId);
}
export async function speichern(entwurfId: string, daten: EntwurfDaten) {
  return a.speichern(entwurfId, daten);
}
export async function dateiEntfernen(dateiId: string) {
  return v.dateiEntfernen(dateiId);
}
export async function absenden(entwurfId: string, daten: EntwurfDaten) {
  return a.absenden(entwurfId, daten);
}
export async function verwerfen(entwurfId: string) {
  return a.verwerfen(entwurfId);
}

// ── Auftragsseite ──
export async function nachricht(orderId: string, daten: { text: string; dateiIds: string[]; intern: boolean }) {
  return v.nachricht(orderId, daten);
}
export async function stornieren(orderId: string, grund: string) {
  return v.stornieren(orderId, grund);
}
/** nur Inhaber (`auftraege.loeschen`); die Prüfung steckt zusätzlich in `auftragLoeschen` */
const inhaber = auftragsAktionen(() => bearbeiterIntern('auftraege.loeschen'));
export async function loeschen(orderId: string) {
  return inhaber.loeschen(orderId);
}
export async function nachreichen(orderId: string, antwort: string) {
  return v.nachreichen(orderId, antwort);
}

/** «Name anzeigen»: nur mit `patientenname.sehen`, jedes Mal im Data-Access-Log. */
export async function nameAnzeigen(orderId: string): Promise<{ name?: string; fehler?: string }> {
  const b = await bearbeiterIntern('patientenname.sehen');
  if (!b) return { fehler: 'Dafür fehlt Ihnen die Berechtigung.' };
  try {
    return { name: await patientenNameZeigen(b, String(orderId), (await anfrageInfo()).ip) };
  } catch (e) {
    if (e instanceof AppError) return { fehler: e.message };
    throw e;
  }
}

// ── Design und Status (Schritt 7) ──
export async function designSenden(orderId: string, notiz: string) {
  return v.designSenden(orderId, notiz);
}
export async function laborSchritt(orderId: string, nach: string) {
  return v.laborSchritt(orderId, nach);
}
export async function rueckfrage(orderId: string, daten: { text: string; fehlend: string[] }) {
  return v.rueckfrage(orderId, daten);
}
export async function liefertermin(orderId: string, datum: string) {
  return v.liefertermin(orderId, datum);
}

// ── Reklamation (Schritt 10) ──
/** Entscheiden nur Inhaber und Büro (Kosten, Kulanz). */
const r = auftragsAktionen(() => bearbeiterIntern('reklamationen.entscheiden'));

export async function reklamation(orderId: string, daten: ReklamationDaten) {
  return v.reklamation(orderId, daten);
}
export async function reklamationEntscheiden(id: string, daten: EntscheidungDaten) {
  return r.reklamationEntscheiden(id, daten);
}
export async function reparaturErledigt(id: string) {
  return r.reparaturErledigt(id);
}
