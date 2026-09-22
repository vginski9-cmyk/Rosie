// THE EVALUATION SERVICE — one deterministic judgement every view shares.
//
// A placement (a section of learners, on a date and shift, at a seat) is judged on six distinct
// questions, each answered pass / fail / unknown / not applicable with the facts that decided it:
//
//   requirement   is the educational requirement defined enough to plan against?
//   setting       does the seat's setting satisfy the requirement's setting rule?
//   capability    has the site shown it provides the experience (confirmed, not inferred)?
//   access        does the program's agreement with the site cover these dates?
//   capacity      is the physical pool open with room, and is its limit known?
//   supervision   are the required roles qualified, available and assigned?
//   readiness     the existing readiness rungs (student clearance, overlaps, holidays) — never erased.
//
// Aggregation is explicit: any fail → fail; else any unknown → unknown; else pass; all not-applicable
// → not applicable. An unknown never passes silently, and an unknown with no demonstrated conflict is
// not a proof of infeasibility either — the two are counted apart (evidence gaps vs conflicts).
// Reasons are structured codes, so the scheduler, the capacity views, staffing, coverage, exceptions
// and the exports all say the same thing about the same shift; prose is derived from them.
//
// Pure. The browser may run it for a preview; the server's run is the authoritative one.

import type { SettingRuleSpec } from "./settingrule";
import { settingEligible, unresolvedQuantities, eligibleSettings, describeRule } from "./settingrule";
import type { SupervisionSpec, RoleFinding, SupervisionRole } from "./supervision";

export type CheckStatus = "pass" | "fail" | "unknown" | "n/a";
export type CheckKey = "requirement" | "setting" | "capability" | "access" | "capacity" | "availability" | "supervision" | "readiness";
export type ReasonCode =
  | "REQUIREMENT_UNRESOLVED" | "REQUIREMENT_UNREVIEWED"
  | "SETTING_INELIGIBLE" | "SETTING_MINIMUM_UNMET" | "MIXING_FORBIDDEN" | "SETTING_UNMAPPED"
  | "CAPABILITY_UNVERIFIED" | "CAPABILITY_UNSUPPORTED" | "CAPABILITY_LIMITED" | "CAPABILITY_UNKNOWN"
  | "ACCESS_UNSECURED" | "ACCESS_EXPIRED" | "ACCESS_UNKNOWN" | "SCENARIO_ASSUMED_ACCESS"
  | "CAPACITY_EXHAUSTED" | "CAPACITY_UNKNOWN" | "AVAILABILITY_UNKNOWN" | "UNAVAILABLE"
  | "INSTRUCTOR_UNASSIGNED" | "INSTRUCTOR_UNAVAILABLE" | "INSTRUCTOR_POLICY_MISSING"
  | "PRECEPTOR_UNASSIGNED" | "PRECEPTOR_UNAVAILABLE" | "PRECEPTOR_POLICY_MISSING"
  | "QUALIFICATION_EXPIRED" | "QUALIFICATION_UNKNOWN"
  | "CONTINUITY_UNMET" | "STUDENT_OVERLAP" | "HOLIDAY" | "CLASS_OVERLAP" | "SOLVER_INCOMPLETE";

export interface Reason {
  code: ReasonCode;
  check: CheckKey;
  /** fail = a demonstrated conflict; unknown = an evidence gap; info = an assumption the reader must see. */
  status: "fail" | "unknown" | "info";
  /** The placement (or other item) affected. */
  item: string;
  role?: SupervisionRole;
  /** Where the fact came from (a record, a policy, a lever). */
  source?: string;
  /** What to fix, and where. */
  remediation?: { label: string; href?: string };
  detail: string;
}
export interface Check { key: CheckKey; status: CheckStatus; facts: string[]; reasons: Reason[] }

/** Explicit aggregation: fail beats unknown beats pass; every check n/a → n/a. */
export function aggregate(checks: { status: CheckStatus }[]): CheckStatus {
  const s = checks.map((c) => c.status).filter((x) => x !== "n/a");
  if (!s.length) return "n/a";
  if (s.includes("fail")) return "fail";
  if (s.includes("unknown")) return "unknown";
  return "pass";
}

