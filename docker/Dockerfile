# image برنامهٔ DDL برای سرور لابراتوار (قدم ۱۳). یک image برای همه: برنامه (`next start`)،
# worker و کارهای نگهداری (migration، Stammdaten، Inhaber، ایمیل هشدار). روی خود سرور
# ساخته می‌شود (`ddl aktualisieren`)، پس همان معماری سرور را دارد.
#
# وابستگی‌های توسعه هم نصب می‌مانند، چون worker و اسکریپت‌ها با tsx و migrationها با
# drizzle-kit اجرا می‌شوند؛ دقیقاً همان راهی که روی Mac آزموده شده است.
FROM node:26-alpine

RUN apk add --no-cache tzdata && npm install -g pnpm@12.5.1 && npm cache clean --force
ENV TZ=Europe/Vienna NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# `next start` در .next/cache می‌نویسد؛ برنامه با کاربر بی‌امتیاز `node` اجرا می‌شود
# نسخهٔ این ساخت برای `deploymentId` در next.config.ts (تب کهنه بعد از به‌روزرسانی کامل دوباره بار می‌شود)
RUN date -u +%Y%m%d%H%M%S > .deployment-id && pnpm build && chown -R node:node .next

ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "--port", "3000"]
