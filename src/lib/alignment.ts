// The Alignment Engine — computed positioning for WBL intake.
//
// The ~700-leaf taxonomy is BACKGROUND vocabulary; what ships here is a curated,
// healthcare-relevant subset that intake staff can tag quickly, plus the computed
// outputs the framework exists to produce:
//   · quadrant position     ← tiers (settledness) × binding constraints (capacity)
//   · recommended WBL modes ← motivations × tiers, filtered by constraints
//   · configuration notes   ← Tier-1 motivations × constraints × capacities
//   · MVD intake requirement← sensitivity across the profile × placement stakes
//   · pairing readout       ← learner quadrant × employer quadrant + gap flags
//   · cohort aggregation    ← pooled blends/constraints → clinical design, asks,
//                             support services
// Pure TS (no Prisma, no React) → unit-testable.

export type Layer = "MOTIVATION" | "CONSTRAINT" | "CAPACITY";
export type Side = "LEARNER" | "EMPLOYER";

export interface Leaf {
  code: string;
  family: string; // family code, e.g. "A", "H", "EC3", "EP2"
  familyLabel: string;
  label: string;
  hint?: string;
  /// consequence-bearing / stigmatized — drives MVD + confidentiality handling
  sensitive?: boolean;
}

// ---------------------------------------------------------------------------
// CURATED TAXONOMY (healthcare / Radiography slice; codes match the framework)
// ---------------------------------------------------------------------------

export const LEARNER_MOTIVATIONS: Leaf[] = [
  { code: "A.1.a", family: "A", familyLabel: "Vocational direction", label: "Broad field exploration", hint: "sampling unfamiliar fields, no working hypothesis" },
  { code: "A.1.b", family: "A", familyLabel: "Vocational direction", label: "Hypothesis testing", hint: "testing a specific candidate identity (\"is imaging for me?\")" },
  { code: "A.2.a", family: "A", familyLabel: "Vocational direction", label: "Identity confirmation", hint: "confirming a settled direction through experience" },
  { code: "A.3.a", family: "A", familyLabel: "Vocational direction", label: "Entry-credential building", hint: "accumulating required experience for field entry" },
  { code: "A.3.c", family: "A", familyLabel: "Vocational direction", label: "Specialization development", hint: "advancing toward MRI / CT / mammography" },
  { code: "A.4.a", family: "A", familyLabel: "Vocational direction", label: "Sector transition", hint: "moving into healthcare from another industry" },
  { code: "A.4.d", family: "A", familyLabel: "Vocational direction", label: "Forced transition", hint: "displacement-driven change, not elective", sensitive: true },
  { code: "B.1.a", family: "B", familyLabel: "Economic & material", label: "Immediate income need", hint: "must earn during the placement", sensitive: true },
  { code: "B.2.b", family: "B", familyLabel: "Economic & material", label: "Employer-sponsored health benefits", hint: "insurance is the real engine — often under-disclosed", sensitive: true },
  { code: "B.3.a", family: "B", familyLabel: "Economic & material", label: "Wage above current job", hint: "pays better than retail/current work" },
  { code: "B.4.a", family: "B", familyLabel: "Economic & material", label: "Stability & security", hint: "predictable, durable employment" },
  { code: "C.1.a", family: "C", familyLabel: "Developmental & growth", label: "Skill acquisition", hint: "becoming more capable, not path-specific" },
  { code: "C.2.a", family: "C", familyLabel: "Developmental & growth", label: "Professional identity formation", hint: "feeling like a professional, not a student" },
  { code: "D.1.a", family: "D", familyLabel: "Identity, belonging, meaning", label: "Service to patients", hint: "often conditional on the economic floor holding" },
  { code: "D.2.b", family: "D", familyLabel: "Identity, belonging, meaning", label: "Representation", hint: "\"someone like me\" in this field", sensitive: true },
  { code: "D.3.b", family: "D", familyLabel: "Identity, belonging, meaning", label: "Family / community pride", hint: "doing it partly for family" },
  { code: "E.1.a", family: "E", familyLabel: "External & relational", label: "Program requirement", hint: "the externship/rotation is required" },
  { code: "E.2.a", family: "E", familyLabel: "External & relational", label: "Family expectation", hint: "path inherited or expected by others", sensitive: true },
  { code: "F.1.a", family: "F", familyLabel: "Strategic positioning", label: "Credential signaling", hint: "optionality for futures not fully known" },
  { code: "F.3.a", family: "F", familyLabel: "Strategic positioning", label: "Professional network building", hint: "contacts the learner has never had" },
];

