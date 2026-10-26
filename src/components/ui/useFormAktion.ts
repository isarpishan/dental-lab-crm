'use client';

import { startTransition, useActionState, useEffect, useRef, type FormEvent } from 'react';

/**
 * مثل `useActionState`، ولی فرم بعد از ارسال خالی نمی‌شود. React 19 فرمی را که با
 * `action={…}` فرستاده شود خودکار پاک می‌کند، حتی وقتی جواب یک پیام خطاست؛ آن وقت
 * کاربر همهٔ چیزهایی را که نوشته بود از دست می‌دهد. اینجا ارسال با `onSubmit` است.
 *
 * `zuruecksetzenBeiErfolg`: بعد از موفقیت پاک شود (مثلاً «Behandler hinzufügen»).
 */
export function useFormAktion<S>(
  aktion: (zustand: S, daten: FormData) => Promise<S>,
  start: S,
  { zuruecksetzenBeiErfolg = false } = {},
) {
  // S هرگز Promise نیست؛ پس Awaited<S> همان S است
  const [zustand, ausloesen, laeuft] = useActionState<S, FormData>(aktion as (z: Awaited<S>, d: FormData) => Promise<S>, start as Awaited<S>);
  const formular = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (zuruecksetzenBeiErfolg && (zustand as { erfolg?: string } | null)?.erfolg) formular.current?.reset();
  }, [zustand, zuruecksetzenBeiErfolg]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    formular.current = e.currentTarget;
    const daten = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => ausloesen(daten));
  }

  return [zustand, onSubmit, laeuft] as const;
}
