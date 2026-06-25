// North-Star goal model — the talent-pipeline ladder exactly as the institutions
// workbook computes it. Unlike the generic funnel (adjacent-stage conversions),
// this is how a program lead actually SETS goals: a row of percentages off a
// single anchor, so you can type a North Star (or an enrollment capacity) and
// every number autocalculates — and type in actual cohort performance to see
// attainment side by side.
//
//   Front half — SURPLUSES anchored on enrollment CAPACITY:
//     interested = capacity × interestedSurplus   (e.g. 150%)
//     qualified  = capacity × qualifiedSurplus    (125%)
//     offered    = capacity × offeredSurplus      (110%)
//     enrolled   = capacity × enrollmentRate      (100%)
//   Back half — chained YIELDS off enrolled:
//     completing = enrolled   × completionRate    (70%)
//     licensed   = completing × licensureRate     (90%)
//     placed     = licensed   × placementRate     (90%)
//     productive = placed     × productivityRate  (90%)
//   Utilization = productive ÷ enrollment capacity — of everyone the cohort had
//   capacity to seat, what share reached full productivity (the 51% benchmark =
//   25 ÷ 49).
//
// Worked example (the workbook's 2025 benchmark cohort): capacity 49 →
// interested 73, qualified 61, offered 54, enrolled 49, completing 34,
// licensed 31, placed 28, productive 25.

export interface LadderRates {
  interestedSurplus: number;
  qualifiedSurplus: number;
  offeredSurplus: number;
  enrollmentRate: number;
  completionRate: number;
  licensureRate: number;
  placementRate: number;
  productivityRate: number;
}

/** The workbook's 2025 health-metric benchmarks. */
export const BENCHMARK_RATES: LadderRates = {
  interestedSurplus: 1.5,
  qualifiedSurplus: 1.25,
  offeredSurplus: 1.1,
  enrollmentRate: 1.0,
  completionRate: 0.7,
  licensureRate: 0.9,
  placementRate: 0.9,
  productivityRate: 0.9,
};

export type RateAnchor = "capacity" | "chain";

export interface RateDef {
  key: keyof LadderRates;
  label: string;
  /** "capacity" = ratio of enrollment capacity; "chain" = yield off the stage above. */
  anchor: RateAnchor;
  /** Plain-language numerator ÷ denominator. */
  of: string;
  benchmark: number;
}

/** The nine editable health-metric rows, in funnel order (utilization handled separately). */
export const RATE_DEFS: RateDef[] = [
  { key: "interestedSurplus", label: "Interested-candidate surplus", anchor: "capacity", of: "interested ÷ capacity", benchmark: 1.5 },
  { key: "qualifiedSurplus", label: "Qualified-applicant surplus", anchor: "capacity", of: "qualified ÷ capacity", benchmark: 1.25 },
  { key: "offeredSurplus", label: "Offered-admission surplus", anchor: "capacity", of: "offered ÷ capacity", benchmark: 1.1 },
  { key: "enrollmentRate", label: "Enrollment rate", anchor: "capacity", of: "enrolled ÷ capacity", benchmark: 1.0 },
  { key: "completionRate", label: "Completion rate (on time)", anchor: "chain", of: "completing ÷ enrolled", benchmark: 0.7 },
  { key: "licensureRate", label: "Licensure pass (1st time)", anchor: "chain", of: "passing ÷ completing", benchmark: 0.9 },
  { key: "placementRate", label: "Regional placement & retention", anchor: "chain", of: "placed ÷ passing", benchmark: 0.9 },
  { key: "productivityRate", label: "Reaching full productivity", anchor: "chain", of: "productive ÷ placed", benchmark: 0.9 },
];

export const UTILIZATION_BENCHMARK = 0.51;

export type LadderStageKey =
  | "interested" | "qualified" | "offered" | "enrolled"
  | "completing" | "licensed" | "placed" | "productive";

export interface Ladder {
  capacity: number;
  interested: number;
  qualified: number;
  offered: number;
  enrolled: number;
  completing: number;
  licensed: number;
  placed: number;
  productive: number;
  /** Per-term headcount; term 1 = enrolled, then each term retains its factor of the prior term. */
  terms: number[];
}

/**
 * Build the full ladder from an enrollment capacity and the rate row.
 * `termRetention[i]` is the retention INTO term i+1 from the prior term;
 * term 1 (index 0) is applied to `enrolled` (use 1.0 for "term 1 = enrolled").
 */
export function buildLadder(capacity: number, rates: LadderRates, termRetention: number[] = []): Ladder {
  const enrolled = capacity * rates.enrollmentRate;
  const completing = enrolled * rates.completionRate;
  const licensed = completing * rates.licensureRate;
  const placed = licensed * rates.placementRate;
  const productive = placed * rates.productivityRate;

  const terms: number[] = [];
  let cur = enrolled;
  const n = termRetention.length;
  for (let i = 0; i < n; i++) {
    cur = i === 0 ? enrolled * (termRetention[0] ?? 1) : cur * (termRetention[i] ?? 1);
    terms.push(cur);
  }

  return {
    capacity,
    interested: capacity * rates.interestedSurplus,
    qualified: capacity * rates.qualifiedSurplus,
    offered: capacity * rates.offeredSurplus,
    enrolled,
    completing,
    licensed,
    placed,
    productive,
    terms,
  };
}

/** The combined back-half yield (enrolled → productive). */
export function backHalfYield(rates: LadderRates): number {
  return rates.enrollmentRate * rates.completionRate * rates.licensureRate * rates.placementRate * rates.productivityRate;
}

/** Inverse of buildLadder: the enrollment capacity needed to land `productiveTarget`. */
export function capacityFromNorthStar(productiveTarget: number, rates: LadderRates): number {
  const y = backHalfYield(rates);
  return y > 0 ? productiveTarget / y : 0;
}

/** Of the cohort's enrollment capacity, what share reached full productivity. */
export function utilization(productive: number, capacity: number | null | undefined): number | null {
  return capacity && capacity > 0 ? productive / capacity : null;
}

/** Round a ladder to whole people (terms too) for display. */
export function roundLadder(l: Ladder): Ladder {
  const r = (v: number) => Math.round(v);
  return {
    capacity: r(l.capacity),
    interested: r(l.interested),
    qualified: r(l.qualified),
    offered: r(l.offered),
    enrolled: r(l.enrolled),
    completing: r(l.completing),
    licensed: r(l.licensed),
    placed: r(l.placed),
    productive: r(l.productive),
    terms: l.terms.map(r),
  };
}

/** A sensible default term-retention curve for `terms` terms (term 1 = enrolled, gentle decline). */
export function defaultTermRetention(terms: number, perTerm = 0.94): number[] {
  return Array.from({ length: Math.max(1, terms) }, (_, i) => (i === 0 ? 1 : perTerm));
}