export const REASON_TEXT: Record<ReasonCode, string> = {
  REQUIREMENT_UNRESOLVED: "the requirement is not defined enough to plan against",
  REQUIREMENT_UNREVIEWED: "the requirement's interpretation has not been reviewed",
  SETTING_INELIGIBLE: "the seat's setting is not eligible under the setting rule",
  SETTING_MINIMUM_UNMET: "a required minimum in one setting is not met",
  MIXING_FORBIDDEN: "hours may not (or may not yet) be split across settings",
  SETTING_UNMAPPED: "the rotation has no setting rule",
  CAPABILITY_UNVERIFIED: "the site has not confirmed it provides this experience (inferred only)",
  CAPABILITY_UNSUPPORTED: "the site says it does not provide this experience",
  CAPABILITY_LIMITED: "the site provides this experience only in a limited way",
  CAPABILITY_UNKNOWN: "whether the site provides this experience is unknown",
  ACCESS_UNSECURED: "the program has no secured agreement with the site",
  ACCESS_EXPIRED: "the agreement ends before this date",
  ACCESS_UNKNOWN: "the program's access to the site is not on record",
  SCENARIO_ASSUMED_ACCESS: "this scenario assumes access that is not secured",
  CAPACITY_EXHAUSTED: "the seat pool is full for this shift",
  CAPACITY_UNKNOWN: "the pool's limit is not known",
  AVAILABILITY_UNKNOWN: "whether the site is open to students then is not known",
  UNAVAILABLE: "the site is not available to students then",
  INSTRUCTOR_UNASSIGNED: "a college instructor is required and none is assigned",
  INSTRUCTOR_UNAVAILABLE: "the assigned instructor is not free for this window",
  INSTRUCTOR_POLICY_MISSING: "instructors are required but no count or ratio is on record",
  PRECEPTOR_UNASSIGNED: "a site preceptor is required and none is assigned",
  PRECEPTOR_UNAVAILABLE: "no qualified, available preceptor at the site for this window",
  PRECEPTOR_POLICY_MISSING: "preceptors are required but no count or ratio is on record",
  QUALIFICATION_EXPIRED: "a qualification or approval expires before the placement date",
  QUALIFICATION_UNKNOWN: "a qualification or availability is not on record",
  CONTINUITY_UNMET: "the rotation must stay at one site and does not",
  STUDENT_OVERLAP: "a student is in two places at once",
  HOLIDAY: "the shift lands on an observed holiday",
  CLASS_OVERLAP: "the shift overlaps a class or lab the cohort is in",
  SOLVER_INCOMPLETE: "the evaluation did not finish — feasibility is not established either way",
};

const mk = (key: CheckKey, status: CheckStatus, facts: string[], reasons: Reason[] = []): Check => ({ key, status, facts, reasons });
const R = (code: ReasonCode, check: CheckKey, status: Reason["status"], item: string, detail: string, extra: Partial<Reason> = {}): Reason => ({ code, check, status, item, detail, ...extra });

// ── The checks ──────────────────────────────────────────────────────────────────────────────────────

/** 1. Is the requirement defined? A rule must exist, be reviewed, and have every quantity it needs. */
export function checkRequirement(item: string, spec: SettingRuleSpec | null, opts: { href?: string; allowProposed?: boolean } = {}): Check {
  if (!spec) return mk("requirement", "unknown", ["no setting rule for this rotation"], [R("SETTING_UNMAPPED", "requirement", "unknown", item, "the rotation type has no setting rule — map it on the rotations panel", { remediation: { label: "map the rotation", href: opts.href } })]);
  const facts = [`rule: ${describeRule(spec.rule)}`, `interpretation: ${spec.status}`];
  const reasons: Reason[] = [];
  const un = unresolvedQuantities(spec.rule);
  if (un.length) reasons.push(R("REQUIREMENT_UNRESOLVED", "requirement", "unknown", item, un.join("; "), { remediation: { label: "complete the rule", href: opts.href } }));
  if (spec.status !== "reviewed" && !opts.allowProposed) reasons.push(R("REQUIREMENT_UNREVIEWED", "requirement", "unknown", item, spec.sourceText ? `"${spec.sourceText}" is interpreted as ${describeRule(spec.rule)} but not yet reviewed` : "the interpretation has not been reviewed", { remediation: { label: "review the interpretation", href: opts.href } }));
  return mk("requirement", reasons.length ? "unknown" : "pass", facts, reasons);
}

