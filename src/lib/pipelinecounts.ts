// AN OFFERING PLANNED IN COUNTS. People plan a class in numbers — "it enrolls 10, plans to complete 7, and 5 of those
// go straight to work" — not in percentages. The editor shows the eight pipeline stages as count boxes; whatever is
// typed stands, every row left alone derives from the family's default rates, and the percent each count implies is
// shown beside it. The derived rates are stored on the offering exactly where the rates always were, so every reader
// of an offering's rates (capacity model, expansion, rosters, analytics) keeps working unchanged.
//
// The rule: a derived row follows the nearest typed row ABOVE it through the family rates (the forward chain of
// buildLadder); rows above the first typed row follow that first typed row backward the same way; with nothing typed
// the ladder is deriveCohortTargets' backward chain from the productive goal, as before. So "enrolled 10, completing 7,
// placed 5" gives interested 15 · qualified 12.5 · offered 11 · enrolled 10 · completing 7 · licensed 6.3 (7 × 0.9) ·
// placed 5 · productive 4.5 (5 × 0.9), and the implied completion rate is 70 %, the placement rate 5 ÷ 6.3.

import { BENCHMARK_RATES, type LadderRates } from "./northstar";
import { deriveCohortTargets, thinTerms } from "./pipeline";

export const PLAN_STAGES = ["interested", "qualified", "offered", "enrolled", "completing", "licensed", "placed", "productive"] as const;
export type PlanStageKey = (typeof PLAN_STAGES)[number];
/** The counts someone typed for an offering, by stage; a missing or null stage is derived. */
export type PlannedCounts = Partial<Record<PlanStageKey, number | null>>;

/** Plain words for each row of the ladder, in the editor and the tooltips. */
export const PLAN_STAGE_LABELS: Record<PlanStageKey, string> = {
  interested: "interested", qualified: "qualified", offered: "offered a seat", enrolled: "enrolled in term 1",
  completing: "completing", licensed: "licensed", placed: "placed in a job", productive: "fully productive",
};
/** The rate each row implies, as "numerator ÷ denominator" words, and the rate key it sets. */
export const PLAN_STAGE_RATE: Record<PlanStageKey, { key: keyof LadderRates; of: string; anchor: "capacity" | "chain" }> = {
  interested: { key: "interestedSurplus", of: "interested ÷ seats", anchor: "capacity" },
  qualified: { key: "qualifiedSurplus", of: "qualified ÷ seats", anchor: "capacity" },
  offered: { key: "offeredSurplus", of: "offered ÷ seats", anchor: "capacity" },
  enrolled: { key: "enrollmentRate", of: "enrolled ÷ seats", anchor: "capacity" },
  completing: { key: "completionRate", of: "completing ÷ enrolled", anchor: "chain" },
  licensed: { key: "licensureRate", of: "licensed ÷ completing", anchor: "chain" },
  placed: { key: "placementRate", of: "placed ÷ licensed", anchor: "chain" },
  productive: { key: "productivityRate", of: "productive ÷ placed", anchor: "chain" },
};

export interface SolvedLadder {
  ladder: Record<PlanStageKey, number>;
  /** Enrollment capacity (seats): enrolled ÷ the family's enrollment rate. */
  capacity: number;
  /** Per-term enrollment from term 1 under linear attrition at the derived completion rate. */
  terms: number[];
  /** The rates the final ladder implies — stored on the offering where its rates always were. */
  rates: LadderRates;
  /** The stages someone typed. */
  fixed: PlanStageKey[];
  /** The productive count — the offering's share of the goal. */
  goal: number;
  /** How each row came to be, in words. */
  formula: Record<PlanStageKey, string>;
}

/** The typed stages of a counts record, in ladder order. */
export const fixedStages = (counts: PlannedCounts | undefined): PlanStageKey[] =>
  PLAN_STAGES.filter((k) => typeof counts?.[k] === "number" && Number.isFinite(counts![k] as number));

/** Every stage's multiplier of capacity under `rates` (the forward chain). */
function factorsOf(rates: LadderRates): Record<PlanStageKey, number> {
  const enrolled = rates.enrollmentRate;
  const completing = enrolled * rates.completionRate;
  const licensed = completing * rates.licensureRate;
  const placed = licensed * rates.placementRate;
  return { interested: rates.interestedSurplus, qualified: rates.qualifiedSurplus, offered: rates.offeredSurplus, enrolled, completing, licensed, placed, productive: placed * rates.productivityRate };
}

