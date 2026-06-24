// Talent-pipeline funnel model.
//
// The funnel is the spine of Rosie's strategic layer: it connects a program's
// North Star goal (how many fully-productive workers the region needs each year)
// back up through every conversion stage to the top-of-funnel interest required
// to hit it. Target-vs-actual at each stage is how a program lead sees exactly
// where the pipeline is leaking.

export type StageKey =
  | "interested"
  | "qualified"
  | "offered"
  | "enrolled"
  | "completing"
  | "licensed"
  | "placed"
  | "productive";

export interface StageDef {
  key: StageKey;
  label: string;
  /** Plain-language description of the conversion INTO this stage. */
  conversionInto: string;
  /** Tailwind color token (see tailwind.config funnel.*). */
  color: string;
}

/** Canonical funnel, top (widest) to bottom (narrowest). */
export const STAGES: StageDef[] = [
  { key: "interested", label: "Interested candidates", conversionInto: "Top of funnel", color: "#60a5fa" },
  { key: "qualified", label: "Qualified applicants", conversionInto: "% who qualify", color: "#38bdf8" },
  { key: "offered", label: "Offered admission", conversionInto: "% offered admission", color: "#34d399" },
  { key: "enrolled", label: "Enrolled (Term 1)", conversionInto: "% who accept & enroll", color: "#22c55e" },
  { key: "completing", label: "Completing on time", conversionInto: "% completing on time", color: "#84cc16" },
  { key: "licensed", label: "Passing licensure (1st)", conversionInto: "% passing licensure", color: "#eab308" },
  { key: "placed", label: "Retained & placed regionally", conversionInto: "% retained & placed", color: "#f97316" },
  { key: "productive", label: "Fully productive in region", conversionInto: "% reaching productivity", color: "#ef4444" },
];

export const STAGE_INDEX: Record<StageKey, number> = STAGES.reduce(
  (acc, s, i) => ((acc[s.key] = i), acc),
  {} as Record<StageKey, number>,
);

export interface StageValue {
  key: StageKey;
  label: string;
  target?: number | null;
  actual?: number | null;
}

export interface StageAnalysis extends StageValue {
  color: string;
  /** target[i] / target[i-1] — the conversion rate the plan assumes. */
  targetConversion: number | null;
  /** actual[i] / actual[i-1] — the conversion rate actually achieved. */
  actualConversion: number | null;
  /** actual - target (negative = behind plan). */
  gap: number | null;
  /** actual / target. */
  attainment: number | null;
}

/**
 * Given target conversion rates and a North Star (productive) goal, size the
 * whole funnel top-down: how many interested candidates are required to land
 * the target number of fully-productive workers.
 *
 * `rates` maps a stage to the conversion rate INTO it from the stage above
 * (e.g. rates.qualified = 0.75 means 75% of interested become qualified).
 */
export function sizeFunnelFromGoal(
  productiveTarget: number,
  rates: Partial<Record<StageKey, number>>,
): Record<StageKey, number> {
  const out = {} as Record<StageKey, number>;
  out.productive = productiveTarget;
  // Walk upward from productive to interested, dividing by each conversion rate.
  for (let i = STAGES.length - 1; i > 0; i--) {
    const cur = STAGES[i].key;
    const above = STAGES[i - 1].key;
    const r = rates[cur];
    out[above] = r && r > 0 ? out[cur] / r : out[cur];
  }
  return out;
}

/** Compute conversion / gap / attainment analytics for a set of stage values. */
export function analyzeFunnel(values: StageValue[]): StageAnalysis[] {
  const byKey = new Map(values.map((v) => [v.key, v]));
  const ordered = STAGES.map((s) => byKey.get(s.key) ?? { key: s.key, label: s.label });

  return ordered.map((v, i) => {
    const prev = i > 0 ? ordered[i - 1] : null;
    const ratio = (a?: number | null, b?: number | null) =>
      a != null && b != null && b !== 0 ? a / b : null;
    return {
      key: v.key,
      label: STAGES[i].label,
      color: STAGES[i].color,
      target: v.target ?? null,
      actual: v.actual ?? null,
      targetConversion: prev ? ratio(v.target, prev.target) : null,
      actualConversion: prev ? ratio(v.actual, prev.actual) : null,
      gap: v.actual != null && v.target != null ? v.actual - v.target : null,
      attainment: ratio(v.actual, v.target),
    };
  });
}

export interface PipelineHealth {
  /** interested actual ÷ interested target (top-of-funnel volume health). */
  interestSurplus: number | null;
  /** enrolled actual ÷ enrolled target (mid-funnel conversion health). */
  enrollmentAttainment: number | null;
  /** productive actual ÷ productive target (the North Star). */
  northStarAttainment: number | null;
  /** Stage where the largest target→actual conversion drop happens. */
  biggestLeak: { key: StageKey; label: string; dropVsTarget: number } | null;
}

export function pipelineHealth(analysis: StageAnalysis[]): PipelineHealth {
  const get = (k: StageKey) => analysis.find((a) => a.key === k);
  const interested = get("interested");
  const enrolled = get("enrolled");
  const productive = get("productive");

  let biggestLeak: PipelineHealth["biggestLeak"] = null;
  for (const a of analysis) {
    if (a.targetConversion != null && a.actualConversion != null) {
      const drop = a.targetConversion - a.actualConversion;
      if (drop > 0 && (!biggestLeak || drop > biggestLeak.dropVsTarget)) {
        biggestLeak = { key: a.key, label: a.label, dropVsTarget: drop };
      }
    }
  }

  return {
    interestSurplus: interested?.attainment ?? null,
    enrollmentAttainment: enrolled?.attainment ?? null,
    northStarAttainment: productive?.attainment ?? null,
    biggestLeak,
  };
}
