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
  layers: Record<WblLayer, LayerAlignment>;
  /** Binding factors (either side) with no counterpart — the dealbreakers. */
  unmetBinding: { side: "LEARNER" | "EMPLOYER"; factor: WblFactorInput }[];
}

/** Score alignment between a learner profile and an employer profile. */
export function alignProfiles(learner: WblProfileInput, employer: WblProfileInput): AlignmentResult {
  const empKeys = new Set(employer.factors.map(keyOf));
  const learnerKeys = new Set(learner.factors.map(keyOf));

  const layers = {} as Record<WblLayer, LayerAlignment>;
  let weightedMatched = 0;
  let weightedTotal = 0;

  // Counterparts are matched ACROSS layers by key: a learner MOTIVATION ("living
  // wage") is satisfied by an employer CAPACITY ("pays living wage"); an employer
  // CONSTRAINT ("ARRT required") is met by a learner CAPACITY ("ARRT-eligible").
  const empByKey = new Map<string, WblFactorInput>();
  for (const f of employer.factors) if (!empByKey.has(keyOf(f))) empByKey.set(keyOf(f), f);

  for (const layer of LAYERS) {
    const lFactors = learner.factors.filter((f) => f.layer === layer);
    const eFactors = employer.factors.filter((f) => f.layer === layer);

    const matched: MatchedFactor[] = [];
    const learnerOnly: WblFactorInput[] = [];
    let layerWeight = 0;
    let layerMatched = 0;

    for (const lf of lFactors) {
      layerWeight += lf.weight;
      const counterpart = empByKey.get(keyOf(lf));
      if (counterpart) {
        const strength = (lf.weight + counterpart.weight) / 2;
        matched.push({ key: keyOf(lf), learner: lf, employer: counterpart, strength });
        layerMatched += lf.weight;
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
    weightedMatched += layerMatched;
    weightedTotal += layerWeight;
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
    layers,
    unmetBinding,
  };
}
