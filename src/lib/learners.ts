// Learner demographics & outcomes — coded dropdown vocabularies and the pure
// math behind the analytics (age, bands, pivots by any dimension × outcome).

export const SEX = ["Female", "Male", "Intersex", "Prefer not to say"] as const;
export const RACE_ETHNICITY = [
  "Hispanic or Latino", "American Indian or Alaska Native", "Asian", "Black or African American",
  "Native Hawaiian or Other Pacific Islander", "White", "Two or more races", "Unknown / prefer not to say",
] as const;
export const RESIDENCY = ["in-district", "in-state", "out-of-state", "international"] as const;
export const PRIOR_EDUCATION = ["HS diploma", "GED", "Some college", "Certificate", "Associate", "Bachelor's", "Graduate"] as const;
export const EMPLOYMENT_STATUS = ["unemployed", "part-time", "full-time", "incumbent worker (healthcare)", "student only"] as const;
export const WITHDRAWAL_REASON = ["academic", "financial", "personal / family", "health", "employment", "relocated", "transferred", "other"] as const;
export const STUDENT_STATUSES = ["prospect", "applicant", "admitted", "enrolled", "completed", "licensed", "placed", "productive", "withdrawn"] as const;
export const AGE_BANDS = ["<20", "20–24", "25–29", "30–34", "35–44", "45–54", "55+"] as const;
export const NC_COUNTIES = ["Alamance", "Alexander", "Alleghany", "Anson", "Ashe", "Avery", "Beaufort", "Bertie", "Bladen", "Brunswick", "Buncombe", "Burke", "Cabarrus", "Caldwell", "Camden", "Carteret", "Caswell", "Catawba", "Chatham", "Cherokee", "Chowan", "Clay", "Cleveland", "Columbus", "Craven", "Cumberland", "Currituck", "Dare", "Davidson", "Davie", "Duplin", "Durham", "Edgecombe", "Forsyth", "Franklin", "Gaston", "Gates", "Graham", "Granville", "Greene", "Guilford", "Halifax", "Harnett", "Haywood", "Henderson", "Hertford", "Hoke", "Hyde", "Iredell", "Jackson", "Johnston", "Jones", "Lee", "Lenoir", "Lincoln", "Macon", "Madison", "Martin", "McDowell", "Mecklenburg", "Mitchell", "Montgomery", "Moore", "Nash", "New Hanover", "Northampton", "Onslow", "Orange", "Pamlico", "Pasquotank", "Pender", "Perquimans", "Person", "Pitt", "Polk", "Randolph", "Richmond", "Robeson", "Rockingham", "Rowan", "Rutherford", "Sampson", "Scotland", "Stanly", "Stokes", "Surry", "Swain", "Transylvania", "Tyrrell", "Union", "Vance", "Wake", "Warren", "Washington", "Watauga", "Wayne", "Wilkes", "Wilson", "Yadkin", "Yancey"];

export interface LearnerLite {
  id: string; name: string; status: string; stageKey: string | null; entryYear: number | null;
  institution: string; program: string; cohort: string | null;
  dob: string | null; sex: string | null; raceEthnicity: string | null; county: string | null; city: string | null; zip: string | null;
  residency: string | null; priorEducation: string | null; employmentStatus: string | null;
  firstGeneration: boolean | null; veteran: boolean | null; pellEligible: boolean | null; disability: boolean | null;
  withdrawalReason: string | null; gpa: number | null;
  /** The date the learner's cohort ends (its last term); null when unknown or no cohort. A completion
   *  rate counts only learners whose cohort has ended — nobody can have completed a program still running (Phase 6). */
  cohortEnds?: string | null;
  /** The class year in the cohort's name ("Class of 2026" → 2026); null when the name carries none. */
  gradYear?: number | null;
  /** The learner's own first day and completion date (ISO), when recorded — time to complete reads them. */
  startDate?: string | null; completionDate?: string | null;
}

