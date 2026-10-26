import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * فیلدهای فرم مثل فرم «Zusammenarbeit» سایت: زمینهٔ #151713، حاشیهٔ #42453d،
 * شعاع 8px، padding 15px، برچسب 15px بالای فیلد.
 */
const FELD = 'mt-[9px] block w-full rounded-[8px] border border-field-line bg-field p-[15px] text-[16px] text-white placeholder:text-muted/70';

export function Feld({ label, hinweis, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hinweis?: string }) {
  return (
    <label className="block text-[15px]">
      {label}
      {props.required ? <span className="ml-1 text-rose" aria-hidden>*</span> : null}
      <input {...props} className={`${FELD} ${props.className ?? ''}`} />
      {hinweis ? <span className="mt-2 block text-[13px] text-muted">{hinweis}</span> : null}
    </label>
  );
}

export function Auswahl({
  label,
  optionen,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; optionen: { wert: string; label: string }[] }) {
  return (
    <label className="block text-[15px]">
      {label}
      {props.required ? <span className="ml-1 text-rose" aria-hidden>*</span> : null}
      <select {...props} className={`${FELD} auswahl pr-11 ${props.className ?? ''}`}>
        {optionen.map((o) => (
          <option key={o.wert} value={o.wert}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Textfeld({ label, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block text-[15px]">
      {label}
      {props.required ? <span className="ml-1 text-rose" aria-hidden>*</span> : null}
      <textarea rows={4} {...props} className={`${FELD} resize-y ${props.className ?? ''}`} />
    </label>
  );
}

/** پیام کنار دکمه: خطا با «!» rose، موفقیت در کادر با حاشیهٔ زیتونی مثل `#success` سایت. */
export function Meldung({ art, children }: { art: 'fehler' | 'erfolg'; children: React.ReactNode }) {
  return art === 'fehler' ? (
    <p role="alert" className="text-[15px]">
      <span className="mr-2 font-medium text-rose" aria-hidden>
        !
      </span>
      {children}
    </p>
  ) : (
    <div role="status" className="rounded-[12px] border border-success-line p-5 text-[15px]">
      {children}
    </div>
  );
}
