import type { NextRequest } from 'next/server';
import { ipVon } from '@/lib/anfrage';
import { logAudit } from '@/lib/audit';
import { versuchErlaubt } from '@/lib/auth/rate-limit';
import { eingangHochladen, eingangLesen } from '@/lib/ausgaben/eingang';
import { empfangsText, scanAntwortText } from '@/lib/ausgaben/scan-text';
import { zugangPruefen } from '@/lib/ausgaben/scan-zugang';
import { AppError } from '@/lib/errors';

/**
 * «Handy-Scanner»: der Kurzbefehl am iPhone schickt einen gescannten Beleg (PDF oder Foto) direkt nach »Zu prüfen«.
 * Anmeldung nur mit dem Schlüssel des Geräts (`Authorization: Bearer …`, Einstellungen → Handy-Scanner), nie mit dem
 * Cookie: darum ist keine Prüfung der Herkunft nötig, der Schlüssel wird vom Browser nie von selbst mitgeschickt.
 * Danach genau wie `api/ausgaben/eingang`. Die Antwort ist ein kurzer Satz, den der Kurzbefehl als Mitteilung zeigt.
 *
 * فقط روی host داخلی؛ هر IP حداکثر ۶۰ درخواست در ساعت (کلید ۲۵۶ بیتی است، این فقط برای جلوگیری از سیل درخواست است).
 */
const text = (status: number, satz: string) =>
  new Response(satz, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  if (req.headers.get('host') === process.env.PORTAL_HOST) return text(404, 'Nicht gefunden.');
  const ip = ipVon(req);
  if (!(await versuchErlaubt(`scan:${ip ?? 'unbekannt'}`, 60, 3600))) return text(429, 'Zu viele Versuche. Bitte später noch einmal.');
  const z = await zugangPruefen(req.headers.get('authorization'));
  if (!z) return text(401, 'Der Handy-Scanner ist nicht (mehr) freigeschaltet. Bitte im CRM unter Einstellungen → Handy-Scanner einen neuen Zugang anlegen.');

  const laenge = Number(req.headers.get('content-length'));
  const akteur = { id: z.userId, label: z.userName };
  // Für die Fehlersuche am iPhone: wie viel und was kam an (nur Größe, Typ und die ersten Bytes, nie der Inhalt)
  const empfangen = { bytes: 0, anfang: new Uint8Array(0) };
  const inhalt =
    req.body?.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(teil, weiter) {
          if (empfangen.anfang.length < 12) empfangen.anfang = Uint8Array.from([...empfangen.anfang, ...teil.subarray(0, 12 - empfangen.anfang.length)]);
          empfangen.bytes += teil.length;
          weiter.enqueue(teil);
        },
      }),
    ) ?? null;
  try {
    const e = await eingangHochladen(
      { name: req.nextUrl.searchParams.get('name'), laenge: req.headers.has('content-length') && Number.isFinite(laenge) ? laenge : null, inhalt },
      akteur,
    );
    await logAudit({
      aktion: 'beleg_eingang',
      akteur: { kind: 'staff', ...akteur },
      ziel: { typ: 'beleg_eingang', id: e.id },
      details: { datei: e.belegName, typ: e.belegTyp, groesse: e.belegGroesse, quelle: 'handy', zugang: z.name },
      ip,
    });
    const r = await eingangLesen(e.id);
    return text(201, scanAntwortText({ status: r.status, fehler: r.fehler, lieferant: r.vorschlag?.lieferant, brutto: r.vorschlag?.brutto, waehrung: r.vorschlag?.waehrung }));
  } catch (e) {
    if (e instanceof AppError) {
      if (!/^(Bitte ein Foto|Keine Datei)/.test(e.message)) return text(400, e.message);
      return text(400, `${e.message} ${empfangsText(empfangen.bytes, req.headers.get('content-type'), empfangen.anfang)}`);
    }
    throw e;
  }
}
