// The assumption registry (Phase 9, use case 1). Every material planning assumption — a pipeline
// rate, a lag, a lead time, a cost, a workload figure — is a named key with a default value, a
// range, a source and a verification status. Rows in the database override the defaults at a scope
// (workspace, college, job family, program; the most specific wins), and a scenario can override
// again without touching any operating plan. Pure: the query layer loads rows, this resolves them.

export type AssumptionCategory = "rates" | "timing" | "lead-time" | "cost" | "workload";
export type AssumptionStatus = "default" | "estimate" | "verified";

export interface AssumptionDef {
  key: string; label: string; category: AssumptionCategory;
  /** How the value reads: share (0–1), months, weeks, $/yr, $/shift, $, years, students, shifts/wk, hours/wk. */
  unit: string;
  value: number; low: number; high: number;
  source: string;
  note?: string;
}

/** The defaults, each named for what it is. A default is never presented as verified. */
export const ASSUMPTION_DEFS: AssumptionDef[] = [
  // Pipeline rates — the workbook's 2025 health-metric benchmarks (the goal planner may save the family's own).
  { key: "interestedSurplus", label: "Interested candidates ÷ enrollment capacity", category: "rates", unit: "share", value: 1.5, low: 1.2, high: 2.0, source: "institutions workbook 2025 health-metric benchmark" },
  { key: "qualifiedSurplus", label: "Qualified applicants ÷ capacity", category: "rates", unit: "share", value: 1.25, low: 1.0, high: 1.6, source: "institutions workbook 2025 health-metric benchmark" },
  { key: "offeredSurplus", label: "Offers ÷ capacity", category: "rates", unit: "share", value: 1.1, low: 1.0, high: 1.3, source: "institutions workbook 2025 health-metric benchmark" },
  { key: "enrollmentRate", label: "Enrolled ÷ capacity (seat fill)", category: "rates", unit: "share", value: 1.0, low: 0.85, high: 1.0, source: "institutions workbook 2025 health-metric benchmark" },
  { key: "completionRate", label: "Completing on time ÷ enrolled", category: "rates", unit: "share", value: 0.7, low: 0.55, high: 0.85, source: "institutions workbook 2025 health-metric benchmark" },
  { key: "licensureRate", label: "First-time licensure pass ÷ completing", category: "rates", unit: "share", value: 0.9, low: 0.75, high: 0.98, source: "institutions workbook 2025 health-metric benchmark" },
  { key: "placementRate", label: "Regional placement ÷ passing", category: "rates", unit: "share", value: 0.9, low: 0.7, high: 0.97, source: "institutions workbook 2025 health-metric benchmark" },
  { key: "productivityRate", label: "Fully productive ÷ placed", category: "rates", unit: "share", value: 0.9, low: 0.8, high: 0.98, source: "institutions workbook 2025 health-metric benchmark" },
  // Timing lags from completion to a productive worker.
  { key: "licensureMonths", label: "Months from completion to licensure", category: "timing", unit: "months", value: 3, low: 2, high: 6, source: "default assumption — typical NC allied-health exam scheduling" },
  { key: "placementMonths", label: "Months from licensure to a regional job", category: "timing", unit: "months", value: 3, low: 1, high: 6, source: "default assumption" },
  { key: "rampMonths", label: "Months from hire to full productivity", category: "timing", unit: "months", value: 6, low: 3, high: 12, source: "default assumption — orientation and ramp" },
  { key: "breakWeeksBetweenTerms", label: "Break weeks between terms", category: "timing", unit: "weeks", value: 2, low: 1, high: 4, source: "default assumption" },
  // Lead times: how long each thing takes to put in place before a cohort can start.
  { key: "recruitingWeeks", label: "Weeks to recruit and admit a cohort", category: "lead-time", unit: "weeks", value: 20, low: 12, high: 36, source: "default assumption — applications open to first day" },
  { key: "facultyHireWeeks", label: "Weeks to hire a full-time faculty member", category: "lead-time", unit: "weeks", value: 26, low: 16, high: 52, source: "default assumption — posting, search, credentialing, start" },
  { key: "adjunctHireWeeks", label: "Weeks to hire an adjunct", category: "lead-time", unit: "weeks", value: 10, low: 6, high: 20, source: "default assumption" },
  { key: "siteAgreementWeeks", label: "Weeks to secure a clinical-site agreement", category: "lead-time", unit: "weeks", value: 20, low: 8, high: 52, source: "default assumption — ask, legal review, signatures" },
  { key: "preceptorOnboardWeeks", label: "Weeks to onboard new preceptors", category: "lead-time", unit: "weeks", value: 8, low: 4, high: 16, source: "default assumption" },
  { key: "equipmentWeeks", label: "Weeks to purchase and install equipment", category: "lead-time", unit: "weeks", value: 16, low: 8, high: 40, source: "default assumption" },
  { key: "spaceRenovationWeeks", label: "Weeks to renovate or build instructional space", category: "lead-time", unit: "weeks", value: 52, low: 26, high: 104, source: "default assumption" },
  { key: "approvalWeeks", label: "Weeks for program, location or accreditor approvals", category: "lead-time", unit: "weeks", value: 16, low: 8, high: 52, source: "default assumption — system office, accreditor substantive change" },
  // Costs. Replace every one of these with the college's own figures.
  { key: "facultyFullTimeAnnual", label: "Full-time faculty, salary and benefits", category: "cost", unit: "$/yr", value: 85000, low: 65000, high: 110000, source: "default assumption — not the college's figure" },
  { key: "adjunctPerContactHour", label: "Adjunct pay per contact hour", category: "cost", unit: "$/hour", value: 55, low: 40, high: 80, source: "default assumption — not the college's figure" },
  { key: "clinicalCoordinatorAnnual", label: "Clinical coordinator, salary and benefits", category: "cost", unit: "$/yr", value: 72000, low: 55000, high: 95000, source: "default assumption — not the college's figure" },
  { key: "preceptorStipendPerShift", label: "Preceptor stipend per student-shift", category: "cost", unit: "$/shift", value: 0, low: 0, high: 75, source: "default assumption — many NC sites are unpaid" },
  { key: "studentSupportPerStudentAnnual", label: "Student support per student (tutoring, licensure prep, aid)", category: "cost", unit: "$/yr", value: 1200, low: 500, high: 3000, source: "default assumption — not the college's figure" },
  { key: "simulationEquipmentOneTime", label: "Simulation or lab equipment for an added section", category: "cost", unit: "$", value: 150000, low: 50000, high: 400000, source: "default assumption — not the college's figure" },
  { key: "spaceRenovationOneTime", label: "Instructional space renovation", category: "cost", unit: "$", value: 250000, low: 100000, high: 1500000, source: "default assumption — not the college's figure" },
  { key: "equipmentUsefulLifeYears", label: "Useful life of equipment", category: "cost", unit: "years", value: 8, low: 5, high: 12, source: "default assumption" },
  { key: "spaceUsefulLifeYears", label: "Useful life of renovated space", category: "cost", unit: "years", value: 25, low: 15, high: 40, source: "default assumption" },
  // Workload and supervision.
  { key: "preceptorShiftsPerWeek", label: "Shifts a week one preceptor takes students", category: "workload", unit: "shifts/wk", value: 4, low: 2, high: 5, source: "default assumption" },
  { key: "preceptorMaxStudentsPerShift", label: "Students one preceptor takes on a shift", category: "workload", unit: "students", value: 2, low: 1, high: 3, source: "default assumption — accreditor ratios vary by program" },
  { key: "onlineContactHourFactor", label: "Faculty contact-hour credit for an online class hour (vs in person)", category: "workload", unit: "share", value: 1, low: 0.5, high: 1, source: "default assumption — an online hour counts the same as an in-person hour until the college's policy says otherwise", note: "Hybrid designs only. Clinical hours are never online." },
];
export const ASSUMPTION_BY_KEY: Record<string, AssumptionDef> = Object.fromEntries(ASSUMPTION_DEFS.map((d) => [d.key, d]));

