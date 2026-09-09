// Workload — the policy math behind every staffing assignment.
//
// A workload policy says what a full load is for a position (contact hours per
// week, the work week, weeks in a term and a year) and how many work hours each
// contact hour is credited. A person's policy is the most specific one that
// matches them (employer + position + employment type → … → the institution's
// default for their role → built-in defaults). Every assignment — one person's
// share of one shift (session × section) — carries its contact hours; the
// policy turns those into credited work hours, load against the week, FTE for
// the term and the year. Pure functions, no I/O.

export interface PolicyLite {
  id?: string;
  institutionId: string;
  employerId: string | null;
  role: string;
  employmentType: string | null;
  title: string | null;
  label?: string | null;
  contactHoursPerWeek: number;
  workWeekHours: number;
  termWeeks: number;
  annualWeeks: number;
  hoursPerContactHour: number | null;
  maxContactHoursPerWeek: number | null;
}

export interface PersonLite { id: string; name?: string; institutionId: string; employerId: string | null; role: string; employmentType: string | null; title: string | null }

/** Built-in defaults when an institution has coded nothing (the Sandhills
 *  workbook's stated policies: FT faculty 16/40 = 2.5 h per contact hour;
 *  adjunct 18/40; support 1:1; preceptor 1:1). */
export const DEFAULT_POLICIES: Omit<PolicyLite, "institutionId">[] = [
  { employerId: null, role: "instructor", employmentType: "full-time", title: null, label: "Full-time faculty", contactHoursPerWeek: 16, workWeekHours: 40, termWeeks: 16, annualWeeks: 32, hoursPerContactHour: 2.5, maxContactHoursPerWeek: null },
  { employerId: null, role: "instructor", employmentType: "adjunct", title: null, label: "Adjunct faculty", contactHoursPerWeek: 18, workWeekHours: 40, termWeeks: 16, annualWeeks: 32, hoursPerContactHour: null, maxContactHoursPerWeek: null },
  { employerId: null, role: "instructor", employmentType: "part-time", title: null, label: "Part-time faculty", contactHoursPerWeek: 9, workWeekHours: 20, termWeeks: 16, annualWeeks: 32, hoursPerContactHour: null, maxContactHoursPerWeek: null },
  { employerId: null, role: "instructor", employmentType: null, title: null, label: "Faculty", contactHoursPerWeek: 16, workWeekHours: 40, termWeeks: 16, annualWeeks: 32, hoursPerContactHour: 2.5, maxContactHoursPerWeek: null },
  { employerId: null, role: "coordinator", employmentType: null, title: null, label: "Coordinator", contactHoursPerWeek: 8, workWeekHours: 40, termWeeks: 16, annualWeeks: 48, hoursPerContactHour: 2.5, maxContactHoursPerWeek: null },
  { employerId: null, role: "support", employmentType: null, title: null, label: "Support staff", contactHoursPerWeek: 40, workWeekHours: 40, termWeeks: 16, annualWeeks: 48, hoursPerContactHour: 1, maxContactHoursPerWeek: null },
  { employerId: null, role: "preceptor", employmentType: null, title: null, label: "Preceptor", contactHoursPerWeek: 40, workWeekHours: 40, termWeeks: 16, annualWeeks: 48, hoursPerContactHour: 1, maxContactHoursPerWeek: null },
  { employerId: null, role: "supervisor", employmentType: null, title: null, label: "Supervisor", contactHoursPerWeek: 40, workWeekHours: 40, termWeeks: 16, annualWeeks: 48, hoursPerContactHour: 1, maxContactHoursPerWeek: null },
];

/** Work hours credited per contact hour under a policy. */
export const creditPerContactHour = (p: PolicyLite) => p.hoursPerContactHour ?? (p.contactHoursPerWeek > 0 ? p.workWeekHours / p.contactHoursPerWeek : 1);

