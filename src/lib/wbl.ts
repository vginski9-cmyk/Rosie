// WBL Alignment Engine.
//
// The research model profiles BOTH sides of a work-based-learning relationship
// across three layers: MOTIVATIONS (what each side wants), CONSTRAINTS (what is
// binding / non-negotiable on each side), and CAPACITIES (what each side brings).
// This engine scores how well a learner profile and an employer profile align —
// rewarding overlap, and hard-flagging when a binding constraint on one side has
// no counterpart on the other. Pure + testable.

export type WblLayer = "MOTIVATION" | "CONSTRAINT" | "CAPACITY";
export type Disclosure = "STATED" | "INFERRED" | "HIDDEN" | "UNKNOWN";

export interface WblFactorInput {
  layer: WblLayer;
  label: string;
  detail?: string | null;
  weight: number;
  binding: boolean;
  disclosure?: Disclosure | string;
  /** Key used to match a factor to a counterpart on the other side. */
  matchKey?: string | null;
}

export interface WblProfileInput {
  id: string;
  subjectType: "LEARNER" | "EMPLOYER";
  name: string;
  factors: WblFactorInput[];
}

const LAYERS: WblLayer[] = ["MOTIVATION", "CONSTRAINT", "CAPACITY"];

const keyOf = (f: WblFactorInput) =>
  (f.matchKey ?? f.label).toLowerCase().replace(/\s+/g, " ").trim();

/**
 * How much to trust a factor by how it surfaced. Stated facts count fully;
 * inferred/hidden/unknown discount the match — evidence quality matters.
 */
const DISCLOSURE_CONFIDENCE: Record<string, number> = { STATED: 1, INFERRED: 0.8, HIDDEN: 0.6, UNKNOWN: 0.5 };
const conf = (d?: string) => DISCLOSURE_CONFIDENCE[d ?? "STATED"] ?? 1;

/**
 * Context modifiers (life-stage, sector, etc.) shift how much each layer counts
 * toward the overall score. E.g. adult learners → weight CONSTRAINTS more, so an
 * unmet constraint hurts the match more. Defaults to 1 (neutral) per layer.
 */
export interface AlignmentContext {
  label?: string;
  emphasis?: Partial<Record<WblLayer, number>>;
}

/** A few illustrative presets drawn from the research model's modifiers. */
export const CONTEXT_PRESETS: Record<string, AlignmentContext> = {
  ADULT_LEARNER: { label: "Adult learner", emphasis: { CONSTRAINT: 1.6, MOTIVATION: 1.1 } },
  RECENT_GRAD: { label: "Recent HS grad", emphasis: { MOTIVATION: 1.3, CAPACITY: 1.1 } },
  HIGH_ACUITY_SECTOR: { label: "High-acuity clinical sector", emphasis: { CAPACITY: 1.4, CONSTRAINT: 1.2 } },
};

export interface MatchedFactor {
  key: string;
  learner: WblFactorInput;
  employer: WblFactorInput;
  strength: number;
}

export interface LayerAlignment {
  layer: WblLayer;
  /** Matched learner weight ÷ total learner weight on this layer (0–1). */
  score: number;
  matched: MatchedFactor[];
  learnerOnly: WblFactorInput[];
  employerOnly: WblFactorInput[];
}

export interface AlignmentResult {
  /** Weighted overall alignment (0–1). */
  score: number;
  /** False when any binding factor has no counterpart on the other side. */
  feasible: boolean;
  /** Average disclosure confidence of the matched factors (0–1). */
  confidence: number;
  /** The context label applied, if any. */
  context?: string;
  layers: Record<WblLayer, LayerAlignment>;
  /** Binding factors (either side) with no counterpart — the dealbreakers. */
  unmetBinding: { side: "LEARNER" | "EMPLOYER"; factor: WblFactorInput }[];
}

