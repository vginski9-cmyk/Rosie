// The exception queue (Phase 7 of docs/metrics-audit.md): the most consequential unresolved
// problems across every college, each linking to the screen that fixes it. The Home page leads
// with these; goals, setup and the analytics directory sit below. A family with a blocker never
// shows a green coverage badge above it.
//
// Server-only (Prisma + the query layer). Pure helpers at the bottom are unit-tested.

import { prisma } from "./db";
import { getSiteLoad, getCapacityModel, getFamiliesClinical, getActionQueue } from "./queries";
import { buildInstances, type CohortCalendarInput } from "./capacitymodel";

export type ExceptionSeverity = "blocker" | "warning" | "info";
export interface ExceptionItem {
  id: string;
  severity: ExceptionSeverity;
  kind: "no-supply" | "over-capacity" | "unsecured-placement" | "holiday-session" | "unprecepted" | "calendar-conflict" | "unstaffed" | "coverage-gap" | "coverage-inferred" | "unverified-input" | "stale-input" | "goal-gap" | "other";
  institutionId: string | null; institution: string | null;
  familyId: string | null; family: string | null;
  title: string; detail: string;
  /** Where it gets fixed, and what the reader will do there. */
  href: string; fix: string;
  /** How many things are wrong (shifts, sites, inputs) — for sorting inside a severity. */
  count: number;
}

const SEV_RANK: Record<ExceptionSeverity, number> = { blocker: 0, warning: 1, info: 2 };
/** Blockers first, then by how much is wrong. */
export const sortExceptions = (items: ExceptionItem[]) => [...items].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.count - a.count || a.title.localeCompare(b.title));
/** Families that have at least one blocker — their coverage badge may not read green (Phase 7). */
export const blockedFamilies = (items: ExceptionItem[]) => { const m = new Map<string, number>(); for (const x of items) if (x.severity === "blocker" && x.familyId) m.set(x.familyId, (m.get(x.familyId) ?? 0) + 1); return m; };

// ── Pure rules over site-load rows (tested) ─────────────────────────────────────────────────────
export interface LoadRowLite { studentId: string; cohortId: string; cohort: string; programId: string; familyId: string | null; family: string | null; date: string | null; status: string; employerId: string | null; site: string; agreement: string; preceptorId: string | null; preceptorsNeeded?: number }
export interface CapLite { familyId: string; employerId: string; studentsAtOnce: number | null }

/** Site-days where a program has more students at a site than the site allows at once. */
export function overCapacityDays(rows: LoadRowLite[], caps: CapLite[], todayIso: string): { familyId: string; employerId: string; site: string; days: number; worst: { date: string; students: number; cap: number } }[] {
  const capOf = new Map(caps.filter((c) => c.studentsAtOnce != null).map((c) => [`${c.familyId}|${c.employerId}`, c.studentsAtOnce as number]));
  const at = new Map<string, Set<string>>();
  const siteName = new Map<string, string>();
  for (const r of rows) {
    if (!r.date || r.date < todayIso || r.status !== "scheduled" || !r.employerId || !r.familyId) continue;
    const k = `${r.familyId}|${r.employerId}|${r.date}`;
    const s = at.get(k) ?? new Set<string>(); s.add(r.studentId); at.set(k, s); siteName.set(r.employerId, r.site);
  }
  const out = new Map<string, { familyId: string; employerId: string; site: string; days: number; worst: { date: string; students: number; cap: number } }>();
  for (const [k, students] of at) {
    const [familyId, employerId, date] = k.split("|");
    const cap = capOf.get(`${familyId}|${employerId}`);
    if (cap == null || students.size <= cap) continue;
    const o = out.get(`${familyId}|${employerId}`) ?? { familyId, employerId, site: siteName.get(employerId) ?? employerId, days: 0, worst: { date, students: 0, cap } };
    o.days++;
    if (students.size > o.worst.students) o.worst = { date, students: students.size, cap };
    out.set(`${familyId}|${employerId}`, o);
  }
  return [...out.values()].sort((a, b) => b.days - a.days);
}

/** Future scheduled student-shifts at sites without a secured agreement, by family. */
export function unsecuredPlacements(rows: LoadRowLite[], todayIso: string): { familyId: string | null; family: string | null; programId: string; shifts: number; students: number; sites: string[] }[] {
  const by = new Map<string, { familyId: string | null; family: string | null; programId: string; shifts: number; students: Set<string>; sites: Set<string> }>();
  for (const r of rows) {
    if (!r.date || r.date < todayIso || r.status !== "scheduled" || !r.employerId || r.agreement === "secured") continue;
    const k = r.familyId ?? r.programId;
    const o = by.get(k) ?? { familyId: r.familyId, family: r.family, programId: r.programId, shifts: 0, students: new Set<string>(), sites: new Set<string>() };
    o.shifts++; o.students.add(r.studentId); o.sites.add(r.site); by.set(k, o);
  }
  return [...by.values()].map((o) => ({ familyId: o.familyId, family: o.family, programId: o.programId, shifts: o.shifts, students: o.students.size, sites: [...o.sites].sort() })).sort((a, b) => b.shifts - a.shifts);
}

