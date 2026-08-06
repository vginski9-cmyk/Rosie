// Talent-pipeline analytics engine — a faithful port of the institution
// workbook's structure ("INPUT HERE_PROGRAM STRUCTURE" → "ALL TOGETHER_OUTPUT
// TABLE" → pivot tabs), so every number on the analytics page can show exactly
// where it was sourced from and how it adds up.
//
// The workbook's spine, reproduced here:
//
//  1. BACKWARD DERIVATION (INPUT rows 52–71). Each cohort-end-year column
//     starts from ONE input — the productivity goal ("Retained, Placed,
//     Credentialed / Licensed Graduates Reaching Full Productivity", row 71 =
//     row 21) — and walks the funnel backward by dividing out each rate:
//        placed     = productive ÷ productivityRate          (r70 = r71/r47)
//        licensed   = placed     ÷ placementRate             (r69 = r70/r46)
//        completing = licensed   ÷ licensureRate             (r68 = r69/r45)
//        term 1     = completing ÷ completionRate            (r56 = r68/r44)
//        capacity   = term 1     ÷ enrollmentRate            (r55 = r56/r43)
//     then forward for the surpluses, anchored on capacity:
//        offered    = capacity × offeredSurplus              (r54 = r55×r42)
//        qualified  = capacity × qualifiedSurplus            (r53 = r55×r41)
//        interested = capacity × interestedSurplus           (r52 = r55×r40)
//     and LINEAR per-term attrition (rows 57–67): each term sheds an equal
//     slice of (term1 − completing):
//        term n = term n−1 − (term1 − completing) / numTerms   (n ≤ numTerms)
//
//  2. THE LONG FACT TABLE (ALL TOGETHER_OUTPUT TABLE). One row per
//     cohort × metric (the workbook replicates term rows per course, then
//     blanks the duplicates). The "(Normalized)" columns carry the value only
//     once per group so a pivot SUM never double-counts — we keep one row per
//     group and record the source of each number as a lineage string.
//
//  3. PIVOTS. The "TALENT PIPELINE HEALTH METRICS" tab pivots the fact table
//     into the funnel ladder (with nested Term rows and a Grand Total), stages
//     the pivot's aggregates into helper cells, and computes the nine health
//     ratios + utilization FROM those staged aggregates. The "OUTPUT
//     VISUAL_PROGRAM STRUCTURE" tab pivots the same facts Year → Season for
//     one selected metric. Same functions here: pivot once, derive ratios from
//     the pivot's own aggregates, keep the chain visible.

import { type LadderRates, BENCHMARK_RATES } from "./northstar";

// ---------------------------------------------------------------------------
// Metric rows, in the workbook's pivot order.
// ---------------------------------------------------------------------------

export type PipelineMetricKey =
  | "interested" | "qualified" | "offered" | "capacity"
  | "term" // per-term enrollment (carries termIndex)
  | "completing" | "licensed" | "placed" | "productive";

export interface PipelineMetricDef {
  key: PipelineMetricKey;
  label: string;
  /** Which INPUT-sheet row this mirrors (provenance shown in the UI). */
  source: string;
}

export const PIPELINE_METRICS: PipelineMetricDef[] = [
  { key: "interested", label: "Interested candidates", source: "capacity × interested surplus" },
  { key: "qualified", label: "Qualified applicants", source: "capacity × qualified surplus" },
  { key: "offered", label: "Offered admission", source: "capacity × offered surplus" },
  { key: "capacity", label: "Actual enrollment capacity", source: "term 1 ÷ enrollment rate" },
  { key: "term", label: "Term enrollment", source: "linear attrition from term 1 to completing" },
  { key: "completing", label: "Students completing on time", source: "licensed ÷ licensure pass rate" },
  { key: "licensed", label: "Students passing licensure (first time)", source: "placed ÷ placement rate" },
  { key: "placed", label: "Credentialed graduates retained & placed regionally", source: "productive ÷ productivity rate" },
  { key: "productive", label: "Retained, placed graduates reaching full productivity", source: "the North-Star goal (input)" },
];

