import 'server-only';
import { renderToBuffer } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import { createElement } from 'react';
import { db } from '@/db/client';
import { documents, type DokumentArt } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { heuteIso } from '@/lib/format';
import { belegnummer, naechsteNummer } from '@/lib/nummern';
import { KonformitaetPdf } from '@/lib/pdf/konformitaet';
import { LieferscheinPdf } from '@/lib/pdf/lieferschein';
import { ausPuffer, loeschen, speichern } from '@/lib/storage';
import { ausstellerLaden } from './aussteller';
import { dokumentDaten } from './daten';

/**
 * صدور اسناد (CLAUDE.md، قانون ۶؛ Spec فاز ۱، بخش K). داخل **همان تراکنشی** صدا زده می‌شود که کار
 * را به «Übergabe» (`versendet`) می‌برد: اگر ساختن سند شکست بخورد، کار هم جلو نمی‌رود. پس هیچ
 * «Fertige Arbeit» بدون Konformitätserklärung و Lieferschein از لابراتوار بیرون نمی‌رود.
 *
 * چرا در `versendet` و نه `fertig` (Spec می‌گفت `fertig`): در این سیستم «Fertig» یعنی کار در
 * Qualitätskontrolle است. اعلام انطباق فقط بعد از قبول‌شدن QK درست است؛ و اگر QK رد شود و کار به
 * تولید برگردد، سندِ غیرقابل‌تغییرِ صادرشده دیگر درست نبود.
 *
 * شماره‌ها از `number_sequences` در همین تراکنش؛ اگر تراکنش برگردد، شماره هم مصرف نمی‌شود.
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

const pdf = (el: unknown) => renderToBuffer(el as Parameters<typeof renderToBuffer>[0]);

export async function dokumenteAusstellen(tx: Tx, orderId: string, akteur: { id: string; label: string }): Promise<string[]> {
  const vorhanden = await tx.select({ kind: documents.kind, docNo: documents.docNo }).from(documents).where(eq(documents.orderId, orderId));
  const nr = (art: DokumentArt) => vorhanden.find((v) => v.kind === art)?.docNo ?? null;
  if (nr('konformitaet') && nr('lieferschein')) return [];

  const [d, aussteller] = await Promise.all([dokumentDaten(orderId), ausstellerLaden()]);
  if (!d) throw new AppError('Auftrag nicht gefunden.');
  const am = new Date();
  const jahr = Number(heuteIso(am).slice(0, 4));
  const dateien: string[] = [];
  const neu: string[] = [];

  async function ablegen(art: DokumentArt, docNo: string, inhalt: Buffer) {
    const f = await speichern(ausPuffer(new Uint8Array(inhalt)), 20 * 1024 * 1024);
    dateien.push(f.key);
    await tx.insert(documents).values({ orderId, kind: art, docNo, storageKey: f.key, sha256: f.sha256, size: f.groesse, issuedAt: am, issuedBy: akteur.id, issuedByLabel: akteur.label });
    neu.push(docNo);
  }

  try {
    let ke = nr('konformitaet');
    if (!ke) {
      ke = belegnummer('KE', jahr, await naechsteNummer(tx, 'konformitaet', jahr));
      await ablegen('konformitaet', ke, await pdf(createElement(KonformitaetPdf, { d, aussteller, nr: ke, am, freigabe: akteur.label })));
    }
    if (!nr('lieferschein')) {
      const ls = belegnummer('LS', jahr, await naechsteNummer(tx, 'lieferschein', jahr));
      await ablegen('lieferschein', ls, await pdf(createElement(LieferscheinPdf, { d, aussteller, nr: ls, am, konformitaet: ke })));
    }
  } catch (e) {
    // die Datenbank rollt zurück; die schon geschriebenen Dateien auch
    for (const k of dateien) await loeschen(k);
    throw e;
  }
  return neu;
}
