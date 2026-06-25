// Talent-pipeline health metrics — the canonical indicators from the institutions
// data model ("Talent Pipeline Health Metrics"), with their target benchmarks.
//
// These are adjacent-stage ratios on the funnel (target & actual), each with a
// benchmark the sheet sizes the funnel against. Aggregating the underlying stage
// counts (across cohorts / programs / institutions) and re-deriving the ratios is
// how the workbook's pivot health view works.

import type { StageKey } from "./funnel";

export interface HealthMetricDef {
  key: string;
  label: string;
  /** numerator stage ÷ denominator stage. */
  num: StageKey;
  den: StageKey | "demand";
  /** Benchmark target ratio from the model. */
  benchmark: number;
  /** "higher is better" — produced ≥ benchmark is healthy. */
  higherBetter: boolean;
}

/** The nine canonical indicators, in funnel order. */
export const HEALTH_METRICS: HealthMetricDef[] = [
  { key: "interestedSurplus", label: "Interested-candidate surplus", num: "interested", den: "qualified", benchmark: 1.5, higherBetter: true },
  { key: "qualifiedSurplus", label: "Qualified-applicant surplus", num: "qualified", den: "offered", benchmark: 1.25, higherBetter: true },
  { key: "offeredSurplus", label: "Offered-admission surplus", num: "offered", den: "enrolled", benchmark: 1.1, higherBetter: true },
  { key: "enrollmentRate", label: "Enrollment rate", num: "enrolled", den: "offered", benchmark: 0.9, higherBetter: true },
  { key: "completionRate", label: "Completion rate (on time)", num: "completing", den: "enrolled", benchmark: 0.7, higherBetter: true },
  { key: "licensureRate", label: "Licensure pass rate (1st time)", num: "licensed", den: "completing", benchmark: 0.9, higherBetter: true },
  { key: "placementRate", label: "Regional placement & retention rate", num: "placed", den: "licensed", benchmark: 0.9, higherBetter: true },
  { key: "productivityRate", label: "Reaching full productivity rate", num: "productive", den: "placed", benchmark: 0.9, higherBetter: true },
];

export interface HealthMetricResult extends HealthMetricDef {
  ratio: number | null;
  /** ratio − benchmark (positive = ahead). */
  vsBenchmark: number | null;
  healthy: boolean | null;
}

/** Compute the health indicators from a set of stage counts (target OR actual). */
export function computeHealthMetrics(stage: Partial<Record<StageKey, number>>, demand?: number | null): HealthMetricResult[] {
  const out: HealthMetricResult[] = [];
  for (const d of HEALTH_METRICS) {
    const n = stage[d.num];
    const den = d.den === "demand" ? demand ?? null : stage[d.den as StageKey];
    const ratio = n != null && den != null && den !== 0 ? n / den : null;
    out.push({
      ...d,
      ratio,
      vsBenchmark: ratio != null ? ratio - d.benchmark : null,
      healthy: ratio != null ? (d.higherBetter ? ratio >= d.benchmark : ratio <= d.benchmark) : null,
    });
  }
  // Regional pipeline utilization — productive ÷ enrollment capacity. Of everyone
  // the cohort had capacity to seat, what share reached full productivity.
  const cap = stage.enrolled;
  const prod = stage.productive;
  if (cap != null && cap !== 0 && prod != null) {
    const ratio = prod / cap;
    out.push({
      key: "utilization", label: "Regional pipeline utilization", num: "productive", den: "enrolled", benchmark: 0.51, higherBetter: true,
      ratio, vsBenchmark: ratio - 0.51, healthy: ratio >= 0.51,
    });
  }
  return out;
}

/** Sum a list of per-cohort stage maps into one aggregate stage map (for pivots). */
export function aggregateStages(maps: Partial<Record<StageKey, number>>[]): Partial<Record<StageKey, number>> {
  const agg: Partial<Record<StageKey, number>> = {};
  for (const m of maps) for (const k of Object.keys(m) as StageKey[]) agg[k] = (agg[k] ?? 0) + (m[k] ?? 0);
  return agg;
}
