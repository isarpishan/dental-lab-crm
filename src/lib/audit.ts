import { db } from '@/db/client';
import { auditLog } from '@/db/schema';

/**
 * ثبت کارهای مهم با نام کسی که انجام داده (الگوی `logAudit` آرکان). نام
 * عملیات‌ها یک union نوع‌دار است: عملیاتی که برچسب آلمانی نداشته باشد، خطای
 * کامپایل می‌دهد. insert همیشه با await است؛ کار نیمه‌تمام در پس‌زمینه ممکن
 * است هرگز ثبت نشود.
 */
export const AUDIT_AKTIONEN = {
  anmeldung: 'Anmeldung',
  anmeldung_fehlgeschlagen: 'Anmeldung fehlgeschlagen',
  abmeldung: 'Abmeldung',
  zugang_eingerichtet: 'Zugang eingerichtet',
  benutzer_eingeladen: 'Mitarbeiter eingeladen',
  einladung_erneuert: 'Einladung erneut gesendet',
  benutzer_deaktiviert: 'Benutzer deaktiviert',
  benutzer_aktiviert: 'Benutzer aktiviert',
  rolle_geaendert: 'Rolle geändert',
  ordination_angelegt: 'Ordination angelegt',
  ordination_geaendert: 'Ordination geändert',
  behandler_angelegt: 'Behandler angelegt',
  behandler_geaendert: 'Behandler geändert',
  praxiszugang_eingeladen: 'Portal-Zugang eingeladen',
  praxiszugang_erneuert: 'Portal-Einladung erneut gesendet',
  praxiszugang_deaktiviert: 'Portal-Zugang deaktiviert',
  praxiszugang_aktiviert: 'Portal-Zugang aktiviert',
  portal_anfrage_eingeladen: 'Portal-Anfrage von der Website: eingeladen',
  portal_anfrage_erledigt: 'Portal-Anfrage von der Website: erledigt',
  katalog_geaendert: 'Behandlungen und Preise geändert',
  behandlung_angelegt: 'Behandlung angelegt',
  behandlung_bild_geaendert: 'Bild einer Behandlung geändert',
  patient_angelegt: 'Patient angelegt',
  auftrag_eingereicht: 'Auftrag eingereicht',
  entwurf_verworfen: 'Entwurf verworfen',
  auftrag_storniert: 'Auftrag storniert',
  auftrag_geloescht: 'Auftrag gelöscht',
  daten_nachgereicht: 'Daten nachgereicht',
  design_hochgeladen: 'Design hochgeladen',
  design_freigegeben: 'Design freigegeben',
  aenderung_angefordert: 'Änderung am Design angefordert',
  rueckfrage_gestellt: 'Rückfrage gestellt',
  status_geaendert: 'Auftragsstatus geändert',
  liefertermin_geaendert: 'Liefertermin geändert',
  schritt_verschoben: 'Produktionsschritt verschoben',
  schritt_erledigt: 'Produktionsschritt erledigt',
  zustaendig_geaendert: 'Zuständigkeit geändert',
  material_angelegt: 'Material angelegt',
  material_geaendert: 'Material geändert',
  charge_angelegt: 'Charge erfasst',
  charge_geaendert: 'Charge geändert',
  charge_bestand: 'Bestand einer Charge geändert',
  tour_angelegt: 'Tour angelegt',
  tour_geaendert: 'Tour geändert',
  auftrag_zugestellt: 'Auftrag zugestellt',
  abholung_angefordert: 'Abholung angefordert',
  abholung_eingeplant: 'Abholung eingeplant',
  abholung_erledigt: 'Abholung erledigt',
  abholung_zurueckgezogen: 'Abholung zurückgezogen',
  reklamation_gemeldet: 'Reklamation gemeldet',
  reklamation_entschieden: 'Reklamation entschieden',
  reparatur_erledigt: 'Reparatur erledigt',
  benachrichtigungen_geaendert: 'E-Mail-Benachrichtigungen geändert',
  vereinbarung_angenommen: 'Vereinbarung zu Datenschutz und Portalnutzung angenommen',
  positionen_geaendert: 'Abrechnungspositionen geändert',
  positionen_zurueckgesetzt: 'Abrechnungspositionen auf den Vorschlag zurückgesetzt',
  rechnung_ausgestellt: 'Rechnung ausgestellt',
  rechnung_storniert: 'Rechnung storniert',
  gutschrift_ausgestellt: 'Gutschrift ausgestellt',
  rechnung_versendet: 'Rechnung per E-Mail gesendet',
  zahlung_erfasst: 'Zahlung erfasst',
  zahlung_geloescht: 'Zahlung gelöscht',
  buchhaltung_exportiert: 'Export für die Steuerberatung (Excel)',
  mahnung_erstellt: 'Zahlungserinnerung oder Mahnung erstellt',
  mahnung_versendet: 'Zahlungserinnerung oder Mahnung per E-Mail gesendet',
  einstellungen_geaendert: 'Einstellungen geändert',
  ausgabe_erfasst: 'Ausgabe erfasst',
  ausgabe_geaendert: 'Ausgabe geändert',
  ausgabe_geloescht: 'Ausgabe gelöscht',
  ausgabe_beleg: 'Beleg zu einer Ausgabe hochgeladen',
  ausgaben_exportiert: 'Ausgaben für die Steuerberatung exportiert (Excel und Belege)',
  beleg_eingang: 'Beleg hochgeladen (Zu prüfen)',
  beleg_verworfen: 'Beleg unter »Zu prüfen« verworfen',
  privat_erfasst: 'Privat: Buchung erfasst',
  privat_geaendert: 'Privat: Buchung geändert',
  privat_geloescht: 'Privat: Buchung gelöscht',
  privat_beleg: 'Privat: Beleg hochgeladen',
  fixkosten_angelegt: 'Fixkosten angelegt',
  fixkosten_geaendert: 'Fixkosten geändert',
  fixkosten_pausiert: 'Fixkosten pausiert',
  fixkosten_fortgesetzt: 'Fixkosten fortgesetzt',
  fixkosten_geloescht: 'Fixkosten gelöscht',
  fixkosten_uebersprungen: 'Fixkosten für einen Monat übersprungen',
  bank_auszug_hochgeladen: 'Bank: Kontoauszug hochgeladen',
  bank_auszug_gelesen: 'Bank: Kontoauszug gelesen',
  bank_auszug_entfernt: 'Bank: Kontoauszug entfernt',
  bank_zugeordnet: 'Bank: Zeile zugeordnet',
  bank_zurueckgesetzt: 'Bank: Zuordnung aufgehoben',
  steuer_einstellungen_geaendert: 'Steuer-Angaben geändert',
  ki_einstellungen_geaendert: 'KI-Einstellungen geändert',
  scan_zugang_angelegt: 'Handy-Scanner: Zugang angelegt',
  scan_zugang_gesperrt: 'Handy-Scanner: Zugang gesperrt',
  scan_zugang_entfernt: 'Handy-Scanner: gesperrten Zugang entfernt',
} as const;
export type AuditAktion = keyof typeof AUDIT_AKTIONEN;

export type Akteur = { kind: 'staff' | 'practice'; id: string; label: string } | { kind: 'system'; label: string };

export async function logAudit(e: {
  aktion: AuditAktion;
  akteur: Akteur;
  ziel?: { typ: string; id: string };
  details?: Record<string, unknown>;
  ip?: string | null;
}) {
  await db()
    .insert(auditLog)
    .values({
      actorKind: e.akteur.kind,
      actorId: 'id' in e.akteur ? e.akteur.id : null,
      actorLabel: e.akteur.label,
      action: e.aktion,
      targetType: e.ziel?.typ ?? null,
      targetId: e.ziel?.id ?? null,
      details: e.details ?? null,
      ip: e.ip ?? null,
    });
}
