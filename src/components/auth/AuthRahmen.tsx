import { SiteHeader } from '@/components/ui/SiteHeader';

/** قاب صفحه‌های ورود: ستون باریک وسط، مثل صفحهٔ «Zusammenarbeit» سایت. */
export function AuthRahmen({ eyebrow, titel, children }: { eyebrow: string; titel: string; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="inhalt" className="page pb-28">
        <div className="mx-auto max-w-[520px] pt-20 max-[640px]:pt-12">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-5 text-[clamp(40px,5vw,64px)] font-light leading-[1]">{titel}</h1>
          <div className="mt-12">{children}</div>
        </div>
      </main>
    </>
  );
}
