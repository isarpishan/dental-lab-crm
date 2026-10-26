import { istEilig, TEMPO_KURZ, type Tempo } from '@/lib/katalog/tempo';

/**
 * تگ حاشیه‌دار مثل «STL / OBJ / PLY» در بخش Datentransfer سایت.
 * `rose` فقط برای «کاری از شما لازم است» (مثلاً Rückfrage)؛ بقیه خنثی (Spec، بخش E).
 */
export function Tag({ children, ton = 'rose', className = '' }: { children: React.ReactNode; ton?: 'rose' | 'neutral'; className?: string }) {
  const farbe = ton === 'rose' ? 'border-rose text-rose' : 'border-line-strong text-white';
  return <span className={`inline-grid h-[30px] min-w-[52px] place-items-center border px-2.5 text-[11px] ${farbe} ${className}`}>{children}</span>;
}

/** «Express» یا «Same-Day»؛ برای Standard هیچ. */
export function TempoTag({ tempo, className }: { tempo: Tempo; className?: string }) {
  return istEilig(tempo) ? (
    <Tag ton="neutral" className={className}>
      {TEMPO_KURZ[tempo]}
    </Tag>
  ) : null;
}
