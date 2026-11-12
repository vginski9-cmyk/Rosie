"use client";

// ONE offering's plan in counts — the eight pipeline stages as numbers (interested … fully productive), the enrollment
// it plans for in each later term. Type any stage and it stands; the rows left alone derive from the family's default
// rates, and the percent each count implies shows under it. Used on the goal page for every offering slot (before AND
// after lock-in) and on the offering page itself. Presentational: the parent decides where the values live (plan JSON
// before lock-in, the cohort afterwards).

import type { LadderRates } from "@/lib/northstar";
import { PLAN_STAGES, PLAN_STAGE_LABELS, PLAN_STAGE_RATE, fixedStages, solveLadder, type PlanStageKey, type PlannedCounts } from "@/lib/pipelinecounts";
import { fmt } from "@/lib/format";

export interface OfferingTargets {
  /** Fully-productive placements this offering is responsible for — the ladder's last row. */
  goal: number;
  /** Per-term enrollment overrides (index 0 = term 1, which the enrolled count sets); null = derived. */
  termOverrides: (number | null)[];
  /** Own health rates saved by an earlier plan; missing keys fall back to the family defaults. New edits never set these. */
  rates: Partial<LadderRates>;
  /** The counts typed for this offering, by stage; every other stage derives. */
  counts: PlannedCounts;
}

/** Seats a term must hold: a count that must be met, so it rounds up. */
export const seatsNeeded = (v: number) => Math.max(0, Math.ceil(v - 1e-9));

export function effectiveRates(defaults: LadderRates, own: Partial<LadderRates> | undefined): LadderRates {
  return { ...defaults, ...(own ?? {}) };
}