export interface AssumptionRow { scope: string; key: string; value: number; low: number | null; high: number | null; source: string | null; owner: string | null; status: string; verifiedAt: string | null; reviewBy: string | null }
export type AssumptionOrigin = "default" | "global" | "institution" | "family" | "program" | "scenario";
export interface ResolvedAssumption extends AssumptionDef {
  status: AssumptionStatus; owner: string | null; verifiedAt: string | null; reviewBy: string | null;
  /** Where the value came from, most specific wins. */
  origin: AssumptionOrigin;
  /** The value is past its review date. */
  stale: boolean;
}
export type Assumptions = Record<string, ResolvedAssumption>;

export const scopeOf = { global: "global", institution: (id: string) => `inst:${id}`, family: (id: string) => `family:${id}`, program: (id: string) => `program:${id}` };

/** Resolve every key: default → global → college → family → program → scenario override. */
export function resolveAssumptions(rows: AssumptionRow[], scope: { institutionId?: string | null; familyId?: string | null; programId?: string | null }, overrides: Record<string, number> = {}, todayIso?: string): Assumptions {
  const chain: [string, AssumptionOrigin][] = [[scopeOf.global, "global"]];
  if (scope.institutionId) chain.push([scopeOf.institution(scope.institutionId), "institution"]);
  if (scope.familyId) chain.push([scopeOf.family(scope.familyId), "family"]);
  if (scope.programId) chain.push([scopeOf.program(scope.programId), "program"]);
  const out: Assumptions = {};
  for (const d of ASSUMPTION_DEFS) {
    let r: ResolvedAssumption = { ...d, status: "default", owner: null, verifiedAt: null, reviewBy: null, origin: "default", stale: false };
    for (const [s, origin] of chain) {
      const row = rows.find((x) => x.scope === s && x.key === d.key);
      if (!row) continue;
      r = { ...r, value: row.value, low: row.low ?? r.low, high: row.high ?? r.high, source: row.source ?? r.source, owner: row.owner, status: (row.status as AssumptionStatus) || "estimate", verifiedAt: row.verifiedAt, reviewBy: row.reviewBy, origin, stale: !!(todayIso && row.reviewBy && row.reviewBy < todayIso) };
    }
    if (overrides[d.key] != null && Number.isFinite(overrides[d.key])) r = { ...r, value: overrides[d.key], origin: "scenario", status: "estimate", source: "scenario override" };
    out[d.key] = r;
  }
  return out;
}

/** The family's saved goal-plan rates count as the family's own figures (an estimate the program owns). */
export function applyFamilyRates(a: Assumptions, rates: Partial<Record<string, number>> | null | undefined, familyLabel: string): Assumptions {
  if (!rates) return a;
  const out = { ...a };
  for (const [k, v] of Object.entries(rates)) {
    if (typeof v !== "number" || !out[k] || out[k].origin === "scenario" || out[k].origin === "program") continue;
    out[k] = { ...out[k], value: v, origin: "family", status: out[k].status === "verified" && out[k].origin === "family" ? "verified" : "estimate", source: `${familyLabel} goal plan` };
  }
  return out;
}

/** Share of the assumptions actually used that are verified, and the ones that are not. */
export function confidenceOf(used: ResolvedAssumption[]): { verified: number; used: number; share: number; unverified: ResolvedAssumption[]; stale: ResolvedAssumption[] } {
  const verified = used.filter((u) => u.status === "verified").length;
  return { verified, used: used.length, share: used.length ? verified / used.length : 0, unverified: used.filter((u) => u.status !== "verified"), stale: used.filter((u) => u.stale) };
}
