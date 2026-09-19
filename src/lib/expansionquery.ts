// Server side of use case 1 (Phase 9): assemble everything the expansion engine needs for one
// program — the template, the college's calendar, the operating plan as dated rows, the supply
// (faculty, sites and preceptors, assets, rooms), the resolved assumptions — plus the saved scenarios.

import { prisma } from "./db";
import { getCapacityModel, getAssetMap, getWorkloadPolicies, getRoomsWorkspace } from "./queries";
import { buildInstances, type CohortCalendarInput, type DatedInstance, type SessionInput } from "./capacitymodel";
import { resolvePolicy, type PolicyLite, type PersonLite } from "./workload";
import { resolveAssumptions, applyFamilyRates, type AssumptionRow, type Assumptions } from "./assumptions";
import { DEFAULT_DESIGN, type ExpansionDesign, type ExpansionInput, type ExpansionResult } from "./expansion";
import { holidayMap } from "./academiccalendar";
import { forFamily } from "./assetmap";

export interface ScenarioRow { id: string; name: string; status: string; design: ExpansionDesign; overrides: Record<string, number>; result: ExpansionResult | null; /** A result exists but was produced by an earlier engine and cannot be shown; re-evaluate. */ staleResult: boolean; evaluatedAt: string | null; notes: string | null; updatedAt: string }
export interface SitePick { employerId: string; name: string; agreementStatus: string; assets: number }

const parse = <T,>(s: string | null | undefined, fallback: T): T => { if (!s) return fallback; try { return JSON.parse(s) as T; } catch { return fallback; } };
const mondayOnOrAfter = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const back = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() + (back ? 7 - back : 0) * 86400000).toISOString().slice(0, 10); };
const isoOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const gradYearOf = (name: string): number | null => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : null; };