export const LEARNER_CONSTRAINTS: Leaf[] = [
  { code: "G.1.a", family: "G", familyLabel: "Time", label: "Work-hours conflict", hint: "current job hours collide with placement hours" },
  { code: "G.2.a", family: "G", familyLabel: "Time", label: "Needs schedule predictability", hint: "variable schedules are infeasible" },
  { code: "G.3.b", family: "G", familyLabel: "Time", label: "Daytime weekdays unavailable", hint: "evenings/weekends only" },
  { code: "H.1.c", family: "H", familyLabel: "Financial", label: "Earnings floor", hint: "must earn at least part-time wage — strikes unpaid configs", sensitive: true },
  { code: "H.4.d", family: "H", familyLabel: "Financial", label: "No financial cushion", hint: "no one to lean on; zero slack", sensitive: true },
  { code: "H.6.a", family: "H", familyLabel: "Financial", label: "Benefits cliff", hint: "earning more costs Medicaid/SNAP — stipends must be structured", sensitive: true },
  { code: "I.1.c", family: "I", familyLabel: "Geographic", label: "Location-bound", hint: "tied to kids' school / housing" },
  { code: "I.2.b", family: "I", familyLabel: "Geographic", label: "Unreliable transport", hint: "car trouble = missed shifts" },
  { code: "I.3.a", family: "I", familyLabel: "Geographic", label: "Transit-dependent", hint: "site must be on a transit line" },
  { code: "J.1.a", family: "J", familyLabel: "Caregiving", label: "Childcare responsibilities", hint: "school-age kids; hours must fit" },
  { code: "J.2.a", family: "J", familyLabel: "Caregiving", label: "Eldercare responsibilities" },
  { code: "J.4.b", family: "J", familyLabel: "Caregiving", label: "No backup care", hint: "a sick kid means an absence — design for it" },
  { code: "K.1.a", family: "K", familyLabel: "Health & disability", label: "Physical limitation", hint: "lifting / standing accommodations", sensitive: true },
  { code: "K.3.a", family: "K", familyLabel: "Health & disability", label: "Health accommodation need", sensitive: true },
  { code: "L.1.a", family: "L", familyLabel: "Legal & status", label: "Credential non-transfer", hint: "foreign clinical credentials don't map", sensitive: true },
  { code: "L.2.a", family: "L", familyLabel: "Legal & status", label: "Background-check concern", sensitive: true },
  { code: "M.1.a", family: "M", familyLabel: "Infrastructure", label: "Device / internet access" },
  { code: "N.1.a", family: "N", familyLabel: "Educational status", label: "Prerequisites incomplete", hint: "gateway courses still ahead" },
  { code: "O.2.a", family: "O", familyLabel: "Network & informational", label: "First-generation navigation", hint: "no map of how college/careers work" },
  { code: "P.1.a", family: "P", familyLabel: "Capacity of the moment", label: "High life-event load", hint: "this season is full", sensitive: true },
];

export const LEARNER_CAPACITIES: Leaf[] = [
  { code: "Q.1", family: "Q", familyLabel: "Prior work experience", label: "Direct field experience", hint: "CNA, MA, imaging aide…" },
  { code: "Q.7", family: "Q", familyLabel: "Prior work experience", label: "Caregiving as work experience", hint: "years of caregiving the system doesn't count — but is" },
  { code: "R.1", family: "R", familyLabel: "Educational capital", label: "Prior degree / credits" },
  { code: "R.3", family: "R", familyLabel: "Educational capital", label: "Foreign clinical credential", hint: "clinical officer, nurse, tech trained abroad" },
  { code: "S.1", family: "S", familyLabel: "Social & network capital", label: "Field contacts" },
  { code: "T.1", family: "T", familyLabel: "Cultural capital", label: "Workplace fluency" },
  { code: "U.4", family: "U", familyLabel: "Lived experience", label: "Caregiving lived experience", hint: "maps directly onto patient care" },
  { code: "U.7", family: "U", familyLabel: "Lived experience", label: "Community background as asset", hint: "serves the patients this clinic actually sees" },
  { code: "W.1", family: "W", familyLabel: "Demonstrated capacity", label: "Portfolio / competency evidence" },
  { code: "X.1", family: "X", familyLabel: "Time & energy", label: "Full availability", hint: "genuinely open schedule" },
];

