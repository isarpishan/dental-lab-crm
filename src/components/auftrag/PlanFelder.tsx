'use client';

import { Auswahl, Feld, Textfeld } from '@/components/ui/Formular';
import type { BehandlerOption } from '@/lib/orders/entwurf';
import type { Plan } from '@/lib/orders/pruefung';

/**
 * قدم «Hinweise»: Behandler (لازم برای Konformitätserklärung، اگر Ordination Behandler
 * دارد)، Wunschtermin و Behandlungsplan. بقیه اختیاری است.
 */
export function PlanFelder({
  plan,
  onChange,
  behandler,
  heute,
}: {
  plan: Plan;
  onChange: (neu: Plan) => void;
  behandler: BehandlerOption[];
  heute: string;
}) {
  return (
    <div className="grid max-w-[760px] grid-cols-1 gap-x-6 gap-y-7 md:grid-cols-2">
      {behandler.length > 1 ? (
        <Auswahl
          label="Behandler"
          required
          value={plan.behandlerId ?? ''}
          onChange={(e) => onChange({ ...plan, behandlerId: e.target.value || null })}
          optionen={[{ wert: '', label: 'Bitte wählen' }, ...behandler.map((b) => ({ wert: b.id, label: b.name }))]}
        />
      ) : behandler.length === 1 ? (
        <p className="text-[15px]">
          Behandler
          <span className="mt-[9px] block py-[15px] text-[16px] font-light text-muted">{behandler[0].name}</span>
        </p>
      ) : null}
      <Feld
        label="Wunschtermin"
        type="date"
        min={heute}
        hinweis="Optional"
        value={plan.wunschtermin ?? ''}
        onChange={(e) => onChange({ ...plan, wunschtermin: e.target.value || null })}
      />
      <div className="md:col-span-2">
        <Textfeld
          label="Behandlungsplan und Hinweise"
          placeholder="Zum Beispiel Präparationsgrenze, Platzverhältnisse, besondere Wünsche"
          maxLength={4000}
          value={plan.text}
          onChange={(e) => onChange({ ...plan, text: e.target.value })}
        />
        <p className="mt-2 text-[13px] text-muted">Fehlende Angaben können die Bearbeitung verzögern.</p>
      </div>
    </div>
  );
}
