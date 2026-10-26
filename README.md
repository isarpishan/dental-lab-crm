# Dental Lab CRM

Internal system of **Digital Dental Lab** (Vienna, Austria): order management, production,
billing and a portal for dental practices ("Ordinationen").

*Laborsoftware für ein digitales Zahntechnik-Labor in Österreich: Aufträge, Produktion,
Abrechnung und ein Portal für Ordinationen. Oberfläche auf Deutsch (de-AT).*

## What it does

- **Internal app** (`crm.<domain>`) for lab staff
  - orders with 3D view, design approval, questions to the practice, delivery dates
  - production steps, job sheets (PDF with QR code), tablet view for technicians
  - materials and batches, declaration of conformity and delivery note (immutable)
  - complaints / warranty, calendar, delivery tours with a driver view
  - billing: invoices, credit notes, cancellations, payments, reminders, Excel export
  - expenses with receipt reading by Claude, bank statement import, tax estimate
- **Portal** (`portal.<domain>`) for dental practices
  - place orders, upload scans, approve designs, request pick-ups, see invoices

## Built for Austria

- UI only in Austrian German (`de-AT`), amounts as `€ 1.234,50`
- invoices without VAT (§ 6 Abs. 1 Z 20 UStG) – adjust if your business is different
- tax estimate uses Austrian income tax and SVS values (`src/lib/steuer/werte.ts`)

Nothing in this project is legal or tax advice.

## Privacy by design (GDPR Art. 9)

- patient names are stored encrypted only (`src/lib/crypto.ts`)
- job sheets and e-mails show a patient code, never the name
- every view or download of patient data is logged
- no patient data is sent to an AI service; the only AI path is `src/lib/ai-safe.ts`
- practices are strictly separated; the practice id always comes from the session

## Stack

Next.js 16, React 19, TypeScript, PostgreSQL with Drizzle, Tailwind CSS,
`@react-pdf/renderer`, three.js, nodemailer. Auth, encryption and TOTP use `node:crypto`.

## Getting started (development)

Requirements: Node.js 24, pnpm, Docker.

```bash
pnpm install
cp .env.example .env          # fill in DATA_ENCRYPTION_KEY and APP_SECRET:
                              # openssl rand -base64 32
pnpm db:up                    # PostgreSQL + Mailpit in Docker
pnpm db:migrate
pnpm seed                     # master data (add --demo for demo data, test DB only)
pnpm inhaber --email you@example.com --name "Your Name"   # owner account + one-time link
pnpm dev -p 3100              # http://crm.localhost:3100 and http://portal.localhost:3100
pnpm worker                   # e-mail queue and background jobs (second terminal)
```

Test e-mails appear in Mailpit at http://localhost:8025.

Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm qa` (browser tests in a separate test database).

**Before real use:** replace the lab's name, address and bank details in
`src/lib/katalog/stammdaten.ts` and `src/lib/dokumente/aussteller-werte.ts` (or in the app under
"Einstellungen"), the e-mail address `lab@drpishan.at`, the logo and the photos.
Code comments and project notes are partly in Persian.

## Not included

Server setup, backups, network and deployment scripts of the lab are not part of this
repository. Never commit `.env` or the `data/` folder.

## License

MIT – free to use, change and share. **No warranty and no liability**: you use this
software at your own risk. See [LICENSE](LICENSE).

Not covered by the license: the name "Digital Dental Lab", the DDL logo (`brand/`,
`public/**/ddl-mark.png`) and the product photos (`public/bilder/`). Replace them with your own.

