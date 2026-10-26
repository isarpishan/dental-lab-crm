'use server';

import { redirect } from 'next/navigation';
import { bearbeiterPortal } from '@/lib/auth/bearbeiter';
import { auftragsAktionen, type ReklamationDaten } from '@/lib/orders/aktionen';
import type { EntwurfDaten } from '@/lib/orders/pruefung';

/** فرم «Neuer Auftrag» در پورتال: Ordination همیشه از نشست (`ordinationId` نادیده گرفته می‌شود). */
const a = auftragsAktionen(bearbeiterPortal);

export async function suchen(_ordination: string | null, suche: string) {
  return a.suchen(null, suche);
}
export async function anlegen(_ordination: string | null, eingabe: { vorname: string; nachname: string; geburtsdatum: string; trotzdem: boolean }) {
  return a.anlegen(null, eingabe);
}
export async function patientFestlegen(_ordination: string | null, entwurfId: string | null, patientId: string) {
  return a.patientFestlegen(null, entwurfId, patientId);
}
export async function speichern(entwurfId: string, daten: EntwurfDaten) {
  return a.speichern(entwurfId, daten);
}
export async function dateiEntfernen(dateiId: string) {
  return a.dateiEntfernen(dateiId);
}
export async function absenden(entwurfId: string, daten: EntwurfDaten) {
  return a.absenden(entwurfId, daten);
}
export async function verwerfen(entwurfId: string) {
  return a.verwerfen(entwurfId);
}

// ── Auftragsseite ──
export async function nachricht(orderId: string, daten: { text: string; dateiIds: string[]; intern: boolean }) {
  return a.nachricht(orderId, { ...daten, intern: false });
}
export async function stornieren(orderId: string, grund: string) {
  return a.stornieren(orderId, grund);
}
export async function nachreichen(orderId: string, antwort: string) {
  return a.nachreichen(orderId, antwort);
}

/** «Neuer Auftrag für diesen Patienten»: Entwurf mit diesem Patienten, dann das Formular. */
export async function auftragFuerPatient(patientId: string) {
  const r = await a.patientFestlegen(null, null, patientId);
  if ('entwurfId' in r) redirect(`/auftraege/neu?entwurf=${r.entwurfId}`);
  redirect('/');
}

// ── Design-Freigabe ──
export async function freigeben(orderId: string, daten: { revisionId: string; name: string; geprueft: boolean }) {
  return a.freigeben(orderId, daten);
}
export async function aenderung(orderId: string, revisionId: string, daten: { zaehne: number[]; arten: string[]; text: string; dateiIds: string[] }) {
  return a.aenderung(orderId, revisionId, daten);
}
export async function feedback(orderId: string, daten: { bewertung: 'up' | 'down'; kommentar: string }) {
  return a.feedback(orderId, daten);
}

// ── Reklamation (Schritt 10) ──
export async function reklamation(orderId: string, daten: ReklamationDaten) {
  return a.reklamation(orderId, daten);
}