export const EMPLOYER_MOTIVATIONS: Leaf[] = [
  { code: "EA.1.a", family: "EA", familyLabel: "Talent acquisition", label: "Pipeline construction", hint: "build a durable hiring pipeline" },
  { code: "EA.1.b", family: "EA", familyLabel: "Talent acquisition", label: "Try-before-hire", hint: "evaluate candidates in real work" },
  { code: "EA.1.d", family: "EA", familyLabel: "Talent acquisition", label: "Succession pressure", hint: "retirement wave / demographic cliff" },
  { code: "EB.1.a", family: "EB", familyLabel: "Workforce development", label: "Upskill incumbent staff", hint: "CNA→tech, tech→MRI/CT" },
  { code: "EB.2.a", family: "EB", familyLabel: "Workforce development", label: "Preceptor / mentor development", hint: "growing their own teachers" },
  { code: "EC.1.a", family: "ECi", familyLabel: "Strategic intelligence", label: "Curriculum influence", hint: "shape what graduates can do" },
  { code: "ED.1.a", family: "ED", familyLabel: "External positioning", label: "Community reputation" },
  { code: "ED.2.a", family: "ED", familyLabel: "External positioning", label: "Diversity signaling", hint: "may mask cost-labor operating motive", sensitive: true },
  { code: "EE.1.a", family: "EE", familyLabel: "Obligation & relational", label: "Teaching-status / accreditation requirement", hint: "hosting is required of them" },
  { code: "EE.2.a", family: "EE", familyLabel: "Obligation & relational", label: "Long-standing partnership", hint: "relationship obligation, not strategy" },
];

export const EMPLOYER_CONSTRAINTS: Leaf[] = [
  { code: "EC1.a", family: "EC1", familyLabel: "Supervisory capacity", label: "Preceptor bandwidth exhausted", hint: "no one left to supervise learners" },
  { code: "EC1.b", family: "EC1", familyLabel: "Supervisory capacity", label: "Preceptor burnout risk" },
  { code: "EC2.a", family: "EC2", familyLabel: "Work availability", label: "Case-volume variability", hint: "can't guarantee exposure" },
  { code: "EC2.b", family: "EC2", familyLabel: "Work availability", label: "Limited modality access", hint: "no MRI/CT rotations available" },
  { code: "EC3.a", family: "EC3", familyLabel: "Financial", label: "No stipend budget", hint: "cannot pay learners" },
  { code: "EC4.a", family: "EC4", familyLabel: "Regulatory & liability", label: "Supervision-ratio limits", hint: "ARRT/state ratios cap learner count" },
  { code: "EC4.b", family: "EC4", familyLabel: "Regulatory & liability", label: "Compliance / liability restrictions" },
  { code: "EC5.a", family: "EC5", familyLabel: "Organizational bandwidth", label: "Onboarding overhead", hint: "EHR access, badging, HR process" },
  { code: "EC5.b", family: "EC5", familyLabel: "Organizational bandwidth", label: "Leadership instability", hint: "champions leave; commitments wobble", sensitive: true },
  { code: "EC6.a", family: "EC6", familyLabel: "Geographic & physical", label: "Day-shift hosting only", hint: "no evening/weekend supervision" },
  { code: "EC6.b", family: "EC6", familyLabel: "Geographic & physical", label: "Space / station limits" },
  { code: "EC7.a", family: "EC7", familyLabel: "Conversion & pathway", label: "No headcount to hire", hint: "hosts but can't convert", sensitive: true },
  { code: "EC7.b", family: "EC7", familyLabel: "Conversion & pathway", label: "Wage ceiling below market" },
];

export const EMPLOYER_CAPACITIES: Leaf[] = [
  { code: "EP1.a", family: "EP1", familyLabel: "Developmental environment", label: "Named supervision", hint: "a real preceptor with time carved out" },
  { code: "EP1.b", family: "EP1", familyLabel: "Developmental environment", label: "Structured rotation plan" },
  { code: "EP2.a", family: "EP2", familyLabel: "Work substance", label: "Full modality exposure", hint: "DR, fluoro, CT, MRI, mammo" },
  { code: "EP2.b", family: "EP2", familyLabel: "Work substance", label: "Real case volume" },
  { code: "EP3.a", family: "EP3", familyLabel: "Credentialing & signaling", label: "Competency sign-off authority" },
  { code: "EP4.a", family: "EP4", familyLabel: "Network & placement", label: "Cross-department / system reach" },
  { code: "EP5.a", family: "EP5", familyLabel: "Identity-affirming environment", label: "Affirming, representative workplace" },
  { code: "EP6.a", family: "EP6", familyLabel: "Conversion & durability", label: "Benefits-eligible roles to convert into" },
  { code: "EP6.b", family: "EP6", familyLabel: "Conversion & durability", label: "Advancement pathways (MRI/CT premium)" },
  { code: "EP6.c", family: "EP6", familyLabel: "Conversion & durability", label: "Evening / weekend hosting", hint: "can supervise outside day shift" },
  { code: "EP6.d", family: "EP6", familyLabel: "Conversion & durability", label: "Stipend / paid-placement budget" },
];

export const ALL_LEAVES = new Map<string, Leaf>(
  [...LEARNER_MOTIVATIONS, ...LEARNER_CONSTRAINTS, ...LEARNER_CAPACITIES, ...EMPLOYER_MOTIVATIONS, ...EMPLOYER_CONSTRAINTS, ...EMPLOYER_CAPACITIES].map((l) => [l.code, l]),
);

// ---------------------------------------------------------------------------
// PROFILE + TAG SHAPES (mirror the Prisma rows, engine-side)
// ---------------------------------------------------------------------------

