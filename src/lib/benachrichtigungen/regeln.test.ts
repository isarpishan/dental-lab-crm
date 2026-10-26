import { describe, expect, it } from 'vitest';
import { BENACHRICHTIGUNGEN } from '@/db/schema';
import { STATUS, type Status } from '@/lib/orders/status';
import { BENACHRICHTIGUNG_NAMEN, ereignisFuerStatus, mitStandard, naechsteNachrichtMail } from './regeln';
import { benachrichtigungMail, type MailDaten } from './texte';

describe('ereignisFuerStatus', () => {
  it('Auftrag eingegangen: beim Absenden, auch mit »Daten werden nachgereicht«, von beiden Seiten', () => {
    expect(ereignisFuerStatus('entwurf', 'eingereicht', 'praxis')).toBe('auftrag_eingegangen');
    expect(ereignisFuerStatus('entwurf', 'rueckfrage', 'praxis')).toBe('auftrag_eingegangen');
    expect(ereignisFuerStatus('entwurf', 'eingereicht', 'labor')).toBe('auftrag_eingegangen');
  });
  it('Schritte des Labors, die die Ordination wissen muss', () => {
    expect(ereignisFuerStatus('in_planung', 'rueckfrage', 'labor')).toBe('rueckfrage');
    expect(ereignisFuerStatus('in_planung', 'design_freigabe', 'labor')).toBe('design_freigabe');
    expect(ereignisFuerStatus('in_ueberarbeitung', 'design_freigabe', 'labor')).toBe('design_freigabe');
    expect(ereignisFuerStatus('in_planung', 'freigegeben', 'labor')).toBe('design_freigabe');
    expect(ereignisFuerStatus('in_produktion', 'einprobe', 'labor')).toBe('einprobe');
    expect(ereignisFuerStatus('fertig', 'versendet', 'labor')).toBe('versendet');
  });
  it('was die Ordination selbst getan hat, bekommt sie nicht per E-Mail', () => {
    expect(ereignisFuerStatus('design_freigabe', 'freigegeben', 'praxis')).toBeNull();
    expect(ereignisFuerStatus('design_freigabe', 'in_produktion', 'praxis')).toBeNull();
    expect(ereignisFuerStatus('design_freigabe', 'in_ueberarbeitung', 'praxis')).toBeNull();
    expect(ereignisFuerStatus('rueckfrage', 'eingereicht', 'praxis')).toBeNull();
    expect(ereignisFuerStatus('eingereicht', 'storniert', 'praxis')).toBeNull();
  });
  it('interne Schritte ohne E-Mail', () => {
    for (const [von, nach] of [
      ['eingereicht', 'in_planung'],
      ['design_freigabe', 'in_produktion'],
      ['einprobe', 'in_produktion'],
      ['in_produktion', 'fertig'],
      ['fertig', 'in_produktion'],
      ['versendet', 'geliefert'],
      ['geliefert', 'abgeschlossen'],
    ] as [Status, Status][]) {
      expect(ereignisFuerStatus(von, nach, 'labor')).toBeNull();
    }
  });
  it('nur bekannte Ereignisse', () => {
    for (const von of STATUS) for (const nach of STATUS) for (const wer of ['praxis', 'labor'] as const) {
      const e = ereignisFuerStatus(von, nach, wer);
      if (e) expect(BENACHRICHTIGUNGEN).toContain(e);
    }
  });
});

describe('naechsteNachrichtMail (höchstens eine pro Auftrag in 15 Minuten)', () => {
  const jetzt = new Date('2026-10-02T10:00:00Z');
  it('erste Nachricht: sofort', () => {
    expect(naechsteNachrichtMail(undefined, jetzt)).toEqual(jetzt);
  });
  it('eine E-Mail wartet noch: sie zählt die neue Nachricht mit', () => {
    expect(naechsteNachrichtMail({ runAfter: new Date('2026-10-02T10:05:00Z'), status: 'wartend' }, jetzt)).toBeNull();
  });
  it('letzte E-Mail vor 5 Minuten: 10 Minuten warten', () => {
    expect(naechsteNachrichtMail({ runAfter: new Date('2026-10-02T09:55:00Z'), status: 'fertig' }, jetzt)).toEqual(new Date('2026-10-02T10:10:00Z'));
  });
  it('letzte E-Mail vor 20 Minuten: sofort', () => {
    expect(naechsteNachrichtMail({ runAfter: new Date('2026-10-02T09:40:00Z'), status: 'fertig' }, jetzt)).toEqual(jetzt);
  });
  it('läuft gerade: die nächste kommt 15 Minuten danach', () => {
    expect(naechsteNachrichtMail({ runAfter: new Date('2026-10-02T09:59:00Z'), status: 'laufend' }, jetzt)).toEqual(new Date('2026-10-02T10:14:00Z'));
  });
});

