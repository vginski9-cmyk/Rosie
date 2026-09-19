// Use case 1 — can a program expand? (docs/use-cases.md §1; Phase 9 of docs/metrics-audit.md)
//
// The engine behind the expansion studio. Pure: the query layer assembles the input, this works
// backward from the workforce target through the pipeline to dated cohorts, applies the program's
// term and course structure, computes every requirement (faculty, preceptors, clinical learner-shifts
// by date × shift × setting, rooms, agreements, accreditor limits, calendar), tests each against
// current supply, names the first binding constraint and the secondary ones — with WHERE each binds
// (the week, the date and shift, the setting) — and works out the earliest feasible start, the
// steady-state annual output, the cost per additional worker, and the assumptions the answer rests on.
//
// Design rules it keeps: target, forecast and committed are never mixed; FTE and people are both
// shown; theoretical capacity is never usable capacity (secured vs physical stays distinct);
// a proposal lives here, never in the operating plan; every material assumption carries its status.

import { buildInstances, weeklyNeed, type DatedInstance, type SessionInput, type WorkloadAssumptions, type CohortCalendarInput } from "./capacitymodel";
import { alignOffering, weeksOf, type TermLite, type CourseLite, type CodedEventLite } from "./termalign";
import type { SemesterAnchors } from "./term";
import { assetSupply, assetDemand, assetMatch, type AssetLite, type AssetDayOverride, type RotationCode, type AssetMatchCell, type AssetSupplyCell } from "./assetmap";
import { buildLadder, type LadderRates } from "./northstar";
import { deriveCohortTargets } from "./pipeline";
import { confidenceOf, type Assumptions, type ResolvedAssumption } from "./assumptions";
import type { ShiftBlock } from "./clinicalsupply";

// ── The design of an expansion ─────────────────────────────────────────────────────────────────
export type ExpansionKind = "larger-cohort" | "additional-cohort" | "evening-cohort" | "weekend-cohort" | "accelerated" | "additional-campus" | "shared-regional" | "hybrid" | "expanded-geography" | "improve-retention";
export const EXPANSION_KINDS: { kind: ExpansionKind; label: string; hint: string }[] = [
  { kind: "additional-cohort", label: "Additional annual cohort", hint: "one more cohort each year, same design" },
  { kind: "larger-cohort", label: "Larger cohort", hint: "more seats in the existing cohort (the seats here are the ADDED seats)" },
  { kind: "evening-cohort", label: "Evening cohort", hint: "classes after 17:00, clinical on the evening shift" },
  { kind: "weekend-cohort", label: "Weekend cohort", hint: "classes and clinical on Saturday and Sunday" },
  { kind: "accelerated", label: "Accelerated schedule", hint: "the same sessions in fewer weeks per term" },
  { kind: "additional-campus", label: "Additional campus or location", hint: "a new delivery site; approvals and space lead times apply" },
  { kind: "shared-regional", label: "Shared regional program", hint: "a cohort delivered with another college; its sites count as secured" },
  { kind: "hybrid", label: "Hybrid instruction", hint: "part of class hours online; fewer room hours" },
  { kind: "expanded-geography", label: "Expanded clinical geography", hint: "sites now asked or prospect are assumed secured" },
  { kind: "improve-retention", label: "Improve retention instead", hint: "no new seats; a higher completion rate on the cohorts already running" },
];
export interface ExpansionDesign {
  kind: ExpansionKind;
  /** The workforce ask: fully productive workers per year, and the year the target must be reached. */
  targetWorkers: number; targetYear: number;
  /** Seats per new cohort (for a larger cohort: the seats added). 0 for improve-retention. */
  seats: number;
  /** First new cohort's first day. */
  startIso: string;
  /** New cohorts per year from then on (0 = one cohort only). */
  cohortsPerYear: number;
  /** Term weeks × this (0.75 = 25% shorter terms) — accelerated designs. */
  paceFactor: number;
  /** Share of class hours delivered online — hybrid designs. */
  onlineShare: number;
  /** Sites (employer ids) assumed secured for this scenario — expanded geography, shared regional. */
  assumedSecuredSiteIds: string[];
  /** Points of completion rate added — improve-retention designs. */
  retentionUplift: number;
  /** Whether this is a new program or location needing approvals (adds the approval lead time). */
  needsApproval: boolean;
}
export const DEFAULT_DESIGN: Omit<ExpansionDesign, "targetYear" | "startIso"> = { kind: "additional-cohort", targetWorkers: 0, seats: 24, cohortsPerYear: 1, paceFactor: 1, onlineShare: 0, assumedSecuredSiteIds: [], retentionUplift: 0, needsApproval: false };

// ── What the engine needs ──────────────────────────────────────────────────────────────────────
export interface ProgramTemplate {
  id: string; name: string; familyId: string | null; familyName: string | null;
  terms: TermLite[];
  courses: { id: string; termId: string; termIndex: number; termName: string; code: string | null; name: string; sessions: SessionInput[] }[];
  assumptions: WorkloadAssumptions;
  /** The accreditor's approved students at once for the family (null = none set). */
  accreditedCapacity: number | null;
  defaultSeats: number | null;
}
export interface BaselineCohort { cohortId: string; cohort: string; programId: string; seats: number; startIso: string | null; endIso: string | null; productiveGoal: number; gradYear: number | null }
export interface InstructorLite { id: string; name: string; employmentType: string | null; contactHoursPerWeek: number }
export interface SiteLite { employerId: string; siteName: string; agreementStatus: string; studentsAtOnce: number | null; approvedCapacity: number | null; preceptors: number }
export interface RoomLite { id: string; name: string; kind: string; weeklyOpenHours: number; capacity: number | null }
export interface ExpansionInput {
  todayIso: string;
  institution: { id: string; name: string };
  program: ProgramTemplate;
  anchors: SemesterAnchors; events: CodedEventLite[]; holidays: Record<string, string>;
  /** Every dated session of every planned and running offering at the college (the operating plan). */
  baselineRows: DatedInstance[];
  baselineCohorts: BaselineCohort[];
  supply: { instructors: InstructorLite[]; assets: AssetLite[]; overrides: AssetDayOverride[]; rotations: RotationCode[]; sites: SiteLite[]; rooms: RoomLite[] };
  assumptions: Assumptions;
}

