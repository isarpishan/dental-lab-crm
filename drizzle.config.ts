import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// خواندن .env با خود Node، بدون کتابخانهٔ اضافه
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  schemaFilter: ['ddl'],
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
});