/** Cells smaller than this show no rates: a rate of one or two people is noise, and can identify them (Phase 6). */
export const SMALL_CELL = 5;
/** The learner's cohort has ended by `today`, so completion is decidable. */
export const matured = (l: { cohortEnds?: string | null }, today: string) => !!l.cohortEnds && l.cohortEnds <= today;

/** Age in whole years on a date. */
export function ageOn(dobIso: string | null, onIso: string): number | null {
  if (!dobIso) return null;
  const d = new Date(dobIso + "T00:00:00Z"), o = new Date(onIso + "T00:00:00Z");
  let a = o.getUTCFullYear() - d.getUTCFullYear();
  if (o.getUTCMonth() < d.getUTCMonth() || (o.getUTCMonth() === d.getUTCMonth() && o.getUTCDate() < d.getUTCDate())) a--;
  return a;
}
export const ageBand = (age: number | null): string => age == null ? "unknown" : age < 20 ? "<20" : age < 25 ? "20–24" : age < 30 ? "25–29" : age < 35 ? "30–34" : age < 45 ? "35–44" : age < 55 ? "45–54" : "55+";

export type Dimension = "sex" | "raceEthnicity" | "ageBand" | "county" | "residency" | "priorEducation" | "employmentStatus" | "firstGeneration" | "veteran" | "pellEligible" | "disability" | "program" | "cohort" | "institution" | "entryYear" | "gradYear" | "status" | "withdrawalReason";
export const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "sex", label: "Sex" }, { key: "raceEthnicity", label: "Race / ethnicity" }, { key: "ageBand", label: "Age band" }, { key: "county", label: "County" },
  { key: "residency", label: "Residency" }, { key: "priorEducation", label: "Prior education" }, { key: "employmentStatus", label: "Employment" },
  { key: "firstGeneration", label: "First generation" }, { key: "veteran", label: "Veteran" }, { key: "pellEligible", label: "Pell eligible" }, { key: "disability", label: "Disability" },
  { key: "program", label: "Program" }, { key: "cohort", label: "Cohort" }, { key: "institution", label: "Institution" }, { key: "entryYear", label: "Entry year" }, { key: "gradYear", label: "Class year" }, { key: "status", label: "Status" }, { key: "withdrawalReason", label: "Withdrawal reason" },
];

const yn = (b: boolean | null) => (b == null ? "unknown" : b ? "yes" : "no");
export function dimensionValue(l: LearnerLite, dim: Dimension, today: string): string {
  switch (dim) {
    case "ageBand": return ageBand(ageOn(l.dob, today));
    case "firstGeneration": return yn(l.firstGeneration);
    case "veteran": return yn(l.veteran);
    case "pellEligible": return yn(l.pellEligible);
    case "disability": return yn(l.disability);
    case "entryYear": return l.entryYear != null ? String(l.entryYear) : "unknown";
    case "gradYear": return l.gradYear != null ? String(l.gradYear) : "unknown";
    case "cohort": return l.cohort ?? "no cohort";
    default: { const v = l[dim as keyof LearnerLite]; return v == null || v === "" ? "unknown" : String(v); }
  }
}

/** Outcome buckets from lifecycle status. */
export const outcomeOf = (status: string): "in progress" | "completed" | "withdrawn" | "pre-enrollment" =>
  status === "withdrawn" ? "withdrawn" : ["completed", "licensed", "placed", "productive"].includes(status) ? "completed" : ["prospect", "applicant", "admitted"].includes(status) ? "pre-enrollment" : "in progress";

export interface PivotRow {
  value: string; n: number; completed: number; withdrawn: number; inProgress: number; preEnrollment: number;
  /** completed ÷ entrants whose cohort has ended; null when none has, or the cell is small. */
  completionRate: number | null;
  /** withdrawn ÷ entrants; null when nobody started, or the cell is small. */
  withdrawalRate: number | null;
  /** Entrants (and entrants whose cohort has ended) — the rates' denominators. */
  entrants: number; maturedEntrants: number;
  /** Fewer than SMALL_CELL entrants: rates suppressed. */
  smallCell: boolean;
  avgAge: number | null; avgGpa: number | null; share: number;
}