// ── What it answers ────────────────────────────────────────────────────────────────────────────
export type ConstraintKind = "time" | "faculty" | "preceptors" | "clinical-seats" | "agreements" | "accreditor" | "rooms" | "pipeline" | "calendar" | "equipment";
export type ConstraintSeverity = "binding" | "secondary" | "ok" | "unknown" | "info";
export interface Constraint {
  kind: ConstraintKind; severity: ConstraintSeverity; label: string;
  /** Demand vs supply in the unit named. */
  demand: number | null; supply: number | null; unit: string;
  /** Where it binds: the week, the date and shift, the setting. */
  where: string | null;
  detail: string; fix: string;
  /** The people or seats short at the worst point. */
  shortfall: number | null;
  /** How well the inputs behind it are known. */
  evidence: "verified" | "estimate" | "unknown";
}
export interface ProposedCohort { id: string; label: string; startIso: string; endIso: string; seats: number; terms: { index: number; name: string; startIso: string; endIso: string; weeks: number; source: string }[]; ladder: { enrolled: number; completing: number; licensed: number; placed: number; productive: number }; productiveByIso: string; warnings: string[] }
export interface CostLine { category: string; oneTime: number; recurring: number; basis: string; assumptionKeys: string[] }
export interface Milestone { iso: string; what: string; owner: string; lateIfAfter: boolean }
export interface TraceCourse { code: string | null; name: string; termIndex: number; sessions: number; learnerShifts: number; bySetting: Record<string, number>; facultyHours: number; preceptorShifts: number }
export interface ExpansionResult {
  feasible: boolean; feasibleInTime: boolean;
  headline: string;
  binding: Constraint | null; constraints: Constraint[];
  cohorts: ProposedCohort[];
  outputs: {
    currentMaxFeasibleSeats: number | null; proposedSeats: number;
    additionalAnnualEnrollment: number; additionalAnnualCompletions: number; additionalAnnualLicensed: number; additionalAnnualPlaced: number; additionalAnnualProductive: number;
    firstYearWorkersEnter: number | null; steadyStateYear: number | null;
    facultyFteAdded: number; facultyPeopleAdded: number; preceptorFteAdded: number; preceptorPeopleAdded: number;
    learnerShifts: number; settingsNeeded: string[]; sitesNeeded: string[];
    roomHoursPerWeekPeak: number; studentSupportSeats: number;
    /** The pipeline the target needs, worked backward. */
    required: { productive: number; placed: number; licensed: number; completing: number; enrolled: number; offered: number; qualified: number; interested: number; seatsPerYear: number };
    baselineAnnualProductive: number;
  };
  costs: { lines: CostLine[]; oneTime: number; recurring: number; annualized: number; perAdditionalCompleter: number | null; perAdditionalPlaced: number | null };
  earliestStartIso: string; proposedStartIso: string;
  milestones: Milestone[];
  assumptionsUsed: ResolvedAssumption[];
  confidence: { share: number; verified: number; used: number; unverified: string[]; stale: string[]; risks: string[] };
  trace: { cohortId: string; courses: TraceCourse[] }[];
  summary: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (s: string) => new Date(s + "T00:00:00Z");
const addWeeks = (s: string, w: number) => iso(new Date(dateOf(s).getTime() + Math.round(w * 7) * DAY));
const addMonths = (s: string, m: number) => { const d = dateOf(s); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); };
const mondayOf = (s: string) => { const d = dateOf(s); return iso(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)); };
const fmtD = (s: string) => dateOf(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtW = (s: string) => `week of ${dateOf(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`;
const round1 = (v: number) => Math.round(v * 10) / 10;
const WEEKEND: Record<string, string> = { Mon: "Sat", Tue: "Sun", Wed: "Sat", Thu: "Sun", Fri: "Sat", Sat: "Sat", Sun: "Sun" };

export function ratesOf(a: Assumptions): LadderRates {
  return { interestedSurplus: a.interestedSurplus.value, qualifiedSurplus: a.qualifiedSurplus.value, offeredSurplus: a.offeredSurplus.value, enrollmentRate: a.enrollmentRate.value, completionRate: a.completionRate.value, licensureRate: a.licensureRate.value, placementRate: a.placementRate.value, productivityRate: a.productivityRate.value };
}

/** The program's sessions as one new cohort would run them under this design (evening, weekend, hybrid, pace). */
function designedSessions(p: ProgramTemplate, d: ExpansionDesign): ProgramTemplate["courses"] {
  return p.courses.map((c) => ({
    ...c,
    sessions: c.sessions.map((s) => {
      let out: SessionInput = { ...s };
      if (d.paceFactor !== 1 && s.week != null) out = { ...out, week: Math.max(1, Math.round(s.week * d.paceFactor)) };
      if (d.kind === "evening-cohort") out = { ...out, startTime: s.kind === "CLINICAL" ? "15:00" : "17:30" };
      if (d.kind === "weekend-cohort") out = { ...out, dayOfWeek: s.dayOfWeek ? WEEKEND[s.dayOfWeek] ?? s.dayOfWeek : (s.kind === "CLINICAL" ? "Sat" : "Sat"), startTime: s.kind === "CLINICAL" ? s.startTime ?? "07:00" : "09:00" };
      if (d.kind === "hybrid" && s.kind === "CLASS" && d.onlineShare > 0) out = { ...out, lengthHours: s.lengthHours * (1 - d.onlineShare) };
      return out;
    }),
  }));
}

/** Per-term enrollment for a cohort of `seats`: term 1 = seats × enrollment rate, sliding to completing by the last term. */
function termEnrollment(seats: number, rates: LadderRates, nTerms: number): number[] {
  const t1 = seats * rates.enrollmentRate, last = t1 * rates.completionRate;
  return Array.from({ length: Math.max(1, nTerms) }, (_, i) => (nTerms <= 1 ? t1 : t1 - (t1 - last) * (i / (nTerms - 1))));
}

/** One proposed cohort, dated on the college's calendar from its first day. */
export function proposeCohort(input: ExpansionInput, d: ExpansionDesign, startIso: string, seats: number, n: number): { cohort: ProposedCohort; rows: DatedInstance[] } {
  const p = input.program;
  const a = input.assumptions;
  const rates = ratesOf(a);
  const terms: TermLite[] = p.terms.map((t) => (d.paceFactor !== 1 ? { ...t, startWeek: t.startWeek, endWeek: t.startWeek != null && t.endWeek != null ? t.startWeek + Math.max(0, Math.round(weeksOf(t) * d.paceFactor) - 1) : t.endWeek } : t));
  const courses = designedSessions(p, d);
  const aligned = alignOffering({ startIso, terms, courses: courses.map((c) => ({ id: c.id, termId: c.termId, code: c.code, name: c.name, sessions: c.sessions.map((s) => ({ week: s.week })) })), anchors: input.anchors, events: input.events });
  const byIndex = new Map(aligned.terms.map((t) => [t.index, t]));
  const enrollment = termEnrollment(seats, rates, p.terms.length);
  const enrollmentByTerm: Record<number, number> = {};
  p.terms.forEach((t, i) => { enrollmentByTerm[t.index] = enrollment[i] ?? enrollment[enrollment.length - 1]; });
  const termStartByIndex: Record<number, Date | null> = {}, termEndByIndex: Record<number, string | null> = {}, termWeeksByIndex: Record<number, number | null> = {};
  for (const t of p.terms) { const at = byIndex.get(t.index); termStartByIndex[t.index] = at ? dateOf(at.startIso) : null; termEndByIndex[t.index] = at?.endIso ?? null; termWeeksByIndex[t.index] = weeksOf(t); }
  const id = `scenario:${n}`;
  const label = `Proposed cohort ${n} (${fmtD(startIso)})`;
  const calInput: CohortCalendarInput = {
    cohortId: id, cohort: label, programId: p.id, program: p.name, enrollmentByTerm, termStartByIndex, termEndByIndex, termWeeksByIndex, holidays: input.holidays,
    courses: courses.map((c) => ({ code: c.code, title: c.name, courseId: c.id, termIndex: c.termIndex, termName: c.termName, sessions: c.sessions })),
  };
  const rows = buildInstances(calInput, p.assumptions).filter((r) => r.dateIso != null);
  const endIso = aligned.terms.reduce((m, t) => (t.endIso > m ? t.endIso : m), aligned.terms[0]?.endIso ?? startIso);
  const ladder = buildLadder(seats, rates);
  const productiveByIso = addMonths(addMonths(addMonths(endIso, a.licensureMonths.value), a.placementMonths.value), a.rampMonths.value);
  return {
    cohort: { id, label, startIso: aligned.terms[0]?.startIso ?? startIso, endIso, seats, terms: aligned.terms.map((t) => ({ index: t.index, name: t.name, startIso: t.startIso, endIso: t.endIso, weeks: t.calendarWeeks, source: t.startSource })), ladder: { enrolled: ladder.enrolled, completing: ladder.completing, licensed: ladder.licensed, placed: ladder.placed, productive: ladder.productive }, productiveByIso, warnings: aligned.warnings },
    rows,
  };
}

/** The proposed cohorts a design implies: from the first start, one per year (or several) through the target year's intake. */
export function proposeCohorts(input: ExpansionInput, d: ExpansionDesign): { cohorts: ProposedCohort[]; rows: DatedInstance[] } {
  if (d.kind === "improve-retention" || d.seats <= 0) return { cohorts: [], rows: [] };
  const cohorts: ProposedCohort[] = []; const rows: DatedInstance[] = [];
  const perYear = Math.max(0, Math.round(d.cohortsPerYear));
  const starts: string[] = [d.startIso];
  if (perYear > 0) {
    const lastYear = Math.max(d.targetYear, Number(d.startIso.slice(0, 4)) + 1);
    for (let y = Number(d.startIso.slice(0, 4)); y <= lastYear; y++) for (let k = 0; k < perYear; k++) {
      const s = addMonths(`${y}${d.startIso.slice(4)}`, Math.round((12 / perYear) * k));
      if (s > d.startIso && !starts.includes(s)) starts.push(s);
    }
  }
  starts.sort();
  starts.slice(0, 8).forEach((s, i) => { const r = proposeCohort(input, d, s, d.seats, i + 1); cohorts.push(r.cohort); rows.push(...r.rows); });
  return { cohorts, rows };
}

// ── Prepared context: the expensive supply computations once per input ─────────────────────────
export interface ExpansionContext {
  input: ExpansionInput;
  baselineWeekly: Map<string, { faculty: number; preceptorShifts: number; roomHours: number }>;
  baselineDemand: ReturnType<typeof assetDemand>;
  /** Supply and the baseline-only match, memoized per window × assumed-secured sites — the seat search re-evaluates many times with the same window. */
  seatCache: Map<string, { supply: Map<string, AssetSupplyCell>; baseOnly: Map<string, AssetMatchCell>; assetById: Map<string, AssetLite>; assets: AssetLite[] }>;
}
export function prepareExpansion(input: ExpansionInput): ExpansionContext {
  return { input, baselineWeekly: weeklyLoads(input.baselineRows), baselineDemand: assetDemand(input.baselineRows, input.supply.rotations), seatCache: new Map() };
}
function weeklyLoads(rows: DatedInstance[]): Map<string, { faculty: number; preceptorShifts: number; roomHours: number }> {
  const m = new Map<string, { faculty: number; preceptorShifts: number; roomHours: number }>();
  for (const r of rows) {
    if (!r.mondayIso) continue;
    const w = m.get(r.mondayIso) ?? { faculty: 0, preceptorShifts: 0, roomHours: 0 };
    w.faculty += r.computed.AB ?? 0;
    if (r.session.kind === "CLINICAL") w.preceptorShifts += (r.computed.Y ?? 0) * (r.session.preceptorsNeeded ?? 0);
    else w.roomHours += r.computed.X ?? 0;
    m.set(r.mondayIso, w);
  }
  return m;
}

// ── The evaluation ─────────────────────────────────────────────────────────────────────────────
export function evaluateExpansion(ctx: ExpansionContext, d: ExpansionDesign, opts: { searchMax?: boolean } = {}): ExpansionResult {
  const { input } = ctx;
  const a = input.assumptions;
  const rates = ratesOf(a);
  const effRates: LadderRates = d.kind === "improve-retention" ? { ...rates, completionRate: Math.min(1, rates.completionRate + d.retentionUplift) } : rates;
  const p = input.program;
  const used = new Set<string>(["enrollmentRate", "completionRate", "licensureRate", "placementRate", "productivityRate", "licensureMonths", "placementMonths", "rampMonths", "recruitingWeeks"]);
  const constraints: Constraint[] = [];

  // 1–3 · The pipeline the target needs, worked backward.
  const req = deriveCohortTargets(Math.max(0, d.targetWorkers), effRates, Math.max(1, p.terms.length));
  const baselineAnnualProductive = input.baselineCohorts.filter((c) => c.programId === p.id && c.gradYear != null).reduce((m, c) => { const y = c.gradYear as number; return { ...m, [y]: (m[y] ?? 0) + c.productiveGoal }; }, {} as Record<number, number>);
  const baselineProductiveTargetYear = baselineAnnualProductive[d.targetYear] ?? Math.max(0, ...Object.values(baselineAnnualProductive));

  // 4–5 · Dated cohorts under the program's structure.
  const { cohorts, rows: newRows } = proposeCohorts(input, d);
  const window = newRows.length ? { from: newRows.reduce((m, r) => (r.dateIso! < m ? r.dateIso! : m), newRows[0].dateIso!), to: newRows.reduce((m, r) => (r.dateIso! > m ? r.dateIso! : m), newRows[0].dateIso!) } : null;

  // 6–7 · Requirements against supply.
  const newWeekly = weeklyLoads(newRows);
  const weeks = [...new Set([...newWeekly.keys()])].sort();
  // Faculty: FTE (contact hours ÷ a full-time load) per week; people = the smallest whole number that covers the peak.
  const facSupplyFte = input.supply.instructors.reduce((n, i) => n + i.contactHoursPerWeek / Math.max(1, p.assumptions.facContactHours), 0);
  let facPeak = { week: "", demand: 0, added: 0 };
  for (const w of weeks) { const total = (ctx.baselineWeekly.get(w)?.faculty ?? 0) + (newWeekly.get(w)?.faculty ?? 0); if (total > facPeak.demand) facPeak = { week: w, demand: total, added: newWeekly.get(w)?.faculty ?? 0 }; }
  const facShort = Math.max(0, facPeak.demand - facSupplyFte);
  const facultyPeopleAdded = Math.ceil(Math.max(0, ...weeks.map((w) => newWeekly.get(w)?.faculty ?? 0)) - 1e-9);
  constraints.push({
    kind: "faculty", severity: weeks.length === 0 ? "info" : facShort > 1e-9 ? "binding" : "ok", label: "Faculty",
    demand: round1(facPeak.demand), supply: round1(facSupplyFte), unit: "FTE in the peak week", where: facPeak.week ? fmtW(facPeak.week) : null,
    detail: weeks.length === 0 ? "No dated sessions to staff." : `Peak concurrent need ${round1(facPeak.demand)} FTE (${round1(facPeak.added)} FTE from the new cohort${cohorts.length === 1 ? "" : "s"}) against ${round1(facSupplyFte)} FTE on the faculty roster (${input.supply.instructors.length} people). ${facShort > 1e-9 ? `${round1(facShort)} FTE short — at least ${Math.ceil(facShort - 1e-9)} more ${Math.ceil(facShort - 1e-9) === 1 ? "person" : "people"}.` : "Covered by the current roster in every week."}`,
    fix: facShort > 1e-9 ? `hire ${Math.ceil(facShort - 1e-9)} faculty (full-time ${a.facultyHireWeeks.value} weeks' lead, adjunct ${a.adjunctHireWeeks.value}) or move sessions off the ${facPeak.week ? fmtW(facPeak.week) : "peak week"}` : "none needed",
    shortfall: facShort > 1e-9 ? Math.ceil(facShort - 1e-9) : 0, evidence: "estimate",
  });
  // Preceptors: preceptor-shifts a week at the family's secured sites vs preceptors on record × shifts they take.
  const securedSites = input.supply.sites.filter((s) => s.agreementStatus === "secured" || d.assumedSecuredSiteIds.includes(s.employerId));
  const preSupplyShifts = securedSites.reduce((n, s) => n + s.preceptors, 0) * a.preceptorShiftsPerWeek.value;
  used.add("preceptorShiftsPerWeek");
  let prePeak = { week: "", demand: 0, added: 0 };
  for (const w of weeks) { const total = (ctx.baselineWeekly.get(w)?.preceptorShifts ?? 0) + (newWeekly.get(w)?.preceptorShifts ?? 0); if (total > prePeak.demand) prePeak = { week: w, demand: total, added: newWeekly.get(w)?.preceptorShifts ?? 0 }; }
  const preShort = Math.max(0, prePeak.demand - preSupplyShifts);
  const preceptorPeopleAdded = Math.ceil(Math.max(0, ...weeks.map((w) => newWeekly.get(w)?.preceptorShifts ?? 0)) / Math.max(1, a.preceptorShiftsPerWeek.value) - 1e-9);
  const preceptorFteAdded = round1(Math.max(0, ...weeks.map((w) => newRowsWeekPreceptorFte(newRows, w))));
  constraints.push({
    kind: "preceptors", severity: prePeak.demand === 0 ? "info" : preShort > 1e-9 ? "binding" : "ok", label: "Preceptors",
    demand: Math.round(prePeak.demand), supply: Math.round(preSupplyShifts), unit: "preceptor-shifts in the peak week", where: prePeak.week ? fmtW(prePeak.week) : null,
    detail: prePeak.demand === 0 ? "No clinical shifts need a preceptor." : `Peak ${Math.round(prePeak.demand)} preceptor-shifts a week (${Math.round(prePeak.added)} from the new cohort${cohorts.length === 1 ? "" : "s"}) against ${securedSites.reduce((n, s) => n + s.preceptors, 0)} preceptors on record at ${securedSites.length} secured sites × ${a.preceptorShiftsPerWeek.value} shifts a week = ${Math.round(preSupplyShifts)}. ${preShort > 1e-9 ? `${Math.round(preShort)} short — about ${Math.ceil(preShort / Math.max(1, a.preceptorShiftsPerWeek.value))} more preceptors.` : "Covered."}`,
    fix: preShort > 1e-9 ? `recruit ${Math.ceil(preShort / Math.max(1, a.preceptorShiftsPerWeek.value))} preceptors at secured sites (${a.preceptorOnboardWeeks.value} weeks' lead) or secure a site that brings its own` : "none needed",
    shortfall: preShort > 1e-9 ? Math.ceil(preShort / Math.max(1, a.preceptorShiftsPerWeek.value)) : 0, evidence: securedSites.some((s) => s.preceptors > 0) ? "estimate" : "unknown",
  });
  // Clinical seats by date × shift × setting: physical vs secured, only where the new cohorts add demand.
  let learnerShifts = 0; const settingsNeeded = new Set<string>(); const sitesNeeded = new Set<string>();
  const seatKey = window ? `${window.from}|${window.to}|${[...d.assumedSecuredSiteIds].sort().join(",")}` : "";
  const cached = window ? ctx.seatCache.get(seatKey) : undefined;
  const assets = cached?.assets ?? input.supply.assets.map((x) => (d.assumedSecuredSiteIds.includes(x.employerId) ? { ...x, agreementStatus: "secured" } : x));
  const assetById = cached?.assetById ?? new Map(assets.map((x) => [x.id, x]));
  if (window) {
    const baseInWindow = ctx.baselineDemand.filter((x) => x.iso >= window.from && x.iso <= window.to);
    const supply = cached?.supply ?? assetSupply(assets, input.supply.overrides, window.from, window.to);
    const baseOnly = cached?.baseOnly ?? new Map(assetMatch(baseInWindow, supply, [], assetById).map((c) => [`${c.iso}|${c.block}|${c.settingCode}`, c]));
    if (!cached) ctx.seatCache.set(seatKey, { supply, baseOnly, assetById, assets });
    const newDemand = assetDemand(newRows, input.supply.rotations);
    // A year's worth at steady state: one cohort's learner-shifts × cohorts a year.
    learnerShifts = newDemand.reduce((n, x) => n + x.students, 0) / Math.max(1, cohorts.length) * Math.max(1, d.cohortsPerYear);
    for (const x of newDemand) if (x.settingCode) settingsNeeded.add(x.settingCode);
    const combined = assetMatch([...baseInWindow, ...newDemand], supply, [], assetById);
    const newKeys = new Set(newDemand.map((x) => `${x.iso}|${x.block}|${x.settingCode}`));
    // Cells the new demand pushes short (or shorter) — the scenario's own shortfall, not the baseline's.
    const worsened = combined.filter((c) => newKeys.has(`${c.iso}|${c.block}|${c.settingCode}`) && c.shortSecured > (baseOnly.get(`${c.iso}|${c.block}|${c.settingCode}`)?.shortSecured ?? 0));
    const shortSecuredCells = worsened.filter((c) => c.shortSecured > 0);
    const shortPhysicalCells = worsened.filter((c) => c.shortPhysical > (baseOnly.get(`${c.iso}|${c.block}|${c.settingCode}`)?.shortPhysical ?? 0));
    const unmapped = [...new Set(newDemand.filter((x) => !x.settingCode).map((x) => x.rotationType))];
    const bySetting = new Map<string, AssetMatchCell[]>();
    for (const c of shortSecuredCells) bySetting.set(c.settingCode, [...(bySetting.get(c.settingCode) ?? []), c]);
    for (const [code, cells] of bySetting) {
      const first = cells.slice().sort((x, y) => x.iso.localeCompare(y.iso))[0];
      const physicalOnly = cells.filter((c) => c.shortPhysical <= (baseOnly.get(`${c.iso}|${c.block}|${c.settingCode}`)?.shortPhysical ?? 0)).length;
      const worst = cells.reduce((b, c) => (c.shortSecured > b.shortSecured ? c : b), cells[0]);
      const unsecuredSites = [...new Set(assets.filter((x) => x.settingCode === code && x.agreementStatus !== "secured" && x.status !== "archived").map((x) => x.facilityName))];
      const isAgreements = physicalOnly === cells.length && unsecuredSites.length > 0;
      for (const s of unsecuredSites) sitesNeeded.add(s);
      constraints.push({
        kind: isAgreements ? "agreements" : "clinical-seats", severity: "binding", label: isAgreements ? `Agreements — ${code}` : `Clinical seats — ${code}`,
        demand: worst.demand, supply: isAgreements ? worst.learners : worst.securedLearners, unit: `learner seats on ${fmtD(worst.iso)} ${worst.block}`, where: `${fmtD(first.iso)} ${first.block} · ${code}`,
        detail: isAgreements
          ? `${cells.length} date-shifts of ${code} exceed secured seats but fit the physical ceiling: on ${fmtD(worst.iso)} ${worst.block} the cohorts need ${worst.demand}, secured sites seat ${worst.securedLearners}, all sites ${worst.learners}. Capacity exists; the agreements do not (${unsecuredSites.slice(0, 3).join(", ")}${unsecuredSites.length > 3 ? ", …" : ""}).`
          : `${cells.length} date-shifts of ${code} exceed what any site can seat: worst ${fmtD(worst.iso)} ${worst.block}, ${worst.demand} learners vs ${worst.securedLearners} secured / ${worst.learners} physical. ${physicalOnly ? `${physicalOnly} of them fit the physical ceiling at unsecured sites.` : "No partner reports enough assets of this setting on those dates."}`,
        fix: isAgreements ? `secure ${unsecuredSites.slice(0, 2).join(" or ")} (${a.siteAgreementWeeks.value} weeks' lead)` : `add ${code} assets at a partner, move the ${code} rotation to another shift or week, or split the section across sites`,
        shortfall: worst.shortSecured, evidence: assets.filter((x) => x.settingCode === code).every((x) => x.dataSource === "VERIFIED") ? "verified" : "estimate",
      });
    }
    used.add("siteAgreementWeeks");
    if (shortSecuredCells.length === 0 && newDemand.length > 0) constraints.push({ kind: "clinical-seats", severity: "ok", label: "Clinical seats", demand: learnerShifts, supply: null, unit: "learner-shifts in the window", where: null, detail: `Every date, shift and setting the new cohort${cohorts.length === 1 ? "" : "s"} need fits within secured seats alongside the offerings already running (${learnerShifts} learner-shifts).`, fix: "none needed", shortfall: 0, evidence: assets.every((x) => x.dataSource === "VERIFIED") ? "verified" : "estimate" });
    if (unmapped.length) constraints.push({ kind: "clinical-seats", severity: "unknown", label: "Unmapped rotation types", demand: null, supply: null, unit: "", where: null, detail: `Rotation types with no asset setting: ${unmapped.join(", ")} — their seats cannot be tested.`, fix: "map each rotation type to a setting on the clinical page", shortfall: null, evidence: "unknown" });
    void shortPhysicalCells;
    // Accreditor: students at once across the family's sites on any date.
    if (p.accreditedCapacity != null) {
      const perDate = new Map<string, number>();
      for (const x of [...baseInWindow, ...newDemand]) perDate.set(x.iso, (perDate.get(x.iso) ?? 0) + x.students);
      const worst = [...perDate.entries()].sort((x, y) => y[1] - x[1])[0];
      const over = worst && worst[1] > p.accreditedCapacity;
      constraints.push({ kind: "accreditor", severity: over ? "binding" : "ok", label: "Accreditor capacity", demand: worst?.[1] ?? 0, supply: p.accreditedCapacity, unit: "students on site at once", where: worst ? fmtD(worst[0]) : null, detail: over ? `On ${fmtD(worst[0])} ${worst[1]} students would be on site against an approved ${p.accreditedCapacity}.` : `Peak ${worst?.[1] ?? 0} students on site within the approved ${p.accreditedCapacity}.`, fix: over ? "request a capacity increase from the accreditor (add the approval lead time) or stagger the clinical weeks" : "none needed", shortfall: over ? worst[1] - p.accreditedCapacity : 0, evidence: "verified" });
    } else constraints.push({ kind: "accreditor", severity: "unknown", label: "Accreditor capacity", demand: null, supply: null, unit: "", where: null, detail: "No accredited capacity is on record for this family — the accreditor's limit cannot be tested.", fix: "record the approved capacity on the family's clinical page", shortfall: null, evidence: "unknown" });
  }
  // Rooms: campus hours a week against the schedulable hours of classrooms and labs.
  const roomSupply = input.supply.rooms.filter((r) => r.weeklyOpenHours > 0).reduce((n, r) => n + r.weeklyOpenHours, 0);
  let roomPeak = { week: "", demand: 0, added: 0 };
  for (const w of weeks) { const total = (ctx.baselineWeekly.get(w)?.roomHours ?? 0) + (newWeekly.get(w)?.roomHours ?? 0); if (total > roomPeak.demand) roomPeak = { week: w, demand: total, added: newWeekly.get(w)?.roomHours ?? 0 }; }
  const roomsCoded = input.supply.rooms.some((r) => r.weeklyOpenHours > 0);
  constraints.push({
    kind: "rooms", severity: !roomsCoded ? "unknown" : roomPeak.demand > roomSupply ? "binding" : "ok", label: "Rooms",
    demand: round1(roomPeak.demand), supply: roomsCoded ? round1(roomSupply) : null, unit: "room-hours in the peak week", where: roomPeak.week ? fmtW(roomPeak.week) : null,
    detail: !roomsCoded ? "No room has coded open hours, so room capacity is unknown — not unlimited." : `Peak ${round1(roomPeak.demand)} class and lab room-hours a week (${round1(roomPeak.added)} added) against ${round1(roomSupply)} open room-hours across ${input.supply.rooms.filter((r) => r.weeklyOpenHours > 0).length} rooms.`,
    fix: !roomsCoded ? "code each room's open hours under Rooms, buildings & equipment" : roomPeak.demand > roomSupply ? `add ${round1(roomPeak.demand - roomSupply)} room-hours a week (evening use, a renovated lab: ${a.spaceRenovationWeeks.value} weeks' lead) or move class hours online` : "none needed",
    shortfall: roomsCoded ? Math.max(0, round1(roomPeak.demand - roomSupply)) : null, evidence: roomsCoded ? "estimate" : "unknown",
  });
  // Pipeline: seats proposed vs the seats the target needs; the applicants those seats need.
  const seatsPerYear = d.kind === "improve-retention" ? 0 : d.seats * Math.max(1, d.cohortsPerYear);
  const seatsRequired = Math.max(0, req.capacity - (baselineProductiveTargetYear > 0 ? deriveCohortTargets(baselineProductiveTargetYear, effRates, Math.max(1, p.terms.length)).capacity : 0));
  constraints.push({
    kind: "pipeline", severity: d.targetWorkers <= 0 ? "info" : seatsPerYear + 1e-9 < seatsRequired && d.kind !== "improve-retention" ? "secondary" : "ok", label: "Pipeline",
    demand: Math.ceil(seatsRequired - 1e-9), supply: seatsPerYear, unit: "seats a year", where: null,
    detail: d.targetWorkers <= 0 ? "No workforce target set — the seats are tested against capacity only." : `${d.targetWorkers} productive workers a year need ${Math.ceil(req.capacity - 1e-9)} seats a year at the current rates (${Math.ceil(req.interested - 1e-9)} interested → ${Math.ceil(req.qualified - 1e-9)} qualified → ${Math.ceil(req.offered - 1e-9)} offers → ${Math.ceil(req.capacity - 1e-9)} enrolled → ${Math.ceil(req.completing - 1e-9)} completing → ${Math.ceil(req.licensed - 1e-9)} licensed → ${Math.ceil(req.placed - 1e-9)} placed). The offerings already planned cover ${Math.ceil((req.capacity - seatsRequired) - 1e-9)}; this design adds ${seatsPerYear}.`,
    fix: seatsPerYear + 1e-9 < seatsRequired ? `add ${Math.ceil(seatsRequired - seatsPerYear - 1e-9)} more seats a year, or raise completion and placement` : "none needed",
    shortfall: Math.max(0, Math.ceil(seatsRequired - seatsPerYear - 1e-9)), evidence: "estimate",
  });
  // Calendar: sessions on holidays, informational.
  const holidayRows = newRows.filter((r) => r.holiday);
  if (holidayRows.length) constraints.push({ kind: "calendar", severity: "info", label: "Calendar", demand: holidayRows.length, supply: null, unit: "sessions on holidays", where: fmtD(holidayRows[0].dateIso!), detail: `${holidayRows.length} sessions land on observed holidays (${[...new Set(holidayRows.map((r) => r.holiday))].slice(0, 3).join(", ")}) and would need moving.`, fix: "move them when the offering is designed", shortfall: null, evidence: "verified" });
  // Equipment: not modeled beyond an assumption.
  constraints.push({ kind: "equipment", severity: "unknown", label: "Equipment", demand: null, supply: null, unit: "", where: null, detail: "Specialized equipment is not modeled; the cost line assumes one set per added section where rooms bind.", fix: "list the equipment each session needs on the design page", shortfall: null, evidence: "unknown" });

  // 8 · Binding first, then secondary.
  const rank: Record<ConstraintSeverity, number> = { binding: 0, secondary: 1, unknown: 2, info: 3, ok: 4 };
  const ordered = [...constraints].sort((x, y) => rank[x.severity] - rank[y.severity]);
  const bindingList = ordered.filter((c) => c.severity === "binding");
  const binding = bindingList[0] ?? null;
  for (let i = 1; i < bindingList.length; i++) bindingList[i].severity = "secondary";

  // 10 · The earliest feasible start from what has to be put in place first.
  const leads: { weeks: number; why: string; key: string; owner: string }[] = [{ weeks: a.recruitingWeeks.value, why: "recruit and admit the cohort", key: "recruitingWeeks", owner: "Admissions" }];
  if (facShort > 1e-9) leads.push({ weeks: a.facultyHireWeeks.value, why: `hire ${Math.ceil(facShort - 1e-9)} faculty`, key: "facultyHireWeeks", owner: "Dean and HR" });
  if (constraints.some((c) => c.kind === "agreements" && (c.severity === "binding" || c.severity === "secondary"))) leads.push({ weeks: a.siteAgreementWeeks.value, why: "secure the missing site agreements", key: "siteAgreementWeeks", owner: "Clinical coordinator" });
  if (preShort > 1e-9) leads.push({ weeks: a.preceptorOnboardWeeks.value, why: "onboard preceptors", key: "preceptorOnboardWeeks", owner: "Clinical coordinator" });
  if (roomsCoded && roomPeak.demand > roomSupply) leads.push({ weeks: a.spaceRenovationWeeks.value, why: "add instructional space", key: "spaceRenovationWeeks", owner: "Facilities" });
  if (d.needsApproval || d.kind === "additional-campus") leads.push({ weeks: a.approvalWeeks.value, why: "program, location or accreditor approvals", key: "approvalWeeks", owner: "Chief academic officer" });
  for (const l of leads) used.add(l.key);
  const longest = leads.reduce((b, l) => (l.weeks > b.weeks ? l : b), leads[0]);
  const earliestStartIso = addWeeks(input.todayIso, longest.weeks);
  const feasibleInTime = d.startIso >= earliestStartIso;
  if (!feasibleInTime) constraints.unshift({ kind: "time", severity: "binding", label: "Time", demand: null, supply: null, unit: "", where: fmtD(d.startIso), detail: `A start on ${fmtD(d.startIso)} leaves ${Math.max(0, Math.round((dateOf(d.startIso).getTime() - dateOf(input.todayIso).getTime()) / DAY / 7))} weeks; the longest lead item is ${longest.why} (${longest.weeks} weeks), so the earliest feasible start is ${fmtD(earliestStartIso)}.`, fix: `start on or after ${fmtD(earliestStartIso)}, or shorten the ${longest.why} lead`, shortfall: null, evidence: "estimate" });
  const feasible = bindingList.length === 0 && feasibleInTime;

  // 11 · Output at steady state, and when the first workers arrive.
  const first = cohorts[0] ?? null;
  const annualLadder = d.kind === "improve-retention"
    ? (() => { const base = input.baselineCohorts.filter((c) => c.programId === p.id); const seats = base.length ? base.reduce((n, c) => n + c.seats, 0) / Math.max(1, new Set(base.map((c) => c.gradYear)).size) : 0; const before = buildLadder(seats, rates), after = buildLadder(seats, effRates); return { enrolled: 0, completing: after.completing - before.completing, licensed: after.licensed - before.licensed, placed: after.placed - before.placed, productive: after.productive - before.productive }; })()
    : (() => { const l = buildLadder(d.seats, rates); const k = Math.max(1, d.cohortsPerYear); return { enrolled: l.enrolled * k, completing: l.completing * k, licensed: l.licensed * k, placed: l.placed * k, productive: l.productive * k }; })();
  const firstYearWorkersEnter = first ? Number(first.productiveByIso.slice(0, 4)) : d.kind === "improve-retention" ? Number(addMonths(addMonths(addMonths(input.todayIso, a.licensureMonths.value), a.placementMonths.value), a.rampMonths.value).slice(0, 4)) : null;
  const steadyStateYear = first && d.cohortsPerYear > 0 ? firstYearWorkersEnter : firstYearWorkersEnter;
  const facultyFteAdded = round1(Math.max(0, ...weeks.map((w) => newWeekly.get(w)?.faculty ?? 0)));

  // Costs: what the binding and secondary constraints say has to be bought, plus per-student support.
  const lines: CostLine[] = [];
  if (facShort > 1e-9) { const n = Math.ceil(facShort - 1e-9); lines.push({ category: "Faculty", oneTime: 0, recurring: n * a.facultyFullTimeAnnual.value, basis: `${n} full-time faculty × $${Math.round(a.facultyFullTimeAnnual.value).toLocaleString("en-US")}`, assumptionKeys: ["facultyFullTimeAnnual"] }); used.add("facultyFullTimeAnnual"); }
  else if (facultyPeopleAdded > 0) { const hours = weeks.reduce((n, w) => n + (newWeekly.get(w)?.faculty ?? 0) * p.assumptions.facContactHours, 0); lines.push({ category: "Faculty (adjunct hours within the roster's slack)", oneTime: 0, recurring: hours * a.adjunctPerContactHour.value / Math.max(1, cohorts.length) * Math.max(1, d.cohortsPerYear), basis: `${Math.round(hours / Math.max(1, cohorts.length))} contact hours a cohort × $${a.adjunctPerContactHour.value}`, assumptionKeys: ["adjunctPerContactHour"] }); used.add("adjunctPerContactHour"); }
  const preceptorShiftsPerYear = newRows.filter((r) => r.session.kind === "CLINICAL").reduce((n, r) => n + (r.computed.Y ?? 0) * (r.session.preceptorsNeeded ?? 0), 0) / Math.max(1, cohorts.length) * Math.max(1, d.cohortsPerYear);
  if (preceptorShiftsPerYear > 0 && a.preceptorStipendPerShift.value > 0) { lines.push({ category: "Preceptor stipends", oneTime: 0, recurring: preceptorShiftsPerYear * a.preceptorStipendPerShift.value, basis: `${Math.round(preceptorShiftsPerYear)} preceptor-shifts a year × $${a.preceptorStipendPerShift.value}`, assumptionKeys: ["preceptorStipendPerShift"] }); used.add("preceptorStipendPerShift"); }
  if (constraints.some((c) => c.kind === "agreements" || c.kind === "preceptors") && constraints.some((c) => (c.kind === "agreements" || c.kind === "preceptors") && (c.severity === "binding" || c.severity === "secondary"))) { lines.push({ category: "Clinical coordination", oneTime: 0, recurring: a.clinicalCoordinatorAnnual.value, basis: "one clinical coordinator to secure sites and preceptors", assumptionKeys: ["clinicalCoordinatorAnnual"] }); used.add("clinicalCoordinatorAnnual"); }
  if (roomsCoded && roomPeak.demand > roomSupply) { lines.push({ category: "Space and equipment", oneTime: a.spaceRenovationOneTime.value + a.simulationEquipmentOneTime.value, recurring: 0, basis: "one renovated instructional space and one equipment set", assumptionKeys: ["spaceRenovationOneTime", "simulationEquipmentOneTime"] }); used.add("spaceRenovationOneTime"); used.add("simulationEquipmentOneTime"); }
  if (seatsPerYear > 0) { lines.push({ category: "Student support", oneTime: 0, recurring: seatsPerYear * a.studentSupportPerStudentAnnual.value, basis: `${seatsPerYear} seats × $${a.studentSupportPerStudentAnnual.value.toLocaleString("en-US")}`, assumptionKeys: ["studentSupportPerStudentAnnual"] }); used.add("studentSupportPerStudentAnnual"); }
  const oneTime = lines.reduce((n, l) => n + l.oneTime, 0), recurring = lines.reduce((n, l) => n + l.recurring, 0);
  const annualized = recurring + lines.reduce((n, l) => n + (l.category === "Space and equipment" ? a.spaceRenovationOneTime.value / a.spaceUsefulLifeYears.value + a.simulationEquipmentOneTime.value / a.equipmentUsefulLifeYears.value : 0), 0);
  if (oneTime > 0) { used.add("spaceUsefulLifeYears"); used.add("equipmentUsefulLifeYears"); }

  // Milestones with owners, counted back from the start.
  const start = feasibleInTime ? d.startIso : earliestStartIso;
  const milestones: Milestone[] = leads.map((l) => ({ iso: addWeeks(start, -l.weeks), what: `${l.why[0].toUpperCase()}${l.why.slice(1)} — begin`, owner: l.owner, lateIfAfter: addWeeks(start, -l.weeks) < input.todayIso }));
  milestones.push({ iso: start, what: `Cohort 1 starts (${d.seats} seats)`, owner: "Program director", lateIfAfter: false });
  if (first) {
    milestones.push({ iso: first.endIso, what: "Cohort 1 completes", owner: "Program director", lateIfAfter: false });
    milestones.push({ iso: first.productiveByIso, what: "Cohort 1 fully productive in regional jobs", owner: "Employer partners", lateIfAfter: false });
  }
  milestones.sort((x, y) => x.iso.localeCompare(y.iso));

  // Trace: each proposed cohort → its courses → sessions, learner-shifts by setting, hours.
  const codeOf = new Map(input.supply.rotations.map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  const trace = cohorts.map((c) => {
    const mine = newRows.filter((r) => r.cohortId === c.id);
    const byCourse = new Map<string, TraceCourse>();
    for (const r of mine) {
      const k = `${r.termIndex}|${r.courseCode ?? r.courseTitle}`;
      const t = byCourse.get(k) ?? { code: r.courseCode, name: r.courseTitle, termIndex: r.termIndex, sessions: 0, learnerShifts: 0, bySetting: {}, facultyHours: 0, preceptorShifts: 0 };
      t.sessions++; t.facultyHours += r.computed.Z ?? 0;
      if (r.session.kind === "CLINICAL") { const seats = Math.min(Math.round(r.computed.C), (r.computed.Y ?? 0) * Math.max(1, r.session.maxStudents)); t.learnerShifts += seats; const code = codeOf.get((r.session.rotationType ?? "").trim().toLowerCase()) ?? r.session.rotationType ?? "(unspecified)"; t.bySetting[code] = (t.bySetting[code] ?? 0) + seats; t.preceptorShifts += (r.computed.Y ?? 0) * (r.session.preceptorsNeeded ?? 0); }
      byCourse.set(k, t);
    }
    return { cohortId: c.id, courses: [...byCourse.values()].sort((x, y) => x.termIndex - y.termIndex || (x.code ?? "").localeCompare(y.code ?? "")) };
  });

  // Confidence: the assumptions the answer used, and the estimates in the supply it read.
  const assumptionsUsed = [...used].map((k) => a[k]).filter(Boolean);
  const conf = confidenceOf(assumptionsUsed);
  const risks: string[] = [];
  const estAssets = assets.filter((x) => x.status !== "archived" && x.dataSource !== "VERIFIED").length;
  if (estAssets) risks.push(`${estAssets} of ${assets.filter((x) => x.status !== "archived").length} clinical assets are estimates or gaps, not confirmed with the site`);
  if (conf.unverified.some((u) => u.category === "cost")) risks.push("every cost figure is a default or an estimate — the cost per worker is indicative only");
  if (conf.unverified.some((u) => u.category === "lead-time")) risks.push("lead times are defaults; the earliest start moves with them");
  if (first?.warnings.length) risks.push(...first.warnings.slice(0, 2));
  if (!roomsCoded) risks.push("room hours are not coded, so space is untested");

  // Max feasible cohort size for this design (ignoring time): the largest seat count with nothing binding.
  let currentMaxFeasibleSeats: number | null = null;
  if (opts.searchMax !== false && d.kind !== "improve-retention" && d.seats > 0) {
    const bindsAt = (seats: number) => { const r = evaluateExpansion(ctx, { ...d, seats, startIso: d.startIso >= earliestStartIso ? d.startIso : earliestStartIso }, { searchMax: false }); return r.constraints.some((c) => c.kind !== "time" && c.kind !== "pipeline" && (c.severity === "binding" || c.severity === "secondary")); };
    if (!bindsAt(d.seats)) { let hi = d.seats; for (let i = 0; i < 3 && !bindsAt(hi * 2); i++) hi *= 2; let lo = hi; hi = hi * 2; while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (bindsAt(mid)) hi = mid; else lo = mid; } currentMaxFeasibleSeats = lo; }
    else { let lo = 0, hi = d.seats; while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (bindsAt(mid)) hi = mid; else lo = mid; } currentMaxFeasibleSeats = lo; }
  }

  const bindingSentence = binding ? `${binding.label.toLowerCase()} binds first${binding.where ? ` (${binding.where})` : ""}: ${binding.detail.split(". ")[0]}.` : "nothing binds.";
  const headline = feasible
    ? `Feasible: ${seatsPerYear ? `${seatsPerYear} seats a year` : "the retention change"} from ${fmtD(d.startIso)} adds about ${Math.round(annualLadder.productive)} productive workers a year at steady state, the first entering the labor market in ${firstYearWorkersEnter ?? "—"}.`
    : `Not feasible as designed: ${bindingSentence}${!feasibleInTime ? ` Earliest feasible start ${fmtD(earliestStartIso)}.` : ""}`;
  const summary = [
    headline,
    d.targetWorkers > 0 ? `The target of ${d.targetWorkers} productive workers by ${d.targetYear} needs ${Math.ceil(req.capacity - 1e-9)} seats a year at current rates; ${Math.ceil(seatsRequired - 1e-9) > 0 ? `${Math.ceil(seatsRequired - 1e-9)} beyond what is already planned` : "the planned offerings already cover it"}.` : "",
    bindingList.length ? `Constraints: ${bindingList.map((c) => c.label.toLowerCase()).join(", ")}.` : "",
    `Faculty ${facultyFteAdded} FTE (${facultyPeopleAdded} people at the peak) and ${preceptorPeopleAdded} preceptors added; ${Math.round(learnerShifts)} learner-shifts across ${[...settingsNeeded].join(", ") || "no clinical settings"}.`,
    lines.length ? `Cost about $${Math.round(recurring).toLocaleString("en-US")} a year recurring and $${Math.round(oneTime).toLocaleString("en-US")} one-time: $${annualLadder.completing > 0 ? Math.round(annualized / annualLadder.completing).toLocaleString("en-US") : "—"} per additional completer, $${annualLadder.placed > 0 ? Math.round(annualized / annualLadder.placed).toLocaleString("en-US") : "—"} per additional placed worker.` : "",
    `Confidence: ${conf.verified} of ${conf.used} assumptions used are verified${risks.length ? `; ${risks[0]}` : ""}.`,
    currentMaxFeasibleSeats != null ? `Largest cohort this design could run today without a new constraint: ${currentMaxFeasibleSeats} seats.` : "",
  ].filter(Boolean).join(" ");

  return {
    feasible, feasibleInTime, headline, binding, constraints: [...constraints].sort((x, y) => rank[x.severity] - rank[y.severity]), cohorts,
    outputs: {
      currentMaxFeasibleSeats, proposedSeats: d.seats,
      additionalAnnualEnrollment: annualLadder.enrolled, additionalAnnualCompletions: annualLadder.completing, additionalAnnualLicensed: annualLadder.licensed, additionalAnnualPlaced: annualLadder.placed, additionalAnnualProductive: annualLadder.productive,
      firstYearWorkersEnter, steadyStateYear,
      facultyFteAdded, facultyPeopleAdded, preceptorFteAdded, preceptorPeopleAdded,
      learnerShifts: Math.round(learnerShifts), settingsNeeded: [...settingsNeeded].sort(), sitesNeeded: [...sitesNeeded].sort(),
      roomHoursPerWeekPeak: round1(roomPeak.added), studentSupportSeats: seatsPerYear,
      required: { productive: req.productive, placed: req.placed, licensed: req.licensed, completing: req.completing, enrolled: req.capacity, offered: req.offered, qualified: req.qualified, interested: req.interested, seatsPerYear: req.capacity },
      baselineAnnualProductive: baselineProductiveTargetYear,
    },
    costs: { lines, oneTime, recurring, annualized, perAdditionalCompleter: annualLadder.completing > 0 ? annualized / annualLadder.completing : null, perAdditionalPlaced: annualLadder.placed > 0 ? annualized / annualLadder.placed : null },
    earliestStartIso, proposedStartIso: d.startIso, milestones, assumptionsUsed,
    confidence: { share: conf.share, verified: conf.verified, used: conf.used, unverified: conf.unverified.map((u) => u.key), stale: conf.stale.map((u) => u.key), risks },
    trace, summary,
  };
}

function newRowsWeekPreceptorFte(rows: DatedInstance[], week: string): number {
  return rows.filter((r) => r.mondayIso === week).reduce((n, r) => n + (r.computed.AE ?? 0), 0);
}

/** A block label for a start time — used by the studio to say which shift a design lands on. */
export const blockLabel = (b: ShiftBlock) => b;