/** Score alignment between a learner profile and an employer profile. */
export function alignProfiles(
  learner: WblProfileInput,
  employer: WblProfileInput,
  context?: AlignmentContext,
): AlignmentResult {
  const empKeys = new Set(employer.factors.map(keyOf));
  const learnerKeys = new Set(learner.factors.map(keyOf));
  const emphasisOf = (layer: WblLayer) => context?.emphasis?.[layer] ?? 1;

  const layers = {} as Record<WblLayer, LayerAlignment>;
  let weightedMatched = 0;
  let weightedTotal = 0;
  let confSum = 0;
  let confCount = 0;

  // Counterparts are matched ACROSS layers by key: a learner MOTIVATION ("living
  // wage") is satisfied by an employer CAPACITY ("pays living wage"); an employer
  // CONSTRAINT ("ARRT required") is met by a learner CAPACITY ("ARRT-eligible").
  const empByKey = new Map<string, WblFactorInput>();
  for (const f of employer.factors) if (!empByKey.has(keyOf(f))) empByKey.set(keyOf(f), f);

  for (const layer of LAYERS) {
    const em = emphasisOf(layer);
    const lFactors = learner.factors.filter((f) => f.layer === layer);
    const eFactors = employer.factors.filter((f) => f.layer === layer);

    const matched: MatchedFactor[] = [];
    const learnerOnly: WblFactorInput[] = [];
    let layerWeight = 0;
    let layerMatched = 0;

    for (const lf of lFactors) {
      layerWeight += lf.weight;
      weightedTotal += lf.weight * em;
      const counterpart = empByKey.get(keyOf(lf));
      if (counterpart) {
        const c = Math.min(conf(lf.disclosure), conf(counterpart.disclosure));
        const strength = ((lf.weight + counterpart.weight) / 2) * c;
        matched.push({ key: keyOf(lf), learner: lf, employer: counterpart, strength });
        layerMatched += lf.weight;
        weightedMatched += lf.weight * em * c;
        confSum += c;
        confCount += 1;
      } else {
        learnerOnly.push(lf);
      }
    }
    const employerOnly = eFactors.filter((f) => !learnerKeys.has(keyOf(f)));

    layers[layer] = {
      layer,
      score: layerWeight > 0 ? layerMatched / layerWeight : 1,
      matched,
      learnerOnly,
      employerOnly,
    };
  }

  // Binding dealbreakers: a binding factor on one side with no key on the other.
  const unmetBinding: AlignmentResult["unmetBinding"] = [];
  for (const f of learner.factors) {
    if (f.binding && !empKeys.has(keyOf(f))) unmetBinding.push({ side: "LEARNER", factor: f });
  }
  for (const f of employer.factors) {
    if (f.binding && !learnerKeys.has(keyOf(f))) unmetBinding.push({ side: "EMPLOYER", factor: f });
  }

  const base = weightedTotal > 0 ? weightedMatched / weightedTotal : 0;
  // Each unmet binding constraint halves the score — a strong but not absolute penalty.
  const penalty = Math.pow(0.5, unmetBinding.length);

  return {
    score: base * penalty,
    feasible: unmetBinding.length === 0,
    confidence: confCount > 0 ? confSum / confCount : 1,
    context: context?.label,
    layers,
    unmetBinding,
  };
}

// ---------------------------------------------------------------------------
// Loop 2 — alignment → constrained placement
// ---------------------------------------------------------------------------

export interface EmployerSlots {
  employerId: string;
  name: string;
  slots: number;
  profile: WblProfileInput | null;
}

export interface PlacementEmployer {
  employerId: string;
  name: string;
  slots: number;
  /** Has an aligned profile and no binding dealbreaker. */
  feasible: boolean;
  score: number | null; // null when no profile to score against
  reason?: string;
}

export interface PlacementCapacity {
  /** Total WBL slots regardless of alignment. */
  raw: number;
  /** Slots from alignment-FEASIBLE employers only — what actually counts. */
  effective: number;
  /** Alignment-score-weighted slots (softer signal). */
  weighted: number;
  employers: PlacementEmployer[];
}

/**
 * Reconcile employer WBL capacity through the alignment lens: only slots from
 * employers whose profile is alignment-feasible for this learner cohort count
 * toward placement. Employers with no profile are treated as feasible (unknown,
 * not blocked) but contribute to a lower confidence elsewhere.
 */
export function effectivePlacementCapacity(
  learner: WblProfileInput | null,
  employers: EmployerSlots[],
  context?: AlignmentContext,
): PlacementCapacity {
  const rows: PlacementEmployer[] = employers.map((e) => {
    if (!learner || !e.profile) {
      return { employerId: e.employerId, name: e.name, slots: e.slots, feasible: true, score: null, reason: learner ? "no employer profile" : "no learner profile" };
    }
    const r = alignProfiles(learner, e.profile, context);
    return {
      employerId: e.employerId,
      name: e.name,
      slots: e.slots,
      feasible: r.feasible,
      score: r.score,
      reason: r.feasible ? undefined : r.unmetBinding.map((u) => u.factor.label).join("; "),
    };
  });

  const raw = rows.reduce((s, r) => s + r.slots, 0);
  const effective = rows.filter((r) => r.feasible).reduce((s, r) => s + r.slots, 0);
  const weighted = rows.reduce((s, r) => s + r.slots * (r.score ?? 1), 0);
  return { raw, effective, weighted, employers: rows };
}
