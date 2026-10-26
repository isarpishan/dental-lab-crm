'use client';

import { useEffect, useRef, useState } from 'react';
import { dateiPruefen, type Ablage } from '@/lib/dateien/regeln';

/**
 * آپلود فایل‌های سفارش در پس‌زمینه (Spec فاز ۱، D.۴): هر فایل جدا با XMLHttpRequest
 * (تنها راه نشان دادن پیشرفت آپلود در مرورگر)، مستقیم به `api/auftraege/[id]/dateien`.
 * کاربر در این فاصله فرم را ادامه می‌دهد؛ فقط ارسال سفارش منتظر می‌ماند.
 */

export type Upload = {
  schluessel: string;
  /** شناسهٔ `order_files` بعد از آپلود کامل. */
  id: string | null;
  platz: Ablage;
  name: string;
  groesse: number;
  /** ۰ تا ۱ */
  fortschritt: number;
  status: 'laeuft' | 'fertig' | 'fehler';
  fehler?: string;
};

export type UploadSteuerung = {
  liste: Upload[];
  laufend: number;
  maxBytes: number;
  hochladen: (platz: Ablage, dateien: File[]) => void;
  entfernen: (u: Upload) => Promise<void>;
  /** nur aus der Liste nehmen (z. B. nach dem Senden einer Nachricht), nicht löschen. */
  vergessen: (u: Upload) => void;
};

export function useUploads({
  entwurfId,
  start,
  maxBytes,
  entfernenAktion,
}: {
  entwurfId: string | null;
  start: { id: string; platz: Ablage; name: string; groesse: number }[];
  maxBytes: number;
  entfernenAktion: (id: string) => Promise<{ fehler?: string }>;
}): UploadSteuerung {
  const [liste, setListe] = useState<Upload[]>(() =>
    start.map((d) => ({ schluessel: d.id, id: d.id, platz: d.platz, name: d.name, groesse: d.groesse, fortschritt: 1, status: 'fertig' })),
  );
  const zaehler = useRef(0);
  const laeufe = useRef(new Map<string, XMLHttpRequest>());
  const laufend = liste.filter((u) => u.status === 'laeuft').length;

  // صفحه با آپلود نیمه‌کاره بسته نشود
  useEffect(() => {
    if (!laufend) return;
    const warnen = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [laufend]);

  const aendern = (schluessel: string, teil: Partial<Upload>) => setListe((alt) => alt.map((u) => (u.schluessel === schluessel ? { ...u, ...teil } : u)));

  function hochladen(platz: Ablage, dateien: File[]) {
    for (const datei of dateien) {
      const schluessel = `u${++zaehler.current}`;
      const p = dateiPruefen(datei.name, datei.size, maxBytes);
      const basis = { schluessel, id: null, platz, name: p.ok ? p.name : datei.name, groesse: datei.size, fortschritt: 0 };
      if (!p.ok || !entwurfId) {
        setListe((alt) => [...alt, { ...basis, status: 'fehler', fehler: p.ok ? 'Bitte zuerst einen Patienten wählen.' : p.fehler }]);
        continue;
      }
      setListe((alt) => [...alt, { ...basis, status: 'laeuft' }]);

      const xhr = new XMLHttpRequest();
      laeufe.current.set(schluessel, xhr);
      xhr.open('POST', `/api/auftraege/${entwurfId}/dateien?platz=${platz}&name=${encodeURIComponent(p.name)}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) aendern(schluessel, { fortschritt: e.loaded / e.total });
      };
      xhr.onload = () => {
        laeufe.current.delete(schluessel);
        let antwort: { id?: string; fehler?: string } = {};
        try {
          antwort = JSON.parse(xhr.responseText);
        } catch {
          // Antwort ohne JSON, z. B. vom Gateway
        }
        if (xhr.status === 201 && antwort.id) aendern(schluessel, { status: 'fertig', id: antwort.id, fortschritt: 1 });
        else aendern(schluessel, { status: 'fehler', fehler: antwort.fehler ?? 'Hochladen fehlgeschlagen. Bitte erneut versuchen.' });
      };
      xhr.onerror = () => {
        laeufe.current.delete(schluessel);
        aendern(schluessel, { status: 'fehler', fehler: 'Verbindung unterbrochen. Bitte erneut versuchen.' });
      };
      xhr.send(datei);
    }
  }

  async function entfernen(u: Upload) {
    if (u.status === 'laeuft') {
      laeufe.current.get(u.schluessel)?.abort();
      laeufe.current.delete(u.schluessel);
    } else if (u.status === 'fertig' && u.id) {
      const r = await entfernenAktion(u.id);
      if (r.fehler) {
        // die Datei ist noch gespeichert; nur die Meldung zeigen
        aendern(u.schluessel, { fehler: r.fehler });
        return;
      }
    }
    setListe((alt) => alt.filter((x) => x.schluessel !== u.schluessel));
  }

  const vergessen = (u: Upload) => setListe((alt) => alt.filter((x) => x.schluessel !== u.schluessel));

  return { liste, laufend, maxBytes, hochladen, entfernen, vergessen };
}
