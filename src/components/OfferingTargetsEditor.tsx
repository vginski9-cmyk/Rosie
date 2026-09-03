"use client";

// ONE offering's enrollment and pipeline targets — the goal it covers, the
// enrollment it plans for in each term, and (optionally) its own health rates.
// Used on the goal page for every offering slot (before AND after lock-in) and
// on the offering page itself. Presentational: the parent decides where the
// values live (plan JSON before lock-in, the cohort afterwards).

import { useState } from "react";
import { RATE_DEFS, type LadderRates } from "@/lib/northstar";
import { deriveCohortTargets } from "@/lib/pipeline";

export interface OfferingTargets {
  /** Fully-productive placements this offering is responsible for. */
  goal: number;
  /** Per-term enrollment overrides (index 0 = term 1); null = derived from the goal. */
  termOverrides: (number | null)[];
  /** This offering's own health rates; missing keys fall back to the family defaults. */
  rates: Partial<LadderRates>;
}

const num = (v: number) => Math.round(v).toLocaleString();

export function effectiveRates(defaults: LadderRates, own: Partial<LadderRates> | undefined): LadderRates {
  return { ...defaults, ...(own ?? {}) };
}

export function OfferingTargetsEditor({ value, termNames, defaultRates, onChange, disabled = false, dense = false }: {
  value: OfferingTargets;
  /** One label per term, in order. */
  termNames: string[];
  defaultRates: LadderRates;
  onChange: (patch: Partial<OfferingTargets>) => void;
  disabled?: boolean;
  dense?: boolean;
}) {
  const [showRates, setShowRates] = useState(false);
  const rates = effectiveRates(defaultRates, value.rates);
  const ownRates = Object.keys(value.rates ?? {}).length > 0;
  const n = Math.max(1, termNames.length);
  const t = deriveCohortTargets(Math.max(0, value.goal), rates, n);
  const enrolled = (i: number) => value.termOverrides[i] ?? Math.round(t.terms[i] ?? t.terms[t.terms.length - 1] ?? 0);
  const inp = "rounded border border-slate-200 px-1.5 py-0.5 text-right tabular-nums focus:border-rose-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <div className={`space-y-2 ${dense ? "text-[11px]" : "text-xs"}`}>
      {/* Goal → derived funnel, this offering only */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="flex items-center gap-1.5">
          <span className="font-medium text-slate-700">covers</span>
          <input type="number" min={0} value={value.goal} disabled={disabled} onChange={(e) => onChange({ goal: Math.max(0, Number(e.target.value) || 0) })} className={`${inp} w-16 font-semibold`} />
          <span className="text-slate-500">productive</span>
        </label>
        <span className="tabular-nums text-slate-500">
          needs <strong className="text-slate-700">{num(t.interested)}</strong> interested · <strong className="text-slate-700">{num(t.qualified)}</strong> qualified · <strong className="text-slate-700">{num(t.offered)}</strong> offered · capacity <strong className="text-slate-700">{num(t.capacity)}</strong>
        </span>
        <span className="tabular-nums text-slate-500">
          → <strong className="text-slate-700">{num(t.completing)}</strong> completing · <strong className="text-slate-700">{num(t.licensed)}</strong> licensed · <strong className="text-slate-700">{num(t.placed)}</strong> placed
        </span>
        <button type="button" onClick={() => setShowRates((v) => !v)} className={`ml-auto rounded border px-2 py-0.5 ${ownRates ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`} title="this offering's own health rates (defaults come from the family)">
          {showRates ? "hide rates" : ownRates ? "own health rates ✓" : "health rates: family defaults"}
        </button>
      </div>

      {/* Enrollment per term — THIS offering's numbers, editable */}
      <div className="flex flex-wrap items-end gap-2">
        <span className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-500">Enrollment</span>
        {termNames.map((name, i) => {
          const ov = value.termOverrides[i] ?? null;
          return (
            <label key={i} className="block">
              <span className="block max-w-[7rem] truncate text-[10px] text-slate-400" title={name}>{name}</span>
              <input
                type="number" min={0} disabled={disabled}
                value={enrolled(i)}
                onChange={(e) => { const o = [...value.termOverrides]; while (o.length < n) o.push(null); o[i] = e.target.value === "" ? null : Math.max(0, Number(e.target.value)); onChange({ termOverrides: o }); }}
                className={`${inp} w-16 ${ov != null ? "border-rose-300 bg-rose-50 font-semibold text-rose-800" : "text-slate-700"}`}
                title={ov != null ? "set for this offering — clear to go back to the derived figure" : "derived from this offering's goal; type to set it"}
              />
            </label>
          );
        })}
        {value.termOverrides.some((v) => v != null) && !disabled && (
          <button type="button" onClick={() => onChange({ termOverrides: [] })} className="pb-1 text-[10px] text-slate-400 hover:text-rose-700">reset to derived</button>
        )}
        <span className="pb-1 text-[10px] text-slate-400">seats each term for this offering · term 1 is what the schedule and staffing math use</span>
      </div>

      {showRates && (
        <div className="rounded-lg border border-rose-100 bg-rose-50/40 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Health rates for this offering</span>
            {ownRates && !disabled && <button type="button" onClick={() => onChange({ rates: {} })} className="text-[10px] text-slate-500 hover:text-rose-700">use family defaults</button>}
          </div>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {RATE_DEFS.map((d) => (
              <label key={d.key} className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-600" title={d.of}>{d.label}</span>
                <span className="whitespace-nowrap">
                  <input type="number" step={1} disabled={disabled} value={Math.round(rates[d.key] * 1000) / 10} onChange={(e) => onChange({ rates: { ...value.rates, [d.key]: (Number(e.target.value) || 0) / 100 } })} className={`${inp} w-14 ${value.rates?.[d.key] != null ? "border-rose-300 bg-white font-semibold text-rose-800" : ""}`} />%
                  <span className="ml-1 text-[10px] text-slate-400">bench {Math.round(d.benchmark * 100)}%</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