/** Score how specifically a policy matches a person (higher wins; -1 = no match). */
function specificity(p: PolicyLite, person: PersonLite): number {
  if (p.institutionId !== person.institutionId) return -1;
  if (p.role !== person.role) return -1;
  if (p.employerId && p.employerId !== person.employerId) return -1;
  if (p.employmentType && p.employmentType !== person.employmentType) return -1;
  if (p.title && (person.title ?? "").trim().toLowerCase() !== p.title.trim().toLowerCase()) return -1;
  return (p.employerId ? 8 : 0) + (p.title ? 4 : 0) + (p.employmentType ? 2 : 0) + 1;
}

/** The policy that governs a person: most specific coded policy, else the built-in default for the role. */
export function resolvePolicy(person: PersonLite, policies: PolicyLite[]): { policy: PolicyLite; source: "employer" | "institution" | "default" } {
  let best: PolicyLite | null = null; let bestScore = -1;
  for (const p of policies) { const s = specificity(p, person); if (s > bestScore) { best = p; bestScore = s; } }
  if (best) return { policy: best, source: best.employerId ? "employer" : "institution" };
  const def = DEFAULT_POLICIES.find((d) => d.role === person.role && d.employmentType === person.employmentType)
    ?? DEFAULT_POLICIES.find((d) => d.role === person.role && d.employmentType == null)
    ?? DEFAULT_POLICIES[3];
  return { policy: { ...def, institutionId: person.institutionId }, source: "default" };
}

// ---------------------------------------------------------------------------
// Coverage of one shift
// ---------------------------------------------------------------------------

export interface AssignmentLite {
  id: string;
  personId: string;
  personName?: string;
  role: string;
  contactHours: number;
  startOffsetMin: number | null;
  segment?: string | null;
  sectionIndex: number;
}

export interface ShiftNeed { lengthHours: number; facultyNeeded: number; preceptorsNeeded: number; supportStaffNeeded: number }

export interface Coverage {
  /** Contact hours required per role (length × people needed) and assigned. */
  faculty: { required: number; assigned: number };
  preceptor: { required: number; assigned: number };
  support: { required: number; assigned: number };
  /** Pairs of assignments whose time spans overlap (co-teaching). */
  coTeaching: [string, string][];
  /** Assignments that run past the end of the session. */
  overruns: string[];
  status: "unstaffed" | "partial" | "staffed" | "over";
}

const FACULTY_ROLES = new Set(["instructor", "coordinator", "supervisor"]);

/** How well one shift's assignments cover what the session row says it needs. */
export function coverageOf(need: ShiftNeed, assignments: AssignmentLite[]): Coverage {
  const sum = (pred: (r: string) => boolean) => assignments.filter((a) => pred(a.role)).reduce((n, a) => n + a.contactHours, 0);
  const faculty = { required: need.lengthHours * need.facultyNeeded, assigned: sum((r) => FACULTY_ROLES.has(r)) };
  const preceptor = { required: need.lengthHours * need.preceptorsNeeded, assigned: sum((r) => r === "preceptor") };
  const support = { required: need.lengthHours * need.supportStaffNeeded, assigned: sum((r) => r === "support") };
  const coTeaching: [string, string][] = [];
  const spans = assignments.filter((a) => a.startOffsetMin != null).map((a) => ({ id: a.id, s: a.startOffsetMin!, e: a.startOffsetMin! + a.contactHours * 60 }));
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) if (spans[i].s < spans[j].e && spans[j].s < spans[i].e) coTeaching.push([spans[i].id, spans[j].id]);
  const overruns = spans.filter((x) => x.e > need.lengthHours * 60 + 1e-9).map((x) => x.id);
  const req = faculty.required + preceptor.required + support.required;
  const got = faculty.assigned + preceptor.assigned + support.assigned;
  const eps = 1e-6;
  const status: Coverage["status"] = got <= eps ? "unstaffed" : got + eps < req ? "partial" : got > req + eps ? "over" : "staffed";
  return { faculty, preceptor, support, coTeaching, overruns, status };
}

// ---------------------------------------------------------------------------
// A person's load: daily · weekly · per term · per year, against their policy
// ---------------------------------------------------------------------------

