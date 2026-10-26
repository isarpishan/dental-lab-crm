import { and, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { portalAnfragen, settings } from '@/db/schema';
import { AppError } from '@/lib/errors';

/**
 * درخواست‌های «Praxisportal-Zugang» از فرم تماس سایت (خواستهٔ کاربر، ۴ اکتبر ۲۰۲۶: تا حالا فقط در صفحهٔ
 * Evaluation سایت دیده می‌شدند). worker هر چند دقیقه از `/api/lab-leads` سایت می‌خواند؛ همان رابط سرور به
 * سرور که پنل محلی قدیمی داشت، با کلید `history-connection` سایت (روی سرور: `ddl website`). سایت عوض
 * نمی‌شود. وضعیت از CRM به سایت هم برمی‌گردد («contacted» بعد از Einladung، «closed» با «Erledigt»).
 * بدون `server-only`، چون worker آن را می‌خواند.
 */

export type WebsiteVerbindung = { url: string; token: string };

export function websiteVerbindung(env: Record<string, string | undefined> = process.env): WebsiteVerbindung | null {
  const token = env.WEBSITE_ANFRAGEN_TOKEN?.trim();
  if (!token) return null;
  return { url: env.WEBSITE_ANFRAGEN_URL?.trim() || 'https://ddl-pishan.at/api/lab-leads', token };
}

export type WebsiteAnfrage = { id: string; eingegangenAm: Date; vorname: string; nachname: string; email: string; telefon: string | null; websiteStatus: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** یک صفحه از پاسخ سایت ← فقط درخواست‌های پورتال که معتبرند؛ بقیه (Zusammenarbeit، دادهٔ ناقص) کنار می‌روند. */
export function portalAnfragenAus(antwort: unknown): { anfragen: WebsiteAnfrage[]; weitere: boolean; anzahl: number } {
  const a = antwort && typeof antwort === 'object' ? (antwort as { items?: unknown; hasMore?: unknown }) : {};
  const items = Array.isArray(a.items) ? a.items : [];
  const anfragen = items.flatMap((x): WebsiteAnfrage[] => {
    if (!x || typeof x !== 'object') return [];
    const r = x as Record<string, unknown>;
    const email = text(r.email, 254);
    const am = typeof r.created_at === 'number' ? new Date(r.created_at) : new Date(NaN);
    if (r.request_type !== 'portal' || typeof r.id !== 'string' || !UUID.test(r.id) || !email.includes('@') || Number.isNaN(am.getTime())) return [];
    return [{ id: r.id.toLowerCase(), eingegangenAm: am, vorname: text(r.first_name, 80), nachname: text(r.last_name, 80), email, telefon: text(r.phone, 35) || null, websiteStatus: text(r.status, 20) || 'new' }];
  });
  return { anfragen, weitere: a.hasMore === true, anzahl: items.length };
}

type Abruf = typeof fetch;

async function seite(v: WebsiteVerbindung, offset: number, abruf: Abruf) {
  const url = new URL(v.url);
  // die Suche der Website grenzt auf «portal» ein (Anliegen, Name oder E-Mail); genau gefiltert wird oben
  url.searchParams.set('q', 'portal');
  url.searchParams.set('offset', String(offset));
  const r = await abruf(url, { headers: { Authorization: `Bearer ${v.token}` }, signal: AbortSignal.timeout(15_000), redirect: 'error' });
  if (r.status === 401) throw new AppError('Die Website hat den Schlüssel nicht angenommen. Bitte auf dem Server »ddl website« ausführen.');
  if (!r.ok) throw new Error(`Die Website antwortet mit ${r.status}.`);
  return portalAnfragenAus(await r.json());
}

const AUFBEWAHRUNG_TAGE = 180;
const MAX_SEITEN = 20;

/**
 * همهٔ درخواست‌های پورتال را می‌خواند و ذخیره می‌کند:
 * - تازه‌ها با وضعیت «neu»، فقط اگر روی سایت هنوز «new» باشند.
 * - اگر روی سایت کسی رسیدگی کرد («contacted»/«closed») یا پاکش کرد، در CRM هم «erledigt».
 * - ۱۸۰ روز بعد از ورود پاک می‌شوند، مثل خود سایت.
 * نتیجه در `settings.website_abruf` برای نمایش در CRM («zuletzt abgerufen»، یا خطا).
 */
export async function anfragenAbrufen(abruf: Abruf = fetch): Promise<{ neu: number; offen: number } | null> {
  const v = websiteVerbindung();
  if (!v) return null;
  try {
    const alle: WebsiteAnfrage[] = [];
    let vollstaendig = false;
    for (let i = 0, offset = 0; i < MAX_SEITEN; i++) {
      const s = await seite(v, offset, abruf);
      alle.push(...s.anfragen);
      offset += s.anzahl;
      if (!s.weitere || !s.anzahl) {
        vollstaendig = true;
        break;
      }
    }
    const ids = alle.map((a) => a.id);
    const bekannt = new Set(ids.length ? (await db().select({ id: portalAnfragen.id }).from(portalAnfragen).where(inArray(portalAnfragen.id, ids))).map((z) => z.id) : []);
    const zeilen = alle.filter((a) => bekannt.has(a.id) || a.websiteStatus === 'new');
    const neu = zeilen.filter((a) => !bekannt.has(a.id)).length;
    // auf der Website schon bearbeitet: in CRM erledigt, wenn hier noch offen
    const vonWebsite = sql`${portalAnfragen.status} = 'neu' and excluded.website_status <> 'new'`;
    if (zeilen.length) {
      await db()
        .insert(portalAnfragen)
        .values(zeilen)
        .onConflictDoUpdate({
          target: portalAnfragen.id,
          set: {
            websiteStatus: sql`excluded.website_status`,
            abgerufenAm: sql`now()`,
            status: sql`case when ${vonWebsite} then 'erledigt' else ${portalAnfragen.status} end`,
            erledigtAm: sql`case when ${vonWebsite} then now() else ${portalAnfragen.erledigtAm} end`,
            erledigtVonLabel: sql`case when ${vonWebsite} then 'Website (Evaluation)' else ${portalAnfragen.erledigtVonLabel} end`,
          },
        });
    }
    // auf der Website gelöscht (nur sicher, wenn alle Seiten gelesen wurden)
    if (vollstaendig) {
      await db()
        .update(portalAnfragen)
        .set({ status: 'erledigt', erledigtAm: new Date(), erledigtVonLabel: 'Auf der Website gelöscht' })
        .where(and(eq(portalAnfragen.status, 'neu'), ids.length ? notInArray(portalAnfragen.id, ids) : undefined));
    }
    await db()
      .delete(portalAnfragen)
      .where(lt(portalAnfragen.eingegangenAm, new Date(Date.now() - AUFBEWAHRUNG_TAGE * 86_400_000)));
    const [{ offen }] = await db().select({ offen: sql<number>`count(*)::int` }).from(portalAnfragen).where(eq(portalAnfragen.status, 'neu'));
    await abrufMerken({ am: new Date().toISOString(), ok: true, neu });
    return { neu, offen };
  } catch (e) {
    await abrufMerken({ am: new Date().toISOString(), ok: false, fehler: e instanceof AppError ? e.message : 'Die Website war nicht erreichbar.' }).catch(() => {});
    throw e;
  }
}

export type AbrufStand = { am: string; ok: boolean; neu?: number; fehler?: string };

async function abrufMerken(wert: AbrufStand) {
  await db()
    .insert(settings)
    .values({ key: 'website_abruf', value: wert })
    .onConflictDoUpdate({ target: settings.key, set: { value: wert, updatedAt: new Date() } });
}

/** کار صف: وضعیت را روی سایت هم عوض می‌کند (صفحهٔ Evaluation). درخواستی که سایت دیگر ندارد، مهم نیست. */
export async function anfrageStatusMelden(payload: unknown, abruf: Abruf = fetch): Promise<{ id: string; status: string; gemeldet: boolean }> {
  const p = payload as { id?: unknown; status?: unknown };
  if (typeof p?.id !== 'string' || !UUID.test(p.id) || (p.status !== 'contacted' && p.status !== 'closed')) throw new AppError('Ungültiger Auftrag für die Website.');
  const v = websiteVerbindung();
  if (!v) throw new AppError('Keine Verbindung zur Website eingerichtet (ddl website).');
  const url = new URL(v.url);
  url.searchParams.set('id', p.id);
  const r = await abruf(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${v.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: p.status }),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (r.status === 404) return { id: p.id, status: p.status, gemeldet: false };
  if (r.status === 401) throw new AppError('Die Website hat den Schlüssel nicht angenommen. Bitte auf dem Server »ddl website« ausführen.');
  if (!r.ok) throw new Error(`Die Website antwortet mit ${r.status}.`);
  return { id: p.id, status: p.status, gemeldet: true };
}