/** The engine's input for a program, as of today. */
export async function getExpansionInput(programId: string, overrides: Record<string, number> = {}): Promise<ExpansionInput | null> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      institution: { select: { id: true, name: true, springStart: true, summerStart: true, fallStart: true, academicEvents: { select: { date: true, endDate: true, label: true, kind: true, season: true } } } },
      family: { select: { id: true, name: true, goalPlan: true, accreditedCapacity: true, familySites: { select: { employerId: true, agreementStatus: true, studentsAtOnce: true, approvedCapacity: true, employer: { select: { name: true } } } } } },
      terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }] } } } } },
    },
  });
  if (!program) return null;
  const inst = program.institution;
  const events = inst.academicEvents.map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: isoOf(e.endDate), label: e.label, kind: e.kind, season: e.season }));
  const holidays = holidayMap(events.filter((e) => e.kind === "holiday").map((e) => ({ iso: e.iso, endIso: e.endIso, label: e.label, kind: e.kind })));

  // The operating plan: every dated session of every planned and running offering at the college.
  const cap = await getCapacityModel({ institutionId: inst.id });
  const baselineRows: DatedInstance[] = (cap?.cohorts ?? []).flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
    termEndByIndex: c.termEndByIndex, termWeeksByIndex: c.termWeeksByIndex, holidays: c.holidays, courses: c.courses,
  } as CohortCalendarInput, c.assumptions).filter((i) => i.dateIso != null));
  const stages = await prisma.cohort.findMany({ where: { program: { institutionId: inst.id }, status: { in: ["planned", "active"] } }, select: { id: true, name: true, stages: { where: { stageKey: "productive" }, select: { targetNumber: true } } } });
  const goalOf = new Map(stages.map((s) => [s.id, { goal: s.stages[0]?.targetNumber ?? 0, gradYear: gradYearOf(s.name) }]));
  const baselineCohorts = (cap?.cohorts ?? []).map((c) => {
    const idx = Object.keys(c.termStartByIndex).map(Number).sort((x, y) => x - y);
    const ends = Object.values(c.termEndByIndex ?? {}).filter((v): v is string => !!v).sort();
    return { cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, seats: c.enrollmentByTerm[idx[0]] ?? 0, startIso: c.termStartByIndex[idx[0]]?.slice(0, 10) ?? null, endIso: ends[ends.length - 1]?.slice(0, 10) ?? null, productiveGoal: goalOf.get(c.cohortId)?.goal ?? 0, gradYear: goalOf.get(c.cohortId)?.gradYear ?? null };
  });

  // Supply.
  const to = `${Number(todayIso.slice(0, 4)) + 5}-12-31`;
  const [map, policies, people, roomsWs] = await Promise.all([
    getAssetMap(inst.id, todayIso, to),
    getWorkloadPolicies(),
    prisma.person.findMany({ where: { institutionId: inst.id, active: true, role: { in: ["instructor", "preceptor"] } }, select: { id: true, name: true, role: true, employmentType: true, title: true, employerId: true, assetId: true, institutionId: true } }),
    getRoomsWorkspace(inst.id),
  ]);
  const instructors = people.filter((p) => p.role === "instructor").map((p) => ({ id: p.id, name: p.name, employmentType: p.employmentType, contactHoursPerWeek: resolvePolicy(p as PersonLite, policies as PolicyLite[]).policy.contactHoursPerWeek }));
  const preceptorsBySite = new Map<string, number>();
  for (const p of people) if (p.role === "preceptor" && p.employerId) preceptorsBySite.set(p.employerId, (preceptorsBySite.get(p.employerId) ?? 0) + 1);
  const sites = (program.family?.familySites ?? []).map((s) => ({ employerId: s.employerId, siteName: s.employer.name, agreementStatus: s.agreementStatus, studentsAtOnce: s.studentsAtOnce, approvedCapacity: s.approvedCapacity, preceptors: preceptorsBySite.get(s.employerId) ?? 0 }));
  const rooms = roomsWs.rooms.filter((r) => r.status === "active").map((r) => ({ id: r.id, name: r.name, kind: r.kind, weeklyOpenHours: r.weeklyOpen, capacity: r.capacity }));

  // Assumptions: registry rows resolved for this program, the family's saved rates applied.
  const rows: AssumptionRow[] = (await prisma.assumption.findMany()).map((r) => ({ scope: r.scope, key: r.key, value: r.value, low: r.low, high: r.high, source: r.source, owner: r.owner, status: r.status, verifiedAt: isoOf(r.verifiedAt), reviewBy: isoOf(r.reviewBy) }));
  let assumptions: Assumptions = resolveAssumptions(rows, { institutionId: inst.id, familyId: program.family?.id ?? null, programId: program.id }, overrides, todayIso);
  if (program.family?.goalPlan) assumptions = applyFamilyRates(assumptions, parse<{ goal?: Record<string, number> }>(program.family.goalPlan, {}).goal, program.family.name);
  for (const k of Object.keys(overrides)) if (assumptions[k]) assumptions[k] = { ...assumptions[k], value: overrides[k], origin: "scenario", status: "estimate", source: "scenario override" };

  const courses = program.terms.flatMap((t) => t.courses.map((c) => ({
    id: c.id, termId: t.id, termIndex: t.index, termName: t.name, code: c.code, name: c.name,
    sessions: c.sessions.map((s): SessionInput => ({ id: s.id, kind: s.kind as SessionInput["kind"], number: s.number, title: s.title, deliveryMode: s.deliveryMode, location: s.location, lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, facultyContactPolicy: s.facultyContactPolicy, supportStaffNeeded: s.supportStaffNeeded, supportContactPolicy: s.supportContactPolicy, week: s.week, dayOfWeek: s.dayOfWeek, startTime: s.startTime, notes: s.notes, preceptorsNeeded: s.preceptorsNeeded, preceptorContactPolicy: s.preceptorContactPolicy, rotationType: s.rotationType, clinicalMode: s.clinicalMode })),
  })));
  return {
    todayIso,
    institution: { id: inst.id, name: inst.name },
    program: {
      id: program.id, name: program.name, familyId: program.family?.id ?? null, familyName: program.family?.name ?? null,
      terms: program.terms.map((t) => ({ id: t.id, index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek, semester: t.semester })),
      courses,
      assumptions: { facContactHours: program.facContactHours, facWorkWeekHours: program.facWorkWeekHours, facTermWeeks: program.facTermWeeks, preContactHours: program.preContactHours, preWorkWeekHours: program.preWorkWeekHours, preTermWeeks: program.preTermWeeks },
      accreditedCapacity: program.family?.accreditedCapacity ?? null, defaultSeats: program.defaultCohortSeats,
    },
    anchors: { springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart },
    events, holidays, baselineRows, baselineCohorts,
    supply: { instructors, assets: forFamily(map.assets, program.family?.id ?? null), overrides: map.overrides, rotations: map.rotations.map((r) => ({ rotationType: r.rotationType, settingCode: r.settingCode })), sites, rooms },
    assumptions,
  };
}