export interface Tag {
  layer: Layer;
  code: string;
  tier?: number | null; // motivations: 1 driving · 2 shaping · 3 active · 4 latent
  binding?: boolean; // constraints
  conditionalOn?: string | null; // motivations: leaf code this depends on
  note?: string | null;
}
export interface Profile {
  side: Side;
  tags: Tag[];
}

export const TIER_LABEL: Record<number, string> = { 1: "Driving", 2: "Shaping", 3: "Active", 4: "Latent" };

const motiv = (p: Profile) => p.tags.filter((t) => t.layer === "MOTIVATION");
const constr = (p: Profile) => p.tags.filter((t) => t.layer === "CONSTRAINT");
const capac = (p: Profile) => p.tags.filter((t) => t.layer === "CAPACITY");
const hasCode = (p: Profile, code: string, layer?: Layer) => p.tags.some((t) => t.code === code && (!layer || t.layer === layer));
const famOf = (code: string) => ALL_LEAVES.get(code)?.family ?? code.split(".")[0];

// ---------------------------------------------------------------------------
// QUADRANT — settledness (from tiers) × operating capacity (from binding constraints)
// ---------------------------------------------------------------------------

export interface QuadrantResult {
  side: Side;
  quadrant: "Q1" | "Q2" | "Q3" | "Q4";
  name: string;
  settled: boolean;
  highCapacity: boolean;
  bindingFamilies: string[]; // constraint families with a binding leaf
  reasoning: string[];
}

const LEARNER_Q: Record<string, string> = { Q1: "Aligned and Equipped", Q2: "Aligned but Constrained", Q3: "Exploring with Room", Q4: "Exploring under Pressure" };
const EMPLOYER_Q: Record<string, string> = { Q1: "Strategic Builders", Q2: "Strategic but Stretched", Q3: "Open Supporter", Q4: "Reluctant or Obligated" };

export function computeQuadrant(p: Profile): QuadrantResult {
  const reasoning: string[] = [];
  const driving = motiv(p).filter((t) => t.tier === 1);

  // Settledness: a clear Tier-1 that is NOT exploration reads as settled.
  let settled: boolean;
  if (driving.length === 0) {
    settled = false;
    reasoning.push("Settledness: no motivation is marked as driving — nothing has been identified as Tier 1.");
  } else {
    const explorationDriving = driving.filter((t) => t.code.startsWith("A.1"));
    const famSet = new Set(driving.map((t) => famOf(t.code)));
    if (explorationDriving.length > 0) {
      settled = false;
      reasoning.push("Settledness: the driving motivation is exploration (A.1) — direction is still being tested.");
    } else if (famSet.size > 2) {
      settled = false;
      reasoning.push(`Settledness: driving motives scatter across ${famSet.size} families — the blend hasn't settled.`);
    } else {
      settled = true;
      const names = driving.map((t) => `${ALL_LEAVES.get(t.code)?.label ?? t.code} (${t.code})`).join("; ");
      reasoning.push(`Settledness: clear Tier-1 — ${names}.`);
    }
  }

  // Operating capacity: count constraint FAMILIES with a binding leaf.
  const bindingFams = [...new Set(constr(p).filter((t) => t.binding).map((t) => famOf(t.code)))];
  const highCapacity = bindingFams.length < 2;
  const famLabels = bindingFams.map((f) => LEAF_FAMILY_LABEL(f)).join(", ");
  reasoning.push(
    bindingFams.length === 0
      ? "Operating capacity: no binding constraints — real room to act."
      : `Operating capacity: ${bindingFams.length} binding constraint famil${bindingFams.length === 1 ? "y" : "ies"} (${famLabels}) limit${bindingFams.length === 1 ? "s" : ""} which placements are feasible.`,
  );

  const quadrant = settled ? (highCapacity ? "Q1" : "Q2") : (highCapacity ? "Q3" : "Q4");
  const name = (p.side === "LEARNER" ? LEARNER_Q : EMPLOYER_Q)[quadrant];
  return { side: p.side, quadrant, name, settled, highCapacity, bindingFamilies: bindingFams, reasoning };
}

function LEAF_FAMILY_LABEL(family: string): string {
  const anyLeaf = [...ALL_LEAVES.values()].find((l) => l.family === family);
  return anyLeaf?.familyLabel.toLowerCase() ?? family;
}

// ---------------------------------------------------------------------------
// RECOMMENDED WBL MODES — motivations × tiers, filtered by constraints
// ---------------------------------------------------------------------------