export interface DatedAssignment extends AssignmentLite {
  /** The shift's date (ISO) when the term is dated, else null. */
  dateIso: string | null;
  termKey: string;      // e.g. "Fall 2026" (or the term name when undated)
  year: number | null;
  cohortId: string;
  cohortName: string;
  programName: string;
  courseCode: string | null;
  kind: string;
}

export interface LoadBucket { key: string; contactHours: number; creditedHours: number }
export interface PersonLoad {
  policy: PolicyLite; policySource: "employer" | "institution" | "default";
  creditPerContactHour: number;
  totalContactHours: number; totalCreditedHours: number;
  daily: LoadBucket[];   // per ISO date
  weekly: LoadBucket[];  // per ISO Monday
  terms: LoadBucket[];   // per term key
  years: LoadBucket[];   // per calendar year
  /** Busiest week and day. */
  peakWeek: LoadBucket | null; peakDay: LoadBucket | null;
  /** Peak week's contact hours against the policy's full load (1.0 = full). */
  peakWeekLoad: number;
  /** Weeks over the policy's cap. */
  overloadedWeeks: string[];
  /** FTE by term (term contact hours ÷ (contactHoursPerWeek × termWeeks)) and by year (÷ annualWeeks). */
  termFte: { key: string; fte: number }[];
  yearFte: { key: string; fte: number }[];
  undatedHours: number;
}

const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const back = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - back * 86400000).toISOString().slice(0, 10); };

export function personLoad(person: PersonLite, assignments: DatedAssignment[], policies: PolicyLite[]): PersonLoad {
  const { policy, source } = resolvePolicy(person, policies);
  const credit = creditPerContactHour(policy);
  const add = (m: Map<string, LoadBucket>, key: string, h: number) => { const b = m.get(key) ?? { key, contactHours: 0, creditedHours: 0 }; b.contactHours += h; b.creditedHours += h * credit; m.set(key, b); };
  const daily = new Map<string, LoadBucket>(), weekly = new Map<string, LoadBucket>(), terms = new Map<string, LoadBucket>(), years = new Map<string, LoadBucket>();
  let total = 0, undated = 0;
  for (const a of assignments) {
    total += a.contactHours;
    add(terms, a.termKey, a.contactHours);
    if (a.year != null) add(years, String(a.year), a.contactHours);
    if (a.dateIso) { add(daily, a.dateIso, a.contactHours); add(weekly, mondayOf(a.dateIso), a.contactHours); } else undated += a.contactHours;
  }
  const sorted = (m: Map<string, LoadBucket>) => [...m.values()].sort((x, y) => x.key.localeCompare(y.key));
  const peak = (list: LoadBucket[]) => list.reduce<LoadBucket | null>((p, b) => (!p || b.contactHours > p.contactHours ? b : p), null);
  const weeklyList = sorted(weekly);
  const cap = policy.maxContactHoursPerWeek ?? policy.contactHoursPerWeek;
  const peakWeek = peak(weeklyList);
  const fullTerm = policy.contactHoursPerWeek * policy.termWeeks;
  const fullYear = policy.contactHoursPerWeek * policy.annualWeeks;
  return {
    policy, policySource: source, creditPerContactHour: credit,
    totalContactHours: total, totalCreditedHours: total * credit,
    daily: sorted(daily), weekly: weeklyList, terms: sorted(terms), years: sorted(years),
    peakWeek, peakDay: peak(sorted(daily)),
    peakWeekLoad: policy.contactHoursPerWeek > 0 && peakWeek ? peakWeek.contactHours / policy.contactHoursPerWeek : 0,
    overloadedWeeks: weeklyList.filter((w) => w.contactHours > cap + 1e-9).map((w) => w.key),
    termFte: sorted(terms).map((t) => ({ key: t.key, fte: fullTerm > 0 ? t.contactHours / fullTerm : 0 })),
    yearFte: sorted(years).map((y) => ({ key: y.key, fte: fullYear > 0 ? y.contactHours / fullYear : 0 })),
    undatedHours: undated,
  };
}

/** Human label for a policy row. */
export const policyLabel = (p: PolicyLite) => p.label ?? [p.employmentType, p.role, p.title].filter(Boolean).join(" · ");
