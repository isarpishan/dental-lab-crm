import { describe, expect, it } from 'vitest';
import { STAFF_ROLLEN } from '@/db/schema';
import { AKTIONEN, darf } from './roles';

describe('Rollen', () => {
  it('Inhaber darf alles', () => {
    for (const a of AKTIONEN) expect(darf('inhaber', a)).toBe(true);
  });

  it('nur der Inhaber verwaltet Benutzer und Einstellungen', () => {
    for (const r of STAFF_ROLLEN.filter((r) => r !== 'inhaber')) {
      expect(darf(r, 'benutzer.verwalten')).toBe(false);
      expect(darf(r, 'einstellungen.verwalten')).toBe(false);
    }
  });

  it('Fahrer sieht nur Touren, keine Patientennamen', () => {
    expect(darf('fahrer', 'touren.sehen')).toBe(true);
    expect(darf('fahrer', 'touren.bearbeiten')).toBe(false);
    expect(darf('fahrer', 'auftraege.sehen')).toBe(false);
    expect(darf('fahrer', 'patientenname.sehen')).toBe(false);
  });

  it('Reklamationen entscheiden nur Inhaber und Büro', () => {
    expect(STAFF_ROLLEN.filter((r) => darf(r, 'reklamationen.entscheiden'))).toEqual(['inhaber', 'buero']);
  });

  it('Nur lesen bearbeitet nichts', () => {
    for (const a of AKTIONEN.filter((a) => a.endsWith('.bearbeiten') || a.endsWith('.verwalten') || a.endsWith('.entscheiden'))) {
      expect(darf('nur_lesen', a)).toBe(false);
    }
  });
});
