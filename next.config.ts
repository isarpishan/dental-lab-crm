import { existsSync, readFileSync } from 'node:fs';
import type { NextConfig } from 'next';

// نسخهٔ هر ساخت روی سرور (`docker/Dockerfile` فایل `.deployment-id` را با زمان ساخت می‌نویسد). با آن، تبی که پیش از
// به‌روزرسانی باز بوده با رفتن به صفحهٔ بعد کامل دوباره بار می‌شود، نه با CSS کهنه و صفحهٔ تازه (۲۵ اکتبر ۲۰۲۶).
// ساخت و `next start` همین فایل را می‌خوانند، پس مقدار یکی است. روی Mac (توسعه) فایل نیست ← بدون deploymentId.
const deploymentId = existsSync('.deployment-id') ? readFileSync('.deployment-id', 'utf8').trim() || undefined : undefined;

const config: NextConfig = {
  // دو برنامه روی یک کد: crm.<domain> و portal.<domain>.
  // تشخیص host بعداً در `src/proxy.ts` اضافه می‌شود (Spec فاز ۱، بخش B).
  poweredByHeader: false,
  deploymentId,
  // محیط جدای آزمون (`scripts/qa.mjs`) پوشهٔ ساخت خودش را دارد تا کنار برنامهٔ اصلی اجرا شود
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // `next dev` در غیر این صورت یک بلوک انگلیسی به CLAUDE.md اضافه می‌کند.
  // نکتهٔ مفیدش (خواندن docs همین نسخه) به فارسی در CLAUDE.md آمده است.
  agentRules: false,
};

export default config;