describe('mitStandard', () => {
  it('ohne Eintrag ist alles an; gespeicherte Werte gelten', () => {
    const w = mitStandard([{ eventKey: 'neue_nachricht', emailEnabled: false }], BENACHRICHTIGUNGEN);
    expect(w.neue_nachricht).toBe(false);
    expect(w.versendet).toBe(true);
    expect(Object.keys(w)).toEqual([...BENACHRICHTIGUNGEN]);
  });
  it('jedes Ereignis hat Namen und Erklärung', () => {
    expect(Object.keys(BENACHRICHTIGUNG_NAMEN)).toEqual([...BENACHRICHTIGUNGEN]);
  });
});

describe('benachrichtigungMail', () => {
  const basis: Omit<MailDaten, 'ereignis'> = {
    an: 'Dr. Muster',
    orderNo: 'A-2026-0042',
    patientCode: 'P-7K3Q',
    behandlung: 'Krone',
    lieferart: 'fertigung',
    ordination: 'Ordination <Test> & Co',
    link: 'http://portal.test/auftraege/x',
    einstellungenLink: 'http://portal.test/einstellungen',
    reklamation: { nr: 'RK-2026-0003', entscheidung: 'neuanfertigung', kostenlos: true, neuerAuftrag: 'A-2026-0050' },
  };
  it('jede E-Mail: Auftragsnummer, Patienten-ID, Knopf ins Portal, Hinweis auf Einstellungen', () => {
    for (const ereignis of BENACHRICHTIGUNGEN) {
      const m = benachrichtigungMail({ ...basis, ereignis });
      expect(m.betreff).toContain('A-2026-0042');
      for (const teil of [m.text, m.html]) {
        expect(teil).toContain('P-7K3Q');
        expect(teil).toContain('http://portal.test/auftraege/x');
        expect(teil).toContain('Einstellungen');
      }
      expect(m.html).toContain('Im Portal öffnen');
      expect(m.html).toContain('cid:ddl-mark');
    }
  });
  it('HTML wird maskiert', () => {
    const m = benachrichtigungMail({ ...basis, ereignis: 'versendet' });
    expect(m.html).toContain('Ordination &lt;Test&gt; &amp; Co');
    expect(m.html).not.toContain('<Test>');
  });
  it('Neuanfertigung: neue Nummer und »nicht berechnet«', () => {
    const m = benachrichtigungMail({ ...basis, ereignis: 'reklamation_entschieden' });
    expect(m.betreff).toBe('Reklamation RK-2026-0003 zu Auftrag A-2026-0042 entschieden');
    expect(m.text).toContain('A-2026-0050');
    expect(m.text).toContain('nicht berechnet');
  });
  it('Abgelehnt: die Begründung steht nur im Portal', () => {
    const m = benachrichtigungMail({ ...basis, ereignis: 'reklamation_entschieden', reklamation: { nr: 'RK-2026-0003', entscheidung: 'abgelehnt', kostenlos: null, neuerAuftrag: null } });
    expect(m.text).toContain('Begründung lesen Sie im Portal');
  });
  it('Neue Nachricht: Anzahl, aber kein Text', () => {
    expect(benachrichtigungMail({ ...basis, ereignis: 'neue_nachricht', ungelesen: 3 }).text).toContain('3 neue Nachrichten');
    expect(benachrichtigungMail({ ...basis, ereignis: 'neue_nachricht', ungelesen: 1 }).text).toContain('eine neue Nachricht');
  });
  it('Design: Version, und ohne Freigabe »fertig«', () => {
    expect(benachrichtigungMail({ ...basis, ereignis: 'design_freigabe', version: 2 }).text).toContain('Version 2');
    expect(benachrichtigungMail({ ...basis, ereignis: 'design_freigabe', ohneFreigabe: true }).betreff).toBe('Design fertig: Auftrag A-2026-0042');
  });
  it('Daten werden nachgereicht', () => {
    expect(benachrichtigungMail({ ...basis, ereignis: 'auftrag_eingegangen', nachreichen: true }).text).toContain('nachgereicht');
  });
});
