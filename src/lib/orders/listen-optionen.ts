import { PORTAL_STATUS } from '@/lib/katalog/stammdaten';
import { SORTIERUNGEN } from './listen-text';

/** گزینه‌های ابزار فهرست، مشترک بین پورتال و پنل داخلی. */
export function filterOptionen(behandlungen: { key: string; name: string }[], seite: 'praxis' | 'labor') {
  return [
    { name: 'behandlung', label: 'Behandlung', optionen: [{ wert: '', label: 'Alle Behandlungen' }, ...behandlungen.map((b) => ({ wert: b.key, label: b.name }))] },
    {
      name: 'status',
      label: 'Status',
      optionen: [
        { wert: '', label: 'Alle' },
        { wert: 'aktion', label: seite === 'praxis' ? 'Ihre Aktion erforderlich' : 'Neue Nachrichten' },
        { wert: 'offen', label: 'Offen' },
        ...PORTAL_STATUS.filter((s) => s.key !== 'entwurf' || seite === 'praxis').map((s) => ({ wert: s.key, label: s.key === 'entwurf' ? 'Entwürfe' : s.label })),
      ],
    },
    { name: 'sortierung', label: 'Sortierung', optionen: Object.entries(SORTIERUNGEN).map(([wert, label]) => ({ wert, label })) },
  ];
}
