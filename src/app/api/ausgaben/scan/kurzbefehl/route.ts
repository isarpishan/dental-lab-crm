import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonFehler } from '@/lib/anfrage';
import { bearbeiterFuerHost } from '@/lib/auth/bearbeiter';

/**
 * Den fertigen Kurzbefehl laden (Einstellungen → Handy-Scanner, am iPhone in Safari). Die Dateien sind auf dem Mac
 * gebaut und von Apple signiert (`scripts/kurzbefehl-bauen.mjs`), ohne Schlüssel: den fragt das iPhone beim
 * Hinzufügen. Trotzdem nur für angemeldete Benutzer mit `ausgaben.verwalten`.
 *
 * فایل‌ها در `src/lib/ausgaben/kurzbefehle/` (کل پوشهٔ برنامه در image هست؛ `docker/Dockerfile`).
 */
const DATEI = 'Beleg-scannen.shortcut';
const NAME = 'Beleg scannen.shortcut';

export async function GET() {
  const b = await bearbeiterFuerHost('ausgaben.verwalten');
  if (!b || b.seite !== 'labor') return jsonFehler(401, 'Bitte zuerst im CRM anmelden.');
  const inhalt = await readFile(path.join(process.cwd(), 'src/lib/ausgaben/kurzbefehle', DATEI));
  return new Response(new Uint8Array(inhalt), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${DATEI}"; filename*=UTF-8''${encodeURIComponent(NAME)}`,
      'Content-Length': String(inhalt.length),
      'Cache-Control': 'no-store',
    },
  });
}