/** Count learners by one dimension with outcome shares, average age and GPA. */
export function pivot(learners: LearnerLite[], dim: Dimension, today: string): PivotRow[] {
  const m = new Map<string, LearnerLite[]>();
  for (const l of learners) { const v = dimensionValue(l, dim, today); const a = m.get(v) ?? []; a.push(l); m.set(v, a); }
  const total = learners.length || 1;
  const rows = [...m.entries()].map(([value, ls]) => {
    const completed = ls.filter((l) => outcomeOf(l.status) === "completed").length;
    const withdrawn = ls.filter((l) => outcomeOf(l.status) === "withdrawn").length;
    const inProgress = ls.filter((l) => outcomeOf(l.status) === "in progress").length;
    const pre = ls.length - completed - withdrawn - inProgress;
    // Rates are of entrants (everyone who started), the same basis as outcomeStats — never "of decided";
    // completion only over entrants whose cohort has ended; nothing for a small cell.
    const o = outcomeStats(ls, today);
    const smallCell = o.entrants > 0 && o.entrants < SMALL_CELL;
    const ages = ls.map((l) => ageOn(l.dob, today)).filter((a): a is number => a != null);
    const gpas = ls.map((l) => l.gpa).filter((g): g is number => g != null);
    return { value, n: ls.length, completed, withdrawn, inProgress, preEnrollment: pre, completionRate: smallCell ? null : o.completionRate, withdrawalRate: smallCell ? null : o.withdrawalRate, entrants: o.entrants, maturedEntrants: o.maturedEntrants, smallCell, avgAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null, avgGpa: gpas.length ? gpas.reduce((a, b) => a + b, 0) / gpas.length : null, share: ls.length / total };
  });
  return rows.sort((a, b) => b.n - a.n || a.value.localeCompare(b.value));
}

/** Two-way table: rows × columns counts. */
export function crosstab(learners: LearnerLite[], rowDim: Dimension, colDim: Dimension, today: string) {
  const rows = new Map<string, Map<string, number>>(); const cols = new Set<string>();
  for (const l of learners) { const r = dimensionValue(l, rowDim, today), c = dimensionValue(l, colDim, today); cols.add(c); const m = rows.get(r) ?? new Map(); m.set(c, (m.get(c) ?? 0) + 1); rows.set(r, m); }
  const colList = [...cols].sort();
  return { cols: colList, rows: [...rows.entries()].map(([r, m]) => ({ value: r, cells: colList.map((c) => m.get(c) ?? 0), n: [...m.values()].reduce((a, b) => a + b, 0) })).sort((a, b) => b.n - a.n) };
}

// ── Withdrawal and completion, one way everywhere ─────────────────────────────────────────────
/** Learners who started: enrolled or further along, and everyone who later withdrew. Prospects,
 *  applicants and admits never started, so they are not in the denominator. */
export const ENTRANT_STATUSES = new Set(["enrolled", "completed", "licensed", "placed", "productive", "withdrawn"]);
export const COMPLETED_STATUSES = new Set(["completed", "licensed", "placed", "productive"]);
/** Everyone who ever sat in an offering: enrolled and every stage after it. The statuses a class's roster,
 *  its requirement progress and its shift logs read — a graduate is still on the roster of the class they finished. */
export const ENROLLED_AND_BEYOND = ["enrolled", "completed", "licensed", "placed", "productive"] as const;
/** The roster plus those admitted and not yet started. */
export const ROSTER_STATUSES = ["admitted", ...ENROLLED_AND_BEYOND] as const;
export interface OutcomeStats {
  entrants: number; withdrawn: number; completed: number; inProgress: number;
  /** withdrawn ÷ entrants (null when nobody started). */
  withdrawalRate: number | null;
  /** completed ÷ entrants whose cohort has ended (null when no cohort is old enough to complete). */
  completionRate: number | null;
  /** Entrants whose cohort has ended, and how many of them completed. */
  maturedEntrants: number; maturedCompleted: number;
  /** Entrants whose cohort is still running (or has no end date on record) — not in the completion denominator. */
  unmaturedEntrants: number;
}
/** Withdrawal rate = withdrawn to date ÷ everyone who started (never "of decided", never of every record).
 *  Completion rate = completed ÷ entrants whose cohort has ended by `today` (Phase 6) — a cohort still
 *  running cannot have a completion rate. Without `today` (or cohort end dates) no completion rate is given. */
