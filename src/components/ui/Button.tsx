import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'text';

/**
 * سه نوع دکمه، همه از سایت:
 * - primary: دکمهٔ قرصی گرم فرم «Zusammenarbeit» (`#c6ae94`، متن `#171913`). یکی در هر صفحه.
 * - secondary: حاشیهٔ rose مثل «Blog» در منوی سایت.
 * - text: متن با خط زیر و فلش، مثل «Arbeiten ansehen ↘».
 */
const styles: Record<Variant, string> = {
  primary:
    'rounded-[30px] bg-button px-[26px] py-[17px] text-button-ink transition-[filter] duration-[180ms] hover:brightness-105 disabled:cursor-wait disabled:opacity-50',
  secondary:
    'border border-rose px-3.5 py-[9px] text-[13px] text-white transition-colors duration-[180ms] hover:bg-rose/10 disabled:opacity-50',
  text: 'inline-flex items-center gap-[18px] border-b border-current pb-1.5 text-[13px] disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" {...props} className={`${styles[variant]} ${className}`} />;
}