// ---------------------------------------------------------------------------
// 1. Backward derivation — the exact INPUT-sheet chain.
// ---------------------------------------------------------------------------

export interface DerivedStep {
  key: PipelineMetricKey;
  label: string;
  value: number;
  /** Human formula with the actual numbers, e.g. "= 88.9 ÷ 0.90 (placement rate)". */
  formula: string;
}

export interface CohortTargets {
  productive: number;
  placed: number;
  licensed: number;
  completing: number;
  /** Per-term enrollment, term 1 first; length = numTerms. */
  terms: number[];
  capacity: number;
  offered: number;
  qualified: number;
  interested: number;
  /** The derivation chain in computed order (goal first), for the lineage view. */
  chain: DerivedStep[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Derive every funnel target for one cohort from its productivity goal —
 * the workbook's INPUT rows 52–71 for one year column.
 */
export function deriveCohortTargets(productiveGoal: number, rates: LadderRates, numTerms: number): CohortTargets {
  const n = Math.max(1, Math.round(numTerms));
  const productive = productiveGoal;
  const placed = rates.productivityRate > 0 ? productive / rates.productivityRate : 0;
  const licensed = rates.placementRate > 0 ? placed / rates.placementRate : 0;
  const completing = rates.licensureRate > 0 ? licensed / rates.licensureRate : 0;
  const term1 = rates.completionRate > 0 ? completing / rates.completionRate : 0;
  const capacity = rates.enrollmentRate > 0 ? term1 / rates.enrollmentRate : 0;
  const offered = capacity * rates.offeredSurplus;
  const qualified = capacity * rates.qualifiedSurplus;
  const interested = capacity * rates.interestedSurplus;

  // Linear attrition: every term sheds an equal slice of (term1 − completing).
  const slice = (term1 - completing) / n;
  const terms: number[] = [term1];
  for (let i = 1; i < n; i++) terms.push(terms[i - 1] - slice);

  const chain: DerivedStep[] = [
    { key: "productive", label: "Reaching full productivity", value: productive, formula: "the North-Star goal for this cohort (input)" },
    { key: "placed", label: "Retained & placed regionally", value: placed, formula: `= ${r1(productive)} ÷ ${rates.productivityRate} (productivity rate)` },
    { key: "licensed", label: "Passing licensure (1st time)", value: licensed, formula: `= ${r1(placed)} ÷ ${rates.placementRate} (placement rate)` },
    { key: "completing", label: "Completing on time", value: completing, formula: `= ${r1(licensed)} ÷ ${rates.licensureRate} (licensure pass rate)` },
    { key: "term", label: "Term 1 enrollment", value: term1, formula: `= ${r1(completing)} ÷ ${rates.completionRate} (completion rate)` },
    { key: "capacity", label: "Enrollment capacity", value: capacity, formula: `= ${r1(term1)} ÷ ${rates.enrollmentRate} (enrollment rate)` },
    { key: "offered", label: "Offered admission", value: offered, formula: `= ${r1(capacity)} × ${rates.offeredSurplus} (offered surplus)` },
    { key: "qualified", label: "Qualified applicants", value: qualified, formula: `= ${r1(capacity)} × ${rates.qualifiedSurplus} (qualified surplus)` },
    { key: "interested", label: "Interested candidates", value: interested, formula: `= ${r1(capacity)} × ${rates.interestedSurplus} (interested surplus)` },
  ];

  return { productive, placed, licensed, completing, terms, capacity, offered, qualified, interested, chain };
}

// ---------------------------------------------------------------------------
// 2. The long fact table — one normalized row per cohort × metric (× term).
// ---------------------------------------------------------------------------

export interface PipelineFact {
  institution: string;
  familyId: string;
  family: string;
  programId: string;
  program: string;
  credential: string | null;
  cohortId: string;
  cohort: string;
  /** The year this cohort's pipeline lands its graduates ("Cohort Year End"). */
  endYear: number;
  /** Fall / Spring / Summer of the cohort's first term (for the Year → Season pivot). */
  season: string;
  metric: PipelineMetricKey;
  metricLabel: string;
  /** 1-based term index for metric === "term", else null. */
  termIndex: number | null;
  target: number | null;
  actual: number | null;
  /** Where the target came from (formula with real numbers). */
  targetSource: string;
  /** Where the actual came from. */
  actualSource: string;
}

export interface CohortActuals {
  interested?: number | null; qualified?: number | null; offered?: number | null;
  enrolled?: number | null; completing?: number | null; licensed?: number | null;
  placed?: number | null; productive?: number | null;
  /** Per-term actual headcount where known (sparse; index 0 = term 1). */
  terms?: (number | null)[];
}

export interface CohortFactInput {
  institution: string;
  familyId: string;
  family: string;
  programId: string;
  program: string;
  credential: string | null;
  cohortId: string;
  cohort: string;
  endYear: number;
  season: string;
  productiveGoal: number;
  numTerms: number;
  actuals: CohortActuals;
}

const ACTUAL_SOURCE = "live student records (cumulative stage counts)";

/** Expand one cohort into its normalized fact rows (the workbook's per-cohort block). */
export function cohortFacts(input: CohortFactInput, rates: LadderRates): PipelineFact[] {
  const t = deriveCohortTargets(input.productiveGoal, rates, input.numTerms);
  const a = input.actuals;
  const base = {
    institution: input.institution, familyId: input.familyId, family: input.family,
    programId: input.programId, program: input.program, credential: input.credential,
    cohortId: input.cohortId, cohort: input.cohort, endYear: input.endYear, season: input.season,
  };
  const step = (k: PipelineMetricKey) => t.chain.find((c) => c.key === k)?.formula ?? "";
  const row = (metric: PipelineMetricKey, label: string, target: number | null, actual: number | null | undefined, targetSource: string): PipelineFact => ({
    ...base, metric, metricLabel: label, termIndex: null,
    target, actual: actual ?? null, targetSource, actualSource: ACTUAL_SOURCE,
  });

  const facts: PipelineFact[] = [
    row("interested", "Interested candidates", t.interested, a.interested, step("interested")),
    row("qualified", "Qualified applicants", t.qualified, a.qualified, step("qualified")),
    row("offered", "Offered admission", t.offered, a.offered, step("offered")),
    row("capacity", "Actual enrollment capacity", t.capacity, a.enrolled, step("capacity")),
  ];
  t.terms.forEach((v, i) => {
    facts.push({
      ...base, metric: "term", metricLabel: `Term ${i + 1}`, termIndex: i + 1,
      target: v, actual: a.terms?.[i] ?? null,
      targetSource: i === 0 ? step("term") : `= term ${i} − (term 1 − completing) ÷ ${Math.max(1, Math.round(input.numTerms))} (linear attrition)`,
      actualSource: "live enrollment in that term",
    });
  });
  facts.push(
    row("completing", "Students completing on time", t.completing, a.completing, step("completing")),
    row("licensed", "Students passing licensure (first time)", t.licensed, a.licensed, step("licensed")),
    row("placed", "Credentialed graduates retained & placed regionally", t.placed, a.placed, step("placed")),
    row("productive", "Retained, placed graduates reaching full productivity", t.productive, a.productive, step("productive")),
  );
  return facts;
}

// ---------------------------------------------------------------------------
// 3a. The funnel-ladder pivot (TALENT PIPELINE HEALTH METRICS tab).
// ---------------------------------------------------------------------------

export interface LadderPivotRow {
  metric: PipelineMetricKey;
  label: string;
  termIndex: number | null;
  /** Sum of normalized targets across the filtered cohorts. */
  target: number | null;
  actual: number | null;
  /** Which cohorts contributed, with each one's slice (the pivot's drill-down). */
  parts: { cohort: string; target: number | null; actual: number | null }[];
  /** True for the nested Term rows under enrollment capacity. */
  nested: boolean;
}

export interface LadderPivot {
  rows: LadderPivotRow[];
  grandTotalTarget: number;
  grandTotalActual: number;
  cohorts: string[];
}

const sumOrNull = (vs: (number | null)[]): number | null => {
  const xs = vs.filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
};

/** Pivot the facts into the workbook's funnel ladder (terms nested under capacity). */
export function ladderPivot(facts: PipelineFact[]): LadderPivot {
  const cohorts = [...new Set(facts.map((f) => f.cohort))];
  const rows: LadderPivotRow[] = [];
  const push = (metric: PipelineMetricKey, termIndex: number | null, nested: boolean) => {
    const fs = facts.filter((f) => f.metric === metric && f.termIndex === termIndex);
    if (!fs.length) return;
    rows.push({
      metric, label: fs[0].metricLabel, termIndex, nested,
      target: sumOrNull(fs.map((f) => f.target)),
      actual: sumOrNull(fs.map((f) => f.actual)),
      parts: fs.map((f) => ({ cohort: f.cohort, target: f.target, actual: f.actual })),
    });
  };
  for (const m of ["interested", "qualified", "offered", "capacity"] as PipelineMetricKey[]) push(m, null, false);
  const termIdxs = [...new Set(facts.filter((f) => f.metric === "term").map((f) => f.termIndex!))].sort((a, b) => a - b);
  for (const i of termIdxs) push("term", i, true);
  for (const m of ["completing", "licensed", "placed", "productive"] as PipelineMetricKey[]) push(m, null, false);

  // The workbook's Grand Total sums every normalized row (terms included).
  return {
    rows,
    grandTotalTarget: rows.reduce((s, r) => s + (r.target ?? 0), 0),
    grandTotalActual: rows.reduce((s, r) => s + (r.actual ?? 0), 0),
    cohorts,
  };
}

// ---------------------------------------------------------------------------
// 3b. Health ratios FROM the pivot aggregates (the staged GETPIVOTDATA block).
// ---------------------------------------------------------------------------

export interface HealthRatioRow {
  key: string;
  label: string;
  /** Plain formula, e.g. "Interested candidates ÷ Enrollment capacity". */
  formula: string;
  numLabel: string;
  denLabel: string;
  targetNum: number | null; targetDen: number | null; targetRatio: number | null;
  actualNum: number | null; actualDen: number | null; actualRatio: number | null;
  benchmark: number;
  /** actualRatio ≥ benchmark (null when no actual). */
  healthy: boolean | null;
}

/**
 * The nine workbook health metrics + utilization, computed from a ladder
 * pivot's own aggregates — exactly how the METRICS tab stages pivot cells
 * (rows 47–66) and then divides them (rows 34–42).
 */
export function healthFromPivot(p: LadderPivot): HealthRatioRow[] {
  type RowRef = PipelineMetricKey | "term1";
  const get = (m: RowRef) =>
    m === "term1"
      ? p.rows.find((r) => r.metric === "term" && r.termIndex === 1) ?? null
      : p.rows.find((r) => r.metric === m && !r.nested) ?? null;
  const val = (m: RowRef, which: "target" | "actual") => get(m)?.[which] ?? null;
  const div = (a: number | null, b: number | null) => (a != null && b != null && b !== 0 ? a / b : null);
  const mk = (key: string, label: string, num: RowRef, den: RowRef, benchmark: number): HealthRatioRow => {
    const numL = num === "term1" ? "Term 1 enrollment" : get(num)?.label ?? num;
    const denL = den === "term1" ? "Term 1 enrollment" : get(den)?.label ?? den;
    const tN = val(num, "target"), tD = val(den, "target"), aN = val(num, "actual"), aD = val(den, "actual");
    const aR = div(aN, aD);
    return {
      key, label, formula: `${numL} ÷ ${denL}`, numLabel: numL, denLabel: denL,
      targetNum: tN, targetDen: tD, targetRatio: div(tN, tD),
      actualNum: aN, actualDen: aD, actualRatio: aR,
      benchmark, healthy: aR != null ? aR >= benchmark : null,
    };
  };
  return [
    mk("interestedSurplus", "Interested-candidate surplus", "interested", "capacity", 1.5),
    mk("qualifiedSurplus", "Qualified-applicant surplus", "qualified", "capacity", 1.25),
    mk("offeredSurplus", "Offered-admission surplus", "offered", "capacity", 1.1),
    mk("enrollmentRate", "Enrollment rate", "term1", "capacity", 1.0),
    mk("completionRate", "Completion rate (on time)", "completing", "term1", 0.7),
    mk("licensureRate", "Licensure pass rate (1st time)", "licensed", "completing", 0.9),
    mk("placementRate", "Regional placement & retention rate", "placed", "licensed", 0.9),
    mk("productivityRate", "Reaching-full-productivity rate", "productive", "placed", 0.9),
    mk("utilization", "Regional pipeline utilization", "productive", "capacity", 0.51),
  ];
}

// ---------------------------------------------------------------------------
// 3c. The Year → Season pivot (OUTPUT VISUAL_PROGRAM STRUCTURE tab).
// ---------------------------------------------------------------------------

export interface YearSeasonRow {
  year: number;
  seasons: { season: string; target: number | null; actual: number | null; cohorts: string[] }[];
  target: number | null;
  actual: number | null;
}

export interface YearSeasonPivot {
  rows: YearSeasonRow[];
  grandTotalTarget: number;
  grandTotalActual: number;
}

/** Pivot one metric's facts Year → Season (the workbook's visual-structure tab). */
export function yearSeasonPivot(facts: PipelineFact[], metric: PipelineMetricKey): YearSeasonPivot {
  const fs = facts.filter((f) => f.metric === metric && (metric !== "term" || f.termIndex === 1));
  const byYear = new Map<number, Map<string, { target: number | null; actual: number | null; cohorts: string[] }>>();
  for (const f of fs) {
    const y = byYear.get(f.endYear) ?? new Map();
    const s = y.get(f.season) ?? { target: null, actual: null, cohorts: [] };
    if (f.target != null) s.target = (s.target ?? 0) + f.target;
    if (f.actual != null) s.actual = (s.actual ?? 0) + f.actual;
    s.cohorts.push(f.cohort);
    y.set(f.season, s);
    byYear.set(f.endYear, y);
  }
  const SEASON_ORDER = ["Spring", "Summer", "Fall"];
  const rows: YearSeasonRow[] = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, m]) => {
    const seasons = [...m.entries()]
      .sort((a, b) => SEASON_ORDER.indexOf(a[0]) - SEASON_ORDER.indexOf(b[0]))
      .map(([season, v]) => ({ season, ...v }));
    return { year, seasons, target: sumOrNull(seasons.map((s) => s.target)), actual: sumOrNull(seasons.map((s) => s.actual)) };
  });
  return {
    rows,
    grandTotalTarget: rows.reduce((s, r) => s + (r.target ?? 0), 0),
    grandTotalActual: rows.reduce((s, r) => s + (r.actual ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// 4. Y-O-Y change (INPUT rows 73–96): (year ÷ prior year) − 1 per metric.
// ---------------------------------------------------------------------------

export interface YoYRow {
  metric: PipelineMetricKey;
  label: string;
  /** One cell per year (aligned with the years array); null for the first year / missing data. */
  changes: (number | null)[];
}

export function yoyChange(facts: PipelineFact[]): { years: number[]; rows: YoYRow[] } {
  const years = [...new Set(facts.map((f) => f.endYear))].sort((a, b) => a - b);
  const rows: YoYRow[] = [];
  for (const def of PIPELINE_METRICS) {
    if (def.key === "term") continue;
    const perYear = years.map((y) =>
      sumOrNull(facts.filter((f) => f.metric === def.key && f.endYear === y).map((f) => f.target)));
    if (perYear.every((v) => v == null)) continue;
    rows.push({
      metric: def.key, label: def.label,
      changes: perYear.map((v, i) => {
        if (i === 0) return null;
        const prev = perYear[i - 1];
        return v != null && prev != null && prev !== 0 ? v / prev - 1 : null;
      }),
    });
  }
  return { years, rows };
}

export { BENCHMARK_RATES };
