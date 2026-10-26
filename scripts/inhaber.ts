/**
 * حساب Inhaber را می‌سازد (اگر نیست) و یک لینک یک‌بارمصرف برای ساختن رمز و
 * 2FA چاپ می‌کند. هیچ رمز پیش‌فرضی وجود ندارد.
 *   pnpm inhaber --email lab@drpishan.at --name "Isar Pishan"
 * اگر Inhaber هست ولی هنوز رمز ندارد (یا لینک گم شده)، لینک تازه می‌سازد.
 */
import { eq } from 'drizzle-orm';
import { db, dbSchliessen } from '@/db/client';
import { staffUsers } from '@/db/schema';
import { einladungErstellen, einladungsLink, EINLADUNG_STUNDEN } from '@/lib/auth/einladung';

function arg(name: string, standard: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
}

try {
  const email = arg('email', 'lab@drpishan.at').trim().toLowerCase();
  const name = arg('name', 'Inhaber').trim();
  const d = db();
  let [inhaber] = await d.select().from(staffUsers).where(eq(staffUsers.role, 'inhaber')).limit(1);
  if (inhaber?.passwordHash && !process.argv.includes('--neu')) {
    console.log(`Inhaber ${inhaber.email} ist bereits eingerichtet. Für einen neuen Einrichtungslink: pnpm inhaber --neu (auf dem Server: sudo ddl inhaber --neu)`);
  } else {
    if (!inhaber) {
      [inhaber] = await d.insert(staffUsers).values({ email, name, role: 'inhaber' }).returning();
      console.log(`✓ Inhaber angelegt: ${name} <${email}>`);
    }
    const token = await einladungErstellen('staff', inhaber.id);
    console.log(`\nEinrichtungslink (${EINLADUNG_STUNDEN} Stunden gültig, nur einmal verwendbar):\n\n  ${einladungsLink('staff', token)}\n`);
  }
} finally {
  await dbSchliessen();
}
