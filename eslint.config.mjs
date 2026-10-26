// بررسی خودکار کد (Spec فاز ۱، «pnpm lint همیشه سبز»): پیکربندی رسمی Next (core-web-vitals و TypeScript).
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react نسخهٔ React را با راهی پیدا می‌کند که در ESLint 10 دیگر نیست؛ پس نسخه همین‌جا
  { settings: { react: { version: '19.3' } } },
  // «_» در ابتدای نام یعنی عمداً استفاده نمی‌شود (مثلاً جدا کردن فیلدها با destructuring)
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  // CLAUDE.md قانون ۲: داده فقط از `lib/ai-safe.ts` به AI می‌رسد؛ کتابخانهٔ Anthropic جای دیگری import نمی‌شود
  {
    ignores: ['src/lib/ai-safe.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@anthropic-ai/*'], message: 'KI nur über src/lib/ai-safe.ts (CLAUDE.md, Regel 2).' }] }],
    },
  },
  globalIgnores(['.next/**', '.next-test/**', 'out/**', 'build/**', 'next-env.d.ts', 'data/**', 'DDL System.app/**']),
]);