/** 2. Does the seat's setting satisfy the rule? A multi-tagged site never counts twice: only the seat's own setting is judged. */
export function checkSetting(item: string, spec: SettingRuleSpec | null, seatSetting: string | null): Check {
  if (!spec) return mk("setting", "unknown", ["no rule to judge against"]);
  if (!seatSetting) return mk("setting", "unknown", ["the seat has no setting"]);
  if (settingEligible(spec.rule, seatSetting)) return mk("setting", "pass", [`${seatSetting} is eligible (${describeRule(spec.rule)})`]);
  return mk("setting", "fail", [`${seatSetting} is not among ${eligibleSettings(spec.rule).join(", ")}`], [R("SETTING_INELIGIBLE", "setting", "fail", item, `${seatSetting} does not satisfy ${describeRule(spec.rule)}`)]);
}

export type ProvisionBasis = "confirmed" | "limited" | "inferred" | "estimate" | "none" | "unknown";
/** 3. Has the site shown the capability? Only a confirmed record passes; inferred and estimated are evidence gaps, none is a conflict. */
export function checkCapability(item: string, basis: ProvisionBasis, siteName: string, settingLabel: string, href?: string): Check {
  switch (basis) {
    case "confirmed": return mk("capability", "pass", [`${siteName} confirmed it provides ${settingLabel}`]);
    case "limited": return mk("capability", "pass", [`${siteName} provides ${settingLabel} in a limited way`], [R("CAPABILITY_LIMITED", "capability", "info", item, `${siteName}: limited ${settingLabel} — check the limitation applies`, { remediation: { label: "read the limitation", href } })]);
    case "none": return mk("capability", "fail", [`${siteName} says it does not provide ${settingLabel}`], [R("CAPABILITY_UNSUPPORTED", "capability", "fail", item, `${siteName} does not provide ${settingLabel}`, { remediation: { label: "choose another site", href } })]);
    case "inferred": return mk("capability", "unknown", [`${siteName} has an asset of this setting; nobody has confirmed the experience`], [R("CAPABILITY_UNVERIFIED", "capability", "unknown", item, `${siteName} has not confirmed ${settingLabel}`, { remediation: { label: "confirm with the site", href } })]);
    case "estimate": return mk("capability", "unknown", [`${siteName}: an estimate, not the site's word`], [R("CAPABILITY_UNVERIFIED", "capability", "unknown", item, `${siteName}'s ${settingLabel} provision is an estimate`, { remediation: { label: "confirm with the site", href } })]);
    default: return mk("capability", "unknown", [`no record either way at ${siteName}`], [R("CAPABILITY_UNKNOWN", "capability", "unknown", item, `${siteName}: ${settingLabel} not on record`, { remediation: { label: "ask the site", href } })]);
  }
}

/** 4. Does the program's access permit it on the date? Secured passes; asked/prospect fail unless the scenario assumes them (then an info reason, never a pass); none/declined fail; missing record is unknown. */
export function checkAccess(item: string, agreement: string | null, agreementEnds: string | null, date: string, siteName: string, opts: { scenarioAllows?: string[]; href?: string } = {}): Check {
  if (agreement == null) return mk("access", "unknown", [`no agreement record for ${siteName}`], [R("ACCESS_UNKNOWN", "access", "unknown", item, `${siteName}: the program's access is not on record`, { remediation: { label: "record the agreement", href: opts.href } })]);
  if (agreementEnds && date > agreementEnds) return mk("access", "fail", [`agreement ends ${agreementEnds}`], [R("ACCESS_EXPIRED", "access", "fail", item, `${siteName}: the agreement ends ${agreementEnds}, before ${date}`, { remediation: { label: "renew the agreement", href: opts.href } })]);
  if (agreement === "secured") return mk("access", "pass", [`secured agreement with ${siteName}`]);
  if (opts.scenarioAllows?.includes(agreement)) return mk("access", "unknown", [`${agreement} agreement counted by this scenario`], [R("SCENARIO_ASSUMED_ACCESS", "access", "info", item, `${siteName} is only ${agreement}; this scenario assumes access — nothing here is secured`, { remediation: { label: "secure the agreement", href: opts.href } })]);
  return mk("access", "fail", [`${agreement} agreement with ${siteName}`], [R("ACCESS_UNSECURED", "access", "fail", item, `${siteName}: agreement is ${agreement}, not secured`, { remediation: { label: "secure the agreement", href: opts.href } })]);
}