/** What the studio page shows before any evaluation: the program, the saved scenarios, the site picker, a default design. */
export async function getExpansionStudio(programId: string) {
  const program = await prisma.program.findUnique({ where: { id: programId }, select: { id: true, name: true, institutionId: true, defaultCohortSeats: true, launchTerms: true, family: { select: { id: true, name: true, goalPlan: true, familySites: { select: { employerId: true, agreementStatus: true, employer: { select: { name: true, _count: { select: { assets: true } } } } } } } }, institution: { select: { id: true, name: true, fallStart: true, academicEvents: { where: { kind: "term_start" }, select: { date: true, kind: true, season: true } } } }, terms: { select: { id: true } } } });
  if (!program) return null;
  const scenarios = (await prisma.scenario.findMany({ where: { programId }, orderBy: { updatedAt: "desc" } })).map((s): ScenarioRow => ({ id: s.id, name: s.name, status: s.status, design: parse<ExpansionDesign>(s.design, { ...DEFAULT_DESIGN, targetYear: new Date().getUTCFullYear() + 3, startIso: "" }), overrides: parse<Record<string, number>>(s.overrides, {}), result: (() => { const r = parse<ExpansionResult | null>(s.result, null); return r && Array.isArray(r.rules) && Array.isArray(r.concurrent) ? r : null; })(), staleResult: (() => { const r = parse<ExpansionResult | null>(s.result, null); return !!r && !(Array.isArray(r.rules) && Array.isArray(r.concurrent)); })(), evaluatedAt: isoOf(s.evaluatedAt), notes: s.notes, updatedAt: s.updatedAt.toISOString() }));
  const goals = parse<{ goalsByYear?: Record<string, number> }>(program.family?.goalPlan, {}).goalsByYear ?? {};
  const year = new Date().getUTCFullYear();
  const targetYear = year + 3;
  const coded = program.institution.academicEvents.find((e) => e.kind === "term_start" && e.season === "Fall" && e.date.getUTCFullYear() === year + 1)?.date.toISOString().slice(0, 10);
  const nextFall = coded ?? mondayOnOrAfter(`${year + 1}-${program.institution.fallStart}`);
  const defaultDesign: ExpansionDesign = { ...DEFAULT_DESIGN, seats: Math.round(program.defaultCohortSeats ?? 24), targetWorkers: Math.round(goals[String(targetYear)] ?? 0), targetYear, startIso: nextFall };
  // Where each prefilled figure comes from, so nothing on the form reads as a recommendation.
  const defaultNotes = {
    seats: program.defaultCohortSeats != null ? `the program's default cohort size (${Math.round(program.defaultCohortSeats)}) from its design page` : "a placeholder of 24 — the program has no default cohort size on record",
    targetWorkers: goals[String(targetYear)] != null ? `the ${program.family?.name ?? "family"} North Star goal for ${targetYear} (${Math.round(goals[String(targetYear)])} productive workers)` : "not set — no North Star goal for that year; enter the workforce ask",
    targetYear: `three years out (${targetYear})`,
    startIso: coded ? `${program.institution.name}'s coded Fall ${year + 1} semester start (${nextFall})` : `the Monday on or after ${program.institution.name}'s fall anchor, ${nextFall} — no Fall ${year + 1} start is coded on the calendar yet`,
    kind: "an additional annual cohort — the most common ask; pick another design to test something else",
  };
  const sitePicks: SitePick[] = (program.family?.familySites ?? []).filter((s) => s.agreementStatus !== "secured").map((s) => ({ employerId: s.employerId, name: s.employer.name, agreementStatus: s.agreementStatus, assets: s.employer._count.assets })).sort((a, b) => b.assets - a.assets);
  const assumptionRows = await prisma.assumption.findMany({ where: { scope: { in: ["global", `inst:${program.institutionId}`, ...(program.family ? [`family:${program.family.id}`] : []), `program:${programId}`] } } });
  return { program: { id: program.id, name: program.name, institutionId: program.institutionId, institution: program.institution.name, familyId: program.family?.id ?? null, family: program.family?.name ?? null, terms: program.terms.length }, scenarios, defaultDesign, defaultNotes, sitePicks, assumptionRowCount: assumptionRows.length };
}
