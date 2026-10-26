import { STAFF_ROLLEN } from '@/db/schema';
import { darf } from '@/lib/auth/roles';

/** Wer Produktionsschritte ausführen darf (für »Zuständig«). */
export const PRODUKTIONS_ROLLEN = STAFF_ROLLEN.filter((r) => darf(r, 'produktion.bearbeiten'));