export type LimitMode = "known" | "unrestricted" | "unknown";
/** 5a. Capacity: the seat pool on this shift. `limit` null with mode unknown is unknown — never infinity, never zero. */
export function checkCapacity(item: string, pool: { label: string; limit: number | null; mode: LimitMode; used: number; adding: number }, href?: string): Check {
  if (pool.mode === "unknown" || (pool.mode === "known" && pool.limit == null)) return mk("capacity", "unknown", [`${pool.label}: limit not known (${pool.used} already there)`], [R("CAPACITY_UNKNOWN", "capacity", "unknown", item, `${pool.label}: the limit is not on record`, { remediation: { label: "record the limit", href } })]);
  if (pool.mode === "unrestricted") return mk("capacity", "pass", [`${pool.label}: explicitly unrestricted by this field (other limits still apply)`]);
  const limit = pool.limit as number;
  if (pool.used + pool.adding > limit) return mk("capacity", "fail", [`${pool.label}: ${pool.used} + ${pool.adding} > ${limit}`], [R("CAPACITY_EXHAUSTED", "capacity", "fail", item, `${pool.label}: ${pool.used + pool.adding} would exceed ${limit}`, { remediation: { label: "another shift, seat or site", href } })]);
  return mk("capacity", "pass", [`${pool.label}: ${pool.used + pool.adding} of ${limit}`]);
}

export type AvailabilityMode = "inherit" | "specific" | "unavailable" | "unknown";
/** 5b. Availability: explicit choices, resolved to whether the place is open to students on that shift. */
export function checkAvailability(item: string, mode: AvailabilityMode, resolvedOpen: boolean | null, source: string, href?: string): Check {
  if (mode === "unknown") return mk("availability", "unknown", ["availability not recorded"], [R("AVAILABILITY_UNKNOWN", "availability", "unknown", item, "whether students may attend this shift is not on record", { remediation: { label: "record availability", href } })]);
  if (mode === "unavailable") return mk("availability", "fail", ["marked unavailable"], [R("UNAVAILABLE", "availability", "fail", item, "the site is not available to students for this period", { remediation: { label: "see the availability record", href } })]);
  if (resolvedOpen == null) return mk("availability", "unknown", [`${source}: could not resolve`], [R("AVAILABILITY_UNKNOWN", "availability", "unknown", item, `${source} does not say whether this shift is open`, { remediation: { label: "record availability", href } })]);
  return resolvedOpen ? mk("availability", "pass", [`open — ${source}`]) : mk("availability", "fail", [`closed — ${source}`], [R("UNAVAILABLE", "availability", "fail", item, `closed on this shift (${source})`, { remediation: { label: "another shift", href } })]);
}

/** 6. Supervision: every required role judged on its own; an inapplicable role never produces a reason. */
export function checkSupervision(item: string, spec: SupervisionSpec | null, findings: RoleFinding[], href?: string): Check {
  if (!spec) return mk("supervision", "unknown", ["no supervision model on record"], [R("QUALIFICATION_UNKNOWN", "supervision", "unknown", item, "which roles must be present is not on record", { remediation: { label: "set the supervision model", href } })]);
  const reasons: Reason[] = []; const facts: string[] = [];
  if (spec.status !== "reviewed") reasons.push(R("QUALIFICATION_UNKNOWN", "supervision", "unknown", item, spec.questions[0] ?? "the supervision model needs review", { remediation: { label: "review the supervision model", href } }));
  for (const f of findings) {
    const up = f.role === "instructor" ? "INSTRUCTOR" : "PRECEPTOR";
    facts.push(`${f.role}: ${f.detail}`);
    const rem = f.remedy ? { label: f.remedy, href } : undefined;
    switch (f.state) {
      case "not-required": case "assigned": case "confirmed": break;
      case "unassigned": reasons.push(R(`${up}_UNASSIGNED` as ReasonCode, "supervision", "fail", item, f.detail, { role: f.role, remediation: rem })); break;
      case "assigned-unavailable": reasons.push(R(`${up}_UNAVAILABLE` as ReasonCode, "supervision", "fail", item, f.detail, { role: f.role, remediation: rem })); break;
      case "no-qualified-person": reasons.push(R(`${up}_UNAVAILABLE` as ReasonCode, "supervision", "fail", item, f.detail, { role: f.role, remediation: rem })); break;
      case "expired": reasons.push(R("QUALIFICATION_EXPIRED", "supervision", "fail", item, f.detail, { role: f.role, remediation: rem })); break;
      case "unknown-qualification": reasons.push(R(f.needed == null ? (`${up}_POLICY_MISSING` as ReasonCode) : "QUALIFICATION_UNKNOWN", "supervision", "unknown", item, f.detail, { role: f.role, remediation: rem })); break;
    }
  }
  const status: CheckStatus = reasons.some((r) => r.status === "fail") ? "fail" : reasons.length ? "unknown" : findings.every((f) => f.state === "not-required") ? "n/a" : "pass";
  return mk("supervision", status, facts, reasons);
}