/** A multiple of the seats ("1.50×", "1.25×"). */
const times = (v: number) => `${fmt.mult(v)}×`;
/** What the box under a count says: the rate the count implies, in words. */
function captionOf(k: PlanStageKey, rates: LadderRates, defaults: LadderRates, capacity: number): { text: string; own: boolean } {
  const r = PLAN_STAGE_RATE[k];
  const v = rates[r.key]; const d = defaults[r.key];
  const own = Math.abs(v - d) > 0.0005;
  if (k === "enrolled") return { text: own ? `${fmt.pct(v)} of ${fmt.num(capacity)} seats` : "term-1 seats", own };
  const i = PLAN_STAGES.indexOf(k);
  const text = r.anchor === "chain" ? `${fmt.pct(v)} of ${PLAN_STAGE_LABELS[PLAN_STAGES[i - 1]]}` : `${times(v)} the seats`;
  return { text: own ? `${text} · family ${r.anchor === "chain" ? fmt.pct(d) : times(d)}` : text, own };
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
  const rates = effectiveRates(defaultRates, value.rates);
  const n = Math.max(1, termNames.length);
  const counts = value.counts ?? {};
  const solved = solveLadder({ goal: Math.max(0, value.goal), rates, counts, numTerms: n });
  const typed = new Set(solved.fixed);
  const inp = "rounded border border-slate-200 px-1.5 py-0.5 text-right tabular-nums focus:border-rose-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400";
  /** A typed or cleared count: the ladder re-solves and the goal (fully productive) follows it. */
  const setCount = (k: PlanStageKey, raw: string) => {
    const next: PlannedCounts = { ...counts };
    if (raw === "") delete next[k]; else next[k] = Math.max(0, Number(raw) || 0);
    const s = solveLadder({ goal: Math.max(0, value.goal), rates, counts: next, numTerms: n });
    onChange({ counts: next, goal: fixedStages(next).length ? s.goal : value.goal });
  };
  const laterTerm = (i: number) => value.termOverrides[i] ?? seatsNeeded(solved.terms[i] ?? solved.terms[solved.terms.length - 1] ?? 0);
  const ownRates = Object.keys(value.rates ?? {}).length > 0;

  return (
    <div className={`space-y-2 ${dense ? "text-[11px]" : "text-xs"}`}>
      {/* The ladder in counts: type any stage, the rest derive from the family's rates */}
      <div className="flex flex-wrap items-end gap-x-2 gap-y-1.5">
        <span className="pb-4 text-[10px] font-semibold uppercase tracking-wide text-rose-500">Plan</span>
        {PLAN_STAGES.map((k, i) => {
          const isTyped = typed.has(k);
          const v = solved.ladder[k];
          const cap = captionOf(k, solved.rates, defaultRates, solved.capacity);
          return (
            <div key={k} className="flex items-end gap-1">
              {i > 0 && <span className="pb-4 text-slate-300">→</span>}
              <label className="block">
                <span className="block whitespace-nowrap text-[10px] text-slate-500">{PLAN_STAGE_LABELS[k]}</span>
                <input
                  type="number" min={0} step="any" disabled={disabled}
                  aria-label={`${PLAN_STAGE_LABELS[k]} — planned count`}
                  value={isTyped ? (counts[k] as number) : seatsNeeded(v)}
                  onChange={(e) => setCount(k, e.target.value)}
                  className={`${inp} w-16 ${isTyped ? "border-rose-300 bg-rose-50 font-semibold text-rose-800" : k === "productive" ? "font-semibold text-slate-800" : "text-slate-700"}`}
                  title={isTyped ? "typed for this offering — clear the box to go back to the derived figure" : `derived: ${solved.formula[k]} (${fmt.calcTitle(v, fmt.atLeastPhrase(v))}); type to set it`}
                />
                <span className={`block whitespace-nowrap text-[10px] ${cap.own ? "text-rose-600" : "text-slate-400"}`} title={`${PLAN_STAGE_RATE[k].of}${cap.own ? " — this offering's own figure, derived from its counts" : " — the family default"}`}>{cap.text}</span>
              </label>
            </div>
          );
        })}
        {(typed.size > 0 || ownRates) && !disabled && (
          <button type="button" onClick={() => onChange({ counts: {}, termOverrides: [], rates: {} })} className="pb-4 text-[10px] text-slate-400 hover:text-rose-700" title="clear every typed count (and any rates an earlier plan set) — everything derives from the family defaults again">reset to derived</button>
        )}
      </div>
      <p className="text-[10px] text-slate-400">
        Type the numbers you plan for — how many enroll, how many complete, how many go to work; the rest follow the family&apos;s default rates and the percent under each box is what your numbers imply. Fully productive is this offering&apos;s share of the goal.
        {ownRates ? <> <span className="text-rose-600">This offering also carries health rates set by an earlier plan</span> — &ldquo;reset to derived&rdquo; clears them.</> : null}
      </p>

      {/* Enrollment in the later terms — THIS offering's numbers, editable; term 1 is the enrolled box above */}
      {n > 1 && (
        <div className="flex flex-wrap items-end gap-2">
          <span className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-500">Enrollment</span>
          <label className="block">
            <span className="block max-w-[7rem] truncate text-[10px] text-slate-400" title={termNames[0]}>{termNames[0]}</span>
            <span className="block w-16 rounded border border-slate-100 bg-slate-50 px-1.5 py-0.5 text-right tabular-nums text-slate-500" title="the enrolled box above">{fmt.num(seatsNeeded(solved.ladder.enrolled))}</span>
          </label>
          {termNames.slice(1).map((name, j) => {
            const i = j + 1;
            const ov = value.termOverrides[i] ?? null;
            return (
              <label key={i} className="block">
                <span className="block max-w-[7rem] truncate text-[10px] text-slate-400" title={name}>{name}</span>
                <input
                  type="number" min={0} disabled={disabled}
                  value={laterTerm(i)}
                  onChange={(e) => { const o = [...value.termOverrides]; while (o.length < n) o.push(null); o[i] = e.target.value === "" ? null : Math.max(0, Number(e.target.value)); onChange({ termOverrides: o }); }}
                  className={`${inp} w-16 ${ov != null ? "border-rose-300 bg-rose-50 font-semibold text-rose-800" : "text-slate-700"}`}
                  title={ov != null ? "set for this offering — clear to go back to the derived figure" : `derived from the enrolled and completing counts (${fmt.calcTitle(solved.terms[i] ?? 0, fmt.atLeastPhrase(solved.terms[i] ?? 0))}); type to set it`}
                />
              </label>
            );
          })}
          <span className="pb-1 text-[10px] text-slate-400">seats each term for this offering · term 1 is what the schedule and staffing math use</span>
        </div>
      )}
    </div>
  );
}