export function outcomeStats(learners: { status: string; cohortEnds?: string | null }[], today?: string): OutcomeStats {
  let entrants = 0, withdrawn = 0, completed = 0, inProgress = 0, maturedEntrants = 0, maturedCompleted = 0;
  for (const l of learners) {
    if (!ENTRANT_STATUSES.has(l.status)) continue;
    entrants++;
    const done = COMPLETED_STATUSES.has(l.status);
    if (l.status === "withdrawn") withdrawn++; else if (done) completed++; else inProgress++;
    if (today && matured(l, today)) { maturedEntrants++; if (done) maturedCompleted++; }
  }
  return { entrants, withdrawn, completed, inProgress, withdrawalRate: entrants ? withdrawn / entrants : null, completionRate: maturedEntrants ? maturedCompleted / maturedEntrants : null, maturedEntrants, maturedCompleted, unmaturedEntrants: entrants - maturedEntrants };
}

// ── The analytics pickers and the time-to-complete figure (pure; the page and its tests read them) ──
export interface AnalyticsCohortLite { id: string; name: string; status: string; gradYear: number | null; programId: string; program: string; institutionId: string; institution: string; cohortEnds: string | null }
/** The institution → program → cohort options for the learner analytics, built from the OFFERINGS, not from who has
 *  students: a class with nobody on its roster is still listed (and says so), never silently missing. */
export function analyticsOptions(cohorts: AnalyticsCohortLite[], learners: Pick<LearnerLite, "gradYear" | "entryYear">[] & { cohortId?: string | null }[], sel: { inst?: string; prog?: string }) {
  const institutions = [...new Map(cohorts.map((c) => [c.institutionId, c.institution])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const inInst = cohorts.filter((c) => !sel.inst || c.institutionId === sel.inst);
  const programs = [...new Map(inInst.map((c) => [c.programId, c.program])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const counts = new Map<string, number>();
  for (const l of learners) if (l.cohortId) counts.set(l.cohortId, (counts.get(l.cohortId) ?? 0) + 1);
  const cohortRows = inInst.filter((c) => !sel.prog || c.programId === sel.prog).map((c) => ({ id: c.id, name: c.name, n: counts.get(c.id) ?? 0, gradYear: c.gradYear, status: c.status, program: c.program }))
    .sort((a, b) => (b.gradYear ?? 0) - (a.gradYear ?? 0) || a.name.localeCompare(b.name));
  const gradYears = [...new Set(cohorts.map((c) => c.gradYear).filter((y): y is number => y != null))].sort((a, b) => b - a);
  const entryYears = [...new Set(learners.map((l) => l.entryYear).filter((y): y is number => y != null))].sort((a, b) => b - a);
  return { institutions, programs, cohorts: cohortRows, gradYears, entryYears };
}
/** Months from a learner's first day to their completion date, for completers with both dates: the median and how many carried both. */
export function timeToComplete(learners: Pick<LearnerLite, "status" | "startDate" | "completionDate">[]): { medianMonths: number | null; n: number } {
  const months = learners.filter((l) => COMPLETED_STATUSES.has(l.status) && l.startDate && l.completionDate).map((l) => (new Date(l.completionDate! + "T00:00:00Z").getTime() - new Date(l.startDate! + "T00:00:00Z").getTime()) / (30.4375 * 86400000)).filter((m) => m >= 0).sort((a, b) => a - b);
  if (!months.length) return { medianMonths: null, n: 0 };
  const mid = Math.floor(months.length / 2);
  return { medianMonths: months.length % 2 ? months[mid] : (months[mid - 1] + months[mid]) / 2, n: months.length };
}
