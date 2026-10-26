import { describe, expect, it } from 'vitest';
import { PORTAL_STATUS } from '@/lib/katalog/stammdaten';
import { AKTION_NOETIG, etappenVon, fortschritt } from './fortschritt';

const fertigung = { lieferart: 'fertigung', freigabeNoetig: true, einprobe: false } as const;
const design = { lieferart: 'design', freigabeNoetig: true, einprobe: false } as const;
const namen = (e: { label: string }[]) => e.map((x) => x.label).join(' → ');

describe('Fortschritt', () => {
  it('nur die Etappen dieses Auftrags', () => {
    expect(namen(etappenVon(fertigung))).toBe('Eingereicht → In Planung → Freigabe → In Produktion → Fertig → Versendet');
    expect(namen(etappenVon({ ...fertigung, einprobe: true }))).toBe('Eingereicht → In Planung → Freigabe → In Produktion → Einprobe → Fertig → Versendet');
    expect(namen(etappenVon(design))).toBe('Eingereicht → In Planung → Freigabe → Freigegeben');
    expect(namen(etappenVon({ ...fertigung, freigabeNoetig: false }))).toBe('Eingereicht → In Planung → In Produktion → Fertig → Versendet');
  });

  it('aktuelle Etappe', () => {
    expect(fortschritt('eingereicht', fertigung).aktuell).toBe(0);
    expect(fortschritt('design_freigabe', fertigung).aktuell).toBe(2);
    expect(fortschritt('in_ueberarbeitung', fertigung).aktuell).toBe(2);
    expect(fortschritt('versendet', fertigung).aktuell).toBe(5);
    expect(fortschritt('geliefert', fertigung)).toMatchObject({ aktuell: 5, fertig: true });
    expect(fortschritt('freigegeben', design)).toMatchObject({ aktuell: 3, fertig: true });
    expect(fortschritt('entwurf', fertigung).aktuell).toBe(-1);
  });

  it('Einprobe ohne eigene Etappe zählt als Produktion', () => {
    expect(fortschritt('einprobe', fertigung).aktuell).toBe(3);
    expect(fortschritt('einprobe', { ...fertigung, einprobe: true }).aktuell).toBe(4);
  });

  it('Rückfrage und Storno bleiben auf der Etappe davor', () => {
    expect(fortschritt('rueckfrage', { ...fertigung, vorher: 'in_planung' }).aktuell).toBe(1);
    expect(fortschritt('rueckfrage', fertigung).aktuell).toBe(0);
    expect(fortschritt('storniert', { ...fertigung, vorher: 'in_planung' })).toMatchObject({ aktuell: 1, storniert: true });
  });

  it('Aktion nötig = needs_action in den Stammdaten', () => {
    expect([...AKTION_NOETIG].sort()).toEqual(PORTAL_STATUS.filter((s) => s.needsAction).map((s) => s.key).sort());
  });
});