export interface WblMode {
  key: string;
  label: string;
  blurb: string;
  paid: boolean;
  stakes: 1 | 2 | 3; // MVD stakes tier this mode demands
}
export const WBL_MODES: WblMode[] = [
  { key: "OBS", label: "Job Shadow / Observation", blurb: "Short observational exposure; no productive work.", paid: false, stakes: 1 },
  { key: "PRE", label: "Pre-Apprenticeship / Career Exposure", blurb: "Structured exploration: tours, panels, modality exposure, HOSA-style programming.", paid: false, stakes: 1 },
  { key: "INT-S", label: "Short Project Internship", blurb: "Under-semester project placement with light supervision.", paid: false, stakes: 2 },
  { key: "INT-L", label: "Substantive Internship", blurb: "Semester-plus placement with substantive work and named supervision.", paid: false, stakes: 2 },
  { key: "CLIN", label: "Clinical Rotation", blurb: "Program-required, competency-bearing clinical education at a partner site.", paid: false, stakes: 3 },
  { key: "APP", label: "Registered Apprenticeship", blurb: "Multi-year structured earn-and-learn with wage progression and credential outcome.", paid: true, stakes: 3 },
  { key: "INC", label: "Incumbent-Worker Structure", blurb: "Employer-sponsored upskilling for current employees (CNA→tech, tech→MRI/CT).", paid: true, stakes: 2 },
];

export interface ModeRec {
  mode: WblMode;
  signals: number;
  because: string[];
  struck: boolean;
  struckBecause?: string;
  variantNotes: string[]; // e.g. "evening/weekend configuration"
}

export function recommendModes(p: Profile): ModeRec[] {
  const m = motiv(p);
  const tierOf = (code: string) => m.find((t) => t.code === code)?.tier ?? 9;
  const weighted = (codes: string[], max = 2) => codes.filter((c) => tierOf(c) <= max);
  const recs = new Map<string, { signals: number; because: string[] }>();
  const add = (key: string, because: string) => {
    const r = recs.get(key) ?? { signals: 0, because: [] };
    r.signals += 1;
    r.because.push(because);
    recs.set(key, r);
  };

  if (p.side === "LEARNER") {
    // Economic driving/shaping → paid structures.
    if (weighted(["B.1.a", "B.2.b", "B.3.a", "B.4.a"]).length) {
      add("APP", "economic motivation needs paid structures with wage progression");
      add("INC", "if already employed in the sector, incumbent upskilling pays while training");
    }
    // Entry-credential building → clinical rotation (it IS the requirement).
    if (weighted(["A.3.a", "E.1.a"]).length) add("CLIN", "entry to the field runs through the required clinical rotation");
    // Specialization → incumbent / advanced rotation.
    if (weighted(["A.3.c"]).length) add("INC", "modality advancement (MRI/CT) is an incumbent-worker structure");
    // Exploration driving → low-stakes modes.
    if (weighted(["A.1.a", "A.1.b"]).length) {
      add("OBS", "exploration is served by observation before commitment");
      add("PRE", "structured exposure tests the hypothesis cheaply");
    }
    // Network building → substantive placements.
    if (weighted(["F.3.a"], 3).length) add("INT-L", "network formation needs sustained, named-supervision placements");
    // Professional identity → substantive/clinical.
    if (weighted(["C.2.a"]).length) add("CLIN", "professional identity forms through real clinical work");
  } else {
    if (weighted(["EA.1.a", "EA.1.b"]).length) {
      add("APP", "employer pipeline is well-served by apprenticeship");
      add("INT-L", "pipeline construction is served by sustained placements");
      add("CLIN", "hosting rotations builds the evaluation pipeline");
    }
    if (weighted(["EA.1.d", "EB.1.a"]).length) add("INC", "workforce development / succession runs through incumbent structures");
    if (weighted(["ED.1.a", "EE.2.a"], 3).length) add("OBS", "reputation and relationship goals are met by low-lift exposure hosting");
    if (weighted(["EE.1.a"]).length) add("CLIN", "teaching status requires hosting clinical education");
  }

  // Constraint filters.
  const c = constr(p).filter((t) => t.binding);
  const earningsFloor = c.some((t) => ["H.1.c", "H.4.d", "B.1.a"].includes(t.code)) || (p.side === "LEARNER" && m.some((t) => t.tier === 1 && t.code.startsWith("B.")));
  const noDaytime = c.some((t) => t.code === "G.3.b");
  const noStipend = c.some((t) => t.code === "EC3.a");
  const dayOnly = c.some((t) => t.code === "EC6.a");

  return WBL_MODES.map((mode) => {
    const r = recs.get(mode.key) ?? { signals: 0, because: [] };
    let struck = false;
    let struckBecause: string | undefined;
    const variantNotes: string[] = [];
    if (p.side === "LEARNER" && earningsFloor && !mode.paid && mode.key !== "OBS" && mode.key !== "PRE") {
      // Unpaid substantive placements are struck; short observation survives.
      struck = true;
      struckBecause = "an earnings floor strikes unpaid configurations — this only works with a stipend/paid structure";
    }
    if (p.side === "LEARNER" && noDaytime && ["CLIN", "INT-L", "APP"].includes(mode.key) && !struck) {
      variantNotes.push("evening / weekend configuration required (daytime weekdays unavailable)");
    }
    if (p.side === "EMPLOYER" && noStipend && mode.paid) {
      struck = true;
      struckBecause = "no stipend budget — paid structures need external funding or aren't hostable here";
    }
    if (p.side === "EMPLOYER" && dayOnly && ["CLIN", "INT-L", "APP"].includes(mode.key) && !struck) {
      variantNotes.push("day-shift hosting only — can't serve evening-constrained learners");
    }
    return { mode, signals: r.signals, because: r.because, struck, struckBecause, variantNotes };
  }).sort((a, b) => (Number(a.struck) - Number(b.struck)) || b.signals - a.signals);
}