/** 7. The readiness rungs that already existed: kept, never erased. */
export function checkReadiness(item: string, flags: { studentOverlap?: boolean; holiday?: string | null; classOverlap?: string | null; continuityBroken?: boolean }): Check {
  const reasons: Reason[] = [];
  if (flags.studentOverlap) reasons.push(R("STUDENT_OVERLAP", "readiness", "fail", item, "a student on this shift is on another at the same time"));
  if (flags.holiday) reasons.push(R("HOLIDAY", "readiness", "fail", item, `lands on ${flags.holiday}`));
  if (flags.classOverlap) reasons.push(R("CLASS_OVERLAP", "readiness", "fail", item, `overlaps ${flags.classOverlap}`));
  if (flags.continuityBroken) reasons.push(R("CONTINUITY_UNMET", "readiness", "fail", item, "the rotation must stay at one site"));
  return mk("readiness", reasons.length ? "fail" : "pass", reasons.length ? [] : ["no conflicts"], reasons);
}

// ── One placement, one verdict ──────────────────────────────────────────────────────────────────────
export interface PlacementEvaluation { placementId: string; label: string; status: CheckStatus; checks: Check[]; reasons: Reason[] }
export function evaluatePlacement(placementId: string, label: string, checks: Check[]): PlacementEvaluation {
  return { placementId, label, status: aggregate(checks), checks, reasons: checks.flatMap((c) => c.reasons) };
}

// ── Counting: unique affected placements apart from occurrences, evidence gaps apart from conflicts ──
export interface ReasonTally { code: ReasonCode; text: string; placements: number; occurrences: number; kind: "conflict" | "gap" | "assumption"; examples: string[]; remediation: { label: string; href?: string } | null }
export interface EvaluationSummary {
  placements: number; pass: number; fail: number; unknown: number; notApplicable: number;
  /** Placements with at least one demonstrated conflict. */
  conflictPlacements: number;
  /** Placements with no conflict but at least one evidence gap. */
  gapOnlyPlacements: number;
  /** Total reason occurrences (one placement can carry several). */
  occurrences: number;
  byCode: ReasonTally[];
}
export function summarize(evals: PlacementEvaluation[]): EvaluationSummary {
  const by = new Map<ReasonCode, ReasonTally & { seen: Set<string> }>();
  let occurrences = 0, conflictPlacements = 0, gapOnlyPlacements = 0;
  for (const e of evals) {
    const hasFail = e.reasons.some((r) => r.status === "fail");
    if (hasFail) conflictPlacements++; else if (e.reasons.some((r) => r.status === "unknown")) gapOnlyPlacements++;
    for (const r of e.reasons) {
      occurrences++;
      const t = by.get(r.code) ?? { code: r.code, text: REASON_TEXT[r.code], placements: 0, occurrences: 0, kind: r.status === "fail" ? "conflict" : r.status === "unknown" ? "gap" : "assumption", examples: [], remediation: r.remediation ?? null, seen: new Set<string>() };
      t.occurrences++;
      if (!t.seen.has(e.placementId)) { t.seen.add(e.placementId); t.placements++; if (t.examples.length < 3) t.examples.push(`${e.label}: ${r.detail}`); }
      if (!t.remediation && r.remediation) t.remediation = r.remediation;
      by.set(r.code, t);
    }
  }
  const byCode = [...by.values()].map(({ seen: _s, ...t }) => t).sort((a, b) => (a.kind === b.kind ? b.placements - a.placements : a.kind === "conflict" ? -1 : b.kind === "conflict" ? 1 : a.kind === "gap" ? -1 : 1));
  return { placements: evals.length, pass: evals.filter((e) => e.status === "pass").length, fail: evals.filter((e) => e.status === "fail").length, unknown: evals.filter((e) => e.status === "unknown").length, notApplicable: evals.filter((e) => e.status === "n/a").length, conflictPlacements, gapOnlyPlacements, occurrences, byCode };
}

