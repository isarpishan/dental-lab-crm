/** ترتیب‌های فهرست سفارش‌ها (بدون وابستگی به سرور، برای ابزار فهرست). */
export const SORTIERUNGEN = { geaendert: 'Zuletzt geändert', neueste: 'Neueste zuerst', liefertermin: 'Liefertermin' } as const;
export type Sortierung = keyof typeof SORTIERUNGEN;