// ---------------------------------------------------------------------------
// CONFIGURATION GUIDANCE — Tier-1 motivations × constraints × capacities
// ---------------------------------------------------------------------------

export interface ConfigNote { topic: string; note: string }

export function configGuidance(p: Profile): ConfigNote[] {
  const out: ConfigNote[] = [];
  const c = constr(p).filter((t) => t.binding);
  const has = (code: string) => c.some((t) => t.code === code);
  const m = motiv(p);

  if (p.side === "LEARNER") {
    if (m.some((t) => t.tier && t.tier <= 2 && t.code.startsWith("B.")) || has("H.1.c")) {
      out.push({ topic: "Compensation", note: "Paid is strongly preferred; an economic motivation or earnings floor is active." });
    }
    if (has("H.6.a")) out.push({ topic: "Compensation structure", note: "Benefits cliff active — structure any stipend to stay under the cliff while pointing toward a benefits-eligible role." });
    if (has("I.1.c") || has("I.2.b") || has("I.3.a")) {
      const why = [has("I.1.c") && "location-bound", has("I.2.b") && "unreliable transport", has("I.3.a") && "transit-dependent"].filter(Boolean).join("; ");
      out.push({ topic: "Location", note: `Proximity matters (${why}). Reconcile against the employer's site pattern.` });
    }
    if (has("G.3.b") || has("J.1.a") || has("J.4.b")) out.push({ topic: "Schedule", note: "Evening/weekend design with predictable hours; build absence tolerance for care events rather than penalizing them." });
    const caps = capac(p);
    if (caps.some((t) => ["Q.7", "U.4", "R.3", "Q.1"].includes(t.code))) {
      out.push({ topic: "Capacity recognition", note: "Run an explicit prior-learning / capacity-recognition step. Placing this learner as a novice wastes real experience." });
    }
    const conditional = m.find((t) => t.conditionalOn);
    if (conditional) {
      const on = ALL_LEAVES.get(conditional.conditionalOn!)?.label ?? conditional.conditionalOn;
      out.push({ topic: "Conditional cascade risk", note: `${ALL_LEAVES.get(conditional.code)?.label ?? conditional.code} operates conditionally on "${on}" — violate the condition and the motivation collapses with it (F.10).` });
    }
  } else {
    if (has("EC1.a") || has("EC1.b")) out.push({ topic: "Supervision", note: "Preceptor bandwidth is the binding constraint — fund preceptor stipends/development before adding learners." });
    if (has("EC7.a")) out.push({ topic: "Conversion honesty", note: "No headcount to hire — do NOT run conversion-intent placements here; be explicit with learners that this is a training site." });
    if (has("EC6.a")) out.push({ topic: "Schedule coverage", note: "Day-shift only — this partner can't serve the evening-constrained share of the cohort." });
    if (has("EC4.a")) out.push({ topic: "Ratios", note: "Supervision-ratio limits cap learners per rotation — plan section sizes against it." });
    const caps = capac(p);
    if (caps.some((t) => t.code === "EP6.c")) out.push({ topic: "Schedule coverage", note: "Evening/weekend hosting available — route evening-constrained learners here first." });
    if (caps.some((t) => t.code === "EP6.d")) out.push({ topic: "Compensation", note: "Stipend budget exists — pair with earnings-floor learners." });
  }
  return out;
}

// ---------------------------------------------------------------------------
// MVD — intake requirement from sensitivity × stakes
// ---------------------------------------------------------------------------

export interface MvdResult { tier: 1 | 2 | 3; reasons: string[] }

