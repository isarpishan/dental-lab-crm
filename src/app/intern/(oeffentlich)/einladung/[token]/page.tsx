import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import QRCode from 'qrcode';
import { AuthRahmen } from '@/components/auth/AuthRahmen';
import { db } from '@/db/client';
import { staffUsers } from '@/db/schema';
import { einladungFinden } from '@/lib/auth/einladung';
import { ROLLEN_NAMEN } from '@/lib/auth/roles';
import { geheimnisErzeugen, inGruppen, otpauthUri } from '@/lib/auth/totp';
import { entschluesseln, verschluesseln } from '@/lib/crypto';
import { EinrichtungsFormular } from './EinrichtungsFormular';

export const metadata: Metadata = { title: 'Zugang einrichten · Digital Dental Lab', robots: { index: false } };

export default async function Einladung({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const einladung = await einladungFinden(token);
  const [u] = einladung?.userKind === 'staff' ? await db().select().from(staffUsers).where(eq(staffUsers.id, einladung.userId)).limit(1) : [];

  if (!einladung || !u) {
    return (
      <AuthRahmen eyebrow="Intern · Zugang" titel="Link nicht gültig.">
        <p className="text-[17px] font-light leading-relaxed text-paragraph">
          Dieser Link ist abgelaufen oder wurde bereits verwendet. Bitte bitten Sie den Inhaber um eine neue Einladung.
        </p>
      </AuthRahmen>
    );
  }

  // راز 2FA فقط یک بار ساخته می‌شود؛ با بارگذاری دوبارهٔ صفحه QR عوض نمی‌شود
  let geheimnis: string;
  if (u.totpSecretEnc && !u.totpEnabled) {
    geheimnis = entschluesseln(u.totpSecretEnc);
  } else {
    geheimnis = geheimnisErzeugen();
    await db().update(staffUsers).set({ totpSecretEnc: verschluesseln(geheimnis), totpEnabled: false }).where(eq(staffUsers.id, u.id));
  }
  const qr = await QRCode.toDataURL(otpauthUri(geheimnis, u.email), { margin: 2, width: 232, color: { dark: '#050505', light: '#ffffff' } });

  return (
    <AuthRahmen eyebrow="Intern · Zugang einrichten" titel={`Willkommen, ${u.name}.`}>
      <p className="text-[17px] font-light leading-relaxed text-paragraph">
        Ihr Zugang: <span className="text-white">{u.email}</span> · Rolle: <span className="text-white">{ROLLEN_NAMEN[u.role]}</span>
      </p>

      <ol className="mt-12 space-y-12">
        <li className="border-t border-line pt-6">
          <p className="text-[11px] text-rose">01</p>
          <h2 className="mt-2 text-[23px] font-light">Authenticator-App verbinden</h2>
          <p className="mt-3 text-[15px] font-light leading-relaxed text-muted">
            Scannen Sie den QR-Code mit einer Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator oder die Passwörter-App auf dem iPhone).
          </p>
          <div className="mt-6 flex flex-wrap items-end gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element -- QR als Daten-URL, wird nicht optimiert */}
            <img src={qr} alt="QR-Code für die Authenticator-App" width={232} height={232} className="rounded-[8px]" />
            <div className="text-[13px] text-muted">
              <p>Ohne Kamera: Schlüssel manuell eingeben</p>
              <p className="mt-2 font-medium tracking-[0.08em] text-white">{inGruppen(geheimnis)}</p>
            </div>
          </div>
        </li>
        <li className="border-t border-line pt-6">
          <p className="text-[11px] text-rose">02</p>
          <h2 className="mt-2 text-[23px] font-light">Passwort festlegen und Code bestätigen</h2>
          <div className="mt-8">
            <EinrichtungsFormular token={token} email={u.email} />
          </div>
        </li>
      </ol>
    </AuthRahmen>
  );
}