const pct = (v: number) => `${Math.round(v * 1000) / 10} %`;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Solve an offering's ladder from its goal share, the rates in force (family defaults with any own rates) and the counts typed. */
export function solveLadder(input: { goal: number; rates: LadderRates; counts?: PlannedCounts; numTerms: number }): SolvedLadder {
  const rates = { ...BENCHMARK_RATES, ...input.rates };
  const n = Math.max(1, Math.round(input.numTerms));
  const fixed = fixedStages(input.counts);
  const formula = {} as Record<PlanStageKey, string>;
  const ladder = {} as Record<PlanStageKey, number>;

  if (!fixed.length) {
    const t = deriveCohortTargets(Math.max(0, input.goal), rates, n);
    Object.assign(ladder, { interested: t.interested, qualified: t.qualified, offered: t.offered, enrolled: t.terms[0] ?? 0, completing: t.completing, licensed: t.licensed, placed: t.placed, productive: t.productive });
    for (const step of t.chain) if (step.key === "term") formula.enrolled = step.formula; else if (step.key !== "capacity") formula[step.key as PlanStageKey] = step.formula;
    return { ladder, capacity: t.capacity, terms: t.terms, rates, fixed, goal: t.productive, formula };
  }

  const f = factorsOf(rates);
  const capacityFrom = (k: PlanStageKey) => (f[k] > 0 ? Math.max(0, input.counts![k] as number) / f[k] : 0);
  for (const k of PLAN_STAGES) {
    if (fixed.includes(k)) { ladder[k] = Math.max(0, input.counts![k] as number); formula[k] = "typed for this offering"; continue; }
    const i = PLAN_STAGES.indexOf(k);
    // The nearest typed row above, else the first typed row (below).
    const above = [...fixed].reverse().find((x) => PLAN_STAGES.indexOf(x) < i);
    const anchor = above ?? fixed[0];
    ladder[k] = capacityFrom(anchor) * f[k];
    const r = PLAN_STAGE_RATE[k];
    formula[k] = above
      ? r.anchor === "chain" ? `= ${r2(ladder[PLAN_STAGES[i - 1]])} ${PLAN_STAGE_LABELS[PLAN_STAGES[i - 1]]} × ${pct(rates[r.key])} (${r.of}, the family default)` : `= ${r2(capacityFrom(anchor))} seats × ${rates[r.key]} (${r.of}, the family default)`
      : `= ${r2(ladder[anchor])} ${PLAN_STAGE_LABELS[anchor]} carried back through the family defaults (${r.of} ${r.anchor === "chain" ? pct(rates[r.key]) : rates[r.key]})`;
  }
  // Capacity (seats) is enrolled ÷ the family's enrollment rate — no count row expresses that rate.
  const capacity = rates.enrollmentRate > 0 ? ladder.enrolled / rates.enrollmentRate : ladder.enrolled;
  // A derived rate that is the family rate to within floating-point noise IS the family rate (no 0.8999999 on screen).
  const ratio = (num: number, den: number, fallback: number) => { if (!(den > 0)) return fallback; const v = num / den; return Math.abs(v - fallback) < 1e-9 ? fallback : v; };
  const derived: LadderRates = {
    interestedSurplus: ratio(ladder.interested, capacity, rates.interestedSurplus),
    qualifiedSurplus: ratio(ladder.qualified, capacity, rates.qualifiedSurplus),
    offeredSurplus: ratio(ladder.offered, capacity, rates.offeredSurplus),
    enrollmentRate: rates.enrollmentRate,
    completionRate: ratio(ladder.completing, ladder.enrolled, rates.completionRate),
    licensureRate: ratio(ladder.licensed, ladder.completing, rates.licensureRate),
    placementRate: ratio(ladder.placed, ladder.licensed, rates.placementRate),
    productivityRate: ratio(ladder.productive, ladder.placed, rates.productivityRate),
  };
  return { ladder, capacity, terms: thinTerms(ladder.enrolled, derived.completionRate, n), rates: derived, fixed, goal: ladder.productive, formula };
}

/** The counts of a saved plan, kept only where they are numbers. */
export function cleanCounts(counts: PlannedCounts | null | undefined): PlannedCounts {
  const out: PlannedCounts = {};
  for (const k of PLAN_STAGES) { const v = counts?.[k]; if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(0, v); }
  return out;
}

/** The typed counts a saved plan carries. A plan from before counts existed typed its term-1 enrollment as the first
 *  term override; that is the enrolled count. */
export function countsOfPlan(saved: { counts?: PlannedCounts | null; termOverrides?: (number | null)[] | null } | null | undefined): PlannedCounts {
  const counts = cleanCounts(saved?.counts);
  const t1 = saved?.termOverrides?.[0];
  if (counts.enrolled == null && typeof t1 === "number" && Number.isFinite(t1)) counts.enrolled = Math.max(0, t1);
  return counts;
}

/** The rates an offering set for itself (over the family's), from its saved plan: the `ownRates` a writer recorded; for a
 *  plan written before that, the keys of its stored rates that differ from the family defaults — but a plan that already
 *  carries counts stores derived rates, which are never "own". */
export function ownRatesOfPlan(saved: { ownRates?: Partial<LadderRates> | null; rates?: Partial<LadderRates> | null; counts?: PlannedCounts | null } | null | undefined, defaults: LadderRates): Partial<LadderRates> {
  const out: Partial<LadderRates> = {};
  if (!saved) return out;
  if (saved.ownRates && typeof saved.ownRates === "object") { for (const [k, v] of Object.entries(saved.ownRates)) if (typeof v === "number" && Number.isFinite(v)) out[k as keyof LadderRates] = v; return out; }
  if (saved.counts && typeof saved.counts === "object") return out;
  for (const [k, v] of Object.entries(saved.rates ?? {})) if (typeof v === "number" && v !== defaults[k as keyof LadderRates]) out[k as keyof LadderRates] = v;
  return out;
}