/** Future scheduled shifts that need a preceptor and have nobody named, by offering. */
export function unpreceptedShifts(rows: LoadRowLite[], todayIso: string): { cohortId: string; cohort: string; programId: string; familyId: string | null; family: string | null; shifts: number; students: number }[] {
  const by = new Map<string, { cohortId: string; cohort: string; programId: string; familyId: string | null; family: string | null; shifts: number; students: Set<string> }>();
  for (const r of rows) {
    if (!r.date || r.date < todayIso || r.status !== "scheduled" || !(r.preceptorsNeeded && r.preceptorsNeeded > 0) || r.preceptorId) continue;
    const o = by.get(r.cohortId) ?? { cohortId: r.cohortId, cohort: r.cohort, programId: r.programId, familyId: r.familyId, family: r.family, shifts: 0, students: new Set<string>() };
    o.shifts++; o.students.add(r.studentId); by.set(r.cohortId, o);
  }
  return [...by.values()].map((o) => ({ ...o, students: o.students.size })).sort((a, b) => b.shifts - a.shifts);
}

// ── The queue ───────────────────────────────────────────────────────────────────────────────────
export async function getExceptionQueue(todayIso = new Date().toISOString().slice(0, 10)): Promise<ExceptionItem[]> {
  const items: ExceptionItem[] = [];
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const families = await prisma.programFamily.findMany({ select: { id: true, name: true, institutionId: true, programs: { select: { id: true }, orderBy: { name: "asc" }, take: 1 } } });
  const famById = new Map(families.map((f) => [f.id, f]));
  const clinicalHref = (familyId: string | null) => { const f = familyId ? famById.get(familyId) : null; return f?.programs[0] ? `/programs/${f.programs[0].id}/clinical#sites` : "/clinical"; };
  const caps: CapLite[] = await prisma.familySite.findMany({ where: { studentsAtOnce: { not: null } }, select: { familyId: true, employerId: true, studentsAtOnce: true } });

  for (const inst of institutions) {
    // A college whose offerings run clinical sessions but that has no sites, assets or preceptors on record at all:
    // nothing clinical can be placed, sized or verified, and every clinical page for it is an empty state, not a zero.
    const [employers, clinicalSessions] = await Promise.all([
      prisma.employer.count({ where: { institutionId: inst.id } }),
      prisma.session.count({ where: { kind: "CLINICAL", course: { term: { program: { institutionId: inst.id, cohorts: { some: { status: { in: ["planned", "active"] } } } } } } } }),
    ]);
    if (employers === 0 && clinicalSessions > 0) items.push({ id: `nosupply|${inst.id}`, severity: "blocker", kind: "no-supply", institutionId: inst.id, institution: inst.name, familyId: null, family: null, count: clinicalSessions,
      title: `${inst.name}: no clinical sites, assets or preceptors on record`, detail: `${clinicalSessions} clinical session${clinicalSessions === 1 ? "" : "s"} in its planned and running offerings have nowhere to be placed. Coverage, site load and the scheduler show nothing for this college until its sites are added — that is missing data, not zero demand.`, href: "/employers", fix: "add the college's clinical sites and their assets, then map each rotation type to a setting" });
    // Site load rows: over-capacity site-days, unsecured placements, unprecepted shifts.
    const load = await getSiteLoad(inst.id);
    if (load) {
      for (const o of overCapacityDays(load.rows, caps, todayIso)) {
        const fam = famById.get(o.familyId);
        items.push({ id: `cap|${o.familyId}|${o.employerId}`, severity: "blocker", kind: "over-capacity", institutionId: inst.id, institution: inst.name, familyId: o.familyId, family: fam?.name ?? null, count: o.days,
          title: `${o.site} over its students-at-once on ${o.days} day${o.days === 1 ? "" : "s"}`, detail: `${fam?.name ?? "The program"} has up to ${o.worst.students} students there at once (${o.worst.date}); the site agreed to ${o.worst.cap}.`, href: `/insights/site-load?inst=${inst.id}`, fix: "move students to another site or raise the agreed number with the site" });
      }
      for (const u of unsecuredPlacements(load.rows, todayIso)) {
        items.push({ id: `unsecured|${u.familyId ?? u.programId}`, severity: "blocker", kind: "unsecured-placement", institutionId: inst.id, institution: inst.name, familyId: u.familyId, family: u.family, count: u.shifts,
          title: `${u.shifts} student-shifts placed at ${u.sites.length} site${u.sites.length === 1 ? "" : "s"} without a secured agreement`, detail: `${u.family ?? "Program"}: ${u.students} students at ${u.sites.slice(0, 3).join(", ")}${u.sites.length > 3 ? ", …" : ""}.`, href: clinicalHref(u.familyId), fix: "secure the agreement, or move the shifts to a secured site" });
      }
      for (const p of unpreceptedShifts(load.rows, todayIso)) {
        items.push({ id: `unprecepted|${p.cohortId}`, severity: "blocker", kind: "unprecepted", institutionId: inst.id, institution: inst.name, familyId: p.familyId, family: p.family, count: p.shifts,
          title: `${p.cohort}: ${p.shifts} upcoming clinical shifts have no preceptor named`, detail: `${p.students} students are scheduled on site with nobody named to precept them.`, href: `/programs/${p.programId}/offerings/${p.cohortId}`, fix: "name preceptors on the offering's staffing panel, or apply a scheduler plan" });
      }
    }
    // Sessions on holidays that nobody has moved.
    const cap = await getCapacityModel({ institutionId: inst.id });
    for (const c of cap?.cohorts ?? []) {
      const rows = buildInstances({
        cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
        termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
        termEndByIndex: c.termEndByIndex, termWeeksByIndex: c.termWeeksByIndex, holidays: c.holidays, courses: c.courses,
      } as CohortCalendarInput, c.assumptions);
      const moved = new Set((c.moves ?? []).map((m) => `${m.sessionId}|${m.fromDate}`));
      const onHoliday = rows.filter((r) => r.holiday && r.dateIso && r.dateIso >= todayIso && !moved.has(`${r.session.id}|${r.dateIso}`));
      if (onHoliday.length) {
        const fam = families.find((f) => f.programs.some((p) => p.id === c.programId)) ?? null;
        items.push({ id: `holiday|${c.cohortId}`, severity: "blocker", kind: "holiday-session", institutionId: inst.id, institution: inst.name, familyId: fam?.id ?? null, family: fam?.name ?? null, count: onHoliday.length,
          title: `${c.cohort}: ${onHoliday.length} upcoming session${onHoliday.length === 1 ? "" : "s"} land on an observed holiday`, detail: `${[...new Set(onHoliday.map((r) => r.holiday))].slice(0, 3).join(", ")} — the college is closed; the sessions need moving.`, href: `/programs/${c.programId}/offerings/${c.cohortId}/design`, fix: "move each session off the holiday on the offering's design page" });
      }
    }
    // Unverified and stale inputs.
    const [assetsUnverified, assetsTotal, staleAssets, staleSites, staleProvisions, provisionsEstimate, staffEstimate] = await Promise.all([
      prisma.clinicalAsset.count({ where: { employer: { institutionId: inst.id }, status: { not: "archived" }, dataSource: { not: "VERIFIED" } } }),
      prisma.clinicalAsset.count({ where: { employer: { institutionId: inst.id }, status: { not: "archived" } } }),
      prisma.clinicalAsset.count({ where: { employer: { institutionId: inst.id }, reviewBy: { lt: new Date(todayIso + "T00:00:00Z") } } }),
      prisma.familySite.count({ where: { family: { institutionId: inst.id }, reviewBy: { lt: new Date(todayIso + "T00:00:00Z") } } }),
      prisma.siteRequirementProvision.count({ where: { employer: { institutionId: inst.id }, reviewBy: { lt: new Date(todayIso + "T00:00:00Z") } } }),
      prisma.siteRequirementProvision.count({ where: { employer: { institutionId: inst.id }, source: { not: "VERIFIED" } } }),
      prisma.familySite.count({ where: { family: { institutionId: inst.id }, agreementStatus: "secured", staffCountSource: { not: "VERIFIED" } } }),
    ]);
    const stale = staleAssets + staleSites + staleProvisions;
    if (stale) items.push({ id: `stale|${inst.id}`, severity: "warning", kind: "stale-input", institutionId: inst.id, institution: inst.name, familyId: null, family: null, count: stale, title: `${stale} inputs are past their review date`, detail: `${staleAssets} assets · ${staleSites} site agreements · ${staleProvisions} site confirmations — the figures still count, but nobody has re-checked them with the site.`, href: `/orgs/${inst.id}`, fix: "re-confirm with the site and set a new review date" });
    if (assetsUnverified) items.push({ id: `assets|${inst.id}`, severity: "warning", kind: "unverified-input", institutionId: inst.id, institution: inst.name, familyId: null, family: null, count: assetsUnverified, title: `${assetsUnverified} of ${assetsTotal} clinical assets are estimates or gaps, not confirmed with the site`, detail: "Every seat these assets contribute to capacity rests on an estimate until the site confirms learners per shift.", href: `/employers?inst=${inst.id}`, fix: "confirm each asset's learners per shift with the site (data source VERIFIED)" });
    if (provisionsEstimate) items.push({ id: `prov|${inst.id}`, severity: "info", kind: "unverified-input", institutionId: inst.id, institution: inst.name, familyId: null, family: null, count: provisionsEstimate, title: `${provisionsEstimate} site experience confirmations are estimates`, detail: "An estimated provision counts as potential coverage only; the scheduler reads the experience as unverified.", href: `/clinical`, fix: "confirm the experience with the site on its checklist" });
    if (staffEstimate) items.push({ id: `staff|${inst.id}`, severity: "info", kind: "unverified-input", institutionId: inst.id, institution: inst.name, familyId: null, family: null, count: staffEstimate, title: `${staffEstimate} secured sites have no confirmed staff count`, detail: "The accreditor's staff-on-shift figure is estimated or missing at these sites.", href: `/clinical`, fix: "record the site's qualified staff on shift (source VERIFIED)" });
  }

  // Coverage: required experiences with no site at all (blocker), or resting on inference (warning).
  for (const f of await getFamiliesClinical()) {
    if (!f.score) continue;
    const uncovered = f.score.required - f.score.requiredCovered;
    if (uncovered > 0) items.push({ id: `gap|${f.id}`, severity: "blocker", kind: "coverage-gap", institutionId: f.institutionId, institution: f.institution, familyId: f.id, family: f.name, count: uncovered, title: `${f.name}: ${uncovered} required experience${uncovered === 1 ? "" : "s"} with no site to provide ${uncovered === 1 ? "it" : "them"}`, detail: `${f.score.gaps.slice(0, 4).join(", ")}${f.score.gaps.length > 4 ? ", …" : ""}.`, href: clinicalHref(f.id), fix: "find a site that provides it and secure the agreement" });
    else if (f.score.requiredConfirmed < f.score.required) items.push({ id: `inferred|${f.id}`, severity: "warning", kind: "coverage-inferred", institutionId: f.institutionId, institution: f.institution, familyId: f.id, family: f.name, count: f.score.required - f.score.requiredConfirmed, title: `${f.name}: coverage rests on inference — ${f.score.requiredConfirmed} of ${f.score.required} required experiences confirmed by a site`, detail: `${f.score.unverified} experiences are inferred from asset settings; no site has confirmed it provides them.`, href: clinicalHref(f.id), fix: "confirm each experience with the site on its checklist" });
    if (f.requirements && !f.requirements.verified) items.push({ id: `std|${f.id}`, severity: "info", kind: "unverified-input", institutionId: f.institutionId, institution: f.institution, familyId: f.id, family: f.name, count: 1, title: `${f.name}: requirement list not verified against the current standard`, detail: `${f.requirements.authority ?? "The standard"} — starter content; every figure derived from it is provisional.`, href: clinicalHref(f.id).replace("#sites", "#requirements"), fix: "verify the list against the current edition and mark it verified" });
  }

  // Calendar health and goals from the action queue (conflicts, unstaffed meetings, goal gaps).
  const KIND: Record<string, ExceptionItem["kind"]> = { conflicts: "calendar-conflict", unstaffed: "unstaffed", "goal-gap": "goal-gap" };
  for (const a of await getActionQueue()) {
    if (!KIND[a.kind]) continue;
    const fam = families.find((f) => f.name === a.family) ?? null;
    const inst = fam ? institutions.find((i) => i.id === fam.institutionId) ?? null : null;
    items.push({ id: `${a.kind}|${a.family ?? "all"}`, severity: a.severity === "red" ? (a.kind === "goal-gap" ? "warning" : "blocker") : a.severity === "amber" ? "warning" : "info", kind: KIND[a.kind], institutionId: inst?.id ?? null, institution: inst?.name ?? null, familyId: fam?.id ?? null, family: a.family, count: Number((a.title.match(/^(\d+)/) ?? [])[1] ?? 1), title: a.title, detail: a.detail, href: a.href, fix: a.kind === "conflicts" ? "resolve the double-bookings on the calendar" : a.kind === "unstaffed" ? "assign an instructor on the offering's schedule panel" : "work the graduating cohorts and the placement pipeline" });
  }
  return sortExceptions(items);
}