export function mvdRequirement(p: Profile, plannedModeKey?: string): MvdResult {
  const reasons: string[] = [];
  let tier: 1 | 2 | 3 = 1;
  const sensitive = p.tags.filter((t) => ALL_LEAVES.get(t.code)?.sensitive);
  if (sensitive.length) {
    tier = 2;
    reasons.push(`${sensitive.length} consequence-bearing leaf${sensitive.length === 1 ? "" : "s"} tagged (e.g. ${ALL_LEAVES.get(sensitive[0].code)?.label}) — narrative intake with confidentiality assurances required.`);
  }
  const mode = WBL_MODES.find((m) => m.key === plannedModeKey);
  if (mode && mode.stakes >= 3) {
    tier = 3;
    reasons.push(`${mode.label} is a high-stakes placement — full MVD.3 intake (narrative + constraint + capacity-recognition conversations, midpoint + exit touchpoints).`);
  } else if (mode && mode.stakes === 2 && tier < 2) {
    tier = 2;
    reasons.push(`${mode.label} is medium-stakes — intake conversation (not a form) required.`);
  }
  if (!reasons.length) reasons.push("Low-stakes profile — open-format prompt + exit touchpoint suffices.");
  return { tier, reasons };
}

// ---------------------------------------------------------------------------
// PAIRING — learner × employer readout with gap flags
// ---------------------------------------------------------------------------

export interface PairingResult {
  headline: string;
  tone: "good" | "workable" | "caution";
  gaps: string[];
}

export function pairing(learner: Profile, employer: Profile): PairingResult {
  const lq = computeQuadrant(learner);
  const eq = computeQuadrant(employer);
  const gaps: string[] = [];
  const lBind = constr(learner).filter((t) => t.binding);
  const eBind = constr(employer).filter((t) => t.binding);
  const lm = motiv(learner);

  const lNeedsPaid = lBind.some((t) => ["H.1.c", "H.4.d"].includes(t.code)) || lm.some((t) => t.tier === 1 && t.code.startsWith("B."));
  if (lNeedsPaid && eBind.some((t) => t.code === "EC3.a")) gaps.push("Learner needs a paid structure; employer has no stipend budget — external funding or a different site.");
  if (lBind.some((t) => t.code === "G.3.b") && eBind.some((t) => t.code === "EC6.a")) gaps.push("Learner is evenings/weekends-only; employer hosts day-shift only — schedule mismatch is disqualifying as-is.");
  if (lm.some((t) => t.tier && t.tier <= 2 && ["B.4.a", "A.3.a"].includes(t.code)) && eBind.some((t) => t.code === "EC7.a")) gaps.push("Learner is building toward a real job; employer has no headcount to convert — name it upfront or expect F-mode failure.");
  if (lBind.some((t) => ["I.1.c", "I.2.b", "I.3.a"].includes(t.code))) gaps.push("Learner is location/transport-bound — verify the actual site distance before committing.");
  const conditional = lm.find((t) => t.conditionalOn);
  if (conditional && lNeedsPaid && eBind.some((t) => t.code === "EC3.a")) gaps.push("Conditional cascade risk: the service motivation collapses if the economic floor fails at this site (F.10).");

  const tone: PairingResult["tone"] = gaps.length === 0 ? "good" : gaps.length <= 2 ? "workable" : "caution";
  const headline = `${lq.quadrant} learner × ${eq.quadrant} employer. ${describePair(lq, eq, tone)}`;
  return { headline, tone, gaps };
}

function describePair(lq: QuadrantResult, eq: QuadrantResult, tone: string): string {
  const l = lq.name.toLowerCase();
  const e = eq.name.toLowerCase();
  if (tone === "good") return `A ${l} learner meets a ${e} employer. Strong fit — design normally.`;
  if (tone === "workable") return `A ${l} learner meets a ${e} employer. Workable, but watch the gaps flagged below before committing.`;
  return `A ${l} learner meets a ${e} employer. Multiple structural gaps — redesign the configuration or choose a different site.`;
}

// ---------------------------------------------------------------------------
// COHORT AGGREGATION — pooled blends → clinical design, employer asks, supports
// ---------------------------------------------------------------------------

export interface CohortRollup {
  n: number;
  quadrants: Record<string, number>;
  drivingByFamily: { family: string; label: string; count: number }[];
  bindingCounts: { code: string; label: string; count: number; share: number }[];
  modeDemand: { key: string; label: string; count: number }[];
  eveningShare: number; // % needing evening/weekend
  paidShare: number; // % needing paid structures
  clinicalDesign: string[];
  employerAsks: string[];
  supportServices: { service: string; because: string; count: number }[];
}

