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
}

/** Age in whole years on a date. */
export function ageOn(dobIso: string | null, onIso: string): number | null {
  if (!dobIso) return null;
  const d = new Date(dobIso + "T00:00:00Z"), o = new Date(onIso + "T00:00:00Z");
  let a = o.getUTCFullYear() - d.getUTCFullYear();
  if (o.getUTCMonth() < d.getUTCMonth() || (o.getUTCMonth() === d.getUTCMonth() && o.getUTCDate() < d.getUTCDate())) a--;
  return a;
}
export const ageBand = (age: number | null): string => age == null ? "unknown" : age < 20 ? "<20" : age < 25 ? "20–24" : age < 30 ? "25–29" : age < 35 ? "30–34" : age < 45 ? "35–44" : age < 55 ? "45–54" : "55+";

export type Dimension = "sex" | "raceEthnicity" | "ageBand" | "county" | "residency" | "priorEducation" | "employmentStatus" | "firstGeneration" | "veteran" | "pellEligible" | "disability" | "program" | "cohort" | "institution" | "entryYear" | "status" | "withdrawalReason";
export const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "sex", label: "Sex" }, { key: "raceEthnicity", label: "Race / ethnicity" }, { key: "ageBand", label: "Age band" }, { key: "county", label: "County" },
  { key: "residency", label: "Residency" }, { key: "priorEducation", label: "Prior education" }, { key: "employmentStatus", label: "Employment" },
  { key: "firstGeneration", label: "First generation" }, { key: "veteran", label: "Veteran" }, { key: "pellEligible", label: "Pell eligible" }, { key: "disability", label: "Disability" },
  { key: "program", label: "Program" }, { key: "cohort", label: "Cohort" }, { key: "institution", label: "Institution" }, { key: "entryYear", label: "Entry year" }, { key: "status", label: "Status" }, { key: "withdrawalReason", label: "Withdrawal reason" },
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
    case "cohort": return l.cohort ?? "no cohort";
    default: { const v = l[dim as keyof LearnerLite]; return v == null || v === "" ? "unknown" : String(v); }
  }
}

/** Outcome buckets from lifecycle status. */
export const outcomeOf = (status: string): "in progress" | "completed" | "withdrawn" | "pre-enrollment" =>
  status === "withdrawn" ? "withdrawn" : ["completed", "licensed", "placed", "productive"].includes(status) ? "completed" : ["prospect", "applicant", "admitted"].includes(status) ? "pre-enrollment" : "in progress";

export interface PivotRow { value: string; n: number; completed: number; withdrawn: number; inProgress: number; preEnrollment: number; completionRate: number | null; withdrawalRate: number | null; avgAge: number | null; avgGpa: number | null; share: number }

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
    const decided = completed + withdrawn;
    const ages = ls.map((l) => ageOn(l.dob, today)).filter((a): a is number => a != null);
    const gpas = ls.map((l) => l.gpa).filter((g): g is number => g != null);
    return { value, n: ls.length, completed, withdrawn, inProgress, preEnrollment: pre, completionRate: decided ? completed / decided : null, withdrawalRate: decided ? withdrawn / decided : null, avgAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null, avgGpa: gpas.length ? gpas.reduce((a, b) => a + b, 0) / gpas.length : null, share: ls.length / total };
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
