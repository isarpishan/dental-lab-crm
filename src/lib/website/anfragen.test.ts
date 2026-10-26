import { describe, expect, it } from 'vitest';
import { portalAnfragenAus, websiteVerbindung } from './anfragen';

const lead = (x: Record<string, unknown> = {}) => ({
  id: '0b6c1f3e-8a2d-4c5e-9f10-1a2b3c4d5e6f',
  created_at: Date.UTC(2026, 9, 4, 8, 30),
  request_type: 'portal',
  first_name: ' Anna ',
  last_name: 'Muster',
  email: 'anna@example.invalid',
  phone: '',
  status: 'new',
  ...x,
});

describe('Anfragen von der Website', () => {
  it('nur Praxisportal, gültige Felder, Telefon leer → null', () => {
    const r = portalAnfragenAus({ items: [lead(), lead({ id: '1b6c1f3e-8a2d-4c5e-9f10-1a2b3c4d5e6f', request_type: 'cooperation' })], hasMore: true });
    expect(r.anzahl).toBe(2);
    expect(r.weitere).toBe(true);
    expect(r.anfragen).toEqual([
      { id: '0b6c1f3e-8a2d-4c5e-9f10-1a2b3c4d5e6f', eingegangenAm: new Date(Date.UTC(2026, 9, 4, 8, 30)), vorname: 'Anna', nachname: 'Muster', email: 'anna@example.invalid', telefon: null, websiteStatus: 'new' },
    ]);
  });

  it('kaputte oder fremde Antworten werden ignoriert, nicht übernommen', () => {
    expect(portalAnfragenAus(null)).toEqual({ anfragen: [], weitere: false, anzahl: 0 });
    expect(portalAnfragenAus({ error: 'Nicht freigegeben.' }).anfragen).toEqual([]);
    const kaputt = [lead({ id: 'x' }), lead({ email: 'keine-adresse' }), lead({ created_at: 'gestern' }), 'text', null];
    expect(portalAnfragenAus({ items: kaputt }).anfragen).toEqual([]);
    expect(portalAnfragenAus({ items: [lead({ phone: '+43 1 234 56 78', status: 'closed' })] }).anfragen[0]).toMatchObject({ telefon: '+43 1 234 56 78', websiteStatus: 'closed' });
  });

  it('Verbindung nur mit Schlüssel; Adresse mit Standard', () => {
    expect(websiteVerbindung({})).toBeNull();
    expect(websiteVerbindung({ WEBSITE_ANFRAGEN_TOKEN: '  ' })).toBeNull();
    expect(websiteVerbindung({ WEBSITE_ANFRAGEN_TOKEN: 'abc' })).toEqual({ url: 'https://ddl-pishan.at/api/lab-leads', token: 'abc' });
    expect(websiteVerbindung({ WEBSITE_ANFRAGEN_TOKEN: 'abc', WEBSITE_ANFRAGEN_URL: 'http://127.0.0.1:3197/api/lab-leads' })?.url).toBe('http://127.0.0.1:3197/api/lab-leads');
  });
});