export function cohortRollup(profiles: Profile[]): CohortRollup {
  const n = profiles.length;
  const quadrants: Record<string, number> = {};
  const drivingFam = new Map<string, number>();
  const bindingCount = new Map<string, number>();
  const modeCount = new Map<string, number>();
  let evening = 0, paid = 0;

  for (const p of profiles) {
    const q = computeQuadrant(p);
    quadrants[q.quadrant] = (quadrants[q.quadrant] ?? 0) + 1;
    for (const t of motiv(p).filter((t) => t.tier === 1)) {
      const fam = famOf(t.code);
      drivingFam.set(fam, (drivingFam.get(fam) ?? 0) + 1);
    }
    const binds = constr(p).filter((t) => t.binding);
    for (const t of binds) bindingCount.set(t.code, (bindingCount.get(t.code) ?? 0) + 1);
    if (binds.some((t) => ["G.3.b", "J.1.a", "J.4.b", "G.1.a"].includes(t.code))) evening += 1;
    const needsPaid = binds.some((t) => ["H.1.c", "H.4.d"].includes(t.code)) || motiv(p).some((t) => t.tier === 1 && t.code.startsWith("B."));
    if (needsPaid) paid += 1;
    const top = recommendModes(p).filter((r) => !r.struck && r.signals > 0).slice(0, 2);
    for (const r of top) modeCount.set(r.mode.key, (modeCount.get(r.mode.key) ?? 0) + 1);
  }

  const eveningShare = n ? evening / n : 0;
  const paidShare = n ? paid / n : 0;

  const clinicalDesign: string[] = [];
  if (eveningShare > 0) clinicalDesign.push(`${Math.round(eveningShare * 100)}% of profiled learners need evening/weekend clinical configurations — schedule that share of rotation slots outside day shift.`);
  if (paidShare > 0) clinicalDesign.push(`${Math.round(paidShare * 100)}% need paid/stipended structures — unpaid daytime rotations will silently shed them (F.16).`);
  const ratioNote = bindingCount.get("J.4.b");
  if (ratioNote) clinicalDesign.push(`${ratioNote} learner(s) have no backup care — build absence-tolerant scheduling into clinical expectations.`);

  const employerAsks: string[] = [];
  if (evening > 0) employerAsks.push(`Ask partners for ${evening} evening/weekend rotation slot${evening === 1 ? "" : "s"} (EP6.c sites first).`);
  if (paid > 0) employerAsks.push(`Ask partners (or braid funding) for ${paid} stipended placement${paid === 1 ? "" : "s"} structured under benefits cliffs where flagged.`);
  const conv = profiles.filter((p) => motiv(p).some((t) => t.tier === 1 && ["B.4.a", "A.3.a", "B.2.b"].includes(t.code))).length;
  if (conv > 0) employerAsks.push(`${conv} learner${conv === 1 ? " is" : "s are"} conversion-intent — prioritize partners with headcount + benefits-eligible roles (EP6.a).`);

  const SUPPORT_MAP: { codes: string[]; service: string; because: string }[] = [
    { codes: ["J.1.a", "J.4.b", "J.2.a"], service: "Childcare-aligned scheduling + childcare subsidy partnership", because: "caregiving constraints" },
    { codes: ["H.6.a"], service: "Benefits-cliff advising + stipend structuring", because: "benefits cliffs" },
    { codes: ["H.1.c", "H.4.d"], service: "Earn-while-you-learn structures / emergency micro-grants", because: "earnings floors, no cushion" },
    { codes: ["I.2.b", "I.3.a", "I.1.c"], service: "Transportation support + proximity-first site matching", because: "transport/location constraints" },
    { codes: ["O.2.a"], service: "First-generation navigation advising (proactive, milestone-tied)", because: "first-generation navigation" },
    { codes: ["N.1.a"], service: "Prereq/gateway-course support and milestone advising", because: "incomplete prerequisites" },
    { codes: ["L.1.a"], service: "Credential-evaluation & bridge pathway support", because: "foreign credential non-transfer" },
    { codes: ["K.1.a", "K.3.a"], service: "Accommodation planning with clinical sites", because: "health & disability accommodations" },
  ];
  const supportServices = SUPPORT_MAP.map((s) => {
    const count = profiles.filter((p) => constr(p).some((t) => t.binding && s.codes.includes(t.code))).length;
    return { service: s.service, because: s.because, count };
  }).filter((s) => s.count > 0).sort((a, b) => b.count - a.count);

  const FAMILY_LABELS: Record<string, string> = { A: "Vocational direction", B: "Economic & material", C: "Developmental & growth", D: "Identity, belonging, meaning", E: "External & relational", F: "Strategic positioning" };
  return {
    n,
    quadrants,
    drivingByFamily: [...drivingFam.entries()].map(([family, count]) => ({ family, label: FAMILY_LABELS[family] ?? LEAF_FAMILY_LABEL(family), count })).sort((a, b) => b.count - a.count),
    bindingCounts: [...bindingCount.entries()].map(([code, count]) => ({ code, label: ALL_LEAVES.get(code)?.label ?? code, count, share: n ? count / n : 0 })).sort((a, b) => b.count - a.count),
    modeDemand: [...modeCount.entries()].map(([key, count]) => ({ key, label: WBL_MODES.find((m) => m.key === key)?.label ?? key, count })).sort((a, b) => b.count - a.count),
    eveningShare,
    paidShare,
    clinicalDesign,
    employerAsks,
    supportServices,
  };
}