// ── The result contract every consumer returns ──────────────────────────────────────────────────────
export interface EvaluationContract {
  /** Which reviewed requirement versions and rule versions this run read. */
  requirementVersions: string[];
  /** A hash or stamp of the inputs (supply, agreements, roster) — so two views can say whether they read the same data. */
  inputVersion: string;
  scope: { institutionId: string; cohortIds: string[]; programIds: string[] };
  window: { from: string; to: string } | null;
  /** Assumptions the reader must see: "asked agreements count", "seats only — no preceptor required", "± 2 days". */
  assumptions: string[];
  /** The population and unit the numbers count (never mixed silently). */
  population: string; unit: string;
  evaluatedAt: string;
  /** Did the evaluation finish? An unfinished run reports SOLVER_INCOMPLETE and never a definitive bottleneck. */
  complete: boolean;
}
export interface EvaluationResult { contract: EvaluationContract; placements: PlacementEvaluation[]; summary: EvaluationSummary }

/** Recommendations derive from the binding constraint, in order: an unreviewed or unresolved requirement first, then eligible alternatives
 *  not yet tried, then access, then capacity, then supervision — and a supervision remedy only for a role that is actually required. */
export function recommend(summary: EvaluationSummary, ctx: { untriedAlternatives?: string[]; rolesRequired?: SupervisionRole[] } = {}): { label: string; because: string; proven: boolean }[] {
  const out: ReturnType<typeof recommend> = [];
  const has = (code: ReasonCode) => summary.byCode.find((t) => t.code === code);
  const reqs = ["REQUIREMENT_UNRESOLVED", "REQUIREMENT_UNREVIEWED", "SETTING_UNMAPPED"] as ReasonCode[];
  for (const c of reqs) { const t = has(c); if (t) out.push({ label: t.remediation?.label ?? "complete the requirement", because: `${t.placements} placement${t.placements === 1 ? "" : "s"}: ${t.text}`, proven: false }); }
  const cap = has("CAPACITY_EXHAUSTED");
  if (cap && ctx.untriedAlternatives?.length) out.push({ label: `evaluate the approved alternative setting${ctx.untriedAlternatives.length === 1 ? "" : "s"} ${ctx.untriedAlternatives.join(", ")} first`, because: "the rule allows them and they were not tried before proposing a new agreement", proven: false });
  const acc = has("ACCESS_UNSECURED"); if (acc) out.push({ label: acc.remediation?.label ?? "secure the agreement", because: `${acc.placements} placement${acc.placements === 1 ? "" : "s"} at sites without a secured agreement`, proven: false });
  if (cap && !ctx.untriedAlternatives?.length) out.push({ label: cap.remediation?.label ?? "add seats or shifts", because: `${cap.placements} placement${cap.placements === 1 ? "" : "s"} with no seat on that shift`, proven: false });
  const roles = ctx.rolesRequired ?? ["instructor", "preceptor"];
  for (const role of roles) {
    const up = role === "instructor" ? "INSTRUCTOR" : "PRECEPTOR";
    for (const c of [`${up}_UNASSIGNED`, `${up}_UNAVAILABLE`, `${up}_POLICY_MISSING`] as ReasonCode[]) { const t = has(c); if (t) out.push({ label: t.remediation?.label ?? t.text, because: `${t.placements} placement${t.placements === 1 ? "" : "s"}: ${t.text}`, proven: false }); }
  }
  for (const c of ["CAPABILITY_UNVERIFIED", "CAPABILITY_UNKNOWN", "AVAILABILITY_UNKNOWN", "CAPACITY_UNKNOWN", "ACCESS_UNKNOWN"] as ReasonCode[]) { const t = has(c); if (t) out.push({ label: t.remediation?.label ?? t.text, because: `${t.placements} placement${t.placements === 1 ? "" : "s"} wait on this evidence`, proven: false }); }
  return out;
}
