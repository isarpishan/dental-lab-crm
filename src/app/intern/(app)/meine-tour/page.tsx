import { and, asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { Tagesplan } from '@/components/touren/Tagesplan';
import { Seitenkopf } from '@/components/ui/Seitenkopf';
import { db } from '@/db/client';
import { tours } from '@/db/schema';
import { mitarbeiterOderAnmelden } from '@/lib/auth/guard';
import { darf } from '@/lib/auth/roles';
import { heuteIso } from '@/lib/format';
import { naechsterTourTag, plusTage, tageText, tagKurz, tagLang } from '@/lib/touren/plan';
import { tagesplan } from '@/lib/touren/tag';
import { abgeholtMelden, zugestellt } from '../(einstellungen)/touren/actions';

export const metadata: Metadata = { title: 'Meine Tour · Digital Dental Lab' };

/**
 * «Meine Tour heute» (Spec فاز ۱، بخش I): برای گوشی راننده. فقط تورهایی که او راننده‌شان است،
 * به ترتیب مسیر؛ «Zugestellt» و «Abgeholt». بدون هیچ دادهٔ بیمار.
 */
export default async function MeineTour() {
  const { user } = await mitarbeiterOderAnmelden();
  if (!darf(user.role, 'touren.sehen')) return <Seitenkopf eyebrow="Meine Tour" titel="Kein Zugriff.">Diese Seite ist für Ihre Rolle nicht freigegeben.</Seitenkopf>;
  const heute = heuteIso();
  const [plan, meine] = await Promise.all([
    tagesplan(heute, user.id),
    db().select({ name: tours.name, tage: tours.weekdays }).from(tours).where(and(eq(tours.driverId, user.id), eq(tours.isActive, true))).orderBy(asc(tours.name)),
  ]);
  const stopps = plan.reduce((n, t) => n + t.stopps.length, 0);
  const naechste = meine
    .map((t) => ({ name: t.name, tag: naechsterTourTag(t.tage, plusTage(heute, 1)) }))
    .filter((t): t is { name: string; tag: string } => Boolean(t.tag))
    .sort((a, b) => a.tag.localeCompare(b.tag))[0];

  return (
    <div className="mx-auto max-w-[900px]">
      {/* وضعیت (بدون تور، تور بعدی) همیشه دیده می‌شود؛ فقط راهنمای کار پشت «i» است */}
      <Seitenkopf
        eyebrow={`Meine Tour · ${tagLang(heute)}`}
        titel={plan.length ? (stopps ? `${stopps} ${stopps === 1 ? 'Stopp' : 'Stopps'} heute.` : 'Heute nichts zu tun.') : 'Heute keine Tour.'}
        info={meine.length && plan.length ? 'Der Reihe nach anfahren. »Zugestellt« oder »Abgeholt« tippen, sobald es erledigt ist.' : undefined}
      >
        {!meine.length
          ? 'Ihnen ist noch keine Tour zugeordnet. Das Büro trägt Sie unter »Touren« als Fahrer ein.'
          : !plan.length && naechste
            ? `Nächste Tour: ${naechste.name}, ${tagKurz(naechste.tag)}. Ihre Touren: ${meine.map((t) => `${t.name} (${tageText(t.tage)})`).join(', ')}.`
            : null}
      </Seitenkopf>
      {plan.length ? <Tagesplan plan={plan} aktionen={{ zugestellt, abgeholt: abgeholtMelden }} /> : null}
    </div>
  );
}
