import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { AuthRahmen } from '@/components/auth/AuthRahmen';
import { db } from '@/db/client';
import { practices, practiceUsers } from '@/db/schema';
import { einladungFinden } from '@/lib/auth/einladung';
import { PortalEinrichtungsFormular } from './EinrichtungsFormular';

export const metadata: Metadata = { title: 'Zugang einrichten · Portal · Digital Dental Lab', robots: { index: false } };

export default async function PortalEinladung({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const einladung = await einladungFinden(token);
  const [z] =
    einladung?.userKind === 'practice'
      ? await db()
          .select({ u: practiceUsers, ordination: practices.name })
          .from(practiceUsers)
          .innerJoin(practices, eq(practices.id, practiceUsers.practiceId))
          .where(eq(practiceUsers.id, einladung.userId))
          .limit(1)
      : [];

  if (!einladung || !z || !z.u.isActive) {
    return (
      <AuthRahmen eyebrow="Portal · Zugang" titel="Link nicht gültig.">
        <p className="text-[17px] font-light leading-relaxed text-paragraph">
          Dieser Link ist abgelaufen oder wurde bereits verwendet. Schreiben Sie uns an{' '}
          <a href="mailto:lab@drpishan.at" className="border-b border-rose text-white">
            lab@drpishan.at
          </a>
          , wir senden Ihnen gern einen neuen.
        </p>
      </AuthRahmen>
    );
  }

  return (
    <AuthRahmen eyebrow="Portal · Zugang einrichten" titel={`Willkommen, ${z.u.name}.`}>
      <p className="text-[17px] font-light leading-relaxed text-paragraph">
        Ihr Zugang für <span className="text-white">{z.ordination}</span>: <span className="text-white">{z.u.email}</span>. Legen Sie jetzt Ihr Passwort fest.
      </p>
      <div className="mt-10 border-t border-line pt-8">
        <PortalEinrichtungsFormular token={token} email={z.u.email} />
      </div>
    </AuthRahmen>
  );
}
