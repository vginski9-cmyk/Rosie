import { prisma } from "./db";
import { NOT_ARCHIVED, gradYearOf as classYearOf } from "./cohortscope";
import { supervisionOnShift } from "./supervision";
import { ENROLLED_AND_BEYOND, ROSTER_STATUSES } from "./learners";
import type { Prisma } from "@prisma/client";
import * as React from "react";
/** Per-request memo (React `cache`) where the server runtime has it; a plain call elsewhere (tests, scripts). */
const cache = ((React as unknown as { cache?: <F>(fn: F) => F }).cache ?? ((fn) => fn)) as <F>(fn: F) => F;
/** The template week a course begins in (its earliest session week) — the anchor of its own date window. */
const firstWeekOf = (sessions: { week: number | null }[]) => (sessions.length ? Math.min(...sessions.map((x) => x.week ?? 1)) : null);
const mondayMs = (ms: number) => ms - ((new Date(ms).getUTCDay() + 6) % 7) * 86400000;
const DAY_MS_SEM = 86400000;
import { seasonOfDate, seasonOfTerm, sessionDate, weekOfDate, semesterAt, nextSemesterStart, SEASON_ORDER as SEASON_RANK } from "./term";
import type { TermArchetype } from "./capacity";
import { isOnlineSession, resolveSessionDay } from "./capacitymodel";
import { isHolidayRule, DEFAULT_HOLIDAY_RULE, resolveHolidays, holidayOn, type HolidayRule } from "./holidayrule";

/** Load a program's full archetype mapped to the capacity-engine shape. */
export async function getProgramArchetype(programId: string): Promise<TermArchetype[]> {
  const terms = await prisma.term.findMany({
    where: { programId },
    orderBy: { index: "asc" },
    include: {
      courses: {
        orderBy: { sequenceOrder: "asc" },
        include: { sessions: true },
      },
    },
  });

  return terms.map((t) => ({
    id: t.id,
    index: t.index,
    name: t.name,
    startWeek: t.startWeek,
    endWeek: t.endWeek,
    courses: t.courses.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      sequenceOrder: c.sequenceOrder,
      sessions: c.sessions.map((s) => ({
        id: s.id,
        kind: s.kind as "CLASS" | "LAB" | "CLINICAL",
        lengthHours: s.lengthHours,
        maxStudents: s.maxStudents,
        facultyNeeded: s.facultyNeeded,
        supportStaffNeeded: s.supportStaffNeeded,
        preceptorsNeeded: s.preceptorsNeeded,
        week: s.week,
      })),
    })),
  }));
}

export async function getDashboard() {
  return prisma.institution.findMany({
    orderBy: { name: "asc" },
    include: {
      programFamilies: { select: { id: true, name: true } },
      programs: {
        include: {
          occupation: true,
          family: { select: { id: true, name: true } },
          yearTargets: { orderBy: { year: "asc" } },
          cohorts: { include: { stages: { orderBy: { sortOrder: "asc" } } } },
          _count: { select: { terms: true } },
        },
      },
      _count: { select: { calendarBlocks: true, employers: true, people: true } },
    },
  });
}

export async function getProgramFull(programId: string) {
  return prisma.program.findUnique({
    where: { id: programId },
    include: {
      institution: true,
      occupation: true,
      family: { select: { id: true, name: true, clinicalModel: true, clinicalNotes: true, serviceAreas: { orderBy: { sortOrder: "asc" } } } },
      yearTargets: { orderBy: { year: "asc" } },
      cohorts: { include: { stages: { orderBy: { sortOrder: "asc" } } } },
      terms: {
        orderBy: { index: "asc" },
        include: {
          courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: true, clinicalRequirements: true } },
        },
      },
    },
  });
}

/** Lightweight bottleneck summary for a program, for dashboard/program banners. */
export async function getProgramBottleneck(programId: string) {
  const data = await getProgramPlanData(programId);
  if (!data || data.cohorts.length === 0) return null;
  const { buildAcademicPlan } = await import("./plan");
  const plan = buildAcademicPlan(data.archetype, data.cohorts, data.supply, { activeCodes: data.activeCodes });
  return {
    hasBottleneck: plan.hasBottleneck,
    bottleneckCount: plan.bottleneckCount,
    peak: plan.peak,
    supply: data.supply,
    cohortCount: data.cohorts.length,
    placementRaw: data.placement.raw,
    placementEffective: data.placement.effective,
  };
}

export async function getWblProfiles(institutionId: string) {
  return prisma.wblProfile.findMany({
    where: { institutionId },
    orderBy: [{ subjectType: "asc" }, { name: "asc" }],
    include: { factors: true },
  });
}

/** Materialize the tidy long fact table across ALL institutions: pipeline metrics
 *  (target/actual per cohort × stage) AND delivery metrics (faculty/preceptor FTE
 *  & contact hours, space hours, sections per cohort × term, from the service
 *  engine). One row per fact — the spine the pivot explorer aggregates. */
export async function getInsightsFacts() {
  const { courseService, DEFAULT_SERVICE } = await import("./service");
  const insts = await prisma.institution.findMany({
    orderBy: { name: "asc" },
    include: {
      programs: {
        include: {
          family: { select: { name: true } },
          terms: { orderBy: { index: "asc" }, include: { courses: { include: { sessions: true } } } },
          cohorts: { include: { stages: { orderBy: { sortOrder: "asc" } }, cohortTerms: true } },
        },
      },
    },
  });

  const gradYearOf = classYearOf;
  type Fact = { institution: string; family: string; program: string; programType: string; cohort: string; metricGroup: string; metric: string; year: number | null; term: string | null; semester: string | null; value: number; target: number | null; actual: number | null };
  const facts: Fact[] = [];

  for (const inst of insts) {
    for (const p of inst.programs) {
      const family = p.family?.name ?? p.name;
      const base = { institution: inst.name, family, program: p.name, programType: p.programType };
      for (const co of p.cohorts) {
        const gradYear = gradYearOf(co.name) ?? co.entryYear ?? null;
        const entryYear = co.startDate ? co.startDate.getUTCFullYear() : (gradYear ? gradYear - 2 : null);
        const entrySemester = co.startDate ? seasonOfDate(co.startDate) : "Fall";
        // --- Pipeline facts (target / actual per stage) ---
        for (const s of co.stages) {
          facts.push({ ...base, cohort: co.name, metricGroup: "Pipeline", metric: s.label, year: gradYear, term: null, semester: entrySemester, value: s.actualNumber ?? s.targetNumber ?? 0, target: s.targetNumber, actual: s.actualNumber });
        }
        // --- Delivery / FTE facts (per term, scaled to cohort enrollment) ---
        const enrollment = Math.round(co.plannedSeats ?? p.defaultCohortSeats ?? 40);
        const ctYear = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate ? ct.startDate.getUTCFullYear() : null]));
        const ctSeason = new Map(co.cohortTerms.map((ct) => [ct.termId, seasonOfTerm({ semester: ct.semester, name: null }, ct.startDate) ]));
        for (const t of p.terms) {
          const sessions = t.courses.flatMap((c) => c.sessions.map((s) => ({ id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded })));
          if (sessions.length === 0) continue;
          const r = courseService(sessions, enrollment, DEFAULT_SERVICE).totals;
          const termYear = ctYear.get(t.id) ?? (entryYear != null ? entryYear + Math.floor((t.index - 1) / 2) : gradYear);
          const sem = ctSeason.get(t.id) ?? seasonOfTerm(t) ?? "Fall";
          const dbase = { ...base, cohort: co.name, metricGroup: "Delivery", year: termYear, term: t.name, semester: sem };
          const add = (metric: string, value: number) => facts.push({ ...dbase, metric, value, target: null, actual: value });
          add("Faculty FTE", r.facultyFte);
          add("Faculty contact hours", r.facultyContactHours);
          add("Preceptor FTE", r.preceptorFte);
          add("Preceptor contact hours", r.preceptorContactHours);
          add("Space / service hours", Math.round(r.spaceHours));
          add("Sections required", r.sections);
        }
      }
    }
  }
  return facts;
}

// ---------------------------------------------------------------------------
// HOME — North Star per job (occupation), with the credential breakdown
// ---------------------------------------------------------------------------

export interface JobCredential {
  credential: string;
  expected: number;       // fully-productive expected this year toward the job
  instantiations: number; // running cohorts across this credential's templates
  programs: { id: string; name: string; expected: number; instantiations: number; terms: number }[];
}
export interface JobNorthStar {
  familyId: string;
  job: string;
  socCode: string | null;
  institution: string;
  thisYear: number;
  lastYear: number;
  thisYearGoal: number;
  lastYearActual: number;
  lastYearGoal: number;
  progress: number | null; // last year's actual ÷ this year's goal
  credentials: JobCredential[];
}

/** Per-job (occupation) North Star: this year's fully-productive goal, last year's
 *  actual, and the credential (AAS/Diploma/Cert) breakdown that delivers it. */
export async function getNorthStarHome(currentYear?: number): Promise<JobNorthStar[]> {
  const thisYear = currentYear ?? new Date().getUTCFullYear();
  const lastYear = thisYear - 1;
  const gradYearOf = classYearOf;

  const families = await prisma.programFamily.findMany({
    orderBy: { name: "asc" },
    include: {
      occupation: { select: { title: true, socCode: true } },
      institution: { select: { name: true } },
      programs: {
        orderBy: { name: "asc" },
        select: {
          id: true, name: true, credential: true, _count: { select: { terms: true, cohorts: true } },
          yearTargets: { select: { year: true, credentialTarget: true } },
          cohorts: { select: { name: true, status: true, stages: { where: { stageKey: "productive" }, select: { actualNumber: true } } } },
        },
      },
    },
  });

  return families.map((f) => {
    const targetFor = (p: (typeof f.programs)[number], y: number) => p.yearTargets.find((t) => t.year === y)?.credentialTarget ?? 0;
    const lastActualFor = (p: (typeof f.programs)[number]) =>
      p.cohorts.filter((c) => gradYearOf(c.name) === lastYear).reduce((n, c) => n + (c.stages[0]?.actualNumber ?? 0), 0);

    const credMap = new Map<string, JobCredential>();
    let thisYearGoal = 0, lastYearActual = 0, lastYearGoal = 0;
    for (const p of f.programs) {
      const cred = p.credential || "Other";
      const exp = targetFor(p, thisYear);
      thisYearGoal += exp;
      lastYearGoal += targetFor(p, lastYear);
      lastYearActual += lastActualFor(p);
      const running = p.cohorts.filter((c) => c.status === "active" || c.status === "planned").length;
      const e = credMap.get(cred) ?? { credential: cred, expected: 0, instantiations: 0, programs: [] };
      e.expected += exp;
      e.instantiations += running;
      e.programs.push({ id: p.id, name: p.name, expected: exp, instantiations: running, terms: p._count.terms });
      credMap.set(cred, e);
    }

    return {
      familyId: f.id,
      job: f.occupation?.title ?? f.name,
      socCode: f.occupation?.socCode ?? null,
      institution: f.institution.name,
      thisYear, lastYear,
      thisYearGoal, lastYearActual, lastYearGoal,
      progress: thisYearGoal > 0 ? lastYearActual / thisYearGoal : null,
      credentials: [...credMap.values()].sort((a, b) => b.expected - a.expected || a.credential.localeCompare(b.credential)),
    };
  }).sort((a, b) => b.thisYearGoal - a.thisYearGoal || a.job.localeCompare(b.job));
}

/** Minimal institution list (for create forms). */
/** The clinical SUPPLY side: every site with its functional units (the asset
 *  map), the rotation-type → unit-category join, and each site's agreement
 *  status — what the day-grid supply vs demand comparison runs on. */
/** The institution a page opens on when none is asked for: the one carrying the most students in
 *  planned or active offerings, then the most such offerings — the workspace's working college,
 *  not the alphabetically first one. */
export async function defaultInstitution(): Promise<{ id: string; name: string } | null> {
  // The college whose offerings are running now, by the students in them; planned runs (a
  // schedule projected years ahead) break ties rather than outrank a live program.
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, programs: { select: { cohorts: { where: NOT_ARCHIVED, select: { status: true, _count: { select: { students: true } } } } } } } });
  const weight = (i: (typeof institutions)[number]) => { let active = 0, planned = 0, graduated = 0, offerings = 0; for (const p of i.programs) for (const c of p.cohorts) { if (c.status === "active") active += c._count.students; else if (c.status === "completed") graduated += c._count.students; else planned += c._count.students; offerings++; } return [active, planned, graduated, offerings] as const; };
  const best = [...institutions].sort((a, b) => { const [aa, pa, ga, oa] = weight(a), [ab, pb, gb, ob] = weight(b); return ab - aa || pb - pa || gb - ga || ob - oa || a.name.localeCompare(b.name); })[0];
  return best ? { id: best.id, name: best.name } : null;
}

export async function getClinicalSupply(institutionId?: string) {
  const inst = institutionId
    ? await prisma.institution.findUnique({ where: { id: institutionId }, select: { id: true, name: true } })
    : await defaultInstitution();
  if (!inst) return null;
  const [sites, rotations] = await Promise.all([
    prisma.employer.findMany({
      where: { institutionId: inst.id },
      orderBy: [{ ring: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, organization: true, facilityType: true, county: true, ring: true, city: true, status: true, agreementStatus: true,
        licensedBeds: true, nursingHomeBeds: true, adultCareBeds: true, operatingRooms: true, wblSlots: true,
        assets: { where: { status: "active" }, select: { settingCode: true, learnersPerShift: true, preceptorsPerShift: true } },
        units: { where: { status: "active" }, select: { id: true, unitType: true, unitCategory: true, unitName: true, capacityCount: true, uom: true, dataSource: true, shiftsPerDay: true, shiftLengthHrs: true, shiftBlocks: true, days: true, studentsPerShift: true, studentsPerPreceptor: true, preceptorsPerShift: true } },
      },
    }),
    prisma.rotationSetting.findMany({ where: { institutionId: inst.id }, orderBy: { rotationType: "asc" } }),
  ]);
  // A unit that codes no student capacity is not a unit with zero capacity: the site's assets in the settings that
  // serve its category carry the seats, and the unit reads them (marked as derived) until someone codes it.
  const codesByCategory = new Map<string, Set<string>>();
  for (const r of rotations) if (r.unitCategory && r.settingCode) { const set = codesByCategory.get(r.unitCategory) ?? new Set<string>(); set.add(r.settingCode); codesByCategory.set(r.unitCategory, set); }
  const sitesDerived = sites.map((site) => ({
    ...site,
    units: site.units.map((u) => {
      if (u.studentsPerShift > 0) return u;
      const codes = codesByCategory.get(u.unitCategory);
      if (!codes) return u;
      const mine = site.assets.filter((a) => codes.has(a.settingCode));
      if (!mine.length) return u;
      const students = mine.reduce((n, a) => n + a.learnersPerShift, 0), preceptors = mine.reduce((n, a) => n + a.preceptorsPerShift, 0);
      return { ...u, studentsPerShift: students, preceptorsPerShift: u.preceptorsPerShift > 0 ? u.preceptorsPerShift : preceptors, dataSource: `${u.dataSource} · students/shift derived from ${mine.length} asset${mine.length === 1 ? "" : "s"}` };
    }),
  }));
  return { institution: inst, sites: sitesDerived, rotations };
}

/** The 365-day clinical asset map for an institution: every physical asset with
 *  its site, per-date exceptions, learner bookings in a window, and the
 *  rotation-type → setting-code join. */
export async function getAssetMap(institutionId: string, from: string, to: string) {
  const [assetsRaw, rotations, bookingsRaw] = await Promise.all([
    prisma.clinicalAsset.findMany({
      where: { employer: { institutionId } },
      orderBy: [{ employer: { name: "asc" } }, { settingCode: "asc" }, { assetNumber: "asc" }],
      include: {
        employer: { select: { id: true, name: true, externalId: true, county: true, ring: true, facilityType: true, organization: true, agreementStatus: true, status: true, familySites: { select: { familyId: true, agreementStatus: true } } } },
        dayOverrides: { where: { date: { gte: new Date(from + "T00:00:00Z"), lte: new Date(to + "T00:00:00Z") } }, select: { date: true, shiftBlocks: true, note: true } },
      },
    }),
    prisma.rotationSetting.findMany({ where: { institutionId }, orderBy: { rotationType: "asc" }, select: { rotationType: true, settingCode: true, unitCategory: true, rule: true, sourceText: true, interpretationStatus: true, revision: true, reviewedBy: true, reviewedAt: true } }),
    prisma.assetBooking.findMany({
      where: { asset: { employer: { institutionId } }, date: { gte: new Date(from + "T00:00:00Z"), lte: new Date(to + "T00:00:00Z") } },
      include: { cohort: { select: { name: true, program: { select: { name: true } } } } },
      orderBy: [{ date: "asc" }, { block: "asc" }],
    }),
  ]);
  const assets = assetsRaw.map((a) => ({
    id: a.id, externalId: a.externalId, employerId: a.employerId, facilityName: a.employer.name, facilityExternalId: a.employer.externalId,
    county: a.employer.county, ring: a.employer.ring, facilityType: a.employer.facilityType, organization: a.employer.organization, agreementStatus: a.employer.agreementStatus, facilityStatus: a.employer.status,
    agreementByFamily: Object.fromEntries(a.employer.familySites.map((f) => [f.familyId, f.agreementStatus])),
    settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks,
    hoursPerShift: a.hoursPerShift, dayStart: a.dayStart, dayHours: a.dayHours, eveningStart: a.eveningStart, eveningHours: a.eveningHours, nightStart: a.nightStart, nightHours: a.nightHours,
    serves: a.serves, learnersPerShift: a.learnersPerShift, preceptorsPerShift: a.preceptorsPerShift, dataSource: a.dataSource, status: a.status, notes: a.notes,
  }));
  const overrides = assetsRaw.flatMap((a) => a.dayOverrides.map((o) => ({ assetId: a.id, date: o.date.toISOString().slice(0, 10), shiftBlocks: o.shiftBlocks, note: o.note })));
  const bookings = bookingsRaw.map((b) => ({ id: b.id, assetId: b.assetId, cohortId: b.cohortId, sessionId: b.sessionId, sectionIndex: b.sectionIndex, meetingId: b.meetingId, date: b.date.toISOString().slice(0, 10), block: b.block, students: b.students, note: b.note, cohort: b.cohort.name, program: b.cohort.program.name }));
  const { ruleFromLegacy: ruleOf, KNOWN_SETTINGS } = await import("./settingrule");
  const known = new Set([...KNOWN_SETTINGS, ...assets.map((a) => a.settingCode)]);
  // Course rotation pools for every program of the college — the rule generically tagged sessions read (lib/requirementcoverage).
  const courseRules = await (await import("./requirementstore")).coursePoolRules((await prisma.program.findMany({ where: { institutionId }, select: { id: true } })).map((p) => p.id));
  return { assets, overrides, bookings, courseRules, rotations: rotations.map((r) => ({ rotationType: r.rotationType, settingCode: r.settingCode, unitCategory: r.unitCategory, rule: ruleOf(r, known), sourceText: r.sourceText, interpretationStatus: r.interpretationStatus, revision: r.revision, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt?.toISOString() ?? null })) };
}

/** Every program family with its clinical model and the sites / assets that serve it — the "clinical sites by program" index. */
export async function getFamiliesClinical() {
  const fams = await prisma.programFamily.findMany({
    orderBy: { name: "asc" },
    include: { institution: { select: { id: true, name: true } }, occupation: { select: { title: true, socCode: true } }, serviceAreas: { orderBy: { sortOrder: "asc" } }, familySites: { select: { agreementStatus: true } }, _count: { select: { programs: true, allocations: true } } },
  });
  const reqSets = await prisma.clinicalRequirementSet.findMany({ select: { familyId: true, authority: true, kind: true, verified: true, items: { select: { mandatory: true, category: true } } } });
  const reqByFamily = new Map(reqSets.map((r) => [r.familyId, { authority: r.authority, kind: r.kind, verified: r.verified, mandatory: r.items.filter((i) => i.mandatory).length, elective: r.items.filter((i) => !i.mandatory).length, categories: new Set(r.items.map((i) => i.category)).size }]));
  // Item-level scorecard (required experiences a secured site provides) for families that have a network to score.
  const scores = new Map<string, { requiredCovered: number; requiredConfirmed: number; required: number; electiveCovered: number; elective: number; unverified: number; gaps: string[] }>();
  for (const f of fams) if (reqByFamily.has(f.id) && f.familySites.length) { const r = await getFamilyRequirements(f.id); if (r?.sets.length) { const t = r.sets.reduce((a, s) => ({ requiredCovered: a.requiredCovered + s.score.requiredCovered, requiredConfirmed: a.requiredConfirmed + s.score.requiredConfirmed, required: a.required + s.score.required, electiveCovered: a.electiveCovered + s.score.electiveCovered, elective: a.elective + s.score.elective, unverified: a.unverified + s.score.unverified, gaps: [...a.gaps, ...s.score.gaps] }), { requiredCovered: 0, requiredConfirmed: 0, required: 0, electiveCovered: 0, elective: 0, unverified: 0, gaps: [] as string[] }); scores.set(f.id, t); } }
  return fams.map((f) => ({
    score: scores.get(f.id) ?? null,
    id: f.id, name: f.name, institution: f.institution.name, institutionId: f.institution.id, occupation: f.occupation?.title ?? null, soc: f.occupation?.socCode ?? null,
    clinicalModel: f.clinicalModel, clinicalNotes: f.clinicalNotes, programs: f._count.programs, allocations: f._count.allocations,
    requirements: reqByFamily.get(f.id) ?? null, capacityBasis: f.capacityBasis,
    areas: f.serviceAreas.map((a) => ({ code: a.code, name: a.name })),
    sites: f.familySites.length, secured: f.familySites.filter((s) => s.agreementStatus === "secured").length, asked: f.familySites.filter((s) => s.agreementStatus === "asked").length,
  })).sort((a, b) => b.sites - a.sites || b.secured - a.secured || a.institution.localeCompare(b.institution) || a.name.localeCompare(b.name)); // families with a real site network first, not 18 empty cards
}

/** ONE family's clinical picture: model, service areas, the requirement grid
 *  over its templates' courses, the sites that serve it (family-level
 *  agreement + what each holds), the shifts allocated to it, and the course
 *  windows of its offerings (students × real dates) that drive demand. */
export async function getFamilyClinical(familyId: string) {
  const fam = await prisma.programFamily.findUnique({
    where: { id: familyId },
    include: {
      institution: { select: { id: true, name: true } }, occupation: { select: { title: true, socCode: true } },
      serviceAreas: { orderBy: { sortOrder: "asc" }, include: { requirements: true } },
      programs: { orderBy: { name: "asc" }, include: { terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { clinicalRequirements: true } } } }, cohorts: { where: NOT_ARCHIVED, select: { id: true } } } },
      familySites: { include: { employer: { select: { id: true } } } },
      allocations: { include: { employer: { select: { name: true, county: true, ring: true } } } },
    },
  });
  if (!fam) return null;
  const settingSet = new Set(fam.serviceAreas.flatMap((a) => a.settingCodes.split(",").map((s) => s.trim()).filter(Boolean)));
  const catSet = new Set(fam.serviceAreas.flatMap((a) => a.unitCategories.split(",").map((s) => s.trim()).filter(Boolean)));
  const employers = await prisma.employer.findMany({
    where: { institutionId: fam.institutionId },
    orderBy: [{ ring: "asc" }, { name: "asc" }],
    include: { assets: { where: { status: "active" }, select: { id: true, settingCode: true, setting: true, assetType: true, shiftBlocks: true, days: true, hoursPerShift: true, learnersPerShift: true } }, units: { where: { status: "active" }, select: { unitCategory: true, unitType: true, studentsPerShift: true, capacityCount: true, uom: true } } },
  });
  const fsByEmp = new Map(fam.familySites.map((s) => [s.employerId, s]));
  const sites = employers
    .filter((e) => fsByEmp.has(e.id) || e.assets.some((a) => settingSet.has(a.settingCode)) || e.units.some((u) => catSet.has(u.unitCategory)))
    .map((e) => {
      const fs = fsByEmp.get(e.id);
      const relevantAssets = e.assets.filter((a) => settingSet.has(a.settingCode));
      const bySetting: Record<string, { assets: number; setting: string; weeklyShifts: number }> = {};
      for (const a of relevantAssets) { const s = bySetting[a.settingCode] ?? { assets: 0, setting: a.setting, weeklyShifts: 0 }; s.assets++; s.weeklyShifts += a.shiftBlocks.split(",").length * a.days.split(",").length; bySetting[a.settingCode] = s; }
      const units = e.units.filter((u) => catSet.has(u.unitCategory));
      return {
        id: e.id, name: e.name, externalId: e.externalId, county: e.county, ring: e.ring, facilityType: e.facilityType, city: e.city, status: e.status,
        globalAgreement: e.agreementStatus, agreementStatus: fs?.agreementStatus ?? "none", contactName: fs?.contactName ?? e.contactName, contactEmail: fs?.contactEmail ?? e.contactEmail, notes: fs?.notes ?? null,
        bySetting, units: units.map((u) => ({ category: u.unitCategory, type: u.unitType, studentsPerShift: u.studentsPerShift, capacity: u.capacityCount, uom: u.uom })),
        allocations: fam.allocations.filter((al) => al.employerId === e.id).map((al) => ({ id: al.id, settingCode: al.settingCode, block: al.block, shiftsPerWeek: al.shiftsPerWeek, hoursPerShift: al.hoursPerShift, learnersPerShift: al.learnersPerShift, from: al.from?.toISOString().slice(0, 10) ?? null, to: al.to?.toISOString().slice(0, 10) ?? null })),
      };
    });
  const programs = fam.programs.map((p) => ({
    id: p.id, name: p.name, cohorts: p.cohorts.length,
    courses: p.terms.flatMap((t) => t.courses.map((c) => ({ id: c.id, code: c.code, name: c.name, termIndex: t.index, termName: t.name, weeks: (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1, weeklyClinicalHours: c.weeklyClinicalHours, requirements: c.clinicalRequirements.map((r) => ({ serviceAreaId: r.serviceAreaId, hoursPerStudent: r.hoursPerStudent, casesPerStudent: r.casesPerStudent })) }))),
  }));
  const allocations = fam.allocations.map((al) => ({ employerId: al.employerId, facilityName: al.employer.name, county: al.employer.county, ring: al.employer.ring, settingCode: al.settingCode, block: al.block, shiftsPerWeek: al.shiftsPerWeek, hoursPerShift: al.hoursPerShift, learnersPerShift: al.learnersPerShift, from: al.from?.toISOString().slice(0, 10) ?? null, to: al.to?.toISOString().slice(0, 10) ?? null }));
  return {
    family: { id: fam.id, name: fam.name, institutionId: fam.institutionId, institution: fam.institution.name, occupation: fam.occupation?.title ?? null, soc: fam.occupation?.socCode ?? null, clinicalModel: fam.clinicalModel, clinicalNotes: fam.clinicalNotes },
    serviceAreas: fam.serviceAreas.map((a) => ({ id: a.id, code: a.code, name: a.name, settingCodes: a.settingCodes.split(",").map((s) => s.trim()).filter(Boolean), unitCategories: a.unitCategories.split(",").map((s) => s.trim()).filter(Boolean), sortOrder: a.sortOrder, notes: a.notes })),
    programs, sites, allocations, settingCodes: [...settingSet],
  };
}

/** ONE job's clinical SUPPLY map — nothing about demand: its settings catalog,
 *  every site that serves it with each site's physical assets and their shift
 *  structures, plus the directory of organizations that can be added. */
/** What completion requires for a family, and which sites / assets can supply each category. */
export async function getFamilyRequirements(familyId: string) {
  const { requirementCoverage } = await import("./requirements");
  const fam = await prisma.programFamily.findUnique({ where: { id: familyId }, select: { id: true, name: true, institutionId: true, clinicalModel: true, capacityBasis: true, casesPerStudentDay: true, caseDaysPerYear: true, requirementSets: { orderBy: { createdAt: "asc" }, include: { items: { orderBy: { sortOrder: "asc" }, include: { provisions: true } } } }, familySites: { select: { employerId: true, agreementStatus: true, casesPerDay: true } } } });
  if (!fam) return null;
  const RANK: Record<string, number> = { secured: 0, asked: 1, prospect: 2, none: 3, declined: 9 };
  const fs = new Map(fam.familySites.map((f) => [f.employerId, f]));
  const employers = await prisma.employer.findMany({ where: { institutionId: fam.institutionId, status: "active" }, select: { id: true, name: true, facilityType: true, agreementStatus: true, annualSurgicalCases: true, operatingDaysPerYear: true, driveMinutes: true, ring: true, assets: { where: { status: { not: "archived" } }, select: { settingCode: true, learnersPerShift: true } } } });
  const sites = employers.map((e) => { const f = fs.get(e.id); const seatsBySetting: Record<string, number> = {}; for (const a of e.assets) seatsBySetting[a.settingCode] = (seatsBySetting[a.settingCode] ?? 0) + a.learnersPerShift; const agreementStatus = f?.agreementStatus ?? e.agreementStatus ?? "none"; return { employerId: e.id, name: e.name, facilityType: e.facilityType, agreementStatus, inFamily: !!f, agreementRank: RANK[agreementStatus] ?? 3, seatsBySetting, casesPerDay: f?.casesPerDay ?? (e.annualSurgicalCases != null ? e.annualSurgicalCases / Math.max(1, e.operatingDaysPerYear ?? fam.caseDaysPerYear ?? 250) : null), driveMinutes: e.driveMinutes, ring: e.ring }; });
  // Demand: every enrolled student in this family's offerings, and what each has logged — so each item
  // can say how many students still need it (the number the rotation plan has to serve).
  const { progressFor } = await import("./requirementprogress");
  const learners = await prisma.student.findMany({ where: { program: { familyId }, cohortId: { not: null }, status: "enrolled" }, select: { id: true, requirementLogs: { select: { itemId: true, outcome: true, role: true, simulated: true, count: true, date: true, employerId: true } } } });
  const { caseRuleLines, serviceLineCategories } = await import("./requirementrules");
  const sets = fam.requirementSets.map((set) => {
    const items = set.items.map((i) => ({ id: i.id, category: i.category, name: i.name, mandatory: i.mandatory, electiveGroup: i.electiveGroup, minCount: i.minCount, role: i.role, settingCodes: i.settingCodes, notes: i.notes }));
    const provisions = set.items.flatMap((i) => i.provisions.map((p) => ({ employerId: p.employerId, itemId: p.itemId, status: p.status, annualVolume: p.annualVolume, studentRole: p.studentRole, source: p.source, notes: p.notes, evidenceOwner: p.evidenceOwner, verifiedAt: p.verifiedAt?.toISOString().slice(0, 10) ?? null, reviewBy: p.reviewBy?.toISOString().slice(0, 10) ?? null })));
    let rules: { key: string; label: string; min?: number; max?: number; of?: number; scope?: string; anyOf?: string[]; notes?: string; categories?: string[] }[] = [];
    try { rules = JSON.parse(set.rules); } catch { rules = []; }
    // Service lines a generic asset must not imply (cardiothoracic, neurosurgery, transplant) read "possible" until confirmed.
    const serviceLines = serviceLineCategories(rules);
    const coverage = requirementCoverage(items, sites, provisions, { noInferCategories: serviceLines });
    let definitions: Record<string, string> = {};
    try { definitions = JSON.parse(set.definitions); } catch { definitions = {}; }
    const demand: Record<string, number> = {};
    let complete = 0;
    for (const st of learners) {
      const pr = progressFor(set.kind, items, rules, st.requirementLogs.map((l) => ({ ...l, date: l.date.toISOString().slice(0, 10) })));
      if (pr.complete) complete++;
      for (const it of pr.items) if (!it.met) demand[it.item.id] = (demand[it.item.id] ?? 0) + 1;
    }
    const graded = coverage.flatMap((c) => c.itemCoverage).filter((i) => i.verdict !== "n/a");
    const required = graded.filter((i) => i.item.mandatory);
    // A case-log standard's rules (volume, First Scrub, specialty spread) are requirement lines too — a
    // network with "1 of 1 items covered" can still graduate nobody.
    const lines = set.kind === "cases" ? caseRuleLines(rules, coverage, learners.length) : [];
    const linesCovered = lines.filter((l) => l.verdict === "confirmed" || l.verdict === "possible").length;
    const linesConfirmed = lines.filter((l) => l.verdict === "confirmed").length;
    return {
      id: set.id, name: set.name, authority: set.authority, edition: set.edition, kind: set.kind, summary: set.summary, sourceUrl: set.sourceUrl, verified: set.verified, verifiedBy: set.verifiedBy, verifiedAt: set.verifiedAt?.toISOString().slice(0, 10) ?? null, reviewBy: set.reviewBy?.toISOString().slice(0, 10) ?? null, notes: set.notes, rules, definitions, items, provisions, coverage, serviceLines, lines,
      /** Enrolled students in the family and, per item id, how many have not met it yet. */
      demand, learners: learners.length, learnersComplete: complete,
      mandatory: items.filter((i) => i.mandatory).length, elective: items.filter((i) => !i.mandatory).length, categories: coverage.length,
      uncovered: coverage.filter((c) => c.verdict === "none" || c.verdict === "prospect-only").map((c) => c.category), askedOnly: coverage.filter((c) => c.verdict === "asked-only").map((c) => c.category),
      /** Item-level scorecard, required items AND rule lines: how many a secured site reaches at all (covered =
       *  potential), how many the site CONFIRMED (the only count that may read as success), how many rest on
       *  inference, how many are only "possible" service lines. */
      score: {
        requiredCovered: required.filter((i) => i.verdict === "covered").length + linesCovered,
        requiredConfirmed: required.filter((i) => i.confirmedSecured > 0).length + linesConfirmed,
        required: required.length + lines.length,
        electiveCovered: graded.filter((i) => !i.item.mandatory && i.verdict === "covered").length, elective: graded.filter((i) => !i.item.mandatory).length,
        unverified: graded.filter((i) => i.verdict === "covered" && i.confirmedSecured === 0).length + lines.filter((l) => l.verdict === "possible").length,
        possible: graded.filter((i) => i.verdict === "possible").length,
        gaps: [...coverage.flatMap((c) => c.mandatoryGaps.map((g) => g.name)), ...lines.filter((l) => l.verdict === "none" || l.verdict === "unknown").map((l) => l.label.replace(/ — .*$/, ""))],
      },
    };
  });
  return { family: { id: fam.id, name: fam.name, clinicalModel: fam.clinicalModel, capacityBasis: fam.capacityBasis }, sets, sites };
}

/** How a program template covers its family's requirement categories: which clinical courses touch each category's settings. */
export async function getProgramRequirementCoverage(programId: string) {
  const { requirementCourseCoverage } = await import("./requirements");
  const { rollupSequence } = await import("./requirementrollup");
  const p = await prisma.program.findUnique({ where: { id: programId }, select: { id: true, familyId: true, institutionId: true, terms: { orderBy: { index: "asc" }, select: { index: true, name: true, courses: { orderBy: { sequenceOrder: "asc" }, select: { id: true, code: true, name: true, requirementPlan: true, sessions: { where: { kind: "CLINICAL" }, select: { rotationType: true } }, clinicalRequirements: { select: { hoursPerStudent: true, casesPerStudent: true, serviceArea: { select: { settingCodes: true } } } } } } } } } });
  if (!p?.familyId) return null;
  const req = await getFamilyRequirements(p.familyId);
  if (!req || !req.sets.length) return null;
  const rotations = new Map((await prisma.rotationSetting.findMany({ where: { institutionId: p.institutionId }, select: { rotationType: true, settingCode: true } })).map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  // A course reaches a setting when hours or cases are coded for a service area in that setting (the numbers
  // the rotation planner places against), or when a clinical session is coded with a rotation type mapped to it.
  const courses = p.terms.flatMap((t) => t.courses.filter((c) => c.sessions.length || c.clinicalRequirements.some((r) => r.hoursPerStudent > 0 || (r.casesPerStudent ?? 0) > 0)).map((c) => {
    const hours: Record<string, number> = {}, cases: Record<string, number> = {};
    for (const r of c.clinicalRequirements) {
      const codes = r.serviceArea.settingCodes.split(",").map((x) => x.trim()).filter(Boolean);
      if (r.hoursPerStudent <= 0 && (r.casesPerStudent ?? 0) <= 0) continue;
      for (const code of codes) { hours[code] = (hours[code] ?? 0) + r.hoursPerStudent / codes.length; cases[code] = (cases[code] ?? 0) + (r.casesPerStudent ?? 0) / codes.length; }
    }
    const fromSessions = c.sessions.map((s) => rotations.get((s.rotationType ?? "").trim().toLowerCase())).filter((x): x is string => !!x);
    let plan: Record<string, number> = {}; try { plan = JSON.parse(c.requirementPlan); } catch { plan = {}; }
    // A course "reaches" a setting when it codes at least half a shift there (a 16 h catch-all area spread over
    // five settings is 3 h each — not a rotation) or a clinical session is coded with that rotation type.
    const reached = Object.keys(hours).filter((k) => hours[k] >= 4 || (cases[k] ?? 0) >= 1);
    return { id: c.id, code: c.code, name: c.name, termIndex: t.index, termName: t.name, settings: [...new Set([...reached, ...fromSessions])], hours, cases, plan };
  }));
  return { family: req.family, programId: p.id, sets: req.sets.map((set) => ({ ...set, courseCoverage: requirementCourseCoverage(set.coverage, courses), rollup: rollupSequence({ id: set.id, name: set.name, authority: set.authority, kind: set.kind, rules: set.rules, items: set.items }, courses) })), courses };
}

/** One site against every requirement set at its institution: for each category the family must
 *  complete, whether THIS site has an asset in the category's settings (and how many seats a day),
 *  under which agreement tier — so a site page says plainly which of a program's required
 *  experiences it can supply and which it cannot. */
export async function getSiteRequirementFit(employerId: string) {
  const { siteFit } = await import("./requirements");
  const e = await prisma.employer.findUnique({ where: { id: employerId }, select: { id: true, institutionId: true, agreementStatus: true, familySites: { select: { familyId: true, agreementStatus: true } } } });
  if (!e) return null;
  const families = await prisma.programFamily.findMany({ where: { institutionId: e.institutionId, requirementSets: { some: {} } }, orderBy: { name: "asc" }, select: { id: true } });
  const out: { family: { id: string; name: string; capacityBasis: string }; agreement: string; inFamily: boolean; sets: { id: string; name: string; authority: string; verified: boolean; categories: { category: string; mandatory: number; elective: number; settings: string[]; seats: number; supplies: boolean; providedRequired: number; requiredItems: number; roles: string[] }[]; suppliedMandatory: number; mandatoryCategories: number; missingMandatory: string[]; requiredProvided: number; requiredConfirmed: number; requiredItems: number; unverified: number; declined: number }[] }[] = [];
  for (const f of families) {
    const req = await getFamilyRequirements(f.id);
    if (!req) continue;
    const me = req.sites.find((s) => s.employerId === employerId);
    if (!me) continue;
    const fsite = e.familySites.find((x) => x.familyId === f.id);
    const agreement = fsite?.agreementStatus ?? e.agreementStatus ?? "none";
    const sets = req.sets.map((set) => {
      const fit = siteFit(me, set.items, set.provisions, { noInferCategories: set.serviceLines });
      const byCat = new Map<string, typeof fit>(); for (const x of fit) { const arr = byCat.get(x.item.category) ?? []; arr.push(x); byCat.set(x.item.category, arr); }
      const categories = set.coverage.filter((c) => c.settings.length > 0).map((c) => {
        const mine = byCat.get(c.category) ?? [];
        const provided = mine.filter((x) => x.state === "provides" || x.state === "limited");
        const reqItems = mine.filter((x) => x.item.mandatory && x.state !== "n/a");
        return { category: c.category, mandatory: c.mandatory, elective: c.elective, settings: c.settings, seats: Math.max(0, ...mine.map((x) => x.seats)), supplies: provided.length > 0, providedRequired: reqItems.filter((x) => x.state === "provides" || x.state === "limited").length, requiredItems: reqItems.length, roles: [...new Set(c.items.map((i) => i.role).filter((r): r is string => !!r))] };
      });
      const mand = categories.filter((c) => c.mandatory > 0);
      const gradable = fit.filter((x) => x.state !== "n/a");
      return { id: set.id, name: set.name, authority: set.authority, verified: set.verified, categories, suppliedMandatory: mand.filter((c) => c.supplies).length, mandatoryCategories: mand.length, missingMandatory: mand.filter((c) => !c.supplies).map((c) => c.category), requiredProvided: gradable.filter((x) => x.item.mandatory && (x.state === "provides" || x.state === "limited")).length, requiredConfirmed: gradable.filter((x) => x.item.mandatory && (x.state === "provides" || x.state === "limited") && x.basis === "verified").length, requiredItems: gradable.filter((x) => x.item.mandatory).length, unverified: gradable.filter((x) => x.basis === "inferred").length, declined: gradable.filter((x) => x.state === "none").length };
    });
    out.push({ family: req.family, agreement, inFamily: !!fsite, sets });
  }
  return out;
}

/** The settings a family's clinicals happen in: its service areas plus every setting its requirement
 *  items name (an OB unit for a surgical technology cesarean; a dental operatory for oral surgery). A
 *  radiography C-arm (OR) is never a surgical technology asset — that job's rooms are OR suites (ORS). */
function familySettingSet(fam: { serviceAreas: { settingCodes: string }[] }, req: { sets: { items: { settingCodes: string }[] }[] } | null | undefined): Set<string> {
  const out = new Set(fam.serviceAreas.flatMap((a) => a.settingCodes.split(",").map((x) => x.trim()).filter(Boolean)));
  for (const set of req?.sets ?? []) for (const i of set.items) for (const c of i.settingCodes.split(",").map((x) => x.trim()).filter(Boolean)) out.add(c);
  return out;
}

// ── Completion requirements: what students have logged against the credentialing body's list ──
const LOG_SELECT = { id: true, itemId: true, shiftId: true, employerId: true, preceptorId: true, date: true, outcome: true, role: true, simulated: true, count: true, procedure: true, flags: true, verifiedById: true, verifiedAt: true, notes: true, employer: { select: { name: true } }, preceptor: { select: { name: true } }, verifiedBy: { select: { name: true } } } as const;
const logLite = (l: { itemId: string; outcome: string; role: string | null; simulated: boolean; count: number; date: Date; employerId: string | null }) => ({ itemId: l.itemId, outcome: l.outcome, role: l.role, simulated: l.simulated, count: l.count, date: l.date.toISOString().slice(0, 10), employerId: l.employerId });

/** ONE STUDENT against the credentialing body's list: every rule with where they stand, every item with
 *  its state and log, the entries themselves, and — for what is still missing — which secured sites in the
 *  program's network provide it and which of the student's coming shifts are at those sites. */
export async function getStudentRequirementProgress(studentId: string) {
  const { progressFor } = await import("./requirementprogress");
  const { disciplineOf } = await import("./discipline");
  const st = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, name: true, cohortId: true, sectionIndex: true, program: { select: { id: true, familyId: true, institutionId: true, family: { select: { id: true, name: true } } } }, requirementLogs: { orderBy: { date: "desc" }, select: LOG_SELECT }, shifts: { select: { id: true, sessionId: true, sectionIndex: true, status: true, loggedAt: true, preceptorId: true, settingCode: true, asset: { select: { employerId: true, employer: { select: { name: true } } } }, session: { select: { week: true, dayOfWeek: true, lengthHours: true, course: { select: { id: true, code: true, termId: true } } } } } } } });
  if (!st?.program.familyId) return null;
  const meetings = st.cohortId ? await prisma.meetingPattern.findMany({ where: { cohortId: st.cohortId, kind: "CLINICAL" }, select: { courseId: true, sectionIndex: true, employerId: true, employer: { select: { name: true } } } }) : [];
  const meetingSite = (courseId: string, sectionIndex: number) => meetings.find((m) => m.courseId === courseId && m.sectionIndex === sectionIndex);
  const req = await getFamilyRequirements(st.program.familyId);
  if (!req) return null;
  const disc = disciplineOf(st.program.family?.name ?? "");
  // Dates for the student's shifts (the log form offers them, and "coming shifts at a site that provides it").
  const dates = st.cohortId ? (await sessionDatesForCohort(st.cohortId)).dates : new Map<string, string>();
  const shifts = st.shifts.map((sh) => { const m = meetingSite(sh.session.course.id, sh.sectionIndex); return { id: sh.id, date: dates.get(sh.sessionId) ?? null, status: sh.status, employerId: sh.asset?.employerId ?? m?.employerId ?? null, site: sh.asset?.employer.name ?? m?.employer?.name ?? null, preceptorId: sh.preceptorId, settingCode: sh.settingCode, course: sh.session.course.code ?? "" }; }).filter((x) => !!x.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const today = new Date().toISOString().slice(0, 10);
  const sets = req.sets.map((set) => {
    const progress = progressFor(set.kind, set.items, set.rules, st.requirementLogs.map(logLite));
    const providersOf = (itemId: string) => set.coverage.flatMap((c) => c.itemCoverage).find((ic) => ic.item.id === itemId)?.providers ?? { secured: [], asked: [], other: [] };
    const missing = [...progress.missingRequired, ...progress.missingElective];
    // Sites that provide what is still missing, ranked by how much of it they cover — where to send this student next.
    const bySite = new Map<string, { employerId: string; name: string; required: string[]; elective: string[]; secured: boolean; coming: number; driveMinutes: number | null }>();
    for (const item of missing) for (const p of providersOf(item.id).secured) {
      const cur = bySite.get(p.site.employerId) ?? { employerId: p.site.employerId, name: p.site.name, required: [], elective: [], secured: true, coming: shifts.filter((x) => x.employerId === p.site.employerId && x.status === "scheduled" && x.date! >= today).length, driveMinutes: p.site.driveMinutes };
      (item.mandatory ? cur.required : cur.elective).push(item.name); bySite.set(p.site.employerId, cur);
    }
    const whereNext = [...bySite.values()].sort((a, b) => b.required.length - a.required.length || b.elective.length - a.elective.length || (a.driveMinutes ?? 9e9) - (b.driveMinutes ?? 9e9));
    const nobody = missing.filter((i) => i.settingCodes && providersOf(i.id).secured.length === 0 && providersOf(i.id).asked.length === 0).map((i) => i.name);
    const logs = st.requirementLogs.filter((l) => set.items.some((i) => i.id === l.itemId)).map((l) => ({ ...l, date: l.date.toISOString().slice(0, 10), verifiedAt: l.verifiedAt?.toISOString().slice(0, 10) ?? null, item: set.items.find((i) => i.id === l.itemId)!, site: l.employer?.name ?? null, preceptor: l.preceptor?.name ?? null, verifier: l.verifiedBy?.name ?? null }));
    return { id: set.id, name: set.name, authority: set.authority, edition: set.edition, kind: set.kind, verified: set.verified, definitions: set.definitions, items: set.items, progress, logs, whereNext, nobody };
  });
  const siteIds = [...new Set([...req.sites.filter((x) => x.inFamily).map((x) => x.employerId), ...shifts.map((x) => x.employerId).filter((x): x is string => !!x)])];
  const sites = await prisma.employer.findMany({ where: { id: { in: siteIds } }, orderBy: { name: "asc" }, select: { id: true, name: true, people: { where: { active: true, role: { in: ["preceptor", "supervisor"] } }, select: { id: true, name: true, title: true } } } });
  return {
    student: { id: st.id, name: st.name, cohortId: st.cohortId, programId: st.program.id }, family: req.family, sets, shifts, today,
    sites: sites.map((e) => ({ id: e.id, name: e.name, preceptors: e.people.filter((p) => disc.title.test(p.title ?? "")).map((p) => ({ id: p.id, name: p.name })) })),
  };
}

/** ONE OFFERING against the list: every student's standing on every rule, and — for allocation — each
 *  experience the cohort still needs with how many students lack it and which secured sites provide it. */
export async function getCohortRequirementProgress(cohortId: string) {
  const { progressFor } = await import("./requirementprogress");
  const co = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true, name: true, program: { select: { id: true, name: true, familyId: true } }, students: { where: { status: { in: [...ROSTER_STATUSES] } }, orderBy: [{ sectionIndex: "asc" }, { name: "asc" }], select: { id: true, name: true, sectionIndex: true, requirementLogs: { select: { itemId: true, outcome: true, role: true, simulated: true, count: true, date: true, employerId: true } } } } } });
  if (!co?.program.familyId) return null;
  const req = await getFamilyRequirements(co.program.familyId);
  if (!req || !req.sets.length) return null;
  const sets = req.sets.map((set) => {
    const students = co.students.map((st) => { const pr = progressFor(set.kind, set.items, set.rules, st.requirementLogs.map(logLite)); return { id: st.id, name: st.name, seat: st.sectionIndex, pct: pr.pct, complete: pr.complete, rules: pr.rules, missingRequired: pr.missingRequired.length, missingElective: pr.missingElective.length, missingIds: new Set([...pr.missingRequired, ...pr.missingElective].map((i) => i.id)), logged: st.requirementLogs.reduce((n, l) => n + l.count, 0) }; });
    const ruleKeys = students[0]?.rules.filter((r) => r.min != null || r.max != null).map((r) => ({ key: r.key, label: r.label, min: r.min, max: r.max })) ?? [];
    const itemDemand = set.coverage.flatMap((c) => c.itemCoverage).map((ic) => {
      const missing = students.filter((s) => s.missingIds.has(ic.item.id)).length;
      return { item: ic.item, category: ic.item.category, missing, providers: ic.providers.secured.map((p) => ({ employerId: p.site.employerId, name: p.site.name, basis: p.basis, annualVolume: p.annualVolume })), asked: ic.providers.asked.length, verdict: ic.verdict };
    }).filter((d) => d.missing > 0 && d.verdict !== "n/a").sort((a, b) => Number(b.item.mandatory) - Number(a.item.mandatory) || b.missing - a.missing);
    // Where the cohort's outstanding requirements can be met: sites by how many student-items they can serve.
    const bySite = new Map<string, { employerId: string; name: string; studentItems: number; required: number; items: Set<string> }>();
    for (const d of itemDemand) for (const p of d.providers) { const cur = bySite.get(p.employerId) ?? { employerId: p.employerId, name: p.name, studentItems: 0, required: 0, items: new Set<string>() }; cur.studentItems += d.missing; if (d.item.mandatory) cur.required += d.missing; cur.items.add(d.item.name); bySite.set(p.employerId, cur); }
    const sites = [...bySite.values()].map((x) => ({ ...x, items: [...x.items] })).sort((a, b) => b.required - a.required || b.studentItems - a.studentItems);
    return { id: set.id, name: set.name, authority: set.authority, kind: set.kind, verified: set.verified, ruleKeys, students: students.map(({ missingIds: _m, ...rest }) => rest), itemDemand, sites, complete: students.filter((s) => s.complete).length };
  });
  return { cohort: { id: co.id, name: co.name, programId: co.program.id, programName: co.program.name }, family: req.family, sets, students: co.students.length };
}

/** THE per-program clinical setup hub: what completion requires (scored item by item against the
 *  network), how the family schedules, and every site serving it with its setup state — address
 *  located, agreement, accreditor recognition, assets in the family's settings, qualified staff,
 *  and how many of the required experiences it provides. */
export async function getFamilyClinicalSetup(familyId: string) {
  const { siteFit, siteFitScore } = await import("./requirements");
  const { disciplineOf } = await import("./discipline");
  const fam = await prisma.programFamily.findUnique({ where: { id: familyId }, select: { id: true, name: true, institutionId: true, clinicalModel: true, clinicalNotes: true, capacityBasis: true, accreditor: true, accreditorProgramNumber: true, accreditedCapacity: true, rotationPrimarySetting: true, studentsPerStaff: true, casesPerStudentDay: true, institution: { select: { id: true, name: true, ringCoreMinutes: true, ringOneMinutes: true, ringTwoMinutes: true } }, occupation: { select: { title: true, socCode: true } }, serviceAreas: { orderBy: { sortOrder: "asc" }, select: { code: true, name: true, settingCodes: true } }, programs: { select: { id: true, name: true } }, familySites: true } });
  if (!fam) return null;
  const req = await getFamilyRequirements(familyId);
  const settingSet = familySettingSet(fam, req);
  const disc = disciplineOf(fam.name);
  const programIds = fam.programs.map((p) => p.id);
  const fsByEmp = new Map(fam.familySites.map((f) => [f.employerId, f]));
  const employers = await prisma.employer.findMany({ where: { institutionId: fam.institutionId }, orderBy: { name: "asc" }, select: { id: true, name: true, organization: true, facilityType: true, city: true, address: true, ring: true, driveMinutes: true, lat: true, status: true, agreementStatus: true, annualSurgicalCases: true, operatingDaysPerYear: true, operatingRooms: true, assets: { where: { status: { not: "archived" } }, select: { settingCode: true, learnersPerShift: true, preceptorsPerShift: true, days: true, shiftBlocks: true, dataSource: true } }, people: { where: { active: true, role: "preceptor" }, select: { title: true } }, meetings: { where: { kind: "CLINICAL", cohort: { programId: { in: programIds } } }, select: { cohortId: true, courseId: true, sectionIndex: true, seats: true } } } });
  const sites = employers.filter((e) => fsByEmp.has(e.id) || e.assets.some((a) => settingSet.has(a.settingCode))).map((e) => {
    const f = fsByEmp.get(e.id) ?? null;
    const mine = e.assets.filter((a) => settingSet.size === 0 || settingSet.has(a.settingCode));
    const seatsBySetting: Record<string, number> = {}; for (const a of mine) seatsBySetting[a.settingCode] = (seatsBySetting[a.settingCode] ?? 0) + a.learnersPerShift;
    const preceptors = e.people.filter((p) => disc.title.test(p.title ?? "")).length;
    const sections = new Set(e.meetings.map((m) => `${m.cohortId}|${m.courseId}|${m.sectionIndex}`)).size;
    const students = [...new Map(e.meetings.map((m) => [`${m.cohortId}|${m.courseId}|${m.sectionIndex}`, m.seats])).values()].reduce((n, v) => n + v, 0);
    // Requirement fit for this site across the family's sets.
    const siteLite = req?.sites.find((s) => s.employerId === e.id);
    const fits = (req?.sets ?? []).map((set) => ({ setId: set.id, ...siteFitScore(siteLite ? siteFit(siteLite, set.items, set.provisions, { noInferCategories: set.serviceLines }) : []) }));
    const fit = fits.reduce((acc, x) => ({ requiredProvided: acc.requiredProvided + x.requiredProvided, requiredConfirmed: acc.requiredConfirmed + x.requiredConfirmed, required: acc.required + x.required, electiveProvided: acc.electiveProvided + x.electiveProvided, elective: acc.elective + x.elective, unverified: acc.unverified + x.unverified, possible: acc.possible + x.possible, declined: acc.declined + x.declined, unknown: acc.unknown + x.unknown }), { requiredProvided: 0, requiredConfirmed: 0, required: 0, electiveProvided: 0, elective: 0, unverified: 0, possible: 0, declined: 0, unknown: 0 });
    const agreementStatus = f?.agreementStatus ?? "none";
    // Setup steps are "done" only on confirmed evidence (Phase 3): every asset VERIFIED, a VERIFIED staff count or a
    // named preceptor, every required experience confirmed with the site. Estimates and inference do not complete a step.
    const setup = {
      located: e.lat != null, address: !!e.address, agreement: agreementStatus === "secured", assets: mine.length > 0 && mine.every((a) => a.dataSource === "VERIFIED"), assetsMapped: mine.length > 0, assetsVerified: mine.length > 0 && mine.every((a) => a.dataSource === "VERIFIED"),
      staff: preceptors > 0 || ((f?.qualifiedStaffOnShift ?? 0) > 0 && f?.staffCountSource === "VERIFIED"), preceptors: preceptors > 0, availability: !!(f?.studentsAtOnce || f?.casesPerDay || f?.daysAllowed || f?.blocksAllowed),
      provisions: fit.required > 0 && fit.requiredConfirmed === fit.required && fit.unknown === 0, accreditor: !fam.accreditor || f?.accreditorStatus === "recognized",
    };
    const steps = [setup.address && setup.located, setup.agreement, setup.assets, setup.staff, setup.availability, setup.provisions, setup.accreditor];
    return {
      employerId: e.id, name: e.name, organization: e.organization, facilityType: e.facilityType, city: e.city, ring: e.ring, driveMinutes: e.driveMinutes, status: e.status,
      inFamily: !!f, agreementStatus, accreditorStatus: f?.accreditorStatus ?? "none", approvedCapacity: f?.approvedCapacity ?? null, requestedCapacity: f?.requestedCapacity ?? null, qualifiedStaffOnShift: f?.qualifiedStaffOnShift ?? null, staffCountSource: f?.staffCountSource ?? "ESTIMATE", studentsAtOnce: f?.studentsAtOnce ?? null, casesPerDay: f?.casesPerDay ?? (e.annualSurgicalCases != null ? e.annualSurgicalCases / Math.max(1, e.operatingDaysPerYear ?? 250) : null), casesPerDaySource: f?.casesPerDay != null ? "agreed" as const : e.annualSurgicalCases != null ? "estimated from annual cases" as const : null, annualSurgicalCases: e.annualSurgicalCases, operatingRooms: e.operatingRooms, daysAllowed: f?.daysAllowed ?? null, blocksAllowed: f?.blocksAllowed ?? null,
      evidence: { source: f?.evidenceSource ?? null, owner: f?.evidenceOwner ?? null, verifiedAt: f?.verifiedAt?.toISOString().slice(0, 10) ?? null, reviewBy: f?.reviewBy?.toISOString().slice(0, 10) ?? null },
      assets: mine.length, seatsBySetting, seats: Object.values(seatsBySetting).reduce((n, v) => n + v, 0), assetsUnverified: mine.filter((a) => a.dataSource !== "VERIFIED").length, preceptors, sections, students, fit, setup, setupDone: steps.filter(Boolean).length, setupSteps: steps.length,
    };
  });
  // The program's primary setting (OR suites for surgical technology, radiographic rooms for radiography) is
  // what most of the clinical hours happen in — sites that have it sort above the observation-only offices.
  const primary = fam.rotationPrimarySetting ?? fam.serviceAreas[0]?.settingCodes.split(",")[0]?.trim() ?? null;
  const hasPrimary = (x: { seatsBySetting: Record<string, number> }) => (primary && (x.seatsBySetting[primary] ?? 0) > 0 ? 1 : 0);
  sites.sort((a, b) => Number(b.inFamily) - Number(a.inFamily) || hasPrimary(b) - hasPrimary(a) || ["secured", "asked", "prospect", "none", "declined"].indexOf(a.agreementStatus) - ["secured", "asked", "prospect", "none", "declined"].indexOf(b.agreementStatus) || b.seats - a.seats || a.name.localeCompare(b.name));
  const others = employers.filter((e) => !sites.some((s) => s.employerId === e.id)).map((e) => ({ id: e.id, name: e.name, facilityType: e.facilityType, city: e.city, ring: e.ring }));
  return {
    family: { id: fam.id, name: fam.name, institutionId: fam.institutionId, institution: fam.institution.name, occupation: fam.occupation?.title ?? null, soc: fam.occupation?.socCode ?? null, clinicalModel: fam.clinicalModel, clinicalNotes: fam.clinicalNotes, capacityBasis: fam.capacityBasis, accreditor: fam.accreditor, accreditorProgramNumber: fam.accreditorProgramNumber, accreditedCapacity: fam.accreditedCapacity, primarySetting: fam.rotationPrimarySetting, studentsPerStaff: fam.studentsPerStaff, casesPerStudentDay: fam.casesPerStudentDay, programs: fam.programs },
    discipline: { label: disc.label, credential: disc.credential },
    bands: { core: fam.institution.ringCoreMinutes, one: fam.institution.ringOneMinutes, two: fam.institution.ringTwoMinutes },
    settings: [...settingSet], areas: fam.serviceAreas, req, sites, others,
    totals: { sites: sites.filter((s) => s.inFamily).length, secured: sites.filter((s) => s.agreementStatus === "secured").length, asked: sites.filter((s) => s.agreementStatus === "asked").length, seatsSecured: sites.filter((s) => s.agreementStatus === "secured").reduce((n, s) => n + s.seats, 0), recognized: sites.filter((s) => s.accreditorStatus === "recognized").length, approvedTotal: sites.reduce((n, s) => n + (s.approvedCapacity ?? 0), 0) },
  };
}

/** ONE site inside ONE program's clinical setup: its address and drive, the agreement and contacts for this
 *  program, accreditor recognition, agreed availability, its assets in this program's settings, the qualified
 *  staff who precept here, and — item by item — which of the program's required experiences it provides. */
export async function getFamilySiteSetup(familyId: string, employerId: string) {
  const { siteFit, siteFitScore } = await import("./requirements");
  const { disciplineOf } = await import("./discipline");
  const fam = await prisma.programFamily.findUnique({ where: { id: familyId }, select: { id: true, name: true, institutionId: true, capacityBasis: true, accreditor: true, studentsPerStaff: true, casesPerStudentDay: true, caseDaysPerYear: true, institution: { select: { name: true, ringCoreMinutes: true, ringOneMinutes: true, ringTwoMinutes: true, campuses: { orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, city: true, lat: true } } } }, serviceAreas: { orderBy: { sortOrder: "asc" }, select: { code: true, name: true, settingCodes: true } }, programs: { select: { id: true, name: true } }, familySites: { where: { employerId } } } });
  if (!fam) return null;
  const e = await prisma.employer.findUnique({ where: { id: employerId }, include: { siteCapabilities: { orderBy: [{ kind: "asc" }, { label: "asc" }] }, assets: { orderBy: [{ settingCode: "asc" }, { assetNumber: "asc" }], include: { _count: { select: { dayOverrides: true } }, dayOverrides: { select: { date: true, shiftBlocks: true, note: true } } } }, people: { where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, title: true, employmentType: true, email: true, asset: { select: { setting: true, settingCode: true, assetNumber: true } } } }, meetings: { where: { kind: "CLINICAL", cohort: { programId: { in: fam.programs.map((p) => p.id) } } }, orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }], include: { cohort: { select: { id: true, name: true, programId: true } }, course: { select: { code: true, name: true } }, staff: { select: { name: true, role: true } } } } } });
  if (!e || e.institutionId !== fam.institutionId) return null;
  const fs = fam.familySites[0] ?? null;
  const disc = disciplineOf(fam.name);
  const req = await getFamilyRequirements(familyId);
  const settingSet = familySettingSet(fam, req);
  const siteLite = req?.sites.find((s) => s.employerId === employerId) ?? { employerId, name: e.name, facilityType: e.facilityType, agreementStatus: fs?.agreementStatus ?? "none", inFamily: !!fs, agreementRank: 3, seatsBySetting: {}, casesPerDay: null, driveMinutes: e.driveMinutes, ring: e.ring };
  const sets = (req?.sets ?? []).map((set) => {
    const fit = siteFit(siteLite, set.items, set.provisions, { noInferCategories: set.serviceLines });
    const cats: string[] = []; for (const x of fit) if (!cats.includes(x.item.category)) cats.push(x.item.category);
    const prov = new Map(set.provisions.filter((p) => p.employerId === employerId).map((p) => [p.itemId, p]));
    return { id: set.id, name: set.name, authority: set.authority, kind: set.kind, verified: set.verified, rules: set.rules, serviceLines: set.serviceLines, categories: cats.map((c) => ({ category: c, items: fit.filter((x) => x.item.category === c).map((x) => ({ ...x, evidence: prov.get(x.item.id) ? { owner: prov.get(x.item.id)!.evidenceOwner, verifiedAt: prov.get(x.item.id)!.verifiedAt, reviewBy: prov.get(x.item.id)!.reviewBy } : null })) })), score: siteFitScore(fit) };
  });
  const accreditor = fam.accreditor ? await getAccreditorCapacity(familyId, employerId) : null;
  const preceptors = e.people.filter((p) => p.role === "preceptor" || p.role === "supervisor");
  const seen = new Set<string>();
  const sections = e.meetings.filter((m) => { const k = `${m.cohortId}|${m.courseId}|${m.sectionIndex}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return {
    family: { id: fam.id, name: fam.name, institution: fam.institution.name, capacityBasis: fam.capacityBasis, accreditor: fam.accreditor, studentsPerStaff: fam.studentsPerStaff, casesPerStudentDay: fam.casesPerStudentDay, caseDaysPerYear: fam.caseDaysPerYear, programs: fam.programs },
    bands: { core: fam.institution.ringCoreMinutes, one: fam.institution.ringOneMinutes, two: fam.institution.ringTwoMinutes }, campus: fam.institution.campuses[0] ?? null,
    settings: [...settingSet], areas: fam.serviceAreas, discipline: { label: disc.label, credential: disc.credential },
    capabilityRaw: { siteCapabilities: e.siteCapabilities, assets: e.assets },
    site: { id: e.id, name: e.name, externalId: e.externalId, organization: e.organization, facilityType: e.facilityType, status: e.status, address: e.address, city: e.city, state: e.state, zip: e.zip, county: e.county, ring: e.ring, ringSource: e.ringSource, driveMinutes: e.driveMinutes, distanceMiles: e.distanceMiles, lat: e.lat, lng: e.lng, geoSource: e.geoSource, contactName: e.contactName, contactEmail: e.contactEmail, contactPhone: e.contactPhone, licensedBeds: e.licensedBeds, operatingRooms: e.operatingRooms, annualSurgicalCases: e.annualSurgicalCases, inpatientSurgicalCases: e.inpatientSurgicalCases, ambulatorySurgicalCases: e.ambulatorySurgicalCases, operatingDaysPerYear: e.operatingDaysPerYear, surgicalCaseSource: e.surgicalCaseSource, agreementStatus: e.agreementStatus },
    familySite: fs, inFamily: !!fs,
    assets: e.assets.map((a) => ({ id: a.id, externalId: a.externalId, employerId: a.employerId, facilityName: e.name, facilityExternalId: e.externalId, county: e.county, ring: e.ring, facilityType: e.facilityType, agreementStatus: fs?.agreementStatus ?? "none", facilityStatus: e.status, settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks, hoursPerShift: a.hoursPerShift, dayStart: a.dayStart, dayHours: a.dayHours, eveningStart: a.eveningStart, eveningHours: a.eveningHours, nightStart: a.nightStart, nightHours: a.nightHours, serves: a.serves, learnersPerShift: a.learnersPerShift, preceptorsPerShift: a.preceptorsPerShift, dataSource: a.dataSource, accreditorClass: a.accreditorClass, status: a.status, notes: a.notes, exceptions: a._count.dayOverrides, inFamily: settingSet.size === 0 || settingSet.has(a.settingCode) })),
    overrides: e.assets.flatMap((a) => a.dayOverrides.map((o) => ({ assetId: a.id, date: o.date.toISOString().slice(0, 10), shiftBlocks: o.shiftBlocks, note: o.note }))),
    people: e.people.map((p) => ({ ...p, precepts: (p.role === "preceptor" || p.role === "supervisor") && disc.title.test(p.title ?? ""), otherDiscipline: (p.role === "preceptor" || p.role === "supervisor") && !disc.title.test(p.title ?? "") })),
    preceptorsInDiscipline: preceptors.filter((p) => disc.title.test(p.title ?? "")).length,
    sets, accreditorSite: accreditor?.sites[0] ?? null, accreditorReport: accreditor,
    sections: sections.map((m) => ({ id: m.id, cohort: m.cohort, course: m.course, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, dayOfWeek: m.dayOfWeek, startTime: m.startTime, lengthHours: m.lengthHours, seats: m.seats, staff: m.staff?.name ?? null })),
  };
}

/** A family's clinical scheduling rules and each site's agreed availability — the directory set-up the rotation planner reads. */
export async function getFamilyClinicalRules(familyId: string) {
  const fam = await prisma.programFamily.findUnique({ where: { id: familyId }, select: { id: true, name: true, institutionId: true, clinicalModel: true, capacityBasis: true, casesPerStudentDay: true, caseDaysPerYear: true, studentsPerStaff: true, rotationPrimarySetting: true, rotationAgreements: true, rotationKeepHome: true, rotationSkipHolidays: true, rotationNotes: true, accreditor: true, serviceAreas: { orderBy: { sortOrder: "asc" }, select: { code: true, name: true, settingCodes: true } }, familySites: { select: { employerId: true, agreementStatus: true, accreditorStatus: true, approvedCapacity: true, qualifiedStaffOnShift: true, studentsAtOnce: true, casesPerDay: true, daysAllowed: true, blocksAllowed: true, availabilityNotes: true } } } });
  if (!fam) return null;
  const settingSet = new Set(fam.serviceAreas.flatMap((a) => a.settingCodes.split(",").map((x) => x.trim()).filter(Boolean)));
  const employers = await prisma.employer.findMany({ where: { institutionId: fam.institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, facilityType: true, agreementStatus: true, annualSurgicalCases: true, assets: { where: { status: { not: "archived" } }, select: { settingCode: true, learnersPerShift: true, days: true, shiftBlocks: true } } } });
  const fs = new Map(fam.familySites.map((f) => [f.employerId, f]));
  const sites = employers.filter((e) => fs.has(e.id) || e.assets.some((a) => settingSet.has(a.settingCode))).map((e) => {
    const f = fs.get(e.id);
    const seatsBySetting: Record<string, number> = {};
    for (const a of e.assets) if (settingSet.size === 0 || settingSet.has(a.settingCode)) seatsBySetting[a.settingCode] = (seatsBySetting[a.settingCode] ?? 0) + a.learnersPerShift;
    const days = [...new Set(e.assets.flatMap((a) => a.days.split(",").map((x) => x.trim())))];
    const blocks = [...new Set(e.assets.flatMap((a) => a.shiftBlocks.split(",").map((x) => x.trim())))];
    return { employerId: e.id, name: e.name, facilityType: e.facilityType, agreementStatus: f?.agreementStatus ?? e.agreementStatus ?? "none", accreditorStatus: f?.accreditorStatus ?? "none", approvedCapacity: f?.approvedCapacity ?? null, qualifiedStaffOnShift: f?.qualifiedStaffOnShift ?? null, studentsAtOnce: f?.studentsAtOnce ?? null, casesPerDay: f?.casesPerDay ?? null, annualSurgicalCases: e.annualSurgicalCases, daysAllowed: f?.daysAllowed ?? null, blocksAllowed: f?.blocksAllowed ?? null, availabilityNotes: f?.availabilityNotes ?? null, seatsBySetting, seats: Object.values(seatsBySetting).reduce((n, v) => n + v, 0), assetDays: days, assetBlocks: blocks };
  }).sort((a, b) => ["secured", "asked", "prospect", "none", "declined"].indexOf(a.agreementStatus) - ["secured", "asked", "prospect", "none", "declined"].indexOf(b.agreementStatus) || b.seats - a.seats || a.name.localeCompare(b.name));
  return { family: { id: fam.id, name: fam.name, clinicalModel: fam.clinicalModel, capacityBasis: fam.capacityBasis, casesPerStudentDay: fam.casesPerStudentDay, caseDaysPerYear: fam.caseDaysPerYear, studentsPerStaff: fam.studentsPerStaff, rotationPrimarySetting: fam.rotationPrimarySetting, rotationAgreements: fam.rotationAgreements, rotationKeepHome: fam.rotationKeepHome, rotationSkipHolidays: fam.rotationSkipHolidays, rotationNotes: fam.rotationNotes, accreditor: fam.accreditor }, settings: [...settingSet], areas: fam.serviceAreas.map((a) => ({ code: a.code, name: a.name, settingCodes: a.settingCodes })), sites };
}

/** The accreditor's clinical-capacity picture (JRCERT Form 1010R for radiography) for one
 *  family across its sites — or one site: physical resources counted from the asset map,
 *  the human count from the site record, the lower of the two, what the accreditor has
 *  approved or is being asked for, and the most students the calendar actually puts on
 *  the site at one time. */
export async function getAccreditorCapacity(familyId: string, employerId?: string) {
  const { jrcertCapacity, accreditorClassOf, peakAssigned, programCapacityChange } = await import("./jrcert");
  const { toMin } = await import("./space");
  const fam = await prisma.programFamily.findUnique({
    where: { id: familyId },
    select: { id: true, name: true, institutionId: true, accreditor: true, accreditorProgramNumber: true, accreditedCapacity: true, accreditationNotes: true, institution: { select: { name: true } }, programs: { select: { id: true, name: true } }, serviceAreas: { select: { settingCodes: true } },
      familySites: { where: employerId ? { employerId } : undefined, select: { id: true, employerId: true, agreementStatus: true, accreditorStatus: true, approvedCapacity: true, requestedCapacity: true, qualifiedStaffOnShift: true, staffCountSource: true, studentHoursWindow: true, accreditorNotes: true, capacityUpdatedAt: true } } },
  });
  if (!fam) return null;
  const settingSet = new Set(fam.serviceAreas.flatMap((a) => a.settingCodes.split(",").map((x) => x.trim()).filter(Boolean)));
  const programIds = fam.programs.map((p) => p.id);
  const employers = await prisma.employer.findMany({
    where: { institutionId: fam.institutionId, ...(employerId ? { id: employerId } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, address: true, city: true, state: true, zip: true, facilityType: true, organization: true, status: true,
      assets: { where: { status: { not: "archived" } }, orderBy: [{ settingCode: "asc" }, { assetNumber: "asc" }], select: { id: true, externalId: true, settingCode: true, setting: true, assetType: true, assetNumber: true, accreditorClass: true, preceptorsPerShift: true, shiftBlocks: true, status: true, dataSource: true } },
      meetings: { where: { kind: "CLINICAL", cohort: { programId: { in: programIds } } }, select: { seats: true, dayOfWeek: true, startTime: true, lengthHours: true, termIndex: true, cohort: { select: { name: true, cohortTerms: { select: { startDate: true, endDate: true, term: { select: { index: true } } } } } } } } },
  });
  const fsByEmp = new Map(fam.familySites.map((f) => [f.employerId, f]));
  const sites = employers
    .filter((e) => fsByEmp.has(e.id) || e.assets.some((a) => settingSet.has(a.settingCode)))
    .map((e) => {
      const fs = fsByEmp.get(e.id) ?? null;
      const cap = jrcertCapacity({ assets: e.assets, qualifiedStaffOnShift: fs?.qualifiedStaffOnShift ?? null });
      const seenMeeting = new Set<string>();
      const bookings = e.meetings.filter((m) => { const k = `${m.cohort.name}|${m.termIndex}|${m.dayOfWeek}|${m.startTime}|${m.lengthHours}|${m.seats}`; if (seenMeeting.has(k)) return false; seenMeeting.add(k); return true; }).map((m) => { const ct = m.cohort.cohortTerms.find((c) => c.term.index === m.termIndex); const s = ct?.startDate?.getTime() ?? 0; return { dayOfWeek: m.dayOfWeek, startMin: toMin(m.startTime), lengthHours: m.lengthHours, seats: m.seats, weekStartMs: s, weekEndMs: ct?.endDate ? ct.endDate.getTime() + 86400000 : s + 16 * 7 * 86400000 }; });
      const peak = peakAssigned(bookings);
      const approved = fs?.approvedCapacity ?? null;
      const change = programCapacityChange(fam.accreditedCapacity, approved, fs?.requestedCapacity ?? null);
      return {
        employerId: e.id, name: e.name, organization: e.organization, facilityType: e.facilityType, address: [e.address, [e.city, e.state].filter(Boolean).join(", "), e.zip].filter(Boolean).join(" · "), status: e.status,
        familySiteId: fs?.id ?? null, agreementStatus: fs?.agreementStatus ?? "none", accreditorStatus: fs?.accreditorStatus ?? "none",
        approvedCapacity: approved, requestedCapacity: fs?.requestedCapacity ?? null, qualifiedStaffOnShift: fs?.qualifiedStaffOnShift ?? null, staffCountSource: fs?.staffCountSource ?? "ESTIMATE", studentHoursWindow: fs?.studentHoursWindow ?? null, accreditorNotes: fs?.accreditorNotes ?? null, capacityUpdatedAt: fs?.capacityUpdatedAt?.toISOString().slice(0, 10) ?? null,
        ...cap,
        assets: e.assets.map((a) => ({ id: a.id, externalId: a.externalId, settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, accreditorClass: accreditorClassOf(a), coded: !!a.accreditorClass, dataSource: a.dataSource })),
        assetsUnverified: e.assets.filter((a) => a.dataSource !== "VERIFIED" && accreditorClassOf(a) !== "EXCLUDED").length,
        peakAssigned: peak.peak, peakDay: peak.dayOfWeek, peakStart: peak.startMin != null ? `${String(Math.floor(peak.startMin / 60)).padStart(2, "0")}:${String(peak.startMin % 60).padStart(2, "0")}` : null,
        cohorts: [...new Set(e.meetings.map((m) => m.cohort.name))],
        /** Assigned beyond what the accreditor approved (or, unrecognized, beyond what the resources support). */
        over: approved != null ? Math.max(0, peak.peak - approved) : Math.max(0, peak.peak - cap.capacity),
        change,
      };
    })
    .sort((a, b) => Number(b.peakAssigned > 0) - Number(a.peakAssigned > 0) || b.capacity - a.capacity || a.name.localeCompare(b.name));
  const approvedTotal = sites.reduce((n, s) => n + (s.approvedCapacity ?? 0), 0);
  const requestedTotal = sites.reduce((n, s) => n + (s.requestedCapacity ?? s.approvedCapacity ?? 0), 0);
  const inClinical = await prisma.student.count({ where: { cohortId: { not: null }, status: "enrolled", program: { familyId }, shifts: { some: {} } } });
  return {
    family: { id: fam.id, name: fam.name, institution: fam.institution.name, accreditor: fam.accreditor, programNumber: fam.accreditorProgramNumber, accreditedCapacity: fam.accreditedCapacity, notes: fam.accreditationNotes, programNames: fam.programs.map((p) => p.name) },
    sites, approvedTotal, requestedTotal, inClinical,
    recognized: sites.filter((s) => s.accreditorStatus === "recognized").length, requested: sites.filter((s) => s.accreditorStatus === "requested").length,
    overCapacity: sites.filter((s) => s.over > 0).length, unrecognizedInUse: sites.filter((s) => s.peakAssigned > 0 && s.accreditorStatus !== "recognized").length,
  };
}

/** Families (of this institution) with a programmatic accreditor that recognizes clinical settings — for a site page. */
export async function getAccreditedFamiliesForEmployer(employerId: string) {
  const e = await prisma.employer.findUnique({ where: { id: employerId }, select: { institutionId: true } });
  if (!e) return [];
  return prisma.programFamily.findMany({ where: { institutionId: e.institutionId, accreditor: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, accreditor: true } });
}

export async function getFamilySupply(familyId: string) {
  const fam = await prisma.programFamily.findUnique({
    where: { id: familyId },
    include: { institution: { select: { id: true, name: true } }, occupation: { select: { title: true, socCode: true } }, serviceAreas: { orderBy: { sortOrder: "asc" } }, familySites: true },
  });
  if (!fam) return null;
  const settingSet = new Set(fam.serviceAreas.flatMap((a) => a.settingCodes.split(",").map((s) => s.trim()).filter(Boolean)));
  const fsByEmp = new Map(fam.familySites.map((s) => [s.employerId, s]));
  const employers = await prisma.employer.findMany({
    where: { institutionId: fam.institutionId },
    orderBy: [{ name: "asc" }],
    include: { assets: { orderBy: [{ settingCode: "asc" }, { assetNumber: "asc" }], include: { _count: { select: { dayOverrides: true } } } } },
  });
  const sites = employers
    .filter((e) => fsByEmp.has(e.id) || e.assets.some((a) => settingSet.has(a.settingCode)))
    .map((e) => {
      const fs = fsByEmp.get(e.id);
      return {
        id: e.id, name: e.name, externalId: e.externalId, organization: e.organization, county: e.county, ring: e.ring, facilityType: e.facilityType, address: e.address, city: e.city, state: e.state, zip: e.zip, status: e.status,
        agreementStatus: fs?.agreementStatus ?? "none", contactName: fs?.contactName ?? e.contactName, contactEmail: fs?.contactEmail ?? e.contactEmail, notes: fs?.notes ?? null,
        assets: e.assets.filter((a) => settingSet.size === 0 || settingSet.has(a.settingCode)).map((a) => ({
          id: a.id, externalId: a.externalId, employerId: a.employerId, facilityName: e.name, facilityExternalId: e.externalId, county: e.county, ring: e.ring, facilityType: e.facilityType, agreementStatus: fs?.agreementStatus ?? "none", facilityStatus: e.status,
          settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks,
          hoursPerShift: a.hoursPerShift, dayStart: a.dayStart, dayHours: a.dayHours, eveningStart: a.eveningStart, eveningHours: a.eveningHours, nightStart: a.nightStart, nightHours: a.nightHours,
          serves: a.serves, learnersPerShift: a.learnersPerShift, preceptorsPerShift: a.preceptorsPerShift, dataSource: a.dataSource, accreditorClass: a.accreditorClass, status: a.status, notes: a.notes, exceptions: a._count.dayOverrides,
        })),
      };
    });
  const siteIds = new Set(sites.map((s) => s.id));
  const overrides = (await prisma.assetDay.findMany({ where: { asset: { employerId: { in: [...siteIds] } } }, select: { assetId: true, date: true, shiftBlocks: true, note: true } })).map((o) => ({ assetId: o.assetId, date: o.date.toISOString().slice(0, 10), shiftBlocks: o.shiftBlocks, note: o.note }));
  return {
    family: { id: fam.id, name: fam.name, institutionId: fam.institutionId, institution: fam.institution.name, occupation: fam.occupation?.title ?? null, soc: fam.occupation?.socCode ?? null },
    settings: fam.serviceAreas.map((a) => ({ id: a.id, code: a.code, name: a.name, settingCodes: a.settingCodes, unitCategories: a.unitCategories, notes: a.notes })),
    sites, overrides,
    organizations: employers.filter((e) => !siteIds.has(e.id)).map((e) => ({ id: e.id, name: e.name, county: e.county, ring: e.ring, facilityType: e.facilityType })),
  };
}

export async function getInstitutionsLite() {
  return prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** All program families grouped by institution, for the dashboard. */
export async function getFamilies() {
  return prisma.institution.findMany({
    orderBy: { name: "asc" },
    include: {
      programFamilies: {
        orderBy: { name: "asc" },
        include: {
          occupation: { select: { title: true, socCode: true } },
          programs: { select: { id: true, name: true, _count: { select: { cohorts: true } } } },
        },
      },
    },
  });
}

/** Everything the family hub needs: its templates (programs) with year targets +
 *  cohorts (funnel target/actual), and the regional demand to anchor goals to. */
export async function getFamily(familyId: string) {
  const family = await prisma.programFamily.findUnique({
    where: { id: familyId },
    include: {
      institution: { include: { academicEvents: { orderBy: { date: "asc" } } } },
      occupation: true,
      programs: {
        orderBy: { name: "asc" },
        include: {
          yearTargets: { orderBy: { year: "asc" } },
          _count: { select: { terms: true } },
          terms: { include: { courses: { include: { sessions: true } } } },
          cohorts: {
            orderBy: { name: "asc" },
            include: { stages: { orderBy: { sortOrder: "asc" } }, _count: { select: { students: true } }, students: { select: { status: true } }, cohortTerms: { select: { termId: true, startDate: true, endDate: true } }, campus: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!family) return null;
  const demand = family.occupationId
    ? await prisma.demandProjection.findMany({ where: { occupationId: family.occupationId, region: { kind: "SERVICE_AREA" } }, orderBy: { year: "asc" } })
    : [];
  return { family, demand };
}

export async function getInstitutions() {
  return prisma.institution.findMany({ orderBy: { name: "asc" }, include: { occupations: true } });
}

/**
 * Assemble every input the integrated planning engine needs for one program:
 * the authored archetype, the cohort series (from the launch cadence), staff
 * supply, and ALIGNMENT-CONSTRAINED WBL supply (loop 2).
 */
export async function getProgramPlanData(programId: string) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      institution: true,
      yearTargets: { orderBy: { year: "asc" } },
      assignments: { include: { person: true } },
      cohorts: true,
      terms: { include: { courses: { include: { sessions: true } } } },
    },
  });
  if (!program) return null;

  const { parseTermCodes } = await import("./calendar");
  const { generateCohortSeries } = await import("./plan");
  const { effectivePlacementCapacity } = await import("./wbl");

  const archetype = await getProgramArchetype(programId);

  // --- Staff supply ---
  const facultyFte = program.assignments.filter((a) => a.role === "instructor" || a.role === "coordinator").reduce((s, a) => s + a.fteCommitment, 0);
  const preceptors = program.assignments.filter((a) => a.role === "preceptor").reduce((s, a) => s + a.fteCommitment, 0);

  // --- Loop 2: alignment-constrained WBL supply ---
  const [employers, employerProfiles, learnerProfile] = await Promise.all([
    prisma.employer.findMany({ where: { institutionId: program.institutionId } }),
    prisma.wblProfile.findMany({ where: { institutionId: program.institutionId, subjectType: "EMPLOYER" }, include: { factors: true } }),
    prisma.wblProfile.findFirst({ where: { institutionId: program.institutionId, subjectType: "LEARNER", cohortId: { in: program.cohorts.map((c) => c.id) } }, include: { factors: true } }),
  ]);
  const toInput = (p: { id: string; subjectType: string; name: string; factors: { layer: string; label: string; detail: string | null; weight: number; binding: boolean; disclosure: string; matchKey: string | null }[] }) => ({
    id: p.id, subjectType: p.subjectType as "LEARNER" | "EMPLOYER", name: p.name,
    factors: p.factors.map((f) => ({ layer: f.layer as "MOTIVATION" | "CONSTRAINT" | "CAPACITY", label: f.label, detail: f.detail, weight: f.weight, binding: f.binding, disclosure: f.disclosure, matchKey: f.matchKey })),
  });
  const profileByEmployer = new Map(employerProfiles.filter((p) => p.employerId).map((p) => [p.employerId!, p]));
  const employerSlots = employers.map((e) => ({ employerId: e.id, name: e.name, slots: e.wblSlots ?? 0, profile: profileByEmployer.has(e.id) ? toInput(profileByEmployer.get(e.id)!) : null }));
  const placement = effectivePlacementCapacity(learnerProfile ? toInput(learnerProfile) : null, employerSlots);

  const supply = { facultyFte, preceptors, wblSlots: placement.effective };

  // --- Launch cadence → cohort series ---
  const years = program.yearTargets.map((t) => t.year);
  const seatsByYear: Record<number, number> = {};
  for (const t of program.yearTargets) if (t.cohortCapacity) seatsByYear[t.year] = Math.round(t.cohortCapacity);
  const startYear = years.length ? Math.min(...years) : 2026;
  const endYear = years.length ? Math.max(...years) : startYear + 4;
  const launchConfig = {
    cadence: program.launchCadence as "ANNUAL" | "BIENNIAL" | "MULTI_PER_YEAR" | "ON_DEMAND",
    launchTerms: parseTermCodes(program.launchTerms),
    intervalYears: program.launchIntervalYears,
    startYear, endYear, seatsByYear,
    defaultSeats: Math.round(program.defaultCohortSeats ?? 30),
  };
  const termCodeOf = (d: Date | null): "FALL" | "SPRING" | "SUMMER" | null => (d ? (d.getUTCMonth() + 1 >= 8 ? "FALL" : d.getUTCMonth() + 1 >= 5 ? "SUMMER" : "SPRING") : null);
  const explicitCohorts = program.cohorts.filter((c) => c.isExplicit && (c.entryTermCode || termCodeOf(c.startDate)) && (c.entryYear || c.startDate)).map((c) => ({
    id: c.id, label: c.name, entryCode: (c.entryTermCode as "FALL" | "SPRING" | "SUMMER" | null) ?? termCodeOf(c.startDate)!, entryCalendarYear: c.entryYear ?? c.startDate!.getUTCFullYear(), seats: Math.round(c.plannedSeats ?? program.defaultCohortSeats ?? 30),
  }));
  const cohorts = generateCohortSeries(launchConfig, explicitCohorts);
  const activeCodes = parseTermCodes(program.termSlots);

  return { program, archetype, supply, placement, cohorts, activeCodes, launchConfig, assignments: program.assignments };
}

/** People available to staff a program (for the assignment picker). */
export async function getStaffOptions(institutionId: string) {
  return prisma.person.findMany({ where: { institutionId }, orderBy: { name: "asc" } });
}

/** Pick the offering (cohort run) to view for a program: an explicit one, else
 *  the active offering, else the one with enrolled students, else the first. */
async function resolveOffering(programId: string, cohortId?: string) {
  const offerings = await prisma.cohort.findMany({
    where: { programId },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    include: { cohortTerms: true, _count: { select: { students: true } } },
  });
  const offering =
    (cohortId ? offerings.find((o) => o.id === cohortId) : undefined) ??
    offerings.find((o) => o.status === "active") ??
    offerings.find((o) => o._count.students > 0) ??
    offerings[0] ??
    null;
  return { offering, offerings };
}

/** Everything the day-by-day schedule / shift-assignment board needs, scoped to
 *  one OFFERING (cohort run): the template's terms/courses/sessions, the term
 *  dates THIS offering runs on, the offering's assigned instructors, its enrolled
 *  students, the staff roster, and planned enrollment. */
export async function getProgramSchedule(programId: string, cohortId?: string) {
  const { offering, offerings } = await resolveOffering(programId, cohortId);
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      institution: true,
      yearTargets: { orderBy: { year: "asc" } },
      terms: {
        orderBy: { index: "asc" },
        include: {
          courses: {
            orderBy: { sequenceOrder: "asc" },
            include: {
              sessions: {
                orderBy: [{ kind: "asc" }, { number: "asc" }],
                include: { instructors: { where: offering ? { cohortId: offering.id } : {}, include: { person: { select: { id: true, name: true } } } } },
              },
            },
          },
        },
      },
    },
  });
  if (!program) return null;
  const roster = await prisma.person.findMany({
    where: { institutionId: program.institutionId, role: { in: ["instructor", "preceptor", "coordinator", "support"] } },
    orderBy: { name: "asc" },
    include: { employer: { select: { name: true } } },
  });
  // Enrolled-and-beyond students of THIS offering form the section roster.
  const students = await prisma.student.findMany({
    where: offering ? { cohortId: offering.id, status: { in: [...ENROLLED_AND_BEYOND] } } : { programId, status: { in: [...ENROLLED_AND_BEYOND] } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, sectionIndex: true, stageKey: true, status: true, clinicalSite: true },
  });
  // Per-offering term start dates (fallback to the template term's own date).
  const offeringTermDate = new Map((offering?.cohortTerms ?? []).map((ct) => [ct.termId, ct.startDate]));
  const termDates: Record<string, string | null> = {};
  for (const t of program.terms) {
    const d = offeringTermDate.get(t.id) ?? t.startDate;
    termDates[t.id] = d ? d.toISOString().slice(0, 10) : null;
  }
  // Per-section weekly-slot overrides for this offering (staggered sections).
  const sectionOverrides: Record<string, { day: string | null; startTime: string | null; location: string | null }> = {};
  if (offering) {
    const rows = await prisma.sectionSchedule.findMany({ where: { cohortId: offering.id } });
    for (const r of rows) sectionOverrides[`${r.sessionId}#${r.sectionIndex}`] = { day: r.dayOfWeek, startTime: r.startTime, location: r.location };
  }
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? Math.max(0, ...program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ?? 40);
  return { program, offering, offerings, roster, students, termDates, sectionOverrides, defaultEnrollment };
}

/** All offerings (cohort runs) of a program, with their schedule + counts. */
export async function getProgramOfferings(programId: string) {
  return prisma.cohort.findMany({
    where: { programId },
    orderBy: [{ startDate: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { students: true, sessionStaff: true } },
      cohortTerms: { include: { term: { select: { index: true, name: true } } }, orderBy: { term: { index: "asc" } } },
      stages: { orderBy: { sortOrder: "asc" } },
      campus: { select: { id: true, name: true, city: true, isMain: true } },
    },
  });
}

/** One offering (cohort run) in full: the program template it instantiates, its
 *  per-term real dates, funnel, and staffing/enrollment counts. */
export async function getOffering(cohortId: string) {
  return prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: { include: { institution: { include: { academicEvents: { orderBy: { date: "asc" }, select: { date: true, endDate: true, label: true, kind: true, season: true } } } }, family: { select: { id: true, name: true, goalPlan: true } }, terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { select: { kind: true, week: true } } } } } } } },
      cohortTerms: { include: { term: true } },
      courseDates: true,
      stages: { orderBy: { sortOrder: "asc" } },
      campus: { select: { id: true, name: true, city: true, isMain: true } },
      _count: { select: { students: true, sessionStaff: true, meetings: true, studentShifts: true } },
    },
  });
}

/** The full student roster for a program, with funnel-stage rollups, so the
 *  pipeline can be drilled into by name. */
export async function getProgramStudents(programId: string) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      institution: true,
      cohorts: { include: { stages: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!program) return null;
  const students = await prisma.student.findMany({
    where: { programId },
    orderBy: [{ name: "asc" }],
    select: {
      id: true, name: true, email: true, status: true, stageKey: true,
      entryYear: true, gpa: true, attendedCount: true, missedCount: true,
      shifts: { select: { status: true } },
      _count: { select: { grades: true, absences: true } },
    },
  });
  // Attendance comes from the shift ledger; the counters on the student row are not maintained.
  return { program, students: students.map((s) => ({ ...s, attendedCount: s.shifts.filter((x) => x.status === "completed").length, missedCount: s.shifts.filter((x) => x.status === "absent" || x.status === "excused").length })) };
}

/** A single student's complete record: dated grades and dated attendance —
 *  the bottom of every drill-down. */
export async function getStudent(studentId: string) {
  return prisma.student.findUnique({
    where: { id: studentId },
    include: {
      program: { include: { institution: true } },
      cohort: true,
      grades: {
        orderBy: [{ termIndex: "asc" }],
        include: { course: { select: { id: true, code: true, name: true, creditHours: true } } },
      },
      absences: { orderBy: [{ date: "asc" }] },
      wblSnapshots: { orderBy: { asOfDate: "desc" }, include: { factors: true } },
      placements: {
        orderBy: { createdAt: "desc" },
        include: { employer: { select: { id: true, name: true } }, cohort: { select: { name: true } }, term: { select: { name: true } } },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// FACILITIES WORKSPACE — classrooms / labs / clinical spaces (supply side)
// ---------------------------------------------------------------------------

export async function getFacilitiesDirectory() {
  const [facilities, institutions] = await Promise.all([
    prisma.facility.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], include: { institution: { select: { id: true, name: true } } } }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { facilities, institutions };
}

// ---------------------------------------------------------------------------
// PEOPLE WORKSPACE — faculty / preceptors / support staff directory
// ---------------------------------------------------------------------------

/** Every staff person across institutions with assignment load, plus the
 *  institution + employer lists for the add/edit form. */
export async function getPeopleDirectory() {
  const { personLoad } = await import("./workload");
  const [raw, institutions, employers, studentCount, policies, dated] = await Promise.all([
    prisma.person.findMany({
      orderBy: { name: "asc" },
      include: {
        institution: { select: { id: true, name: true } },
        employer: { select: { id: true, name: true } },
        _count: { select: { sessionStaff: true, assignments: true } },
      },
    }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.employer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, institutionId: true } }),
    prisma.student.count(),
    getWorkloadPolicies(),
    datedStaffAssignments(),
  ]);
  const [roles, assetsLite] = await Promise.all([getStaffRoles(), getAssetsLite()]);
  const today = new Date().toISOString().slice(0, 10);
  const byPerson = new Map<string, typeof dated>();
  for (const d of dated) { const l = byPerson.get(d.personId) ?? []; l.push(d); byPerson.set(d.personId, l); }

  // Roll each person's shift assignments into a time-bound load: daily, weekly,
  // per term, per year — credited by their workload policy — plus the same
  // per-cohort buckets the filters use, and whether any shift is this week.
  const people = raw.map((p) => {
    const mine = byPerson.get(p.id) ?? [];
    const load = personLoad({ id: p.id, institutionId: p.institutionId, employerId: p.employerId, assetId: p.assetId, role: p.role, employmentType: p.employmentType, title: p.title }, mine, policies);
    type Bucket = { cohortId: string; name: string; program: string; hours: number; year: number | null; season: string | null };
    const buckets: Bucket[] = [];
    const byYear: Record<number, number> = {};
    const bySemester: Record<string, { year: number; season: string; hours: number }> = {};
    let workingNow = false, currentHours = 0;
    const weekMonday = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };
    const thisMonday = weekMonday(today);
    for (const a of mine) {
      const season = a.termKey.split(" ")[0] || null; const year = a.year;
      if (year != null) byYear[year] = (byYear[year] ?? 0) + a.contactHours;
      if (year != null && season) { const key = `${year} ${season}`; const b = bySemester[key] ?? { year, season, hours: 0 }; b.hours += a.contactHours; bySemester[key] = b; }
      if (a.dateIso && weekMonday(a.dateIso) === thisMonday) { workingNow = true; currentHours += a.contactHours; }
      const bk = buckets.find((x) => x.cohortId === a.cohortId && x.year === year && x.season === season);
      if (bk) bk.hours += a.contactHours; else buckets.push({ cohortId: a.cohortId, name: a.cohortName, program: a.programName, hours: a.contactHours, year, season });
    }
    buckets.sort((x, y) => (y.year ?? 0) - (x.year ?? 0) || y.hours - x.hours);
    const semesters = Object.values(bySemester).sort((x, y) => y.year - x.year || x.season.localeCompare(y.season));
    return {
      ...p, workingNow, currentHours,
      load: { cohorts: buckets, byYear, semesters, totalHours: load.totalContactHours },
      workload: {
        policyLabel: load.policy.label ?? [load.policy.employmentType, load.policy.role].filter(Boolean).join(" "), policySource: load.policySource, policyId: load.policy.id ?? null,
        contactHoursPerWeek: load.policy.contactHoursPerWeek, workWeekHours: load.policy.workWeekHours, termWeeks: load.policy.termWeeks, annualWeeks: load.policy.annualWeeks,
        creditPerContactHour: load.creditPerContactHour, totalContactHours: load.totalContactHours, totalCreditedHours: load.totalCreditedHours,
        years: load.years.map((y) => ({ key: y.key, contactHours: y.contactHours, creditedHours: y.creditedHours, fte: load.yearFte.find((f) => f.key === y.key)?.fte ?? 0 })),
        terms: load.terms.map((t) => ({ key: t.key, contactHours: t.contactHours, creditedHours: t.creditedHours, fte: load.termFte.find((f) => f.key === t.key)?.fte ?? 0 })),
        weekly: load.weekly, daily: load.daily, peakWeek: load.peakWeek, peakDay: load.peakDay, peakWeekLoad: load.peakWeekLoad, overloadedWeeks: load.overloadedWeeks, undatedHours: load.undatedHours,
        shifts: mine.length,
      },
    };
  });

  return { people, institutions, employers, studentCount, policies, roles: roles.map((r) => ({ id: r.id, institutionId: r.institutionId, institution: r.institution.name, key: r.key, label: r.label, family: r.family, notes: r.notes })), assets: assetsLite };
}

// ---------------------------------------------------------------------------
// EMPLOYERS WORKSPACE — partner directory, detail, and placement context
// ---------------------------------------------------------------------------

/** Every employer partner across institutions + the institution list for intake.
 *  WBL capacity is sourced from actual placement records (asked vs secured) rather
 *  than a static slot count, bucketed by calendar year + semester. */
export async function getEmployersDirectory() {
  const [employers, institutions] = await Promise.all([
    prisma.employer.findMany({
      orderBy: { name: "asc" },
      include: {
        institution: { select: { id: true, name: true } },
        _count: { select: { people: true, units: true, meetings: true } },
        meetings: { where: { kind: "CLINICAL" }, select: { seats: true, termIndex: true, courseId: true, sectionIndex: true, cohortId: true, cohort: { select: { program: { select: { family: { select: { name: true } } } }, cohortTerms: { select: { startDate: true, term: { select: { index: true } } } } } } } },
        familySites: { select: { agreementStatus: true, family: { select: { name: true } } } },
        units: { select: { unitCategory: true, studentsPerShift: true, shiftsPerDay: true, days: true, status: true } },
      },
    }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  // What each site actually hosts, from the calendarized meeting patterns: clinical
  // sections and the students in them, by semester (the term the section runs in)
  // and by program family — plus the family-level agreements that make it real.
  const withHosting = employers.map((e) => {
    const byPeriod: Record<string, { year: number; season: string; sections: number; students: number }> = {};
    const byFamily: Record<string, { sections: number; students: number }> = {};
    let sections = 0, students = 0;
    // One section that meets Tuesday AND Thursday is one placement, not two — count each cohort × course × section once.
    const seen = new Set<string>();
    for (const m of e.meetings) {
      const k = `${m.cohortId}|${m.courseId}|${m.sectionIndex}`;
      if (seen.has(k)) continue;
      seen.add(k);
      sections += 1; students += m.seats;
      const fam = m.cohort.program.family?.name ?? "—";
      const f = byFamily[fam] ?? { sections: 0, students: 0 }; f.sections += 1; f.students += m.seats; byFamily[fam] = f;
      const ct = m.cohort.cohortTerms.find((c) => c.term.index === m.termIndex);
      if (ct?.startDate) {
        const y = ct.startDate.getUTCFullYear(); const sn = seasonOfDate(ct.startDate);
        const key = `${y} ${sn}`;
        const b = byPeriod[key] ?? { year: y, season: sn, sections: 0, students: 0 };
        b.sections += 1; b.students += m.seats; byPeriod[key] = b;
      }
    }
    const periods = Object.values(byPeriod).sort((a, b) => b.year - a.year || a.season.localeCompare(b.season));
    const families = Object.entries(byFamily).map(([family, v]) => ({ family, ...v })).sort((a, b) => b.students - a.students);
    const agreements = e.familySites.map((f) => ({ family: f.family.name, status: f.agreementStatus }));
    const { meetings: _m, familySites: _f, ...rest } = e;
    return { ...rest, hosting: { sections, students, periods, families, agreements }, geo: { lat: e.lat, lng: e.lng, source: e.geoSource, distanceMiles: e.distanceMiles, driveMinutes: e.driveMinutes, ringSource: e.ringSource } };
  });
  return { employers: withHosting, institutions };
}

/** One employer partner with its placements (the hosted students). */
export async function getEmployer(id: string) {
  const e = await prisma.employer.findUnique({
    where: { id },
    include: {
      institution: { select: { id: true, name: true, ringCoreMinutes: true, ringOneMinutes: true, ringTwoMinutes: true, campuses: { orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], take: 1, select: { id: true, name: true, address: true, city: true, lat: true, lng: true, geoSource: true } } } },
      site: { select: { id: true, partners: { select: { id: true, institutionId: true, agreementStatus: true, driveMinutes: true, institution: { select: { id: true, name: true } } } } } },
      units: { orderBy: [{ unitCategory: "asc" }, { unitType: "asc" }] },
      people: { where: { active: true }, select: { id: true } },
      assets: { orderBy: [{ settingCode: "asc" }, { assetNumber: "asc" }], include: { _count: { select: { bookings: true, dayOverrides: true } }, dayOverrides: { select: { date: true, shiftBlocks: true, note: true } } } },
      siteCapabilities: { orderBy: [{ kind: "asc" }, { label: "asc" }] },
      meetings: {
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
        include: { cohort: { select: { id: true, name: true, programId: true, program: { select: { name: true } } } }, course: { select: { code: true, name: true } }, unit: { select: { id: true, unitType: true } }, staff: { select: { name: true, role: true } } },
      },
      placements: {
        orderBy: { createdAt: "desc" },
        include: {
          student: { select: { id: true, name: true, program: { select: { name: true } } } },
          cohort: { select: { name: true } },
          term: { select: { name: true } },
        },
      },
    },
  });
  if (!e) return null;
  return { ...e, assetOverrides: e.assets.flatMap((a) => a.dayOverrides.map((o) => ({ assetId: a.id, date: o.date.toISOString().slice(0, 10), shiftBlocks: o.shiftBlocks, note: o.note }))) };
}

/** Lightweight employer list for an institution (for placement assignment selects). */
export async function getInstitutionEmployersLite(institutionId: string) {
  return prisma.employer.findMany({ where: { institutionId }, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, wblSlots: true } });
}

/** A program's terms (id + name) for placement-window selects. */
export async function getProgramTermsLite(programId: string) {
  return prisma.term.findMany({ where: { programId }, orderBy: { index: "asc" }, select: { id: true, name: true } });
}

/** Employers with their LATEST WBL capacity snapshot — the employer side of the
 *  per-student placement recommendation. */
export async function getEmployerWblSlots(institutionId: string) {
  // Capacity is FLUID — no partner "always has 5 slots." A partner's working
  // capacity = rotations they are actually hosting now or have agreed to next
  // (active + planned placements), which shifts week to week as reality does.
  const employers = await prisma.employer.findMany({
    where: { institutionId },
    orderBy: { name: "asc" },
    include: {
      wblSnapshots: { orderBy: { asOfDate: "desc" }, take: 1, include: { factors: true } },
      placements: { where: { status: { in: ["active", "planned"] } }, select: { id: true } },
    },
  });
  return employers.map((e) => ({ employerId: e.id, name: e.name, slots: e.placements.length, snapshot: e.wblSnapshots[0] ?? null }));
}

/** The cohort-wide WBL placement board: every enrolled-and-beyond student with
 *  their latest learner snapshot, plus employer capacity, so the page can
 *  recommend a placement and surface unmet needs per student. */
export async function getProgramWblBoard(programId: string) {
  const program = await prisma.program.findUnique({ where: { id: programId }, include: { institution: true } });
  if (!program) return null;
  const students = await prisma.student.findMany({
    where: { programId, status: { in: [...ENROLLED_AND_BEYOND] } },
    orderBy: { name: "asc" },
    include: { wblSnapshots: { orderBy: { asOfDate: "desc" }, take: 1, include: { factors: true } } },
  });
  const employers = await getEmployerWblSlots(program.institutionId);
  return { program, students, employers };
}

/** The program's full session plan (terms → courses → sessions with planned
 *  staffing + homework), used to build a single student's personal schedule. */
export async function getProgramSessionPlan(programId: string) {
  return prisma.term.findMany({
    where: { programId },
    orderBy: { index: "asc" },
    include: {
      courses: {
        orderBy: { sequenceOrder: "asc" },
        include: {
          sessions: {
            orderBy: [{ week: "asc" }, { number: "asc" }],
            include: { instructors: { include: { person: { select: { id: true, name: true } } } } },
          },
        },
      },
    },
  });
}

/** Everything the offering scheduler needs: the offering, its program template
 *  (terms → courses → sessions), the planned enrollment that sets section counts,
 *  and any per-section slot overrides already saved for this run. */
/** Per-offering staffing: the template's terms/courses/sessions, the staff already
 *  assigned to THIS cohort, and the institution's people pool to assign from. */
export async function getOfferingStaffing(cohortId: string) {
  const { personLoad } = await import("./workload");
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: {
        include: {
          institution: { select: { id: true, name: true } },
          terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { select: { id: true, lengthHours: true, kind: true, maxStudents: true, facultyNeeded: true, preceptorsNeeded: true, supportStaffNeeded: true } } } } } },
        },
      },
      _count: { select: { students: true } },
    },
  });
  if (!cohort) return null;
  const institutionId = cohort.program.institution.id;
  const [people, policies, dated] = await Promise.all([
    prisma.person.findMany({ where: { institutionId, active: true }, orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, role: true, employmentType: true, title: true, employerId: true, institutionId: true, employer: { select: { name: true } } } }),
    getWorkloadPolicies(),
    datedStaffAssignments({ cohortId }),
  ]);
  const enrolled = Math.max(cohort._count.students, cohort.plannedSeats ?? 0, 1);
  // Per-person load for THIS run (their whole load lives on the People page).
  const byPerson = new Map<string, typeof dated>();
  for (const d of dated) { const l = byPerson.get(d.personId) ?? []; l.push(d); byPerson.set(d.personId, l); }
  const loads = [...byPerson.entries()].map(([pid, list]) => {
    const p = people.find((x) => x.id === pid);
    const lite = p ? { id: p.id, institutionId: p.institutionId, employerId: p.employerId, role: p.role, employmentType: p.employmentType, title: p.title } : { id: pid, institutionId, employerId: null, role: list[0].role, employmentType: null, title: null };
    const l = personLoad(lite, list, policies);
    return { personId: pid, name: list[0].personName, role: p?.role ?? list[0].role, employmentType: p?.employmentType ?? null, employer: p?.employer?.name ?? null, policyLabel: l.policy.label ?? l.policy.role, contactHoursPerWeek: l.policy.contactHoursPerWeek, credit: l.creditPerContactHour, total: l.totalContactHours, credited: l.totalCreditedHours, terms: l.terms.map((t) => ({ key: t.key, contactHours: t.contactHours, fte: l.termFte.find((f) => f.key === t.key)?.fte ?? 0 })), years: l.years.map((y) => ({ key: y.key, contactHours: y.contactHours, fte: l.yearFte.find((f) => f.key === y.key)?.fte ?? 0 })), peakWeek: l.peakWeek, peakDay: l.peakDay, peakWeekLoad: l.peakWeekLoad, overloadedWeeks: l.overloadedWeeks, shifts: list.length };
  }).sort((a, b) => b.total - a.total);
  return { cohort, program: cohort.program, enrolled, assignments: dated, people, loads };
}

export async function getOfferingScheduler(cohortId: string) {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: {
        include: {
          institution: { select: { id: true } },
          yearTargets: true,
          terms: {
            orderBy: { index: "asc" },
            include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }] } } } },
          },
        },
      },
      sectionSchedules: true,
    },
  });
  if (!cohort) return null;
  const enrollment = Math.round(cohort.plannedSeats ?? cohort.program.defaultCohortSeats ?? Math.max(0, ...cohort.program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ?? 40);
  const overrides: Record<string, { dayOfWeek: string | null; startTime: string | null; location: string | null; facilityId: string | null }> = {};
  for (const o of cohort.sectionSchedules) overrides[`${o.sessionId}#${o.sectionIndex}`] = { dayOfWeek: o.dayOfWeek, startTime: o.startTime, location: o.location, facilityId: o.facilityId };
  const facilities = await prisma.facility.findMany({
    where: { institutionId: cohort.program.institutionId, status: "active" },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, capacity: true },
  });
  return { cohort, program: cohort.program, enrollment, overrides, facilities };
}

/** A single course with its full catalog detail + session-by-session schedule. */
export async function getCourse(courseId: string) {
  // The course is part of the TEMPLATE — no instructors/students here (those are
  // offering concerns). Just catalog detail and the session archetype.
  return prisma.course.findUnique({
    where: { id: courseId },
    include: {
      sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }], include: { resources: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } },
      term: { include: { program: { include: { institution: true, yearTargets: { orderBy: { year: "asc" } } } } } },
    },
  });
}

// ---------------------------------------------------------------------------
// STUDENTS WORKSPACE — institution-wide directory + intake/enroll options
// ---------------------------------------------------------------------------

/** A program's cohorts (id + name) for assignment selects. */
export async function getProgramCohortsLite(programId: string) {
  return prisma.cohort.findMany({ where: { programId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

/** Every student across institutions (for the directory) plus the program/cohort
 *  tree used by the enroll form's dependent selects. */
export async function getStudentsDirectory() {
  const [students, institutions] = await Promise.all([
    prisma.student.findMany({
      orderBy: { name: "asc" },
      include: {
        program: { select: { id: true, name: true, institution: { select: { id: true, name: true } } } },
        cohort: { select: { id: true, name: true } },
      },
    }),
    prisma.institution.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true,
        programs: { orderBy: { name: "asc" }, select: { id: true, name: true, cohorts: { orderBy: { name: "asc" }, select: { id: true, name: true } } } },
      },
    }),
  ]);
  return { students: students.map((s) => ({ ...s, dob: s.dob?.toISOString().slice(0, 10) ?? null, startDate: s.startDate?.toISOString().slice(0, 10) ?? null, completionDate: s.completionDate?.toISOString().slice(0, 10) ?? null })), institutions };
}

// ---------------------------------------------------------------------------
// SEMESTER VIEW — every offering running in a chosen term, side by side
// ---------------------------------------------------------------------------

export interface SemesterOffering {
  cohortId: string;
  cohortName: string;
  programId: string;
  programName: string;
  family: string | null;
  familyId: string | null;
  institution: string;
  termName: string;
  termIndex: number;
  enrollment: number;
  facultyFte: number;
  preceptorFte: number;
  spaceHours: number;
  sections: number;
  startDate: Date | null;
  endDate: Date | null;
  inSessionNow: boolean;
  courses: { id: string; name: string; sessions: number }[];
}

export interface SemesterView {
  options: { sem: string; year: number; count: number; current: boolean }[];
  selected: { sem: string; year: number } | null;
  offerings: SemesterOffering[];
}

/** Every offering-term active in a given semester+year, with its delivery footprint. */
export async function getSemesterView(sem?: string, year?: number): Promise<SemesterView> {
  const { courseService, DEFAULT_SERVICE } = await import("./service");

  const cts = await prisma.cohortTerm.findMany({
    include: {
      term: { include: { courses: { include: { sessions: true } } } },
      cohort: {
        include: {
          program: { include: { institution: { select: { name: true, springStart: true, summerStart: true, fallStart: true } }, family: { select: { id: true, name: true } } } },
        },
      },
    },
  });

  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const today = new Date();
  type Row = SemesterOffering & { sem: string; year: number };
  const rows: Row[] = [];
  for (const ct of cts) {
    const co = ct.cohort;
    const p = co.program;
    const yr = ct.startDate ? ct.startDate.getUTCFullYear() : (co.entryYear != null ? co.entryYear + Math.floor((ct.term.index - 1) / 2) : null);
    if (yr == null) continue;
    // The offering's own aligned semester first (Summer stays Summer), then the template term's, then the start date.
    const season = seasonOfTerm({ semester: ct.semester, name: null }, null) ?? seasonOfTerm(ct.term, ct.startDate) ?? "Fall";
    // A term that runs past its semester (a continuing-education class started in November) is in session in
    // every semester it touches, so it is listed under each of them, not only the one it started in.
    const anchors = { springStart: p.institution.springStart, summerStart: p.institution.summerStart, fallStart: p.institution.fallStart };
    const semestersTouched: { sem: string; year: number }[] = [{ sem: season, year: yr }];
    if (ct.startDate && ct.endDate) {
      for (let d = new Date(nextSemesterStart(new Date(ct.startDate.getTime() + 86400000), anchors)); d <= ct.endDate; d = nextSemesterStart(new Date(d.getTime() + 86400000), anchors)) {
        const s = semesterAt(d, anchors);
        if (!semestersTouched.some((x) => x.sem === s.season && x.year === s.year)) semestersTouched.push({ sem: s.season, year: s.year });
      }
    }
    const sessions = ct.term.courses.flatMap((c) => c.sessions.map((s) => ({ id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded })));
    const enrollment = Math.round(co.plannedSeats ?? p.defaultCohortSeats ?? 40);
    const t = sessions.length ? courseService(sessions, enrollment, DEFAULT_SERVICE).totals : null;
    // Term date window: real start (from the CohortTerm) + its instructional span.
    const termWeeks = ct.term.startWeek != null && ct.term.endWeek != null && ct.term.endWeek >= ct.term.startWeek ? ct.term.endWeek - ct.term.startWeek + 1 : 16;
    // The offering's coded last day when the calendar carries one (exclusive bound = the day after), else the template span.
    const endDate = ct.endDate ? new Date(ct.endDate.getTime() + DAY_MS_SEM) : ct.startDate ? new Date(ct.startDate.getTime() + termWeeks * WEEK_MS) : null;
    const inSessionNow = !!(ct.startDate && endDate && today >= ct.startDate && today < endDate);
    for (const touched of semestersTouched) rows.push({
      sem: touched.sem, year: touched.year,
      cohortId: co.id, cohortName: co.name, programId: p.id, programName: p.name,
      family: p.family?.name ?? null, familyId: p.family?.id ?? null, institution: p.institution.name,
      termName: ct.term.name, termIndex: ct.term.index, enrollment,
      facultyFte: t ? t.facultyFte : 0,
      preceptorFte: t ? t.preceptorFte : 0,
      spaceHours: t ? t.spaceHours : 0,
      sections: t ? t.sections : 0,
      startDate: ct.startDate ?? null, endDate, inSessionNow,
      courses: ct.term.courses.map((c) => ({ id: c.id, name: c.name, sessions: c.sessions.length })),
    });
  }

  // Distinct semester options, chronological. Mark the one in session today.
  const optMap = new Map<string, { sem: string; year: number; count: number; current: boolean }>();
  const SEASON_ORDER = SEASON_RANK;
  for (const r of rows) {
    const k = `${r.year}-${r.sem}`;
    const e = optMap.get(k) ?? { sem: r.sem, year: r.year, count: 0, current: false };
    e.count += 1;
    if (r.inSessionNow) e.current = true;
    optMap.set(k, e);
  }
  const options = [...optMap.values()].sort((a, b) => a.year - b.year || SEASON_ORDER[a.sem] - SEASON_ORDER[b.sem]);
  const currentOpt = options.find((o) => o.current);

  const selected = sem && year != null && optMap.has(`${year}-${sem}`)
    ? { sem, year }
    : currentOpt ? { sem: currentOpt.sem, year: currentOpt.year }
    : options[0] ? { sem: options[0].sem, year: options[0].year } : null;

  const offerings = selected
    ? rows.filter((r) => r.sem === selected.sem && r.year === selected.year)
        .sort((a, b) => a.institution.localeCompare(b.institution) || (a.family ?? "").localeCompare(b.family ?? "") || a.programName.localeCompare(b.programName) || a.termIndex - b.termIndex)
        .map(({ sem: _s, year: _y, ...rest }) => rest)
    : [];

  return { options, selected, offerings };
}

// ---------------------------------------------------------------------------
// MASTER SPACE CALENDAR — every booked meeting across all programs, with room
// utilization and conflict detection, on a real weekly timeline.
// ---------------------------------------------------------------------------

export interface MasterMeeting {
  id: string;
  cohortId: string; cohortName: string;
  programId: string; programName: string; family: string | null;
  courseId: string; courseCode: string | null; courseName: string;
  kind: string; sectionIndex: number; sectionCount: number; seats: number;
  dayOfWeek: string; startTime: string; endTime: string; lengthHours: number;
  facilityId: string | null; facilityName: string | null; facilityKind: string | null;
  employerId: string | null; employerName: string | null;
  staffPersonId: string | null; staffName: string | null;
  termIndex: number; weekStartMs: number; weekEndMs: number;
  startLabel: string; endLabel: string;
  /** Session titles for this meeting's kind, week by week (from the template). */
  sessionTitles: { week: number | null; title: string | null }[];
}

/** One clinical shift as it ACTUALLY happens in the displayed week: the date it landed on (after
 *  the scheduler's plan or a hand move), the site and rooms booked, who precepts, and which
 *  students are there. Stands in for the weekly pattern's block on the calendar. */
export interface CalOccurrence {
  key: string; meetingId: string | null;
  cohortId: string; cohortName: string; programId: string; programName: string;
  courseId: string; courseCode: string | null; courseName: string; sessionTitle: string | null;
  sectionIndex: number; sectionCount: number;
  date: string; dayOfWeek: string; originalDate: string; originalDay: string; startTime: string; endTime: string; lengthHours: number; block: string | null;
  employerId: string | null; employerName: string | null; assets: string[];
  preceptors: string[]; instructor: string | null;
  students: { id: string; name: string; preceptor: string | null; status: string }[];
  moved: boolean; changedBlock: boolean; source: "plan" | "move" | "pattern";
  /** A booking on a site's asset exists for this shift; without one the site shown is only the section's weekly site. */
  booked: boolean;
}
export interface CalRosterDay { date: string; dayOfWeek: string; sites: { employerId: string | null; name: string; students: { name: string; cohort: string; course: string; preceptor: string | null }[]; preceptors: string[] }[] }

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const dowOf = (iso: string) => DOW_SHORT[new Date(iso + "T00:00:00Z").getUTCDay()];

/** The clinical shifts of one calendar week, as they actually happen — from the applied plan's
 *  bookings, per-occurrence moves, shift staffing and every student's pinned shift. */
export async function weekClinicalOccurrences(meetings: MasterMeeting[], mondayMs: number): Promise<{ occurrences: CalOccurrence[]; roster: CalRosterDay[] }> {
  const { toMin, toHHMM } = await import("./space");
  const empty = { occurrences: [] as CalOccurrence[], roster: [] as CalRosterDay[] };
  const cohortIds = [...new Set(meetings.map((m) => m.cohortId))];
  if (!cohortIds.length) return empty;
  const monday = isoOf(new Date(mondayMs)); const sunday = isoOf(new Date(mondayMs + 6 * 86400000));
  const inWin = (iso: string) => iso >= monday && iso <= sunday;
  const win = { gte: new Date(monday + "T00:00:00Z"), lte: new Date(sunday + "T00:00:00Z") };
  const [bookings, moves, dated] = await Promise.all([
    prisma.assetBooking.findMany({ where: { cohortId: { in: cohortIds }, date: win, sessionId: { not: null } }, select: { cohortId: true, sessionId: true, sectionIndex: true, date: true, block: true, students: true, asset: { select: { externalId: true, settingCode: true, assetNumber: true, dayStart: true, eveningStart: true, nightStart: true, employer: { select: { id: true, name: true } } } } } }),
    prisma.shiftMove.findMany({ where: { cohortId: { in: cohortIds }, OR: [{ fromDate: win }, { toDate: win }] }, select: { cohortId: true, sessionId: true, sectionIndex: true, fromDate: true, toDate: true, startTime: true, note: true, employer: { select: { id: true, name: true } }, staff: { select: { name: true } } } }),
    Promise.all(cohortIds.map(async (id) => [id, (await sessionDatesForCohort(id)).dates] as const)),
  ]);
  const dateOf = new Map(dated.map(([id, d]) => [id, d]));
  // Sessions that happen this week: on their own date, or moved into it (moved out = gone from this week).
  const moveByKey = new Map(moves.map((m) => [`${m.cohortId}|${m.sessionId}|${m.sectionIndex}`, m]));
  const sessionIds = new Set<string>();
  for (const [cid, d] of dateOf) for (const [sid, iso] of d) if (iso && inWin(iso)) sessionIds.add(sid);
  for (const m of moves) if (inWin(isoOf(m.toDate))) sessionIds.add(m.sessionId);
  if (!sessionIds.size) return empty;
  const ids = [...sessionIds];
  const [sessions, shifts, staff] = await Promise.all([
    prisma.session.findMany({ where: { id: { in: ids }, kind: "CLINICAL" }, select: { id: true, courseId: true, title: true, startTime: true, lengthHours: true, course: { select: { code: true, name: true } } } }),
    prisma.studentShift.findMany({ where: { cohortId: { in: cohortIds }, sessionId: { in: ids } }, select: { studentId: true, sessionId: true, sectionIndex: true, cohortId: true, status: true, student: { select: { name: true } }, preceptor: { select: { name: true, employerId: true } } }, orderBy: { student: { name: "asc" } } }),
    prisma.sessionInstructor.findMany({ where: { cohortId: { in: cohortIds }, sessionId: { in: ids } }, select: { cohortId: true, sessionId: true, sectionIndex: true, role: true, note: true, person: { select: { name: true, employerId: true } } } }),
  ]);
  const sessionById = new Map(sessions.map((s) => [s.id, s]));
  const cohortOf = new Map(meetings.map((m) => [m.cohortId, m]));
  const patterns = meetings.filter((m) => m.kind === "CLINICAL");
  // Every (cohort, session, section) anything is known about this week.
  const keys = new Map<string, { cohortId: string; sessionId: string; sectionIndex: number }>();
  const add = (cohortId: string, sessionId: string, sectionIndex: number) => { if (sessionById.has(sessionId)) keys.set(`${cohortId}|${sessionId}|${sectionIndex}`, { cohortId, sessionId, sectionIndex }); };
  for (const b of bookings) add(b.cohortId, b.sessionId!, b.sectionIndex);
  for (const m of moves) add(m.cohortId, m.sessionId, m.sectionIndex);
  for (const s of shifts) add(s.cohortId, s.sessionId, s.sectionIndex);
  for (const s of staff) if (s.cohortId) add(s.cohortId, s.sessionId, s.sectionIndex);
  const blockStart = (a: (typeof bookings)[number]["asset"], block: string) => (block === "Evening" ? a.eveningStart : block === "Night" ? a.nightStart : a.dayStart) ?? (block === "Evening" ? "15:00" : block === "Night" ? "23:00" : "07:00");
  const occurrences: CalOccurrence[] = [];
  for (const k of keys.values()) {
    const s = sessionById.get(k.sessionId)!;
    const originalDate = dateOf.get(k.cohortId)?.get(k.sessionId) ?? null;
    const mv = moveByKey.get(`${k.cohortId}|${k.sessionId}|${k.sectionIndex}`);
    const date = mv ? isoOf(mv.toDate) : originalDate;
    if (!date || !inWin(date)) continue;
    const from = originalDate ?? (mv ? isoOf(mv.fromDate) : date);
    const mine = bookings.filter((b) => b.cohortId === k.cohortId && b.sessionId === k.sessionId && b.sectionIndex === k.sectionIndex);
    const forSection = patterns.filter((m) => m.cohortId === k.cohortId && m.courseId === s.courseId && m.sectionIndex === k.sectionIndex);
    const pattern = forSection.find((m) => m.dayOfWeek === dowOf(from)) ?? forSection[0] ?? null;
    const head = cohortOf.get(k.cohortId)!;
    const lead = mine[0]?.asset ?? null;
    // The session's own hours, unless the plan or a move put it on another shift block.
    const startTime = mv?.startTime ?? pattern?.startTime ?? s.startTime ?? (mine[0] ? blockStart(mine[0].asset, mine[0].block) : "07:00");
    const lengthHours = pattern?.lengthHours ?? s.lengthHours ?? 8;
    const rows = staff.filter((x) => x.cohortId === k.cohortId && x.sessionId === k.sessionId && x.sectionIndex === k.sectionIndex);
    const myShifts = shifts.filter((x) => x.cohortId === k.cohortId && x.sessionId === k.sessionId && x.sectionIndex === k.sectionIndex);
    const employerId = lead?.employer.id ?? mv?.employer?.id ?? pattern?.employerId ?? null;
    // Who precepts: only people OF the site the shift is at. A preceptor stays with their employer,
    // so an assignment at some other site is not this shift's preceptor and is not shown as one.
    const atSite = (empl: string | null | undefined) => !employerId || empl === employerId;
    const pRows = rows.filter((x) => x.role === "preceptor" && atSite(x.person.employerId));
    const preceptors = [...new Set([...pRows.map((x) => x.person.name), ...myShifts.filter((x) => atSite(x.preceptor?.employerId)).map((x) => x.preceptor?.name).filter((n): n is string => !!n), ...(mv?.staff?.name && (!mv.employer || mv.employer.id === employerId) ? [mv.staff.name] : [])])];
    occurrences.push({
      key: `${k.cohortId}|${k.sessionId}|${k.sectionIndex}`, meetingId: pattern?.id ?? null,
      cohortId: k.cohortId, cohortName: head.cohortName, programId: head.programId, programName: head.programName,
      courseId: s.courseId, courseCode: s.course.code, courseName: s.course.name, sessionTitle: s.title,
      sectionIndex: k.sectionIndex, sectionCount: Math.max(pattern?.sectionCount ?? 1, k.sectionIndex),
      date, dayOfWeek: dowOf(date), originalDate: from, originalDay: dowOf(from), startTime, endTime: toHHMM(Math.round(toMin(startTime) + lengthHours * 60)), lengthHours, block: mine[0]?.block ?? null,
      employerId, employerName: lead?.employer.name ?? mv?.employer?.name ?? pattern?.employerName ?? null,
      assets: [...new Set(mine.map((b) => b.asset.externalId ?? `${b.asset.settingCode}-${b.asset.assetNumber}`))],
      preceptors, instructor: rows.find((x) => x.role !== "preceptor")?.person.name ?? null,
      students: myShifts.map((x) => ({ id: x.studentId, name: x.student.name, preceptor: atSite(x.preceptor?.employerId) ? x.preceptor?.name ?? null : null, status: x.status })),
      moved: date !== from, changedBlock: !!mv?.startTime, source: mine.length ? "plan" : mv ? "move" : "pattern", booked: mine.length > 0,
    });
  }
  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.courseCode?.localeCompare(b.courseCode ?? "") || a.sectionIndex - b.sectionIndex);
  // Who is where, day by day: every site with the students and preceptors on it.
  const roster: CalRosterDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = isoOf(new Date(mondayMs + i * 86400000));
    const todays = occurrences.filter((o) => o.date === date && (o.students.length || o.preceptors.length));
    if (!todays.length) continue;
    const sites = new Map<string, CalRosterDay["sites"][number]>();
    for (const o of todays) {
      // Only a booked (or hand-moved) shift is really AT its site; the rest are waiting for a booking.
      const placed = o.booked || o.source === "move";
      const id = placed ? o.employerId ?? "tbd" : "unbooked";
      const site = sites.get(id) ?? { employerId: placed ? o.employerId : null, name: placed ? o.employerName ?? "site TBD" : "not booked yet — apply a plan or book by hand", students: [], preceptors: [] };
      for (const st of o.students) site.students.push({ name: st.name, cohort: o.cohortName, course: o.courseCode ?? o.courseName, preceptor: st.preceptor ?? o.preceptors[0] ?? null });
      if (placed) for (const p of o.preceptors) if (!site.preceptors.includes(p)) site.preceptors.push(p);
      sites.set(id, site);
    }
    roster.push({ date, dayOfWeek: dowOf(date), sites: [...sites.values()].sort((a, b) => b.students.length - a.students.length || a.name.localeCompare(b.name)) });
  }
  return { occurrences, roster };
}

export async function getMasterCalendar(opts?: { institutionId?: string; weekMs?: number }) {
  const { roomUtilization, seatStartsByGroup, toMin, toHHMM } = await import("./space");
  const WEEK_MS = 7 * 24 * 3600 * 1000;

  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  // Default to the institution that actually has scheduled meetings, so the calendar
  // opens on real data rather than an empty alphabetical-first tenant.
  let institutionId = opts?.institutionId;
  if (!institutionId) {
    const grouped = await prisma.meetingPattern.groupBy({ by: ["cohortId"], _count: true });
    if (grouped.length) {
      const cohortInst = await prisma.cohort.findMany({ where: { id: { in: grouped.map((g) => g.cohortId) } }, select: { id: true, program: { select: { institutionId: true } } } });
      const instOf = new Map(cohortInst.map((c) => [c.id, c.program.institutionId]));
      const counts = new Map<string, number>();
      for (const g of grouped) { const inst = instOf.get(g.cohortId); if (inst) counts.set(inst, (counts.get(inst) ?? 0) + g._count); }
      institutionId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    }
    institutionId = institutionId ?? institutions[0]?.id;
  }
  if (!institutionId) return { institutions, institutionId: null, rooms: [], people: [] as { id: string; name: string; role: string }[], employers: [] as { id: string; name: string; setting: string | null }[], meetings: [] as MasterMeeting[], conflicts: [], conflictGroupCount: 0, weeks: [], currentWeekMs: null, programs: [] as { id: string; name: string }[], summary: { roomed: 0, unroomed: 0, clinical: 0, peakUtil: 0 }, occurrences: [] as CalOccurrence[], roster: [] as CalRosterDay[] };

  const [rooms, calPeople, calEmployers, raw] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, capacity: true, building: true } }),
    prisma.person.findMany({ where: { institutionId, active: true, role: { in: ["instructor", "preceptor", "coordinator"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, employerId: true } }),
    prisma.employer.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, setting: true } }),
    prisma.meetingPattern.findMany({
      where: { cohort: { program: { institutionId } } },
      include: {
        facility: { select: { id: true, name: true, kind: true } },
        employer: { select: { id: true, name: true } },
        staff: { select: { id: true, name: true } },
        course: { select: { id: true, code: true, name: true, term: { select: { index: true, startWeek: true, endWeek: true } }, sessions: { select: { id: true, kind: true, week: true, number: true, title: true, dayOfWeek: true, startTime: true, lengthHours: true, deliveryMode: true, location: true }, orderBy: [{ week: "asc" }, { number: "asc" }] } } },
        cohort: { select: { id: true, name: true, program: { select: { id: true, name: true, family: { select: { name: true } } } }, cohortTerms: { select: { startDate: true, endDate: true, term: { select: { index: true } } } } } },
      },
    }),
  ]);

  // Who staffs a weekly booking: the shift assignments of its course × kind × section (the
  // staffing table's truth), else the booking's own staff field. Loaded once per cohort — an
  // offering can carry thousands of shift assignments, far too many to ship with every pattern.
  const staffRows = await prisma.sessionInstructor.findMany({ where: { cohortId: { in: [...new Set(raw.map((m) => m.cohortId))] } }, select: { cohortId: true, sessionId: true, sectionIndex: true, person: { select: { name: true } } } });
  const staffByCohort = new Map<string, typeof staffRows>();
  for (const a of staffRows) { const l = staffByCohort.get(a.cohortId!) ?? []; l.push(a); staffByCohort.set(a.cohortId!, l); }
  const leadStaffOf = (m: (typeof raw)[number]) => {
    const ids = new Set(m.course.sessions.filter((s) => s.kind === m.kind).map((s) => s.id));
    const counts = new Map<string, number>();
    for (const a of staffByCohort.get(m.cohortId) ?? []) if (a.sectionIndex === m.sectionIndex && ids.has(a.sessionId)) counts.set(a.person.name, (counts.get(a.person.name) ?? 0) + 1);
    const top = [...counts.entries()].sort((x, y) => y[1] - x[1]);
    return top.length ? (top.length > 1 ? `${top[0][0]} +${top.length - 1}` : top[0][0]) : null;
  };

  const dlabel = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const meetings: MasterMeeting[] = raw.map((m) => {
    // Derive placement from the LIVE course→term relation, so re-sequencing the
    // program shifts every calendar (the stored termIndex is only a fallback).
    const liveIdx = m.course.term?.index ?? m.termIndex;
    const liveTw = m.course.term?.startWeek != null && m.course.term?.endWeek != null && m.course.term.endWeek >= m.course.term.startWeek
      ? m.course.term.endWeek - m.course.term.startWeek + 1 : Math.max(1, m.endWeek - m.startWeek + 1);
    const ct = m.cohort.cohortTerms.find((c) => c.term.index === liveIdx);
    const startMs = ct?.startDate ? ct.startDate.getTime() : 0;
    const tw = liveTw;
    const weekStartMs = startMs;
    // A weekly booking recurs until the term's real last day (the semester's end), else the template weeks.
    const weekEndMs = startMs && ct?.endDate ? ct.endDate.getTime() + 24 * 3600 * 1000 : startMs + tw * WEEK_MS;
    const endMin = toMin(m.startTime) + m.lengthHours * 60;
    return {
      id: m.id,
      cohortId: m.cohortId, cohortName: m.cohort.name,
      programId: m.cohort.program.id, programName: m.cohort.program.name, family: m.cohort.program.family?.name ?? null,
      courseId: m.courseId, courseCode: m.course.code, courseName: m.course.name,
      kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
      dayOfWeek: m.dayOfWeek, startTime: m.startTime, endTime: toHHMM(Math.round(endMin)), lengthHours: m.lengthHours,
      facilityId: m.facilityId, facilityName: m.facility?.name ?? null, facilityKind: m.facility?.kind ?? null,
      employerId: m.employerId, employerName: m.employer?.name ?? null,
      staffPersonId: m.staffPersonId, staffName: leadStaffOf(m) ?? m.staff?.name ?? null,
      termIndex: liveIdx, weekStartMs, weekEndMs,
      startLabel: startMs ? dlabel(weekStartMs) : "—", endLabel: startMs ? dlabel(weekEndMs) : "—",
      // Session titles for this meeting's kind — what actually happens in the room/at the site, week by week.
      sessionTitles: m.course.sessions.filter((x) => x.kind === m.kind).map((x) => ({ week: x.week, title: x.title })),
    };
  });

  // Engine inputs.
  const seatStarts = seatStartsByGroup(meetings, (m) => `${m.cohortId}|${m.courseId}|${m.kind}`);
  const bookings = meetings.map((m) => ({
    id: m.id, cohortId: m.cohortId, sectionIndex: m.sectionIndex, kind: m.kind, seats: m.seats, seatStart: seatStarts.get(m.id),
    lengthHours: m.lengthHours, dayOfWeek: m.dayOfWeek as import("./space").Weekday, startMin: toMin(m.startTime),
    weekStartMs: m.weekStartMs, weekEndMs: m.weekEndMs, facilityId: m.facilityId, staffPersonId: m.staffPersonId,
  }));
  const roomUse = roomUtilization(bookings, rooms.map((r) => ({ id: r.id, name: r.name, kind: r.kind, capacity: r.capacity })));
  const roomsOut = roomUse.map((u) => ({ ...u, building: rooms.find((r) => r.id === u.facilityId)?.building ?? null }));

  // Weekly timeline: span of all meetings, weekly steps; default to the week of today.
  const starts = meetings.map((m) => m.weekStartMs).filter(Boolean);
  const ends = meetings.map((m) => m.weekEndMs).filter(Boolean);
  const weeks: { ms: number; label: string }[] = [];
  let currentWeekMs: number | null = null;
  if (starts.length) {
    const mondayOf = (ms: number) => { const d = new Date(ms); const day = (d.getUTCDay() + 6) % 7; return ms - day * 24 * 3600 * 1000; };
    const lo = mondayOf(Math.min(...starts));
    const hi = mondayOf(Math.max(...ends));
    for (let w = lo; w <= hi; w += WEEK_MS) weeks.push({ ms: w, label: dlabel(w) });
    const todayMonday = mondayOf(Date.now());
    currentWeekMs = opts?.weekMs ?? (todayMonday >= lo && todayMonday <= hi ? todayMonday : weeks[Math.floor(weeks.length / 2)]?.ms ?? lo);
  }

  const programs = [...new Map(meetings.map((m) => [m.programId, m.programName])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  const summary = {
    roomed: meetings.filter((m) => m.facilityId).length,
    unroomed: meetings.filter((m) => !m.facilityId && m.kind !== "CLINICAL").length,
    clinical: meetings.filter((m) => m.kind === "CLINICAL").length,
    peakUtil: roomsOut.reduce((n, r) => Math.max(n, r.utilization), 0),
  };

  // The displayed week's clinical shifts as they actually happen (the plan, moves, staffing, students).
  const week = currentWeekMs != null ? await weekClinicalOccurrences(meetings, currentWeekMs) : { occurrences: [] as CalOccurrence[], roster: [] as CalRosterDay[] };
  // Conflicts on the dates things happen this week: each weekly booking's session on its resolved
  // weekday (resolveSessionDay), after per-date moves — reported as pairs for highlighting and
  // counted as groups (three sections in one room at 09:00 are one conflict).
  const { detectDatedConflicts, conflictGroups } = await import("./space");
  let conflicts: import("./space").DatedConflict[] = [];
  let conflictGroupCount = 0;
  if (currentWeekMs != null) {
    const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const monday = new Date(currentWeekMs).toISOString().slice(0, 10);
    const dateOfDay = (day: string) => new Date(currentWeekMs! + DOW.indexOf(day) * 86400000).toISOString().slice(0, 10);
    const sunday = dateOfDay("Sun");
    const cohortIds = [...new Set(raw.map((m) => m.cohortId))];
    const moves = cohortIds.length ? await prisma.shiftMove.findMany({ where: { cohortId: { in: cohortIds }, OR: [{ fromDate: { gte: new Date(monday + "T00:00:00Z"), lte: new Date(sunday + "T00:00:00Z") } }, { toDate: { gte: new Date(monday + "T00:00:00Z"), lte: new Date(sunday + "T00:00:00Z") } }] }, select: { cohortId: true, sessionId: true, sectionIndex: true, fromDate: true, toDate: true, startTime: true, facilityId: true, staffPersonId: true } }) : [];
    const moveByKey = new Map(moves.map((m) => [`${m.cohortId}|${m.sessionId}|${m.sectionIndex}|${m.fromDate.toISOString().slice(0, 10)}`, m]));
    const rawById = new Map(raw.map((m) => [m.id, m]));
    const dated: import("./space").DatedBooking[] = [];
    const seen = new Set<string>();
    // The holiday rule (lib/holidayrule): a session on a holiday is held on the week's open day the rule picks.
    const instRow = await prisma.institution.findUnique({ where: { id: institutionId }, select: { holidayRule: true, academicEvents: { where: { kind: "holiday" }, select: { date: true, endDate: true, label: true, kind: true } } } });
    const { holidayMap: hm } = await import("./academiccalendar");
    const calHolidays = hm((instRow?.academicEvents ?? []).map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind })));
    const calRule: HolidayRule = isHolidayRule(instRow?.holidayRule) ? instRow.holidayRule : DEFAULT_HOLIDAY_RULE;
    for (const m of meetings) {
      if (!m.weekStartMs || !(m.weekStartMs <= currentWeekMs && currentWeekMs < m.weekEndMs)) continue;
      const r = rawById.get(m.id); if (!r) continue;
      const weekOfTerm = weekOfDate({ termStart: new Date(m.weekStartMs), holidays: calHolidays }, new Date(currentWeekMs)); // week 1 = the calendar week containing the term's first day; a closed week is no week
      if (weekOfTerm == null) continue;
      const patterns = raw.filter((x) => x.cohortId === m.cohortId && x.courseId === m.courseId && x.kind === m.kind && x.sectionIndex === m.sectionIndex).map((x) => ({ dayOfWeek: x.dayOfWeek }));
      const kindSessions = r.course.sessions.filter((x) => x.kind === m.kind);
      const sessionDays = kindSessions.map((x) => x.dayOfWeek).filter((d): d is string => !!d);
      for (const sess of kindSessions.filter((x) => (x.week ?? 1) === weekOfTerm)) {
        const online = isOnlineSession(sess.deliveryMode, sess.location);
        const day = resolveSessionDay(sess.dayOfWeek, online, patterns, sessionDays);
        if (!day || day !== m.dayOfWeek) continue; // this booking hosts the session only on its own day
        const originIso = dateOfDay(day);
        const mv = moveByKey.get(`${m.cohortId}|${sess.id}|${m.sectionIndex}|${originIso}`);
        // Sibling sessions of the same kind this week hold their days; the rule moves a holiday session onto a free one.
        const siblings = new Set(kindSessions.filter((x) => x.id !== sess.id && (x.week ?? 1) === weekOfTerm && x.dayOfWeek).map((x) => dateOfDay(resolveSessionDay(x.dayOfWeek, isOnlineSession(x.deliveryMode, x.location), patterns, sessionDays) ?? x.dayOfWeek!)));
        const heldIso = resolveHolidays([originIso], calHolidays, calRule)[0]?.dateIso ?? originIso;
        const ruledIso = siblings.has(heldIso) && heldIso !== originIso ? originIso : heldIso;
        const dateIso = mv ? mv.toDate.toISOString().slice(0, 10) : ruledIso;
        if (dateIso < monday || dateIso > sunday) continue; // moved out of this week
        const key = `${m.id}|${sess.id}`; if (seen.has(key)) continue; seen.add(key);
        dated.push({ id: m.id, cohortId: m.cohortId, sectionIndex: m.sectionIndex, kind: m.kind, seats: m.seats, seatStart: seatStarts.get(m.id), lengthHours: sess.lengthHours ?? m.lengthHours, dayOfWeek: DOW[(new Date(dateIso + "T00:00:00Z").getUTCDay() + 6) % 7] as import("./space").Weekday, startMin: toMin(mv?.startTime ?? sess.startTime ?? m.startTime), dateIso, facilityId: mv?.facilityId ?? m.facilityId, staffPersonId: mv?.staffPersonId ?? m.staffPersonId });
      }
    }
    // Shifts moved INTO this week from another week.
    for (const mv of moves) {
      const toIso = mv.toDate.toISOString().slice(0, 10); const fromIso = mv.fromDate.toISOString().slice(0, 10);
      if (toIso < monday || toIso > sunday || (fromIso >= monday && fromIso <= sunday)) continue;
      const pattern = raw.find((x) => x.cohortId === mv.cohortId && x.sectionIndex === mv.sectionIndex && x.course.sessions.some((s) => s.id === mv.sessionId));
      const sess = pattern?.course.sessions.find((s) => s.id === mv.sessionId); if (!pattern || !sess) continue;
      const m = meetings.find((x) => x.id === pattern.id)!;
      dated.push({ id: m.id, cohortId: m.cohortId, sectionIndex: m.sectionIndex, kind: m.kind, seats: m.seats, seatStart: seatStarts.get(m.id), lengthHours: sess.lengthHours ?? m.lengthHours, dayOfWeek: DOW[(new Date(toIso + "T00:00:00Z").getUTCDay() + 6) % 7] as import("./space").Weekday, startMin: toMin(mv.startTime ?? sess.startTime ?? m.startTime), dateIso: toIso, facilityId: mv.facilityId ?? m.facilityId, staffPersonId: mv.staffPersonId ?? m.staffPersonId });
    }
    conflicts = detectDatedConflicts(dated);
    conflictGroupCount = conflictGroups(conflicts).length;
  }
  return { institutions, institutionId, rooms: roomsOut, people: calPeople, employers: calEmployers, meetings, conflicts, conflictGroupCount, weeks, currentWeekMs, programs, summary, occurrences: week.occurrences, roster: week.roster };
}

/** One meeting's full editing context (for the move/reassign editor). */
export async function getMeetingForEdit(meetingId: string) {
  const m = await prisma.meetingPattern.findUnique({
    where: { id: meetingId },
    include: { cohort: { select: { program: { select: { institutionId: true } } } } },
  });
  if (!m) return null;
  const facilities = await prisma.facility.findMany({ where: { institutionId: m.cohort.program.institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, capacity: true } });
  return { meeting: m, facilities };
}

/** One offering's real bookings (MeetingPattern), grouped for the offering page:
 *  sections-by-course (room + staff + day/time), a staffing rollup, and the
 *  institution rooms — the same data the master calendar shows, scoped to a cohort,
 *  with cross-cohort room conflicts flagged. */
export async function getCohortSchedule(cohortId: string) {
  const { detectConflicts, seatStartsByGroup, toMin, toHHMM } = await import("./space");
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: { id: true, name: true, program: { select: { id: true, name: true, institutionId: true } }, cohortTerms: { select: { startDate: true, endDate: true, term: { select: { index: true, name: true } } } } },
  });
  if (!cohort) return null;
  const institutionId = cohort.program.institutionId;
  const [rooms, people, mine, instMeetings] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, capacity: true } }),
    prisma.person.findMany({ where: { institutionId, active: true, role: { in: ["instructor", "preceptor", "coordinator"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, employerId: true } }),
    prisma.meetingPattern.findMany({ where: { cohortId }, include: { facility: { select: { name: true, kind: true } }, employer: { select: { id: true, name: true } }, staff: { select: { id: true, name: true } }, course: { select: { id: true, code: true, name: true, term: { select: { index: true, name: true } } } } } }),
    prisma.meetingPattern.findMany({ where: { cohort: { program: { institutionId } } }, select: { id: true, cohortId: true, courseId: true, sectionIndex: true, kind: true, seats: true, lengthHours: true, dayOfWeek: true, startTime: true, termIndex: true, startWeek: true, endWeek: true, facilityId: true, staffPersonId: true, course: { select: { term: { select: { index: true, startWeek: true, endWeek: true } } } }, cohort: { select: { cohortTerms: { select: { startDate: true, endDate: true, term: { select: { index: true } } } } } } } }),
  ]);

  const winOf = (cohortTerms: { startDate: Date | null; endDate: Date | null; term: { index: number } }[], termIndex: number, startWeek: number, endWeek: number) => {
    const ct = cohortTerms.find((c) => c.term.index === termIndex);
    const s = ct?.startDate ? ct.startDate.getTime() : 0;
    return { weekStartMs: s, weekEndMs: s && ct?.endDate ? ct.endDate.getTime() + 24 * 3600 * 1000 : s + Math.max(1, endWeek - startWeek + 1) * WEEK_MS };
  };
  // Institution-wide bookings → conflicts; keep only those touching this cohort.
  const instSeatStarts = seatStartsByGroup(instMeetings, (m) => `${m.cohortId}|${m.courseId}|${m.kind}`);
  const bookings = instMeetings.map((m) => ({ id: m.id, cohortId: m.cohortId, sectionIndex: m.sectionIndex, kind: m.kind, seats: m.seats, seatStart: instSeatStarts.get(m.id), lengthHours: m.lengthHours, dayOfWeek: m.dayOfWeek as import("./space").Weekday, startMin: toMin(m.startTime), ...winOf(m.cohort.cohortTerms, m.course.term?.index ?? m.termIndex, m.course.term?.startWeek ?? m.startWeek, m.course.term?.endWeek ?? m.endWeek), facilityId: m.facilityId, staffPersonId: m.staffPersonId }));
  const conflicts = detectConflicts(bookings).filter((c) => { const a = instMeetings.find((m) => m.id === c.aId), b = instMeetings.find((m) => m.id === c.bId); return a?.cohortId === cohortId || b?.cohortId === cohortId; });
  const conflictIds = new Set<string>();
  for (const c of conflicts) { if (instMeetings.find((m) => m.id === c.aId)?.cohortId === cohortId) conflictIds.add(c.aId); if (instMeetings.find((m) => m.id === c.bId)?.cohortId === cohortId) conflictIds.add(c.bId); }

  const meetings = mine.map((m) => {
    // Live course→term relation drives placement, so structure edits propagate.
    const liveIdx = m.course.term.index;
    const w = winOf(cohort.cohortTerms, liveIdx, m.startWeek, m.endWeek);
    return {
      id: m.id, courseId: m.courseId, courseCode: m.course.code, courseName: m.course.name,
      termIndex: liveIdx, termName: m.course.term.name,
      kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
      dayOfWeek: m.dayOfWeek, startTime: m.startTime, endTime: toHHMM(toMin(m.startTime) + m.lengthHours * 60), lengthHours: m.lengthHours,
      facilityId: m.facilityId, facilityName: m.facility?.name ?? null, facilityKind: m.facility?.kind ?? null,
      employerId: m.employerId, employerName: m.employer?.name ?? null,
      staffPersonId: m.staffPersonId, staffName: m.staff?.name ?? null,
      weekStartMs: w.weekStartMs, weekEndMs: w.weekEndMs,
      conflict: conflictIds.has(m.id),
    };
  });
  return { cohort, rooms, people, meetings, conflictCount: conflicts.length };
}

// ---------------------------------------------------------------------------
// CROSS-PROGRAM COURSE DEMAND — when several programs need the same course, how
// big does it really need to be, where is the demand coming from, and who's in it.
// ---------------------------------------------------------------------------

export interface CourseDemandRow {
  code: string;
  name: string;
  totalStudents: number;
  programs: { programId: string; programName: string; family: string | null; students: number; cohorts: number }[];
  sectionsScheduled: number;
  seatsScheduled: number;
  typicalCap: number;
  sectionsNeeded: number;
}

/** Group every course by catalog code across the institution; for shared courses,
 *  pool the live enrolled-student demand by program, compare it to the seats
 *  currently scheduled, and size how many sections are really needed. */
export async function getCourseDemand(opts?: { institutionId?: string }) {
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  let institutionId = opts?.institutionId;
  if (!institutionId) {
    // Default to the workspace's working college (the one carrying the students).
    institutionId = (await defaultInstitution())?.id ?? institutions[0]?.id;
  }
  if (!institutionId) return { institutions, institutionId: null, rows: [] as CourseDemandRow[] };

  // Courses (by code) → which programs require them.
  const courses = await prisma.course.findMany({
    where: { code: { not: null }, term: { program: { institutionId } } },
    select: { code: true, name: true, term: { select: { program: { select: { id: true, name: true, family: { select: { name: true } } } } } } },
  });
  // Live enrolled-student demand per program (students currently in-program).
  const enrolledByProgram = new Map<string, number>();
  const grouped = await prisma.student.groupBy({ by: ["programId"], where: { program: { institutionId }, status: "enrolled" }, _count: true });
  for (const g of grouped) enrolledByProgram.set(g.programId, g._count);
  const cohortsByProgram = new Map<string, number>();
  const todayIsoCd = new Date().toISOString().slice(0, 10);
  // Live demand: the offerings in session today (a term spanning today), whatever their status label.
  const cg = await prisma.cohort.groupBy({ by: ["programId"], where: { program: { institutionId }, ...NOT_ARCHIVED, cohortTerms: { some: { startDate: { lte: new Date(todayIsoCd + "T00:00:00Z") }, endDate: { gte: new Date(todayIsoCd + "T00:00:00Z") } } } }, _count: true });
  for (const g of cg) cohortsByProgram.set(g.programId, g._count);

  // Scheduled CLASS sections per course code (from the master bookings).
  const meetings = await prisma.meetingPattern.findMany({ where: { kind: "CLASS", cohort: { program: { institutionId } } }, select: { seats: true, cohortId: true, courseId: true, sectionIndex: true, course: { select: { code: true } } } });
  const schedByCode = new Map<string, { sections: number; seats: number }>();
  const seenSection = new Set<string>();
  for (const m of meetings) { const code = m.course.code; if (!code) continue; const sk = `${m.cohortId}|${m.courseId}|${m.sectionIndex}`; if (seenSection.has(sk)) continue; seenSection.add(sk); const e = schedByCode.get(code) ?? { sections: 0, seats: 0 }; e.sections += 1; e.seats += m.seats; schedByCode.set(code, e); }

  // Build per-code rows.
  const byCode = new Map<string, { name: string; programs: Map<string, { programName: string; family: string | null }> }>();
  for (const c of courses) {
    const code = c.code!;
    const e = byCode.get(code) ?? { name: c.name, programs: new Map() };
    e.programs.set(c.term.program.id, { programName: c.term.program.name, family: c.term.program.family?.name ?? null });
    byCode.set(code, e);
  }
  const TYPICAL_CAP = 30;
  const rows: CourseDemandRow[] = [...byCode.entries()].map(([code, e]) => {
    const programs = [...e.programs.entries()].map(([programId, p]) => ({ programId, programName: p.programName, family: p.family, students: enrolledByProgram.get(programId) ?? 0, cohorts: cohortsByProgram.get(programId) ?? 0 }))
      .sort((a, b) => b.students - a.students);
    const totalStudents = programs.reduce((n, p) => n + p.students, 0);
    const sched = schedByCode.get(code) ?? { sections: 0, seats: 0 };
    return { code, name: e.name, totalStudents, programs, sectionsScheduled: sched.sections, seatsScheduled: sched.seats, typicalCap: TYPICAL_CAP, sectionsNeeded: Math.max(1, Math.ceil(totalStudents / TYPICAL_CAP)) };
  }).filter((r) => r.programs.length > 1) // cross-program courses only
    .sort((a, b) => b.programs.length - a.programs.length || b.totalStudents - a.totalStudents);

  return { institutions, institutionId, rows };
}

/** The actual enrolled students driving demand for a shared course (drill-down). */
export async function getCourseDemandStudents(code: string, institutionId: string) {
  const programIds = (await prisma.course.findMany({ where: { code, term: { program: { institutionId } } }, select: { term: { select: { programId: true } } } })).map((c) => c.term.programId);
  const students = await prisma.student.findMany({
    where: { programId: { in: programIds }, status: "enrolled" },
    orderBy: [{ program: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, program: { select: { id: true, name: true } }, cohort: { select: { name: true } } },
  });
  return students;
}

// ---------------------------------------------------------------------------
// ALIGNMENT ENGINE — intake profiles, computed positioning, cohort rollup
// ---------------------------------------------------------------------------

/** A subject's alignment profiles (all checkpoints) + identity context. */
export async function getAlignmentSubject(kind: "student" | "employer", id: string) {
  if (kind === "student") {
    const student = await prisma.student.findUnique({
      where: { id },
      select: {
        id: true, name: true, status: true,
        program: { select: { id: true, name: true, family: { select: { id: true, name: true } } } },
        cohort: { select: { id: true, name: true } },
        alignmentProfiles: { orderBy: { capturedAt: "asc" }, include: { tags: true } },
      },
    });
    return student ? { kind, subject: student, profiles: student.alignmentProfiles } : null;
  }
  const employer = await prisma.employer.findUnique({
    where: { id },
    select: {
      id: true, name: true, setting: true, status: true,
      institution: { select: { id: true, name: true } },
      alignmentProfiles: { orderBy: { capturedAt: "asc" }, include: { tags: true } },
    },
  });
  return employer ? { kind, subject: employer, profiles: employer.alignmentProfiles } : null;
}

/** Family-scoped WBL design studio: every profiled learner in the family's
 *  programs + every profiled employer at the institution, with tags — the engine
 *  computes the rollup, pairings, and asks client/server-side from these. */
export async function getFamilyAlignment(familyId: string) {
  const family = await prisma.programFamily.findUnique({
    where: { id: familyId },
    select: { id: true, name: true, institutionId: true, institution: { select: { name: true } }, programs: { select: { id: true, name: true } } },
  });
  if (!family) return null;
  const programIds = family.programs.map((p) => p.id);
  const [learnerProfiles, employerProfiles, employers] = await Promise.all([
    prisma.alignmentProfile.findMany({
      where: { subjectType: "LEARNER", checkpoint: "P0", student: { programId: { in: programIds } } },
      include: { tags: true, student: { select: { id: true, name: true, status: true, cohort: { select: { name: true } } } } },
      orderBy: { capturedAt: "asc" },
    }),
    prisma.alignmentProfile.findMany({
      where: { subjectType: "EMPLOYER", checkpoint: "P0", employer: { institutionId: family.institutionId } },
      include: { tags: true, employer: { select: { id: true, name: true, setting: true, status: true } } },
      orderBy: { capturedAt: "asc" },
    }),
    prisma.employer.findMany({ where: { institutionId: family.institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  // Learners in the family without a profile yet (intake worklist).
  const unprofiled = await prisma.student.findMany({
    where: { programId: { in: programIds }, status: { in: ["enrolled", "admitted", "applicant"] }, alignmentProfiles: { none: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, cohort: { select: { name: true } } },
    take: 40,
  });
  return { family, learnerProfiles, employerProfiles, employers, unprofiled };
}


// ---------------------------------------------------------------------------
// ACTION CENTER — the connective organ. Every gap the data can see, expressed
// as a work item with a deep link to the surface that fixes it. This is what
// makes the platform actionable instead of a set of pages.
// ---------------------------------------------------------------------------

export interface ActionItem {
  severity: "red" | "amber" | "info";
  kind: string;
  family: string | null;
  title: string;
  detail: string;
  href: string;
}

export async function getActionQueue(): Promise<ActionItem[]> {
  const { detectConflicts, seatStartsByGroup, toMin } = await import("./space");
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const today = new Date();
  const nowYear = today.getUTCFullYear();
  const items: ActionItem[] = [];

  const families = await prisma.programFamily.findMany({
    include: {
      programs: {
        include: {
          yearTargets: true,
          cohorts: { include: { students: { select: { status: true } }, cohortTerms: { select: { startDate: true, term: { select: { index: true } } } }, _count: { select: { students: true } } } },
        },
      },
    },
  });
  const RANK: Record<string, number> = { prospect: 0, applicant: 1, admitted: 2, enrolled: 3, completed: 4, licensed: 5, placed: 6, productive: 7 };
  const gradYearOf = (name: string): number => classYearOf(name) ?? 0;

  for (const fam of families) {
    // 1) GOAL GAP — this year's goal vs live placed across cohorts graduating now.
    const goalNow = fam.programs.reduce((n, p) => n + (p.yearTargets.find((t) => t.year === nowYear)?.credentialTarget ?? 0), 0);
    if (goalNow > 0) {
      const placedNow = fam.programs.reduce((n, p) => n + p.cohorts.filter((c) => gradYearOf(c.name) === nowYear).reduce((m, c) => m + c.students.filter((s) => (RANK[s.status] ?? -1) >= 6).length, 0), 0);
      if (placedNow < goalNow) {
        items.push({ severity: placedNow < goalNow * 0.5 ? "red" : "amber", kind: "goal-gap", family: fam.name, title: `${nowYear} goal at risk: ${placedNow} placed of ${goalNow}`, detail: `The ${nowYear} North-Star goal is ${goalNow} placed; live student data shows ${placedNow}. Work the graduating cohorts and placement pipeline.`, href: "/goals" });
      }
    }
    // 2) RECRUITING SHORTFALL — recruiting cohorts under seat target.
    for (const p of fam.programs) {
      for (const c of p.cohorts) {
        const start = c.cohortTerms.find((ct) => ct.term.index === 1)?.startDate ?? null;
        if (!start || start <= today) continue;
        const seats = Math.round(c.plannedSeats ?? p.defaultCohortSeats ?? 0);
        const admitted = c.students.filter((s) => (RANK[s.status] ?? -1) >= 2).length;
        if (seats > 0 && admitted < seats * 0.8) {
          items.push({ severity: admitted < seats * 0.5 ? "red" : "amber", kind: "recruiting", family: fam.name, title: `${c.name} recruiting behind: ${admitted} admitted of ${seats} seats`, detail: `Starts ${start.toLocaleDateString(undefined, { month: "short", year: "numeric" })}. Interventions targeting qualified/enrolled are the lever.`, href: "/programs" });
        }
      }
    }
    // 3) NO NEXT LAUNCH — nothing recruiting or planned after the newest running cohort.
    const anyFuture = fam.programs.some((p) => p.cohorts.some((c) => { const s = c.cohortTerms.find((ct) => ct.term.index === 1)?.startDate; return s && s > today; }));
    const anyActive = fam.programs.some((p) => p.cohorts.length > 0);
    if (anyActive && !anyFuture) {
      items.push({ severity: "amber", kind: "no-next-launch", family: fam.name, title: "No next cohort scheduled", detail: "Every instantiation has already started — there is no future intake on the calendar. Plan the next launch.", href: "/programs" });
    }
  }

  // 4) SCHEDULE HEALTH — unstaffed / unroomed / conflicting bookings (live weeks only).
  const meetings = await prisma.meetingPattern.findMany({
    include: { cohort: { select: { name: true, program: { select: { id: true, name: true, family: { select: { name: true } } } }, cohortTerms: { select: { startDate: true, endDate: true, term: { select: { index: true } } } } } } },
  });
  const live = meetings.map((m) => {
    const ct = m.cohort.cohortTerms.find((c) => c.term.index === m.termIndex);
    const s = ct?.startDate ? ct.startDate.getTime() : 0;
    return { m, weekStartMs: s, weekEndMs: s && ct?.endDate ? ct.endDate.getTime() + 24 * 3600 * 1000 : s + Math.max(1, m.endWeek - m.startWeek + 1) * WEEK_MS };
  }).filter((x) => x.weekStartMs && x.weekEndMs > today.getTime());
  const unstaffed = live.filter((x) => !x.m.staffPersonId);
  if (unstaffed.length) {
    const fams = [...new Set(unstaffed.map((x) => x.m.cohort.program.family?.name ?? x.m.cohort.program.name))].join(", ");
    items.push({ severity: "red", kind: "unstaffed", family: null, title: `${unstaffed.length} current/upcoming meetings have no instructor`, detail: `Across ${fams}. Assign staff from each offering's schedule panel.`, href: `/programs/${unstaffed[0].m.cohort.program.id}/offerings/${unstaffed[0].m.cohortId}`
    });
  }
  const unroomed = live.filter((x) => !x.m.facilityId && x.m.kind !== "CLINICAL");
  if (unroomed.length) items.push({ severity: "amber", kind: "unroomed", family: null, title: `${unroomed.length} campus meetings have no room`, detail: "Space pressure — resolve on the master calendar (idle rooms are visible in the utilization rail).", href: "/calendar" });
  const liveSeatStarts = seatStartsByGroup(live.map((x) => x.m), (m) => `${m.cohortId}|${m.courseId}|${m.kind}`);
  const conflicts = detectConflicts(live.map((x) => ({ id: x.m.id, cohortId: x.m.cohortId, sectionIndex: x.m.sectionIndex, kind: x.m.kind, seats: x.m.seats, seatStart: liveSeatStarts.get(x.m.id), lengthHours: x.m.lengthHours, dayOfWeek: x.m.dayOfWeek as import("./space").Weekday, startMin: toMin(x.m.startTime), weekStartMs: x.weekStartMs, weekEndMs: x.weekEndMs, facilityId: x.m.facilityId, staffPersonId: x.m.staffPersonId })));
  if (conflicts.length) items.push({ severity: "red", kind: "conflicts", family: null, title: `${conflicts.length} scheduling conflicts on live weeks`, detail: `${conflicts.filter((c) => c.kind === "room").length} room · ${conflicts.filter((c) => c.kind === "staff").length} staff · ${conflicts.filter((c) => c.kind === "section").length} section double-bookings.`, href: "/calendar" });

  // 5) ASKS AWAITING PARTNER CONFIRMATION — planned placements sitting unconfirmed.
  const pendingAsks = await prisma.wblPlacement.groupBy({ by: ["employerId"], where: { status: "planned" }, _count: true });
  if (pendingAsks.length) {
    const emps = await prisma.employer.findMany({ where: { id: { in: pendingAsks.map((a) => a.employerId) } }, select: { id: true, name: true } });
    for (const a of pendingAsks) {
      const e = emps.find((x) => x.id === a.employerId);
      if (e) items.push({ severity: "info", kind: "ask-pending", family: null, title: `${a._count} placement ask${a._count === 1 ? "" : "s"} awaiting ${e.name}`, detail: "Planned placements the partner hasn't confirmed. Confirming (→ active) is what makes them secured.", href: `/employers/${a.employerId}` });
    }
  }

  // 6) INTAKE COVERAGE — enrolled learners in started cohorts without an alignment intake.
  const noIntake = await prisma.student.count({ where: { status: "enrolled", alignmentProfiles: { none: {} }, cohort: { startDate: { lte: today } } } });
  if (noIntake > 0) {
    const firstFam = families[0];
    items.push({ severity: "info", kind: "intake", family: null, title: `${noIntake} enrolled learners have no alignment intake`, detail: "Placement design runs on intake profiles — motivations, constraints, capacities. Work the intake worklist.", href: "/students" });
  }

  const order = { red: 0, amber: 1, info: 2 } as const;
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** This offering's WBL operations: every placement for the cohort's students —
 *  real learner × partner records with status. Empty until the cohort has data. */
export async function getCohortPlacements(cohortId: string) {
  return prisma.wblPlacement.findMany({
    where: { OR: [{ cohortId }, { student: { cohortId } }] },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      student: { select: { id: true, name: true } },
      employer: { select: { id: true, name: true } },
      term: { select: { name: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// CLINICAL CAPACITY MODEL — the workbook's calendar layer, from live data
// ---------------------------------------------------------------------------

/** Everything the capacity insights (instructors & preceptors needed · clinical
 *  sites · daily coverage) need: every offering's dated template expansion
 *  inputs. Per-term enrollment comes from the same backward derivation the
 *  analytics page uses (the cohort's North-Star goal through the family's goal
 *  plan rates), so all surfaces agree on the numbers. */
/** The id the Insights pages use for every college at once. */
export const ALL_INSTITUTIONS = "all";

/** The capacity model is read several times per request (a page and its scope bridge): one computation per request (Phase 8). */
// React's cache keys object arguments by identity, so the memo is keyed on the primitives — every caller passes a fresh literal.
const capacityModelByKey = cache((institutionId: string | null, cohortId: string | null) => getCapacityModelUncached({ institutionId: institutionId ?? undefined, cohortId: cohortId ?? undefined }));
export const getCapacityModel = (opts?: { institutionId?: string; cohortId?: string }) => capacityModelByKey(opts?.institutionId ?? null, opts?.cohortId ?? null);
async function getCapacityModelUncached(opts?: { institutionId?: string; cohortId?: string }) {
  // Which institution: the one asked for, the one an offering belongs to, or —
  // with no hint — the one that actually has offerings running (not the
  // alphabetically first college in the workspace). "all" reads every college together.
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  let wantedId = opts?.institutionId ?? null;
  if (wantedId === ALL_INSTITUTIONS) {
    const parts = await Promise.all(institutions.map((i) => capacityModelFor(i)));
    return {
      institution: { id: ALL_INSTITUTIONS, name: "All colleges" }, institutions,
      cohorts: parts.flatMap((p) => p.cohorts), clinicalSites: parts.flatMap((p) => p.clinicalSites), rooms: parts.flatMap((p) => p.rooms), people: parts.flatMap((p) => p.people),
    };
  }
  if (!wantedId && opts?.cohortId) wantedId = (await prisma.cohort.findUnique({ where: { id: opts.cohortId }, select: { program: { select: { institutionId: true } } } }))?.program.institutionId ?? null;
  let institution = institutions.find((i) => i.id === wantedId);
  if (!institution) institution = (await defaultInstitution()) ?? institutions[0];
  if (!institution) return null;
  return { institution, institutions, ...(await capacityModelFor(institution)) };
}

/** One college's offerings as the capacity model reads them, with its sites, rooms and people. */
async function capacityModelFor(institution: { id: string; name: string }) {
  const { deriveCohortTargets, thinTerms } = await import("./pipeline");
  const { BENCHMARK_RATES } = await import("./northstar");

  // The institution's coded holidays & breaks (imported academic calendar) —
  // every dated session checks against these before the U.S. defaults.
  const { holidayMap } = await import("./academiccalendar");
  const holidays = holidayMap((await prisma.academicEvent.findMany({ where: { institutionId: institution.id, kind: "holiday" }, select: { date: true, endDate: true, label: true, kind: true } }))
    .map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind })));
  // The college's holiday rule (lib/holidayrule): how a session that lands on one of those days moves.
  const instRow = await prisma.institution.findUnique({ where: { id: institution.id }, select: { holidayRule: true, springStart: true, summerStart: true, fallStart: true } });
  const holidayRuleRaw = instRow?.holidayRule;
  const holidayRule: HolidayRule = isHolidayRule(holidayRuleRaw) ? holidayRuleRaw : DEFAULT_HOLIDAY_RULE;
  // The college's semester anchors: the boards bucket each week by the calendar semester its date falls in.
  const anchors = { springStart: instRow?.springStart ?? "01-08", summerStart: instRow?.summerStart ?? "05-28", fallStart: instRow?.fallStart ?? "08-15" };

  const programs = await prisma.program.findMany({
    // Every offering that is a record — planned, running or graduated (lib/cohortscope): a graduated class is history
    // on the same calendar, and each forward-looking page narrows by date, never by status.
    where: { institutionId: institution.id, cohorts: { some: NOT_ARCHIVED } },
    include: {
      family: { select: { id: true, name: true, goalPlan: true } },
      terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: true } } } },
      cohorts: {
        where: NOT_ARCHIVED,
        orderBy: { name: "asc" },
        include: {
          stages: true,
          cohortTerms: { select: { termId: true, startDate: true, endDate: true } },
          sessionOverrides: true,
          courseDates: { select: { courseId: true, startDate: true, endDate: true } },
          meetings: { select: { id: true, courseId: true, kind: true, sectionIndex: true, sectionCount: true, seats: true, dayOfWeek: true, startTime: true, lengthHours: true, termIndex: true, facilityId: true, employerId: true, unitId: true, staffPersonId: true, facility: { select: { name: true } }, employer: { select: { name: true } }, unit: { select: { unitType: true } }, staff: { select: { name: true } } }, orderBy: { sectionIndex: "asc" as const } },
          shiftMoves: { select: { note: true, sessionId: true, sectionIndex: true, fromDate: true, toDate: true, startTime: true, facilityId: true, employerId: true, staffPersonId: true, facility: { select: { name: true } }, employer: { select: { name: true } }, staff: { select: { name: true } } } },
          sessionStaff: { select: { sessionId: true, sectionIndex: true, role: true, person: { select: { id: true, name: true } } } },
          _count: { select: { students: true } },
          // The named roster: students on the offering who have not withdrawn. Once they exist they ARE the demand, whatever the target said.
          students: { where: { status: { notIn: ["withdrawn"] } }, select: { id: true } },
        },
      },
    },
  });

  const cohorts = programs.flatMap((p) => {
    // Rates: the family's saved goal plan, else benchmarks.
    let rates = { ...BENCHMARK_RATES };
    if (p.family?.goalPlan) {
      try {
        const saved = JSON.parse(p.family.goalPlan) as { goal?: Partial<typeof BENCHMARK_RATES> };
        if (saved.goal) rates = { ...rates, ...saved.goal };
      } catch { /* benchmarks */ }
    }
    const orderedTerms = [...p.terms].sort((a, b) => a.index - b.index);
    return p.cohorts.map((co) => {
      const productiveGoal = co.stages.find((s) => s.stageKey === "productive")?.targetNumber ?? 0;
      const enrolledTarget = co.stages.find((s) => s.stageKey === "enrolled")?.targetNumber ?? null;
      const fallbackSeats = enrolledTarget ?? co.plannedSeats ?? p.defaultCohortSeats ?? co._count.students ?? 24;
      // Cohort-specific plan (rates + term overrides) beats the family defaults.
      let coRates = rates;
      let termOverrides: (number | null)[] = [];
      if (co.pipelineRates) {
        try {
          const saved = JSON.parse(co.pipelineRates) as { rates?: Partial<typeof BENCHMARK_RATES>; termOverrides?: (number | null)[] };
          if (saved.rates) coRates = { ...rates, ...saved.rates };
          if (saved.termOverrides) termOverrides = saved.termOverrides;
        } catch { /* family defaults */ }
      }
      // Term 1 is the enrollment the offering actually plans (its enrolled target or planned seats), thinned by the
      // family's completion rate; only an offering with no planned seats falls back to the seats its productive goal implies.
      const seatsPlanned = enrolledTarget ?? co.plannedSeats ?? null;
      const derived = seatsPlanned != null && seatsPlanned > 0
        ? thinTerms(Number(seatsPlanned), coRates.completionRate, Math.max(1, orderedTerms.length))
        : productiveGoal > 0
          ? deriveCohortTargets(productiveGoal, coRates, Math.max(1, orderedTerms.length)).terms
          : orderedTerms.map(() => Number(fallbackSeats));
      // A term's seats are its target (thinned by the completion rate, or overridden) — but never fewer than the
      // students actually on the roster today: a named student needs a seat in every term they are still in, and the
      // scheduler, the capacity view and the site-load page all count the same people. Attrition shows up as withdrawals.
      const onRoster = co.students.length;
      const enrollmentByTerm: Record<number, number> = {};
      orderedTerms.forEach((t, i) => { enrollmentByTerm[t.index] = Math.max(Math.round(termOverrides[i] ?? derived[i] ?? derived[derived.length - 1] ?? 0), onRoster); });
      const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct]));
      const termStartByIndex: Record<number, string | null> = {};
      const termEndByIndex: Record<number, string | null> = {};
      const termWeeksByIndex: Record<number, number | null> = {};
      orderedTerms.forEach((t) => {
        const ct = ctById.get(t.id) ?? null;
        termStartByIndex[t.index] = ct?.startDate ? ct.startDate.toISOString() : null;
        termEndByIndex[t.index] = ct?.endDate ? ct.endDate.toISOString() : null;
        termWeeksByIndex[t.index] = t.startWeek != null && t.endWeek != null && t.endWeek >= t.startWeek ? t.endWeek - t.startWeek + 1 : null;
      });
      // Templates are timeless — days attach at instantiation. When this offering
      // has calendarized meetings, their day pattern dates the session rows.
      const meetingTime = new Map<string, string>();
      const meetingLoc = new Map<string, string>();
      const meetingStaff = new Map<string, string>();
      const bookingsByCK = new Map<string, { dayOfWeek: string }[]>();
      // A course that meets Tuesday and Thursday has a booking per weekday: the time keyed
      // by course|kind|day answers a session's own day; course|kind alone is the first booking.
      for (const m of co.meetings) {
        const k = `${m.courseId}|${m.kind}`;
        bookingsByCK.set(k, [...(bookingsByCK.get(k) ?? []), { dayOfWeek: m.dayOfWeek }]);
        if (!meetingTime.has(k)) meetingTime.set(k, m.startTime);
        if (!meetingTime.has(`${k}|${m.dayOfWeek}`)) meetingTime.set(`${k}|${m.dayOfWeek}`, m.startTime);
        const loc = m.kind === "CLINICAL" ? (m.employer?.name ? `@ ${m.employer.name}` : "@ site TBD") : (m.facility?.name ?? null);
        if (loc && !meetingLoc.has(k)) meetingLoc.set(k, loc);
        if (m.staff?.name && !meetingStaff.has(k)) meetingStaff.set(k, m.staff.name);
      }
      // Who staffs each shift: the shift assignments (session × section), the
      // source of truth the staffing table and loads use — the weekly booking's
      // staffPersonId is only a fallback. Names per session, and per course ×
      // kind × section for the weekly booking chips.
      const staffBySession = new Map<string, string[]>();
      for (const a of co.sessionStaff) { const l = staffBySession.get(a.sessionId) ?? []; if (!l.includes(a.person.name)) l.push(a.person.name); staffBySession.set(a.sessionId, l); }
      const sessionCourseKind = new Map<string, string>();
      for (const t of orderedTerms) for (const c of t.courses) for (const s of c.sessions) sessionCourseKind.set(s.id, `${c.id}|${s.kind}`);
      const staffBySection = new Map<string, Map<string, number>>(); // course|kind|section → person name → shifts
      for (const a of co.sessionStaff) { const ck = sessionCourseKind.get(a.sessionId); if (!ck) continue; const k = `${ck}|${a.sectionIndex}`; const m = staffBySection.get(k) ?? new Map<string, number>(); m.set(a.person.name, (m.get(a.person.name) ?? 0) + 1); staffBySection.set(k, m); }
      const leadStaff = (courseId: string, kind: string, sec: number) => { const m = staffBySection.get(`${courseId}|${kind}|${sec}`); if (!m) return null; const top = [...m.entries()].sort((x, y) => y[1] - x[1]); return top.length > 1 ? `${top[0][0]} +${top.length - 1}` : top[0][0]; };
      // Per-instantiation session overrides beat both the template and the
      // meeting-day fallback — this cohort's reality is what the math uses.
      const ovBySession = new Map(co.sessionOverrides.map((o) => [o.sessionId, o]));
      const cdByCourse = new Map(co.courseDates.map((cd) => [cd.courseId, cd]));
      return {
        cohortId: co.id, cohort: co.name, status: co.status,
        programId: p.id, program: p.name, familyId: p.family?.id ?? null, family: p.family?.name ?? null,
        institutionId: institution.id, institution: institution.name,
        students: co._count.students,
        enrollmentByTerm, termStartByIndex, termEndByIndex, termWeeksByIndex, holidays, holidayRule, anchors,
        // One row per booked section — the calendar's draggable shift instances.
        meetings: co.meetings.map((m) => ({
          id: m.id, courseId: m.courseId, kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
          dayOfWeek: m.dayOfWeek, startTime: m.startTime,
          facilityId: m.facilityId, employerId: m.employerId, unitId: m.unitId, staffPersonId: m.staffPersonId,
          loc: m.kind === "CLINICAL" ? (m.employer?.name ? `@ ${m.employer.name}${m.unit?.unitType ? ` · ${m.unit.unitType}` : ""}` : "@ site TBD") : (m.facility?.name ?? null),
          staffName: leadStaff(m.courseId, m.kind, m.sectionIndex) ?? m.staff?.name ?? null,
          lengthHours: m.lengthHours, termIndex: m.termIndex,
        })),
        // Per-occurrence moves: ONE shift (session × section, on one date) bumped
        // to another date / time / place — keyed by the session, so nothing else follows.
        moves: co.shiftMoves.map((mv) => ({
          note: mv.note ?? null, sessionId: mv.sessionId, sectionIndex: mv.sectionIndex,
          fromDate: mv.fromDate.toISOString().slice(0, 10), toDate: mv.toDate.toISOString().slice(0, 10),
          startTime: mv.startTime, facilityId: mv.facilityId, employerId: mv.employerId, staffPersonId: mv.staffPersonId,
          loc: mv.employer?.name ? `@ ${mv.employer.name}` : mv.facility?.name ?? null,
          staffName: mv.staff?.name ?? null,
        })),
        courses: orderedTerms.flatMap((t) => t.courses.map((c) => ({
          code: c.code, title: c.name, courseId: c.id, termIndex: t.index, termName: t.name,
          startDate: cdByCourse.get(c.id)?.startDate?.toISOString() ?? null,
          endDate: cdByCourse.get(c.id)?.endDate?.toISOString() ?? null,
          sessions: c.sessions.map((s) => {
            const ov = ovBySession.get(s.id);
            return {
              id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", number: s.number,
              title: ov?.title ?? s.title,
              deliveryMode: ov?.deliveryMode ?? s.deliveryMode,
              location: ov?.location ?? meetingLoc.get(`${c.id}|${s.kind}`) ?? s.location,
              staffName: staffBySession.get(s.id)?.join(", ") ?? meetingStaff.get(`${c.id}|${s.kind}`) ?? null,
              lengthHours: ov?.lengthHours ?? s.lengthHours, maxStudents: ov?.maxStudents ?? s.maxStudents,
              facultyNeeded: ov?.facultyNeeded ?? s.facultyNeeded, facultyContactPolicy: ov?.facultyContactPolicy ?? s.facultyContactPolicy,
              supportStaffNeeded: ov?.supportStaffNeeded ?? s.supportStaffNeeded, supportContactPolicy: ov?.supportContactPolicy ?? s.supportContactPolicy,
              week: ov?.week ?? s.week,
              // The session's day, unless the calendar moved its weekly booking to another weekday
              // (see resolveSessionDay); an online / no-fixed-day session stays undated.
              dayOfWeek: ov?.dayOfWeek ?? resolveSessionDay(s.dayOfWeek, isOnlineSession(ov?.deliveryMode ?? s.deliveryMode, ov?.location ?? s.location), bookingsByCK.get(`${c.id}|${s.kind}`) ?? [], c.sessions.filter((x) => x.kind === s.kind).map((x) => x.dayOfWeek).filter((d): d is string => !!d)),
              startTime: ov?.startTime ?? s.startTime ?? (isOnlineSession(ov?.deliveryMode ?? s.deliveryMode, ov?.location ?? s.location) ? null : meetingTime.get(`${c.id}|${s.kind}|${ov?.dayOfWeek ?? s.dayOfWeek ?? ""}`) ?? meetingTime.get(`${c.id}|${s.kind}`) ?? null),
              notes: ov?.notes ?? s.notes,
              preceptorsNeeded: ov?.preceptorsNeeded ?? s.preceptorsNeeded, preceptorContactPolicy: ov?.preceptorContactPolicy ?? s.preceptorContactPolicy,
              rotationType: ov?.rotationType ?? s.rotationType, clinicalMode: ov?.clinicalMode ?? s.clinicalMode,
            };
          }),
        }))),
        assumptions: {
          facContactHours: p.facContactHours, facWorkWeekHours: p.facWorkWeekHours, facTermWeeks: p.facTermWeeks,
          preContactHours: p.preContactHours, preWorkWeekHours: p.preWorkWeekHours, preTermWeeks: p.preTermWeeks,
        },
      };
    });
  });

  // Clinical-site supply: every partner site and the students/day it can host.
  const clinicalSites = await prisma.employer.findMany({
    where: { institutionId: institution.id },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    select: { id: true, name: true, setting: true, city: true, wblSlots: true, status: true },
  });

  // Rooms + staff pools so the coverage calendar can edit each shift's
  // location and instructor / preceptor in place.
  const [rooms, people] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId: institution.id, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, capacity: true } }),
    prisma.person.findMany({ where: { institutionId: institution.id, active: true, role: { in: ["instructor", "preceptor", "coordinator"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
  ]);

  return { cohorts, clinicalSites, rooms, people };
}

/** Everything the per-offering design & sequence page needs: the template's
 *  session rows PLUS this instantiation's reality — term dates, and each
 *  course×kind meeting pattern (day, time, room / partner site, staff) so every
 *  session shows its real date, time, location, and instructor / preceptor. */
export async function getOfferingDesign(cohortId: string) {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: {
        include: {
          institution: { select: { id: true, name: true, holidayRule: true, academicEvents: { where: { kind: "holiday" }, select: { date: true, endDate: true, label: true, kind: true } } } },
          terms: {
            orderBy: { index: "asc" },
            include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }] } } } },
          },
        },
      },
      cohortTerms: { select: { termId: true, startDate: true, endDate: true } },
      sessionOverrides: true,
      courseDates: true,
      meetings: {
        include: {
          facility: { select: { id: true, name: true } },
          employer: { select: { id: true, name: true } },
          staff: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!cohort) return null;
  const institutionId = cohort.program.institutionId;
  const [rooms, people, employers] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, capacity: true } }),
    prisma.person.findMany({ where: { institutionId, active: true }, orderBy: [{ role: "asc" }, { name: "asc" }], select: { id: true, name: true, role: true, employmentType: true, title: true, employerId: true, employer: { select: { name: true } } } }),
    prisma.employer.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, setting: true } }),
  ]);
  const assignments = await prisma.sessionInstructor.findMany({ where: { cohortId }, include: { person: { select: { id: true, name: true, role: true } } }, orderBy: [{ sectionIndex: "asc" }, { startOffsetMin: "asc" }] });
  return { cohort, rooms, people, employers, assignments };
}

/** Everything the clinical scheduler needs beyond the capacity model: the asset
 *  map over the window, preceptors (with their site) and instructors, each
 *  offering's students by section, and every family's own site agreements. */
export async function getSchedulerData(institutionId: string, from: string, to: string) {
  const { geocodeOffline, haversineMiles, driveMinutes } = await import("./geo");
  const [map, people, students, familySites, located] = await Promise.all([
    getAssetMap(institutionId, from, to),
    prisma.person.findMany({ where: { institutionId, active: true, role: { in: ["preceptor", "instructor"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, employerId: true } }),
    prisma.student.findMany({ where: { program: { institutionId }, cohortId: { not: null }, status: { in: [...ROSTER_STATUSES] } }, orderBy: [{ sectionIndex: "asc" }, { name: "asc" }], select: { id: true, name: true, cohortId: true, sectionIndex: true, city: true, state: true } }),
    prisma.familySite.findMany({ where: { family: { institutionId } }, select: { familyId: true, employerId: true, agreementStatus: true, agreementEnds: true, studentsAtOnce: true, approvedCapacity: true, studentsAtOnceMode: true, availabilityMode: true } }),
    prisma.employer.findMany({ where: { institutionId, lat: { not: null }, lng: { not: null } }, select: { id: true, lat: true, lng: true } }),
  ]);
  // Settings each site has CONFIRMED it provides (Phase 5): a VERIFIED provision of a requirement item
  // that names asset settings. Estimated or inferred provisions do not count — those placements read "unverified".
  const provisions = await prisma.siteRequirementProvision.findMany({
    where: { employer: { institutionId }, source: "VERIFIED", status: { in: ["provides", "limited"] } },
    select: { employerId: true, item: { select: { settingCodes: true } } },
  });
  const confirmedSettings: { employerId: string; settingCode: string }[] = [];
  const seenSetting = new Set<string>();
  for (const p of provisions) for (const code of p.item.settingCodes.split(",").map((s) => s.trim()).filter(Boolean)) {
    const k = `${p.employerId}|${code}`;
    if (seenSetting.has(k)) continue;
    seenSetting.add(k);
    confirmedSettings.push({ employerId: p.employerId, settingCode: code });
  }
  // Each student's drive to each site, from the town they live in (the built-in gazetteer — no network needed).
  const driveFrom = (city: string | null, state: string | null) => {
    const home = city ? geocodeOffline({ city, state: state ?? "NC" }) : null;
    if (!home) return undefined;
    return Object.fromEntries(located.map((e) => [e.id, driveMinutes(haversineMiles(home, { lat: e.lat!, lng: e.lng! }))]));
  };
  return {
    ...map,
    preceptors: people.filter((p) => p.role === "preceptor").map((p) => ({ id: p.id, name: p.name, employerId: p.employerId, role: p.role })),
    instructors: people.filter((p) => p.role === "instructor").map((p) => ({ id: p.id, name: p.name, role: p.role })),
    students: students.map((s) => ({ id: s.id, name: s.name, cohortId: s.cohortId!, sectionIndex: s.sectionIndex, homeLabel: s.city, driveTo: driveFrom(s.city, s.state) })),
    familyAgreements: familySites.map((f) => ({ familyId: f.familyId, employerId: f.employerId, agreementStatus: f.agreementStatus, agreementEnds: f.agreementEnds ? f.agreementEnds.toISOString().slice(0, 10) : null })),
    siteCaps: familySites.map((f) => ({ employerId: f.employerId, familyId: f.familyId, studentsAtOnce: f.studentsAtOnce, approvedCapacity: f.approvedCapacity, studentsAtOnceMode: (f.studentsAtOnce != null ? "known" : f.studentsAtOnceMode) as "known" | "unrestricted" | "unknown", availabilityMode: f.availabilityMode as "inherit" | "specific" | "unavailable" | "unknown" })),
    confirmedSettings,
  };
}

// ── Home: every institution, its jobs (families) with their North-Star goals, and the programs under each ──
export interface HomeProgram { id: string; name: string; credential: string | null; programType: string; launchTerms: string; seats: number | null; terms: number; running: number; students: number; inventoryNote: string | null }
export interface HomeFamily {
  id: string; name: string; job: string; socCode: string | null; description: string | null;
  goalsByYear: Record<number, number>; thisYearGoal: number; nextYearGoal: number;
  /** The most recent graduated class: its year, what it actually produced (null until its records say), and the goal that year carried. */
  latestClass: { year: number; actual: number | null; goal: number | null } | null;
  /** latest class actual ÷ its year's goal (null without both). */
  progress: number | null;
  programs: HomeProgram[]; running: number; students: number;
}
export interface HomeInstitution { id: string; name: string; shortName: string | null; kind: string | null; city: string | null; state: string | null; serviceArea: string | null; families: HomeFamily[]; thisYearGoal: number; programs: number; running: number; students: number; sites: number }

export async function getInstitutionsHome(currentYear?: number): Promise<HomeInstitution[]> {
  const thisYear = currentYear ?? new Date().getUTCFullYear();
  const lastYear = thisYear - 1;
  const gradYearOf = classYearOf;
  const institutions = await prisma.institution.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { employers: true } },
      programFamilies: {
        orderBy: { name: "asc" },
        include: {
          occupation: { select: { title: true, socCode: true } },
          programs: {
            orderBy: { name: "asc" },
            select: {
              id: true, name: true, credential: true, programType: true, launchTerms: true, defaultCohortSeats: true, inventoryNote: true,
              _count: { select: { terms: true } },
              yearTargets: { select: { year: true, credentialTarget: true } },
              cohorts: { select: { name: true, status: true, _count: { select: { students: true } }, stages: { where: { stageKey: "productive" }, select: { actualNumber: true } } } },
            },
          },
        },
      },
    },
  });
  return institutions.map((inst) => {
    const families: HomeFamily[] = inst.programFamilies.map((f) => {
      let goalsByYear: Record<number, number> = {};
      if (f.goalPlan) { try { const gp = JSON.parse(f.goalPlan) as { goalsByYear?: Record<string, number> }; for (const [y, g] of Object.entries(gp.goalsByYear ?? {})) goalsByYear[Number(y)] = Number(g) || 0; } catch { /* none */ } }
      if (Object.keys(goalsByYear).length === 0) for (const p of f.programs) for (const t of p.yearTargets) if (t.credentialTarget != null) goalsByYear[t.year] = (goalsByYear[t.year] ?? 0) + t.credentialTarget;
      const programs: HomeProgram[] = f.programs.map((p) => ({
        id: p.id, name: p.name, credential: p.credential, programType: p.programType, launchTerms: p.launchTerms, seats: p.defaultCohortSeats, terms: p._count.terms,
        running: p.cohorts.filter((c) => c.status === "active" || c.status === "planned").length, students: p.cohorts.reduce((n, c) => n + c._count.students, 0), inventoryNote: p.inventoryNote,
      }));
      // The most recent graduated class year and what its records say it produced (the productive stage actual; null until the records exist).
      const graduatedYears = f.programs.flatMap((p) => p.cohorts.filter((c) => c.status === "completed").map((c) => gradYearOf(c.name))).filter((y): y is number => y != null);
      const latestYear = graduatedYears.length ? Math.max(...graduatedYears) : null;
      const latestCohorts = latestYear == null ? [] : f.programs.flatMap((p) => p.cohorts.filter((c) => c.status === "completed" && gradYearOf(c.name) === latestYear));
      const latestActual = latestCohorts.some((c) => c.stages[0]?.actualNumber != null) ? latestCohorts.reduce((m, c) => m + (c.stages[0]?.actualNumber ?? 0), 0) : null;
      const latestClass = latestYear == null ? null : { year: latestYear, actual: latestActual, goal: goalsByYear[latestYear] ?? null };
      const thisYearGoal = goalsByYear[thisYear] ?? 0;
      return {
        id: f.id, name: f.name, job: f.occupation?.title ?? f.name, socCode: f.occupation?.socCode ?? null, description: f.description,
        goalsByYear, thisYearGoal, nextYearGoal: goalsByYear[thisYear + 1] ?? 0, latestClass, progress: latestClass?.actual != null && latestClass.goal ? latestClass.actual / latestClass.goal : null,
        programs, running: programs.reduce((n, p) => n + p.running, 0), students: programs.reduce((n, p) => n + p.students, 0),
      };
    });
    return {
      id: inst.id, name: inst.name, shortName: inst.shortName, kind: inst.kind, city: inst.city, state: inst.state, serviceArea: inst.serviceArea, families,
      thisYearGoal: families.reduce((n, f) => n + f.thisYearGoal, 0), programs: families.reduce((n, f) => n + f.programs.length, 0),
      running: families.reduce((n, f) => n + f.running, 0), students: families.reduce((n, f) => n + f.students, 0), sites: inst._count.employers,
    };
  });
}

// ---------------------------------------------------------------------------
// WORKLOAD — policies by institution / employer / position, and dated staffing
// assignments (one person's share of one shift) for load math
// ---------------------------------------------------------------------------

export async function getWorkloadPolicies() {
  const rows = await prisma.workloadPolicy.findMany({
    orderBy: [{ institutionId: "asc" }, { employerId: "asc" }, { role: "asc" }, { employmentType: "asc" }, { title: "asc" }],
    include: { institution: { select: { id: true, name: true } }, employer: { select: { id: true, name: true } }, asset: { select: { id: true, setting: true, assetNumber: true } } },
  });
  return rows.map((r) => ({
    id: r.id, institutionId: r.institutionId, institutionName: r.institution.name, employerId: r.employerId, employerName: r.employer?.name ?? null,
    assetId: r.assetId, assetName: r.asset ? `${r.asset.setting} #${r.asset.assetNumber}` : null,
    role: r.role, employmentType: r.employmentType, title: r.title, label: r.label,
    contactHoursPerWeek: r.contactHoursPerWeek, workWeekHours: r.workWeekHours, termWeeks: r.termWeeks, annualWeeks: r.annualWeeks,
    hoursPerContactHour: r.hoursPerContactHour, maxContactHoursPerWeek: r.maxContactHoursPerWeek, notes: r.notes,
  }));
}

const DAY_OFF: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Every offering-level staffing assignment (optionally for one cohort or one
 *  person) with the shift's real date and term, ready for the workload engine. */
export async function datedStaffAssignments(where: { cohortId?: string; personId?: string; institutionId?: string } = {}) {
  const rows = await prisma.sessionInstructor.findMany({
    where: {
      cohortId: where.cohortId ?? { not: null },
      ...(where.personId ? { personId: where.personId } : {}),
      ...(where.institutionId ? { person: { institutionId: where.institutionId } } : {}),
    },
    include: {
      person: { select: { id: true, name: true, employmentType: true, employer: { select: { name: true } } } },
      session: { select: { id: true, kind: true, lengthHours: true, week: true, dayOfWeek: true, course: { select: { id: true, code: true, name: true, termId: true, term: { select: { index: true, name: true } }, sessions: { select: { week: true } } } } } },
      cohort: { select: { id: true, name: true, startDate: true, program: { select: { name: true } }, cohortTerms: { select: { termId: true, startDate: true, endDate: true, semester: true, term: { select: { startWeek: true, endWeek: true } } } }, sessionOverrides: { select: { sessionId: true, week: true, dayOfWeek: true } }, courseDates: { select: { courseId: true, startDate: true } } } },
    },
  });
  return rows.map((r) => {
    const ov = r.cohort?.sessionOverrides.find((o) => o.sessionId === r.sessionId);
    const week = ov?.week ?? r.session.week; const day = ov?.dayOfWeek ?? r.session.dayOfWeek;
    const ct = r.cohort?.cohortTerms.find((x) => x.termId === r.session.course.termId);
    const cw = r.cohort?.courseDates.find((x) => x.courseId === r.session.course.id);
    const tplWeeks = ct?.term.startWeek != null && ct?.term.endWeek != null && ct.term.endWeek >= ct.term.startWeek ? ct.term.endWeek - ct.term.startWeek + 1 : null;
    const d = sessionDate({ termStart: ct?.startDate ?? null, termEnd: ct?.endDate ?? null, templateWeeks: tplWeeks, courseStart: cw?.startDate ?? null, courseFirstWeek: firstWeekOf(r.session.course.sessions) }, week, day);
    const dateIso: string | null = d ? d.toISOString().slice(0, 10) : null;
    const termStart = ct?.startDate ?? null;
    const termKey = termStart ? `${seasonOfTerm({ semester: ct?.semester, name: null }, termStart)} ${termStart.getUTCFullYear()}` : r.session.course.term.name;
    const year = dateIso ? Number(dateIso.slice(0, 4)) : termStart ? termStart.getUTCFullYear() : null;
    return {
      id: r.id, personId: r.personId, personName: r.person.name, employerName: r.person.employer?.name ?? null, employmentType: r.person.employmentType, role: r.role, contactHours: r.contactHours, startOffsetMin: r.startOffsetMin, segment: r.segment, sectionIndex: r.sectionIndex,
      sessionId: r.sessionId, dateIso, termKey, year, cohortId: r.cohortId!, cohortName: r.cohort?.name ?? "", programName: r.cohort?.program.name ?? "", courseCode: r.session.course.code, courseName: r.session.course.name, kind: r.session.kind,
      termIndex: r.session.course.term.index,
    };
  });
}

// ---------------------------------------------------------------------------
// ORGANIZATIONS — set up & map each institution in one place
// ---------------------------------------------------------------------------

export async function getOrganizations() {
  const insts = await prisma.institution.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { programs: true, programFamilies: true, employers: true, people: true, facilities: true, academicEvents: true, workloadPolicies: true } },
      academicEvents: { where: { kind: "term_start" }, select: { date: true } },
    },
  });
  const assets = await prisma.clinicalAsset.groupBy({ by: ["employerId"], _count: true });
  const empInst = await prisma.employer.findMany({ select: { id: true, institutionId: true } });
  const assetsByInst = new Map<string, number>();
  for (const a of assets) { const e = empInst.find((x) => x.id === a.employerId); if (e) assetsByInst.set(e.institutionId, (assetsByInst.get(e.institutionId) ?? 0) + a._count); }
  return insts.map((i) => ({
    id: i.id, name: i.name, shortName: i.shortName, kind: i.kind, city: i.city, state: i.state, serviceArea: i.serviceArea,
    counts: { ...i._count, assets: assetsByInst.get(i.id) ?? 0, codedSemesters: i.academicEvents.length },
    setup: {
      basics: !!(i.kind && i.city),
      calendar: i.academicEvents.length > 0,
      rooms: i._count.facilities > 0,
      sites: i._count.employers > 0,
      assets: (assetsByInst.get(i.id) ?? 0) > 0,
      people: i._count.people > 0,
      policies: i._count.workloadPolicies > 0,
      programs: i._count.programs > 0,
    },
  }));
}

export async function getOrganization(id: string) {
  const inst = await prisma.institution.findUnique({
    where: { id },
    include: {
      academicEvents: { orderBy: { date: "asc" } },
      facilities: { orderBy: [{ kind: "asc" }, { name: "asc" }] },
      employers: { orderBy: { name: "asc" }, select: { id: true, name: true, organization: true, facilityType: true, county: true, ring: true, ringSource: true, geoSource: true, distanceMiles: true, driveMinutes: true, city: true, agreementStatus: true, status: true, _count: { select: { assets: true, units: true, people: { where: { role: "preceptor", active: true } } } }, assets: { where: { status: { not: "archived" } }, select: { learnersPerShift: true, dataSource: true } }, familySites: { select: { agreementStatus: true, family: { select: { id: true, name: true, programs: { select: { id: true }, take: 1 } } } } } } },
      campuses: { orderBy: [{ isMain: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, address: true, city: true, state: true, zip: true, lat: true, lng: true, geoSource: true, isMain: true } },
      people: { select: { role: true, employmentType: true, active: true, employerId: true } },
      programFamilies: { orderBy: { name: "asc" }, include: { occupation: { select: { title: true, socCode: true } }, programs: { orderBy: { name: "asc" }, select: { id: true, name: true, credential: true, programType: true, launchTerms: true, defaultCohortSeats: true, _count: { select: { terms: true, cohorts: true } } } } } },
      workloadPolicies: { orderBy: [{ employerId: "asc" }, { role: "asc" }] },
    },
  });
  if (!inst) return null;
  const assets = await prisma.clinicalAsset.groupBy({ by: ["settingCode"], where: { employer: { institutionId: id } }, _count: true, _sum: { learnersPerShift: true } });
  const employers = await prisma.employer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, institutionId: true } });
  return { inst, assets: assets.map((a) => ({ settingCode: a.settingCode, count: a._count, learners: a._sum.learnersPerShift ?? 0 })), employersLite: employers };
}

// ---------------------------------------------------------------------------
// ROOMS · BUILDINGS · EQUIPMENT (supply side, structured)
// ---------------------------------------------------------------------------

export async function getRoomsWorkspace(institutionId?: string) {
  const { weeklyUtilization, hoursLabel } = await import("./rooms");
  const where = institutionId ? { institutionId } : {};
  const [rooms, campuses, buildings, equipment, institutions, meetings] = await Promise.all([
    prisma.facility.findMany({ where, orderBy: [{ kind: "asc" }, { name: "asc" }], include: { institution: { select: { id: true, name: true } }, buildingRef: { select: { id: true, name: true, code: true, campus: { select: { id: true, name: true } } } }, openHours: true, closures: { orderBy: { date: "asc" } }, equipmentHome: { select: { id: true, name: true, category: true, mobility: true, quantity: true, status: true } }, equipmentAssignments: { include: { equipment: { select: { id: true, name: true, category: true, mobility: true } } } } } }),
    prisma.campus.findMany({ where, orderBy: { name: "asc" }, include: { _count: { select: { buildings: true } } } }),
    prisma.building.findMany({ where, orderBy: { name: "asc" }, include: { campus: { select: { id: true, name: true } }, _count: { select: { rooms: true, equipment: true } } } }),
    prisma.equipment.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], include: { homeFacility: { select: { id: true, name: true } }, building: { select: { id: true, name: true } }, assignments: { orderBy: { from: "desc" }, include: { facility: { select: { id: true, name: true } } } } } }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.meetingPattern.findMany({ where: { facilityId: { not: null }, ...(institutionId ? { cohort: { program: { institutionId } } } : {}), cohort: { ...NOT_ARCHIVED, cohortTerms: { some: { endDate: { gte: new Date() } } } } }, select: { facilityId: true, dayOfWeek: true, startTime: true, lengthHours: true, termIndex: true, cohort: { select: { cohortTerms: { select: { startDate: true, endDate: true, term: { select: { index: true } } } } } } } }),
  ]);
  // Each booking is placed in its term's calendar window so utilization is the busiest WEEK, not every term's hours added together.
  const byRoom = new Map<string, { dayOfWeek: string; startTime: string; lengthHours: number; weekStartMs?: number | null; weekEndMs?: number | null }[]>();
  for (const m of meetings) { const ct = m.cohort.cohortTerms.find((x) => x.term.index === m.termIndex); const l = byRoom.get(m.facilityId!) ?? []; l.push({ dayOfWeek: m.dayOfWeek, startTime: m.startTime, lengthHours: m.lengthHours, weekStartMs: ct?.startDate?.getTime() ?? null, weekEndMs: ct?.endDate?.getTime() ?? null }); byRoom.set(m.facilityId!, l); }
  return {
    rooms: rooms.map((r) => {
      const spans = r.openHours.map((h) => ({ dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime }));
      const u = weeklyUtilization(spans, byRoom.get(r.id) ?? []);
      return {
        id: r.id, institutionId: r.institutionId, institution: r.institution.name, name: r.name, kind: r.kind, roomNumber: r.roomNumber, floor: r.floor,
        buildingId: r.buildingId, building: r.buildingRef?.name ?? r.building ?? null, buildingCode: r.buildingRef?.code ?? null, campus: r.buildingRef?.campus?.name ?? null, campusId: r.buildingRef?.campus?.id ?? null,
        capacity: r.capacity, areaSqft: r.areaSqft, availability: r.availability, notes: r.notes, status: r.status,
        hours: spans, hoursLabel: hoursLabel(spans), closures: r.closures.map((c) => ({ id: c.id, date: c.date.toISOString().slice(0, 10), openTime: c.openTime, closeTime: c.closeTime, note: c.note })),
        weeklyOpen: u.open, weeklyBooked: u.booked, utilization: u.utilization, outsideHours: u.outsideHours, bookings: (byRoom.get(r.id) ?? []).length,
        equipment: [...r.equipmentHome.map((e) => ({ ...e, via: "home" as const })), ...r.equipmentAssignments.map((a) => ({ id: a.equipment.id, name: a.equipment.name, category: a.equipment.category, mobility: a.equipment.mobility, quantity: a.quantity, status: "assigned", via: "assigned" as const }))],
      };
    }),
    campuses: campuses.map((c) => ({ id: c.id, institutionId: c.institutionId, name: c.name, address: c.address, city: c.city, state: c.state, zip: c.zip, notes: c.notes, buildings: c._count.buildings })),
    buildings: buildings.map((b) => ({ id: b.id, institutionId: b.institutionId, campusId: b.campusId, campus: b.campus?.name ?? null, name: b.name, code: b.code, address: b.address, floors: b.floors, notes: b.notes, rooms: b._count.rooms, equipment: b._count.equipment })),
    equipment: equipment.map((e) => ({ id: e.id, institutionId: e.institutionId, name: e.name, category: e.category, mobility: e.mobility, quantity: e.quantity, make: e.make, model: e.model, serial: e.serial, homeFacilityId: e.homeFacilityId, homeFacility: e.homeFacility?.name ?? null, buildingId: e.buildingId, building: e.building?.name ?? null, status: e.status, acquiredDate: e.acquiredDate?.toISOString().slice(0, 10) ?? null, notes: e.notes, assignments: e.assignments.map((a) => ({ id: a.id, facilityId: a.facilityId, facility: a.facility.name, quantity: a.quantity, from: a.from?.toISOString().slice(0, 10) ?? null, to: a.to?.toISOString().slice(0, 10) ?? null, note: a.note })) })),
    institutions,
  };
}

// ---------------------------------------------------------------------------
// STAFF ROLES · ASSETS LITE (for people & policy forms)
// ---------------------------------------------------------------------------

export async function getStaffRoles() {
  return prisma.staffRole.findMany({ orderBy: [{ institutionId: "asc" }, { label: "asc" }], include: { institution: { select: { name: true } } } });
}
export async function getAssetsLite() {
  const rows = await prisma.clinicalAsset.findMany({ where: { status: { not: "archived" } }, orderBy: [{ settingCode: "asc" }, { assetNumber: "asc" }], select: { id: true, employerId: true, settingCode: true, setting: true, assetType: true, assetNumber: true, externalId: true, employer: { select: { name: true, institutionId: true } } } });
  return rows.map((a) => ({ id: a.id, employerId: a.employerId, institutionId: a.employer.institutionId, label: `${a.employer.name} · ${a.setting} #${a.assetNumber}${a.externalId ? ` (${a.externalId})` : ""}` }));
}

// ---------------------------------------------------------------------------
// ROOM & CAMPUS UTILIZATION EXPLORER — the master calendar's analytics
// ---------------------------------------------------------------------------

export async function getUtilizationExplorer(institutionId?: string) {
  const cal = await getMasterCalendar({ institutionId });
  if (!cal.institutionId) return null;
  const [ws, inst, events] = await Promise.all([
    getRoomsWorkspace(cal.institutionId),
    prisma.institution.findUnique({ where: { id: cal.institutionId }, select: { id: true, name: true, springStart: true, summerStart: true, fallStart: true } }),
    prisma.academicEvent.findMany({ where: { institutionId: cal.institutionId, kind: { in: ["term_start", "term_end", "holiday"] } }, orderBy: { date: "asc" }, select: { date: true, endDate: true, kind: true, season: true, label: true } }),
  ]);
  if (!inst) return null;
  // Coded holidays and breaks, expanded to dates — not schedulable hours (Phase 6).
  const holidays: string[] = [];
  for (const e of events.filter((x) => x.kind === "holiday")) { const a = e.date.getTime(), b = (e.endDate ?? e.date).getTime(); for (let t = a; t <= b; t += 86400000) holidays.push(new Date(t).toISOString().slice(0, 10)); }
  const semesters = events.filter((e) => e.kind === "term_start").map((s) => { const end = events.find((e) => e.kind === "term_end" && e.date > s.date && e.season === s.season && e.date.getUTCFullYear() === s.date.getUTCFullYear()); return { iso: s.date.toISOString().slice(0, 10), endIso: end?.date.toISOString().slice(0, 10) ?? null, season: s.season }; });
  return {
    institution: { id: inst.id, name: inst.name },
    institutions: cal.institutions,
    anchors: { springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart },
    semesters, holidays,
    rooms: ws.rooms.filter((r) => r.status === "active").map((r) => ({ id: r.id, name: r.name, kind: r.kind, capacity: r.capacity, buildingId: r.buildingId, building: r.building, campusId: r.campusId, campus: r.campus, hours: r.hours, closures: r.closures })),
    meetings: cal.meetings.map((m) => ({
      id: m.id, cohortId: m.cohortId, cohort: m.cohortName, programId: m.programId, program: m.programName,
      courseId: m.courseId, courseCode: m.courseCode, courseName: m.courseName, kind: m.kind, sectionIndex: m.sectionIndex, seats: m.seats,
      dayOfWeek: m.dayOfWeek, startTime: m.startTime, lengthHours: m.lengthHours,
      facilityId: m.facilityId, employerId: m.employerId, employerName: m.employerName,
      weekStartMs: m.weekStartMs, weekEndMs: m.weekEndMs, termIndex: m.termIndex,
    })),
    programs: cal.programs,
    /** The window the bookings span — the explorer's default "everything" range. */
    span: cal.meetings.length ? { from: new Date(Math.min(...cal.meetings.filter((m) => m.weekStartMs).map((m) => m.weekStartMs))).toISOString().slice(0, 10), to: new Date(Math.max(...cal.meetings.map((m) => m.weekEndMs)) - 1).toISOString().slice(0, 10) } : null,
  };
}

// ---------------------------------------------------------------------------
// ASSET SUPPLY EXPLORER
// ---------------------------------------------------------------------------

export async function getSupplyExplorer(institutionId: string | undefined, from: string, to: string) {
  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { employers: true } } } });
  const inst = institutions.find((i) => i.id === institutionId) ?? [...institutions].sort((a, b) => b._count.employers - a._count.employers)[0];
  if (!inst) return null;
  const [map, events] = await Promise.all([
    getAssetMap(inst.id, from, to),
    prisma.academicEvent.findMany({ where: { institutionId: inst.id, kind: { in: ["term_start", "term_end"] } }, orderBy: { date: "asc" }, select: { date: true, kind: true, season: true, label: true } }),
  ]);
  // Coded semesters as windows (start → matching end).
  const starts = events.filter((e) => e.kind === "term_start").map((s) => { const end = events.find((e) => e.kind === "term_end" && e.date > s.date && e.season === s.season && e.date.getUTCFullYear() === s.date.getUTCFullYear()); return { iso: s.date.toISOString().slice(0, 10), endIso: end?.date.toISOString().slice(0, 10) ?? null, season: s.season, label: s.label }; });
  return { institution: { id: inst.id, name: inst.name }, institutions: institutions.map((i) => ({ id: i.id, name: i.name })), assets: map.assets, overrides: map.overrides, bookings: map.bookings, semesters: starts };
}

// ---------------------------------------------------------------------------
// LEARNERS — profile with assignments, and the analytics set
// ---------------------------------------------------------------------------

// ── Clinical rotations: the planner's input from the records, and the saved plan scored ──
export interface RotationBoardData {
  cohort: { id: string; name: string; programId: string; programName: string; institutionId: string };
  courses: { id: string; code: string | null; name: string; term: string; shifts: number }[];
  course: { id: string; code: string | null; name: string; term: string } | null;
  input: import("./rotations").RotationInput | null;
  plan: import("./rotations").RotationPlan | null;
  /** Saved shift status per student × session, so the grid can show what already happened. */
  status: Record<string, { status: string; hoursLogged: number | null }>;
  sessionByDate: Record<string, string>;
  siteNames: Record<string, string>;
  areaNames: Record<string, string>;
  /** The family whose clinical set-up (directory) the plan is built from. */
  family: { id: string; name: string; clinicalModel: string; notes: string | null } | null;
}

export async function getRotationInput(cohortId: string, courseId: string) {
  const co = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true, name: true, program: { select: { id: true, name: true, institutionId: true, familyId: true, family: { select: { id: true, name: true, clinicalModel: true, capacityBasis: true, casesPerStudentDay: true, caseDaysPerYear: true, studentsPerStaff: true, rotationPrimarySetting: true, rotationAgreements: true, rotationKeepHome: true, rotationSkipHolidays: true, rotationNotes: true } } } }, meetings: { where: { courseId, kind: "CLINICAL" }, select: { sectionIndex: true, employerId: true } }, cohortTerms: { select: { termId: true, startDate: true, endDate: true } } } });
  if (!co) return null;
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, code: true, name: true, termId: true, term: { select: { name: true } }, sessions: { where: { kind: "CLINICAL" }, orderBy: [{ week: "asc" }, { number: "asc" }], select: { id: true, week: true, dayOfWeek: true, startTime: true, lengthHours: true, rotationType: true, deliveryMode: true, location: true } }, clinicalRequirements: { select: { hoursPerStudent: true, serviceArea: { select: { code: true, name: true, settingCodes: true } } } } } });
  if (!course) return null;
  const { dates } = await sessionDatesForCohort(cohortId);
  const { shiftBlockOf } = await import("./clinicalsupply");
  const { holidayMap } = await import("./academiccalendar");
  const holidays = holidayMap((await prisma.academicEvent.findMany({ where: { institutionId: co.program.institutionId, kind: "holiday" }, select: { date: true, endDate: true, label: true, kind: true } })).map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind })));
  const rotations = new Map((await prisma.rotationSetting.findMany({ where: { institutionId: co.program.institutionId }, select: { rotationType: true, settingCode: true } })).map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10); };
  const shifts = course.sessions
    .filter((x) => x.dayOfWeek && !isOnlineSession(x.deliveryMode, x.location))
    .map((x) => { const iso = dates.get(x.id) ?? null; return iso ? { sessionId: x.id, date: iso, weekMonday: mondayOf(iso), block: shiftBlockOf(x.startTime), hours: x.lengthHours, rotationType: x.rotationType, settingCode: rotations.get((x.rotationType ?? "").trim().toLowerCase()) ?? null, holiday: holidays[iso] ?? null } : null; })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!shifts.length) return { co, course, input: null, existing: [], status: {}, family: co.program.family ? { id: co.program.family.id, name: co.program.family.name, clinicalModel: co.program.family.clinicalModel, notes: co.program.family.rotationNotes } : null };
  const from = shifts[0].date, to = shifts[shifts.length - 1].date;
  const [map, familySites, employers, studentsRaw] = await Promise.all([
    getAssetMap(co.program.institutionId, from, to),
    co.program.familyId ? prisma.familySite.findMany({ where: { familyId: co.program.familyId }, select: { employerId: true, agreementStatus: true, accreditorStatus: true, approvedCapacity: true, qualifiedStaffOnShift: true, studentsAtOnce: true, casesPerDay: true, daysAllowed: true, blocksAllowed: true } }) : Promise.resolve([]),
    prisma.employer.findMany({ where: { institutionId: co.program.institutionId, status: "active" }, select: { id: true, name: true, agreementStatus: true, annualSurgicalCases: true, operatingDaysPerYear: true } }),
    prisma.student.findMany({ where: { cohortId, status: { in: [...ROSTER_STATUSES] } }, orderBy: { sectionIndex: "asc" }, select: { id: true, name: true, sectionIndex: true, sections: { where: { courseId, kind: "CLINICAL" }, select: { sectionIndex: true } }, shifts: { where: { session: { courseId } }, select: { sessionId: true, assetId: true, settingCode: true, pinnedArea: true, status: true, hoursLogged: true, asset: { select: { employerId: true, settingCode: true } } } } } }),
  ]);
  const RANK: Record<string, number> = { secured: 0, asked: 1, prospect: 2, none: 3, declined: 9 };
  const fs = new Map(familySites.map((f) => [f.employerId, f]));
  const homeOf = new Map(co.meetings.map((m) => [m.sectionIndex, m.employerId]));
  const students = studentsRaw.map((st) => { const sec = st.sections[0]?.sectionIndex ?? st.sectionIndex; return { id: st.id, name: st.name, seat: st.sectionIndex, sectionIndex: sec, homeEmployerId: homeOf.get(sec) ?? null }; });
  const csv = (v: string | null | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const sites: import("./rotations").RotationSite[] = employers.filter((e) => map.assets.some((a) => a.employerId === e.id)).map((e) => { const f = fs.get(e.id); return { employerId: e.id, name: e.name, agreementRank: RANK[f?.agreementStatus ?? e.agreementStatus ?? "none"] ?? 3, approvedCapacity: f?.accreditorStatus === "recognized" ? f.approvedCapacity ?? null : null, studentsAtOnce: f?.studentsAtOnce ?? null, casesPerDay: f?.casesPerDay ?? null, annualSurgicalCases: e.annualSurgicalCases, operatingDaysPerYear: e.operatingDaysPerYear, qualifiedStaffOnShift: f?.qualifiedStaffOnShift ?? null, daysAllowed: csv(f?.daysAllowed), blocksAllowed: csv(f?.blocksAllowed) }; });
  const areas = course.clinicalRequirements.filter((r) => r.hoursPerStudent > 0).map((r) => ({ code: r.serviceArea.code, name: r.serviceArea.name, settingCodes: r.serviceArea.settingCodes.split(",").map((x) => x.trim()).filter(Boolean), hours: r.hoursPerStudent }));
  // The credentialing body's list as demand: what each student still lacks, by setting, and which sites provide it.
  const needs: Record<string, Record<string, number>> = {};
  const siteNeeds: Record<string, Record<string, number>> = {};
  if (co.program.familyId) {
    const { progressFor, needsBySetting } = await import("./requirementprogress");
    const req = await getFamilyRequirements(co.program.familyId);
    if (req?.sets.length) {
      const logs = await prisma.studentRequirementLog.findMany({ where: { studentId: { in: studentsRaw.map((x) => x.id) } }, select: { studentId: true, itemId: true, outcome: true, role: true, simulated: true, count: true, date: true, employerId: true } });
      for (const st of studentsRaw) {
        const mine = logs.filter((l) => l.studentId === st.id).map((l) => ({ itemId: l.itemId, outcome: l.outcome, role: l.role, simulated: l.simulated, count: l.count, date: l.date.toISOString().slice(0, 10), employerId: l.employerId }));
        const bySetting: Record<string, number> = {}; const bySite: Record<string, number> = {};
        for (const set of req.sets) {
          const pr = progressFor(set.kind, set.items, set.rules, mine);
          for (const [k, v] of Object.entries(needsBySetting(pr))) bySetting[k] = (bySetting[k] ?? 0) + v;
          const missing = new Set([...pr.missingRequired.map((i) => i.id)]);
          for (const c of set.coverage) for (const ic of c.itemCoverage) if (missing.has(ic.item.id)) for (const p of ic.providers.secured) bySite[p.site.employerId] = (bySite[p.site.employerId] ?? 0) + 1;
        }
        needs[st.id] = bySetting; siteNeeds[st.id] = bySite;
      }
    }
  }
  const sessionIds = new Set(shifts.map((s) => s.sessionId));
  const existingBookings = map.bookings.filter((b) => !(b.cohortId === cohortId && b.sessionId && sessionIds.has(b.sessionId)));
  const pins: Record<string, string> = {};
  const areaOf = (setting: string | null) => (setting ? areas.find((a) => a.settingCodes.includes(setting))?.code ?? setting : null);
  const existing: import("./rotations").Placement[] = [];
  const status: Record<string, { status: string; hoursLogged: number | null }> = {};
  const shiftById = new Map(shifts.map((s) => [s.sessionId, s]));
  for (const st of studentsRaw) for (const sh of st.shifts) {
    const s = shiftById.get(sh.sessionId); if (!s) continue;
    status[`${st.id}|${sh.sessionId}`] = { status: sh.status, hoursLogged: sh.hoursLogged };
    if (sh.pinnedArea) pins[`${st.id}|${s.date}`] = sh.pinnedArea;
    if (sh.assetId && sh.asset) { const setting = sh.asset.settingCode; const home = students.find((x) => x.id === st.id)?.homeEmployerId ?? null; existing.push({ studentId: st.id, sessionId: sh.sessionId, date: s.date, block: s.block, hours: s.hours, areaCode: areaOf(setting) ?? setting, settingCode: setting, employerId: sh.asset.employerId, assetId: sh.assetId, away: sh.asset.employerId !== home, pinned: !!sh.pinnedArea, reason: "saved" }); }
  }
  const { DEFAULT_ROTATION_POLICY } = await import("./rotations");
  const fam = co.program.family;
  const basis = (fam?.capacityBasis === "cases" || fam?.capacityBasis === "staff" ? fam.capacityBasis : "seats") as import("./rotations").CapacityBasis;
  const policy: import("./rotations").RotationPolicy = {
    ...DEFAULT_ROTATION_POLICY, basis,
    casesPerStudentDay: fam?.casesPerStudentDay ?? DEFAULT_ROTATION_POLICY.casesPerStudentDay, caseDaysPerYear: fam?.caseDaysPerYear ?? DEFAULT_ROTATION_POLICY.caseDaysPerYear, studentsPerStaff: fam?.studentsPerStaff ?? DEFAULT_ROTATION_POLICY.studentsPerStaff,
    maxAgreementRank: fam?.rotationAgreements === "secured" ? 0 : fam?.rotationAgreements === "any" ? 2 : 1,
    keepHome: fam?.rotationKeepHome ?? true, skipHolidays: fam?.rotationSkipHolidays ?? true, primarySetting: fam?.rotationPrimarySetting || null,
  };
  const input: import("./rotations").RotationInput = { students, shifts, areas, sites, assets: map.assets, overrides: map.overrides, existingBookings, pins, options: policy, needs, siteNeeds };
  return { co, course, input, existing, status, family: fam ? { id: fam.id, name: fam.name, clinicalModel: fam.clinicalModel, notes: fam.rotationNotes } : null };
}

/** The rotation board for one offering: its clinical courses, and the selected course's saved plan scored. */
export async function getRotationBoard(cohortId: string, courseId?: string | null): Promise<RotationBoardData | null> {
  const co = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true, name: true, program: { select: { id: true, name: true, institutionId: true, terms: { orderBy: { index: "asc" }, select: { name: true, courses: { orderBy: { sequenceOrder: "asc" }, select: { id: true, code: true, name: true, _count: { select: { sessions: { where: { kind: "CLINICAL" } } } } } } } } } } } });
  if (!co) return null;
  const courses = co.program.terms.flatMap((t) => t.courses.filter((c) => c._count.sessions > 0).map((c) => ({ id: c.id, code: c.code, name: c.name, term: t.name, shifts: c._count.sessions })));
  const chosen = courses.find((c) => c.id === courseId) ?? courses[0] ?? null;
  const base: RotationBoardData = { cohort: { id: co.id, name: co.name, programId: co.program.id, programName: co.program.name, institutionId: co.program.institutionId }, courses, course: chosen, input: null, plan: null, status: {}, sessionByDate: {}, siteNames: {}, areaNames: {}, family: null };
  if (!chosen) return base;
  const r = await getRotationInput(cohortId, chosen.id);
  if (!r || !r.input) return base;
  const { evaluatePlan } = await import("./rotations");
  const plan = r.existing.length ? evaluatePlan(r.input, r.existing) : null;
  return { ...base, input: r.input, plan, status: r.status, sessionByDate: Object.fromEntries(r.input.shifts.map((s) => [s.date, s.sessionId])), siteNames: Object.fromEntries(r.input.sites.map((s) => [s.employerId, s.name])), areaNames: Object.fromEntries(r.input.areas.map((a) => [a.code, a.name])), family: r.family };
}

/** Every session of an offering dated on its calendar: session id → ISO date (null when undated). */
export async function sessionDatesForCohort(cohortId: string): Promise<{ dates: Map<string, string | null>; today: string }> {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { cohortTerms: { select: { termId: true, startDate: true, endDate: true } }, courseDates: { select: { courseId: true, startDate: true } }, program: { select: { institution: { select: { holidayRule: true, academicEvents: { where: { kind: "holiday" }, select: { date: true, endDate: true, label: true, kind: true } } } }, terms: { select: { id: true, startWeek: true, endWeek: true, courses: { select: { id: true, sessions: { select: { id: true, kind: true, week: true, dayOfWeek: true } } } } } } } } } });
  const dates = new Map<string, string | null>();
  if (!cohort) return { dates, today: new Date().toISOString().slice(0, 10) };
  // The same holiday rule the capacity model applies (lib/holidayrule), so the calendar agrees with every other reader.
  const { holidayMap } = await import("./academiccalendar");
  const holidays = holidayMap(cohort.program.institution.academicEvents.map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind })));
  const rule: HolidayRule = isHolidayRule(cohort.program.institution.holidayRule) ? cohort.program.institution.holidayRule : DEFAULT_HOLIDAY_RULE;
  for (const t of cohort.program.terms) {
    const ct = cohort.cohortTerms.find((x) => x.termId === t.id);
    const tplWeeks = t.startWeek != null && t.endWeek != null && t.endWeek >= t.startWeek ? t.endWeek - t.startWeek + 1 : null;
    const patternOf = new Map(t.courses.map((c) => [c.id, c.sessions.map((x) => { const d = sessionDate({ termStart: ct?.startDate ?? null, termEnd: ct?.endDate ?? null, templateWeeks: tplWeeks, courseStart: cohort.courseDates.find((cd) => cd.courseId === c.id)?.startDate ?? null, courseFirstWeek: firstWeekOf(c.sessions), holidays }, x.week, x.dayOfWeek); return d ? d.toISOString().slice(0, 10) : null; })]));
    const cohortDates = new Set([...patternOf.values()].flat().filter((d): d is string => !!d));
    for (const c of t.courses) {
      const pattern = patternOf.get(c.id)!;
      for (const kind of new Set(c.sessions.map((x) => x.kind))) {
        const idx = c.sessions.map((x, i) => (x.kind === kind ? i : -1)).filter((i) => i >= 0);
        const mine = new Set(idx.map((i) => pattern[i]).filter((d): d is string => !!d));
        const rs = resolveHolidays(idx.map((i) => pattern[i]), holidays, rule, { cohortDates: [...cohortDates].filter((d) => !mine.has(d)) });
        idx.forEach((i, j) => { dates.set(c.sessions[i].id, rs[j]?.dateIso ?? pattern[i]); if (rs[j]?.fromIso) cohortDates.add(rs[j]!.dateIso); });
      }
    }
  }
  return { dates, today: new Date().toISOString().slice(0, 10) };
}

export type ShiftStatus = "scheduled" | "completed" | "absent" | "excused";

export async function getStudentAssignments(studentId: string) {
  const s = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, cohortId: true, programId: true, sectionIndex: true, sections: true, shifts: { include: { session: { select: { id: true, number: true, title: true, week: true, dayOfWeek: true, startTime: true, lengthHours: true, maxStudents: true, rotationType: true, preceptorsNeeded: true, course: { select: { id: true, code: true, name: true, termId: true } } } }, asset: { select: { id: true, setting: true, assetNumber: true, employer: { select: { name: true } } } }, preceptor: { select: { id: true, name: true } } }, orderBy: [{ session: { week: "asc" } }] } } });
  const empty = { cohort: null, courses: [], sections: [], shifts: [], assets: [], staff: [], today: new Date().toISOString().slice(0, 10) };
  if (!s || !s.cohortId) return empty;
  const cohort = await prisma.cohort.findUnique({ where: { id: s.cohortId }, select: { id: true, name: true, plannedSeats: true, _count: { select: { students: true } }, cohortTerms: { select: { termId: true, startDate: true, endDate: true } }, courseDates: { select: { courseId: true, startDate: true } },
    meetings: { where: { kind: "CLINICAL" }, select: { courseId: true, sectionIndex: true, employer: { select: { id: true, name: true } } } },
    sessionStaff: { select: { sessionId: true, sectionIndex: true, role: true, person: { select: { id: true, name: true } } } },
    program: { select: { institutionId: true, institution: { select: { academicEvents: { where: { kind: "holiday" }, select: { date: true, endDate: true, label: true, kind: true } } } }, terms: { orderBy: { index: "asc" }, select: { id: true, index: true, name: true, startWeek: true, endWeek: true, courses: { orderBy: { sequenceOrder: "asc" }, select: { id: true, code: true, name: true, clinicalRequirements: { select: { hoursPerStudent: true, casesPerStudent: true, serviceArea: { select: { code: true, name: true, settingCodes: true } } } }, sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }], select: { id: true, kind: true, number: true, title: true, week: true, dayOfWeek: true, startTime: true, lengthHours: true, maxStudents: true, rotationType: true, preceptorsNeeded: true } } } } } } } } } });
  if (!cohort) return empty;
  const enrolled = Math.max(cohort._count.students, cohort.plannedSeats ?? 0, 1);
  const { holidayMap: hmap } = await import("./academiccalendar");
  const holidays = hmap(cohort.program.institution.academicEvents.map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind })));
  const dateOf = (termId: string, courseId: string, week: number | null, day: string | null) => {
    const ct = cohort.cohortTerms.find((x) => x.termId === termId); const t = cohort.program.terms.find((x) => x.id === termId);
    const tplWeeks = t?.startWeek != null && t?.endWeek != null && t.endWeek >= t.startWeek ? t.endWeek - t.startWeek + 1 : null;
    const d = sessionDate({ termStart: ct?.startDate ?? null, termEnd: ct?.endDate ?? null, templateWeeks: tplWeeks, courseStart: cohort.courseDates.find((x) => x.courseId === courseId)?.startDate ?? null, courseFirstWeek: firstWeekOf(t?.courses.find((c) => c.id === courseId)?.sessions ?? []), holidays }, week, day);
    return d ? d.toISOString().slice(0, 10) : null;
  };
  // Who staffs each course × kind × section this learner sits in (instructors for class / lab, preceptors for clinical).
  const sessionKind = new Map<string, { courseId: string; kind: string }>();
  for (const t of cohort.program.terms) for (const c of t.courses) for (const x of c.sessions) sessionKind.set(x.id, { courseId: c.id, kind: x.kind });
  const staffByKey = new Map<string, Map<string, { id: string; name: string; role: string; shifts: number }>>();
  for (const a of cohort.sessionStaff) {
    const sk = sessionKind.get(a.sessionId); if (!sk) continue;
    const key = `${sk.courseId}|${sk.kind}|${a.sectionIndex}`;
    const m = staffByKey.get(key) ?? new Map(); const cur = m.get(a.person.id) ?? { id: a.person.id, name: a.person.name, role: a.role, shifts: 0 }; cur.shifts++; m.set(a.person.id, cur); staffByKey.set(key, m);
  }
  const staff = s.sections.map((sec) => ({ courseId: sec.courseId, kind: sec.kind, sectionIndex: sec.sectionIndex, people: [...(staffByKey.get(`${sec.courseId}|${sec.kind}|${sec.sectionIndex}`)?.values() ?? [])].sort((a, b) => b.shifts - a.shifts) }));
  const siteOf = (courseId: string, sectionIndex: number) => cohort.meetings.find((m) => m.courseId === courseId && m.sectionIndex === sectionIndex)?.employer ?? null;
  const courses = cohort.program.terms.flatMap((t) => t.courses.map((c) => ({
    id: c.id, code: c.code, name: c.name, term: t.name, termId: t.id,
    kinds: (["CLASS", "LAB", "CLINICAL"] as const).map((k) => { const ss = c.sessions.filter((x) => x.kind === k); const maxSec = ss.length ? Math.max(...ss.map((x) => Math.max(1, Math.ceil(enrolled / Math.max(1, x.maxStudents))))) : 0; return { kind: k, sessions: ss.length, sections: maxSec, needsPreceptor: ss.some((x) => x.preceptorsNeeded > 0) }; }).filter((k) => k.sessions > 0),
    clinicalSessions: c.sessions.filter((x) => x.kind === "CLINICAL").map((x) => ({ id: x.id, number: x.number, title: x.title, week: x.week, dayOfWeek: x.dayOfWeek, startTime: x.startTime, lengthHours: x.lengthHours, rotationType: x.rotationType, sections: Math.max(1, Math.ceil(enrolled / Math.max(1, x.maxStudents))), dateIso: dateOf(t.id, c.id, x.week, x.dayOfWeek) })),
    // What the course requires of each learner (the family's requirement grid): hours per service area, cases where the model is case-based.
    required: c.clinicalRequirements.filter((r) => r.hoursPerStudent > 0 || (r.casesPerStudent ?? 0) > 0).map((r) => ({ code: r.serviceArea.code, name: r.serviceArea.name, settingCodes: r.serviceArea.settingCodes.split(",").filter(Boolean), hours: r.hoursPerStudent, cases: r.casesPerStudent })),
  })));
  const assets = await prisma.clinicalAsset.findMany({ where: { employer: { institutionId: cohort.program.institutionId }, status: { not: "archived" } }, orderBy: [{ employer: { name: "asc" } }, { settingCode: "asc" }, { assetNumber: "asc" }], select: { id: true, setting: true, assetNumber: true, settingCode: true, employer: { select: { name: true } } } });
  return {
    cohort: { id: cohort.id, name: cohort.name, enrolled },
    courses, sections: s.sections, staff, today: new Date().toISOString().slice(0, 10),
    shifts: s.shifts.map((sh) => ({
      id: sh.id, sessionId: sh.sessionId, sectionIndex: sh.sectionIndex, note: sh.note, course: sh.session.course,
      session: { number: sh.session.number, title: sh.session.title, week: sh.session.week, dayOfWeek: sh.session.dayOfWeek, startTime: sh.session.startTime, lengthHours: sh.session.lengthHours, rotationType: sh.session.rotationType, preceptorsNeeded: sh.session.preceptorsNeeded },
      dateIso: dateOf(sh.session.course.termId, sh.session.course.id, sh.session.week, sh.session.dayOfWeek),
      asset: sh.asset ? `${sh.asset.employer.name} · ${sh.asset.setting} #${sh.asset.assetNumber}` : null,
      site: sh.asset?.employer.name ?? siteOf(sh.session.course.id, sh.sectionIndex)?.name ?? null,
      status: sh.status as ShiftStatus, hoursLogged: sh.hoursLogged, loggedAt: sh.loggedAt ? sh.loggedAt.toISOString().slice(0, 10) : null, settingCode: sh.settingCode,
      preceptor: sh.preceptor ? { id: sh.preceptor.id, name: sh.preceptor.name } : null,
    })).sort((a, b) => (a.dateIso ?? "9999").localeCompare(b.dateIso ?? "9999") || a.session.number - b.session.number),
    assets: assets.map((a) => ({ id: a.id, label: `${a.employer.name} · ${a.setting} #${a.assetNumber}`, settingCode: a.settingCode })),
  };
}

/** The offering's learner ledger: for every student, whether they sit in a section of
 *  every current course, who teaches / precepts them, and how their clinical hours stand
 *  — required by the requirement grid, scheduled on shifts, logged so far, missed — so
 *  a coordinator can see at a glance who is short, unsupervised or unassigned. */
export async function getOfferingLedger(cohortId: string) {
  const co = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: {
      id: true, name: true, plannedSeats: true,
      cohortTerms: { select: { termId: true, startDate: true, endDate: true } },
      meetings: { where: { kind: "CLINICAL" }, select: { courseId: true, sectionIndex: true, employer: { select: { name: true } } } },
      sessionStaff: { select: { sessionId: true, sectionIndex: true, role: true, person: { select: { id: true, name: true } } } },
      students: { orderBy: [{ sectionIndex: "asc" }], select: { id: true, name: true, status: true, sectionIndex: true, attendedCount: true, missedCount: true, sections: { select: { courseId: true, kind: true, sectionIndex: true } }, shifts: { select: { sessionId: true, sectionIndex: true, status: true, hoursLogged: true, settingCode: true, preceptorId: true, instructorId: true } } } },
      program: { select: { terms: { orderBy: { index: "asc" }, select: { id: true, index: true, name: true, courses: { orderBy: { sequenceOrder: "asc" }, select: { id: true, code: true, name: true, clinicalRequirements: { select: { hoursPerStudent: true, casesPerStudent: true, serviceArea: { select: { code: true, settingCodes: true } } } }, sessions: { select: { id: true, kind: true, lengthHours: true, maxStudents: true, preceptorsNeeded: true, facultyNeeded: true, clinicalMode: true, deliveryMode: true, location: true } } } } } } } },
    },
  });
  if (!co) return null;
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  // The class's last day: a completion rate is decidable only once it has passed (lib/learners outcomeStats).
  const cohortEnds = co.cohortTerms.map((t) => t.endDate).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString().slice(0, 10) ?? null;
  const enrolled = Math.max(co.students.filter((s) => s.status !== "withdrawn").length, co.plannedSeats ?? 0, 1);
  const started = co.program.terms.filter((t) => { const ct = co.cohortTerms.find((x) => x.termId === t.id); return ct?.startDate && ct.startDate <= today; });
  const current = started.find((t) => { const ct = co.cohortTerms.find((x) => x.termId === t.id)!; return !ct.endDate || ct.endDate >= today; }) ?? started.at(-1) ?? null;
  const sessionInfo = new Map<string, { courseId: string; kind: string; lengthHours: number; preceptorsNeeded: number; facultyNeeded: number; clinicalMode: string | null }>();
  for (const t of co.program.terms) for (const c of t.courses) for (const x of c.sessions) sessionInfo.set(x.id, { courseId: c.id, kind: x.kind, lengthHours: x.lengthHours, preceptorsNeeded: x.preceptorsNeeded, facultyNeeded: x.facultyNeeded, clinicalMode: x.clinicalMode });
  // Learners on each clinical shift (session × section) — the same count site load uses — and each shift's supervision reading.
  const learnersOn = new Map<string, number>();
  for (const st of co.students) for (const sh of st.shifts) if (sh.status === "completed" || (sh.status === "scheduled" && st.status !== "withdrawn")) { const k = `${sh.sessionId}|${sh.sectionIndex}`; learnersOn.set(k, (learnersOn.get(k) ?? 0) + 1); }
  const supOf = (sh: { sessionId: string; sectionIndex: number; status: string; preceptorId: string | null; instructorId: string | null }) => { const si = sessionInfo.get(sh.sessionId)!; return supervisionOnShift({ clinicalMode: si.clinicalMode, facultyNeeded: si.facultyNeeded, preceptorsNeeded: si.preceptorsNeeded, lengthHours: si.lengthHours, learners: learnersOn.get(`${sh.sessionId}|${sh.sectionIndex}`) ?? 0, preceptorNamed: !!sh.preceptorId, instructorNamed: !!sh.instructorId, attended: sh.status === "completed" || sh.status === "scheduled" }); };
  const personName = (id: string) => co.sessionStaff.find((a) => a.person.id === id)?.person.name ?? "?";
  const staffByKey = new Map<string, Map<string, { name: string; role: string }>>();
  for (const a of co.sessionStaff) { const si = sessionInfo.get(a.sessionId); if (!si) continue; const k = `${si.courseId}|${si.kind}|${a.sectionIndex}`; const m = staffByKey.get(k) ?? new Map(); m.set(a.person.id, { name: a.person.name, role: a.role }); staffByKey.set(k, m); }
  // Course kinds every learner should sit in: in-person kinds of the courses of the terms that have started (online-only kinds need no section).
  const expected = started.flatMap((t) => t.courses.flatMap((c) => [...new Set(c.sessions.filter((x) => !isOnlineSession(x.deliveryMode, x.location)).map((x) => x.kind))].map((kind) => ({ courseId: c.id, code: c.code, kind, current: t.id === current?.id }))));
  const clinicalCourses = co.program.terms.flatMap((t) => t.courses.filter((c) => c.sessions.some((x) => x.kind === "CLINICAL")).map((c) => ({ id: c.id, code: c.code, name: c.name, term: t.name, termIndex: t.index, requiredHours: c.clinicalRequirements.reduce((n, r) => n + r.hoursPerStudent, 0), requiredCases: c.clinicalRequirements.reduce((n, r) => n + (r.casesPerStudent ?? 0), 0), byArea: c.clinicalRequirements.filter((r) => r.hoursPerStudent > 0).map((r) => ({ code: r.serviceArea.code, hours: r.hoursPerStudent, settingCodes: r.serviceArea.settingCodes.split(",").filter(Boolean) })), started: started.some((t2) => t2.courses.some((x) => x.id === c.id)) })));
  const siteOf = (courseId: string, sectionIndex: number) => co.meetings.find((m) => m.courseId === courseId && m.sectionIndex === sectionIndex)?.employer?.name ?? null;
  const students = co.students.map((st) => {
    const secOf = (courseId: string, kind: string) => st.sections.find((x) => x.courseId === courseId && x.kind === kind)?.sectionIndex ?? null;
    const missingSections = st.status === "withdrawn" ? [] : expected.filter((e) => secOf(e.courseId, e.kind) == null).map((e) => `${e.code ?? e.courseId} ${e.kind.toLowerCase()}`);
    const unstaffedSections = st.status === "withdrawn" ? [] : expected.filter((e) => e.kind !== "CLINICAL").filter((e) => { const sec = secOf(e.courseId, e.kind); return sec != null && !(staffByKey.get(`${e.courseId}|${e.kind}|${sec}`)?.size); }).map((e) => `${e.code ?? e.courseId} ${e.kind.toLowerCase()} §${secOf(e.courseId, e.kind)}`);
    const instructors = [...new Set(expected.filter((e) => e.kind !== "CLINICAL" && e.current).flatMap((e) => { const sec = secOf(e.courseId, e.kind); return sec == null ? [] : [...(staffByKey.get(`${e.courseId}|${e.kind}|${sec}`)?.values() ?? [])].map((p) => p.name); }))];
    const clinical = clinicalCourses.map((c) => {
      const mine = st.shifts.filter((sh) => sessionInfo.get(sh.sessionId)?.courseId === c.id);
      const scheduled = mine.reduce((n, sh) => n + (sessionInfo.get(sh.sessionId)?.lengthHours ?? 0), 0);
      const logged = mine.reduce((n, sh) => n + (sh.status === "completed" ? sh.hoursLogged ?? 0 : 0), 0);
      const missed = mine.filter((sh) => sh.status === "absent" || sh.status === "excused").length;
      const missedHours = mine.filter((sh) => sh.status === "absent" || sh.status === "excused").reduce((n, sh) => n + (sessionInfo.get(sh.sessionId)?.lengthHours ?? 0), 0);
      const done = mine.filter((sh) => sh.status !== "scheduled").length;
      // Unsupervised: the role the session's supervision model requires — a preceptor, a college instructor, or both — is not named on the shift.
      const sups = mine.map((sh) => ({ sh, sup: supOf(sh) }));
      const unprecepted = sups.filter(({ sh, sup }) => (sup.preceptorNeeded && !sh.preceptorId) || (sup.instructorNeeded && !sh.instructorId)).length;
      const instructorHours = sups.reduce((n, { sup }) => n + sup.instructorShare, 0), preceptorHours = sups.reduce((n, { sup }) => n + sup.preceptorShare, 0);
      const sec = secOf(c.id, "CLINICAL");
      const preceptors = [...new Set(mine.map((sh) => sh.preceptorId).filter((x): x is string => !!x))].map(personName);
      const instructors = [...new Set(mine.map((sh) => sh.instructorId).filter((x): x is string => !!x))].map(personName);
      // Hours still reachable = what is scheduled but not yet happened; short = required beyond logged + still-scheduled.
      const remaining = scheduled - logged - missedHours;
      return { courseId: c.id, code: c.code, shifts: mine.length, done, scheduled, logged, missed, missedHours, remaining, unprecepted, instructorHours, preceptorHours, site: sec != null ? siteOf(c.id, sec) : null, preceptors, instructors, short: Math.max(0, c.requiredHours - logged - remaining) };
    });
    const req = clinicalCourses.reduce((n, c) => n + c.requiredHours, 0);
    return {
      id: st.id, name: st.name, status: st.status, cohortEnds, seat: st.sectionIndex, attended: st.shifts.filter((x) => x.status === "completed").length, missed: st.shifts.filter((x) => x.status === "absent" || x.status === "excused").length,
      missingSections, unstaffedSections, instructors, clinical,
      requiredHours: req, scheduledHours: clinical.reduce((n, c) => n + c.scheduled, 0), loggedHours: clinical.reduce((n, c) => n + c.logged, 0), missedShifts: clinical.reduce((n, c) => n + c.missed, 0), shortHours: clinical.reduce((n, c) => n + c.short, 0), unprecepted: clinical.reduce((n, c) => n + c.unprecepted, 0),
      instructorHours: clinical.reduce((n, c) => n + c.instructorHours, 0), preceptorHours: clinical.reduce((n, c) => n + c.preceptorHours, 0),
    };
  });
  return { cohortId: co.id, name: co.name, enrolled, currentTerm: current ? { index: current.index, name: current.name } : null, clinicalCourses, students, today: today.toISOString().slice(0, 10) };
}

export async function getLearnerAnalytics() {
  const students = await prisma.student.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, status: true, stageKey: true, entryYear: true, dob: true, sex: true, raceEthnicity: true, county: true, city: true, zip: true, residency: true, priorEducation: true, employmentStatus: true, firstGeneration: true, veteran: true, pellEligible: true, disability: true, withdrawalReason: true, gpa: true, startDate: true, completionDate: true, program: { select: { id: true, name: true, institution: { select: { id: true, name: true } } } }, cohort: { select: { id: true, name: true, cohortTerms: { select: { endDate: true } } } } } });
  // The cohort's end (its last term's end date): a completion rate counts only cohorts that have ended (Phase 6).
  const endOf = (c: { cohortTerms: { endDate: Date | null }[] } | null) => { const ends = (c?.cohortTerms ?? []).map((t) => t.endDate).filter((d): d is Date => !!d); return ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))).toISOString().slice(0, 10) : null; };
  return students.map((s) => ({ id: s.id, name: s.name, status: s.status, stageKey: s.stageKey, entryYear: s.entryYear, institution: s.program.institution.name, institutionId: s.program.institution.id, program: s.program.name, programId: s.program.id, cohort: s.cohort?.name ?? null, cohortId: s.cohort?.id ?? null, cohortEnds: endOf(s.cohort), gradYear: classYearOf(s.cohort?.name), startDate: s.startDate?.toISOString().slice(0, 10) ?? null, completionDate: s.completionDate?.toISOString().slice(0, 10) ?? null, dob: s.dob?.toISOString().slice(0, 10) ?? null, sex: s.sex, raceEthnicity: s.raceEthnicity, county: s.county, city: s.city, zip: s.zip, residency: s.residency, priorEducation: s.priorEducation, employmentStatus: s.employmentStatus, firstGeneration: s.firstGeneration, veteran: s.veteran, pellEligible: s.pellEligible, disability: s.disability, withdrawalReason: s.withdrawalReason, gpa: s.gpa }));
}

/** Every offering that is a record, for the analytics pickers — a class with no students is still an option (it says so), never missing. */
export async function getAnalyticsCohorts() {
  const rows = await prisma.cohort.findMany({ where: NOT_ARCHIVED, orderBy: { name: "asc" }, select: { id: true, name: true, status: true, cohortTerms: { select: { endDate: true } }, program: { select: { id: true, name: true, institution: { select: { id: true, name: true } } } } } });
  return rows.map((c) => { const ends = c.cohortTerms.map((t) => t.endDate).filter((d): d is Date => !!d); return { id: c.id, name: c.name, status: c.status, gradYear: classYearOf(c.name), programId: c.program.id, program: c.program.name, institutionId: c.program.institution.id, institution: c.program.institution.name, cohortEnds: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))).toISOString().slice(0, 10) : null }; });
}

/** The program a family's shared pages (clinical setup, goal) are shown under: its first template. */
export async function getFamilyProgramId(familyId: string): Promise<string | null> {
  const p = await prisma.program.findFirst({ where: { familyId }, orderBy: { name: "asc" }, select: { id: true } });
  return p?.id ?? null;
}
/** The family a program belongs to — its clinical setup and goal are family-level. */
export async function getProgramFamilyId(programId: string): Promise<string | null> {
  const p = await prisma.program.findUnique({ where: { id: programId }, select: { familyId: true } });
  return p?.familyId ?? null;
}

/** Every clinical shift of an offering (or one of its courses) as export rows: who, when, where, with whom. */
export async function getRotationExport(cohortId: string, courseId?: string | null) {
  const co = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { id: true, name: true, program: { select: { id: true, name: true, institutionId: true } }, meetings: { where: { kind: "CLINICAL" }, select: { courseId: true, sectionIndex: true, employer: { select: { name: true } }, staff: { select: { name: true, role: true } } } } } });
  if (!co) return null;
  const [{ ruleBook }, { describeRule }] = await Promise.all([import("./requirementstore"), import("./settingrule")]);
  const book = await ruleBook(co.program.institutionId);
  const { dates } = await sessionDatesForCohort(cohortId);
  const shifts = await prisma.studentShift.findMany({
    where: { cohortId, session: { kind: "CLINICAL", ...(courseId ? { courseId } : {}) } },
    select: { sectionIndex: true, status: true, hoursLogged: true, note: true, pinnedArea: true, settingCode: true, preceptorId: true, instructorId: true, student: { select: { name: true, status: true, sectionIndex: true } }, preceptor: { select: { name: true } }, instructor: { select: { name: true } }, asset: { select: { setting: true, settingCode: true, assetType: true, assetNumber: true, employer: { select: { name: true } } } }, session: { select: { id: true, number: true, title: true, week: true, dayOfWeek: true, startTime: true, lengthHours: true, rotationType: true, clinicalMode: true, facultyNeeded: true, preceptorsNeeded: true, course: { select: { id: true, code: true, name: true, term: { select: { name: true } } } } } } },
  });
  const course = courseId ? shifts[0]?.session.course ?? (await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, code: true, name: true } })) : null;
  // Learners on each shift (session × section), the same count site load uses, so the two exports state the same shares.
  const learnersOn = new Map<string, number>();
  for (const s of shifts) if (s.status === "completed" || (s.status === "scheduled" && s.student.status !== "withdrawn")) { const k = `${s.session.id}|${s.sectionIndex}`; learnersOn.set(k, (learnersOn.get(k) ?? 0) + 1); }
  const rows: import("./rotationexport").RotationRow[] = shifts.map((s) => {
    const m = co.meetings.find((x) => x.courseId === s.session.course.id && x.sectionIndex === s.sectionIndex);
    const patternPreceptor = m?.staff?.role === "preceptor" ? m.staff.name : null, patternInstructor = m?.staff?.role === "instructor" ? m.staff.name : null;
    const preceptor = s.preceptor?.name ?? patternPreceptor ?? null, instructor = s.instructor?.name ?? patternInstructor ?? null;
    const sup = supervisionOnShift({ clinicalMode: s.session.clinicalMode, facultyNeeded: s.session.facultyNeeded, preceptorsNeeded: s.session.preceptorsNeeded, lengthHours: s.session.lengthHours, learners: learnersOn.get(`${s.session.id}|${s.sectionIndex}`) ?? 0, preceptorNamed: !!preceptor, instructorNamed: !!instructor, attended: s.status === "completed" || s.status === "scheduled" });
    return {
      student: s.student.name, seat: s.student.sectionIndex, cohort: co.name, program: co.program.name,
      course: s.session.course.code ?? s.session.course.name, courseName: s.session.course.name, term: s.session.course.term.name,
      week: s.session.week, date: dates.get(s.session.id) ?? null, weekday: s.session.dayOfWeek, start: s.session.startTime, hours: s.session.lengthHours,
      session: `CLINICAL ${s.session.number}${s.session.title ? ` · ${s.session.title}` : ""}`,
      setting: s.asset?.settingCode ?? s.settingCode ?? null, area: s.pinnedArea ?? s.session.rotationType ?? null,
      site: s.asset?.employer.name ?? m?.employer?.name ?? null, asset: s.asset ? `${s.asset.setting} ${s.asset.assetNumber} (${s.asset.assetType})` : null,
      preceptor, status: s.status, hoursLogged: s.hoursLogged, pinned: !!s.pinnedArea, note: s.note,
      instructor: instructor ?? (sup.instructorNeeded ? null : "none required"), supervision: sup.supervision, learnersOnShift: sup.learnersOnShift, instructorHours: sup.instructorShare, preceptorHours: sup.preceptorShare,
    };
  });
  // The setting rule each rotation type in these rows means, as the evaluation service reads it (lib/requirementstore).
  const rules: import("./rotationexport").RotationRuleSheetRow[] = [...new Set(shifts.map((s) => s.session.rotationType).filter((t): t is string => !!t))].sort().map((t) => {
    const spec = book.rules.get(t.toLowerCase()) ?? null;
    return { rotationType: t, rule: spec ? describeRule(spec.rule) : "no setting rule (unmapped)", wording: spec?.sourceText ?? null, status: spec?.status ?? "unmapped", mixing: spec?.mixing ?? "unknown", continuity: spec?.continuity ?? "unknown", questions: spec?.questions ?? [] };
  });
  return { cohort: { id: co.id, name: co.name, program: co.program.name }, course: course ? { id: course.id, code: course.code, name: course.name } : null, rows, rules };
}

/** Every clinical student-shift at the institution as a site-load row, plus each site's seats in the program's settings. */
export async function getSiteLoad(institutionId?: string): Promise<{ institution: { id: string; name: string }; rows: import("./siteload").LoadRow[]; withdrawn: { excluded: number; kept: number; students: number }; seats: import("./siteload").SiteSeats[]; familySettings: Record<string, string[]>; programs: string[]; cohorts: string[]; terms: string[]; settings: string[] } | null> {
  if (institutionId === ALL_INSTITUTIONS) {
    // Every college together: each one's load, then one table.
    const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true } });
    const parts = (await Promise.all(institutions.map((i) => getSiteLoad(i.id)))).filter((p): p is NonNullable<typeof p> => !!p);
    const uniq = (xs: string[]) => [...new Set(xs)].sort();
    return { institution: { id: ALL_INSTITUTIONS, name: "All colleges" }, rows: parts.flatMap((p) => p.rows), withdrawn: parts.reduce((a, p) => ({ excluded: a.excluded + p.withdrawn.excluded, kept: a.kept + p.withdrawn.kept, students: a.students + p.withdrawn.students }), { excluded: 0, kept: 0, students: 0 }), seats: parts.flatMap((p) => p.seats), familySettings: Object.assign({}, ...parts.map((p) => p.familySettings)), programs: uniq(parts.flatMap((p) => p.programs)), cohorts: uniq(parts.flatMap((p) => p.cohorts)), terms: uniq(parts.flatMap((p) => p.terms)), settings: uniq(parts.flatMap((p) => p.settings)) };
  }
  const inst = institutionId
    ? await prisma.institution.findUnique({ where: { id: institutionId }, select: { id: true, name: true } })
    : await defaultInstitution();
  if (!inst) return null;
  const cohorts = await prisma.cohort.findMany({
    where: { program: { institutionId: inst.id }, ...NOT_ARCHIVED },
    select: { id: true, name: true, program: { select: { id: true, name: true, familyId: true, family: { select: { id: true, name: true, serviceAreas: { select: { settingCodes: true } }, requirementSets: { select: { items: { select: { settingCodes: true } } } }, familySites: { select: { employerId: true, agreementStatus: true } } } } } }, meetings: { where: { kind: "CLINICAL" }, select: { courseId: true, sectionIndex: true, employerId: true, staffPersonId: true, staff: { select: { name: true, role: true } } } } },
  });
  // Every site with its seats: each active asset (a unit, room or suite), the shift blocks it runs and the learners it takes per shift.
  const employers = await prisma.employer.findMany({ where: { institutionId: inst.id }, select: { id: true, name: true, organization: true, county: true, ring: true, facilityType: true, driveMinutes: true, agreementStatus: true, assets: { where: { status: { not: "archived" } }, select: { id: true, externalId: true, assetType: true, assetNumber: true, settingCode: true, learnersPerShift: true, shiftBlocks: true } }, people: { where: { active: true, role: "preceptor" }, select: { id: true } } } });
  const empById = new Map(employers.map((e) => [e.id, e]));
  const assetName = (a: { externalId: string | null; assetType: string; assetNumber: number }) => a.externalId ?? `${a.assetType} #${a.assetNumber}`;
  const seats: import("./siteload").SiteSeats[] = employers.filter((e) => e.assets.length).map((e) => ({ employerId: e.id, preceptorsOnRecord: e.people.length, assets: e.assets.map((a) => ({ assetId: a.id, name: assetName(a), settingCode: a.settingCode, learnersPerShift: a.learnersPerShift, blocks: a.shiftBlocks.split(",").map((x) => x.trim()).filter(Boolean) })) }));
  const rotations = new Map((await prisma.rotationSetting.findMany({ where: { institutionId: inst.id }, select: { rotationType: true, settingCode: true } })).map((r) => [r.rotationType.toLowerCase(), r.settingCode]));
  const rows: import("./siteload").LoadRow[] = [];
  const familySettings: Record<string, string[]> = {};
  for (const co of cohorts) {
    const { dates } = await sessionDatesForCohort(co.id);
    const fam = co.program.family;
    if (fam && !familySettings[fam.id]) familySettings[fam.id] = [...familySettingSet(fam, { sets: fam.requirementSets })];
    const agreementBy = new Map((fam?.familySites ?? []).map((f) => [f.employerId, f.agreementStatus]));
    // The seats the plan booked for this offering: per session × section × asset, the date and shift block the shift lands on.
    const bookings = await prisma.assetBooking.findMany({ where: { cohortId: co.id, sessionId: { not: null } }, select: { assetId: true, sessionId: true, sectionIndex: true, date: true, block: true } });
    const seatOf = new Map<string, { date: string; block: string }>();
    for (const bk of bookings) { const k = `${bk.sessionId}|${bk.sectionIndex}|${bk.assetId}`; if (!seatOf.has(k)) seatOf.set(k, { date: bk.date.toISOString().slice(0, 10), block: bk.block }); }
    const shifts = await prisma.studentShift.findMany({ where: { cohortId: co.id, session: { kind: "CLINICAL" } }, select: { studentId: true, sectionIndex: true, status: true, hoursLogged: true, settingCode: true, preceptorId: true, instructorId: true, student: { select: { name: true, status: true, keepAssignments: true } }, preceptor: { select: { name: true } }, instructor: { select: { name: true } }, asset: { select: { id: true, employerId: true, settingCode: true, externalId: true, assetType: true, assetNumber: true, learnersPerShift: true } }, session: { select: { id: true, lengthHours: true, rotationType: true, preceptorsNeeded: true, facultyNeeded: true, clinicalMode: true, course: { select: { id: true, code: true, name: true, term: { select: { name: true } } } } } } } });
    // The learners on each shift (cohort × session × section): everyone who attended or is due to — a withdrawn learner's
    // unattended shift is not on it, a logged absence is not on it. A supervisor's hours on the shift are shared across them.
    const learnersOn = new Map<string, number>();
    for (const s of shifts) {
      const on = s.status === "completed" || (s.status === "scheduled" && s.student.status !== "withdrawn");
      if (!on) continue;
      const k = `${s.session.id}|${s.sectionIndex}`;
      learnersOn.set(k, (learnersOn.get(k) ?? 0) + 1);
    }
    for (const s of shifts) {
      const m = co.meetings.find((x) => x.courseId === s.session.course.id && x.sectionIndex === s.sectionIndex);
      // The section's usual lead staff on the calendar pattern stands in for a shift with no pin of that role — by that person's role, never across roles.
      const patternPreceptor = m?.staff?.role === "preceptor" ? { id: m.staffPersonId, name: m.staff.name } : null;
      const patternInstructor = m?.staff?.role === "instructor" ? { id: m.staffPersonId, name: m.staff.name } : null;
      const preceptorId = s.preceptorId ?? patternPreceptor?.id ?? null;
      const instructorId = s.instructorId ?? patternInstructor?.id ?? null;
      const sup = supervisionOnShift({ clinicalMode: s.session.clinicalMode, facultyNeeded: s.session.facultyNeeded, preceptorsNeeded: s.session.preceptorsNeeded, lengthHours: s.session.lengthHours, learners: learnersOn.get(`${s.session.id}|${s.sectionIndex}`) ?? 0, preceptorNamed: !!preceptorId, instructorNamed: !!instructorId, attended: s.status === "completed" || s.status === "scheduled" });
      // A seated shift lands on the booking's date and block (the plan may have moved it); an unseated one on its pattern date.
      const seat = s.asset ? seatOf.get(`${s.session.id}|${s.sectionIndex}|${s.asset.id}`) ?? null : null;
      // A pin with no booking behind it is not a seat: the roster's seat is the booking (asset × date × block); without one the
      // shift is unseated on its pattern date, never counted as load on that asset.
      const seated = seat ? s.asset : null;
      const employerId = (seat ? s.asset?.employerId : null) ?? m?.employerId ?? null;
      const e = employerId ? empById.get(employerId) : undefined;
      const iso = seat?.date ?? dates.get(s.session.id) ?? null;
      const d = iso ? new Date(iso + "T00:00:00Z") : null;
      rows.push({
        studentId: s.studentId, student: s.student.name, cohortId: co.id, cohort: co.name, programId: co.program.id, program: co.program.name, familyId: fam?.id ?? null, family: fam?.name ?? null,
        course: s.session.course.code ?? s.session.course.name, term: s.session.course.term.name,
        date: iso, hours: s.status === "completed" ? s.hoursLogged ?? s.session.lengthHours : s.status === "absent" || s.status === "excused" ? 0 : s.session.lengthHours, status: s.status,
        year: d ? d.getUTCFullYear() : null, semester: d ? seasonOfDate(d) : null, dayOfWeek: d ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] : null,
        employerId, site: e?.name ?? "site TBD", system: e?.organization ?? null, county: e?.county ?? null, ring: e?.ring ?? null, facilityType: e?.facilityType ?? null, driveMinutes: e?.driveMinutes ?? null,
        setting: seated?.settingCode ?? s.settingCode ?? rotations.get((s.session.rotationType ?? "").trim().toLowerCase()) ?? null,
        assetId: seated?.id ?? null, asset: seated ? assetName(seated) : null, block: seated ? seat!.block : null, seatsPerShift: seated?.learnersPerShift ?? null,
        preceptorId, preceptor: s.preceptor?.name ?? patternPreceptor?.name ?? null,
        instructorId, instructor: s.instructor?.name ?? patternInstructor?.name ?? null,
        ...sup,
        agreement: employerId ? agreementBy.get(employerId) ?? e?.agreementStatus ?? "none" : "none",
        studentStatus: s.student.status, keepAssignments: s.student.keepAssignments, preceptorsNeeded: s.session.preceptorsNeeded ?? 0,
      });
    }
  }
  // Withdrawn students leave future demand unless kept (Phase 4).
  const { withdrawnRule } = await import("./siteload");
  const ruled = withdrawnRule(rows, new Date().toISOString().slice(0, 10));
  return { institution: inst, rows: ruled.rows, withdrawn: { excluded: ruled.excluded, kept: ruled.kept, students: ruled.students }, seats, familySettings, programs: [...new Set(rows.map((r) => r.program))].sort(), cohorts: [...new Set(rows.map((r) => r.cohort))].sort(), terms: [...new Set(rows.map((r) => r.term))].sort(), settings: [...new Set(rows.map((r) => r.setting ?? "(no setting)"))].sort() };
}

// ── Where the offerings run: campuses (rooms the class and lab sessions are booked in) and the
//    clinical sites their shifts are booked at, located for a map ─────────────────────────────
export interface MapPoint {
  id: string; kind: "campus" | "site"; name: string; institution: string; institutionId: string;
  city: string | null; lat: number; lng: number;
  /** The offerings at this place, with what runs there. */
  offerings: { cohortId: string; cohort: string; program: string; programId: string; status: string; students: number; kinds: string[] }[];
}
export async function getOfferingsMap(): Promise<{ points: MapPoint[]; unlocated: { cohort: string; program: string; institution: string }[] }> {
  const { geocodeOffline } = await import("./geo");
  const cohorts = await prisma.cohort.findMany({
    where: NOT_ARCHIVED,
    select: {
      id: true, name: true, status: true, _count: { select: { students: true } },
      program: { select: { id: true, name: true, institution: { select: { id: true, name: true, city: true, state: true, campuses: { select: { id: true, name: true, city: true, state: true, lat: true, lng: true, isMain: true } } } } } },
      meetings: { select: { kind: true, facility: { select: { id: true, name: true, buildingRef: { select: { campus: { select: { id: true, name: true, city: true, state: true, lat: true, lng: true } } } } } }, employer: { select: { id: true, name: true, city: true, state: true, lat: true, lng: true } } } },
    },
    orderBy: { startDate: "asc" },
  });
  const points = new Map<string, MapPoint>();
  const unlocated: { cohort: string; program: string; institution: string }[] = [];
  const locate = (p: { lat: number | null; lng: number | null; city: string | null; state: string | null }) => {
    if (p.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng };
    const g = geocodeOffline({ city: p.city, state: p.state ?? "NC" });
    return g ? { lat: g.lat, lng: g.lng } : null;
  };
  const add = (key: string, kind: MapPoint["kind"], name: string, inst: { id: string; name: string }, place: { lat: number | null; lng: number | null; city: string | null; state: string | null }, co: (typeof cohorts)[number], k: string) => {
    const loc = locate(place); if (!loc) return false;
    const pt = points.get(key) ?? { id: key, kind, name, institution: inst.name, institutionId: inst.id, city: place.city, ...loc, offerings: [] };
    let o = pt.offerings.find((x) => x.cohortId === co.id);
    if (!o) { o = { cohortId: co.id, cohort: co.name, program: co.program.name, programId: co.program.id, status: co.status, students: co._count.students, kinds: [] }; pt.offerings.push(o); }
    if (!o.kinds.includes(k)) o.kinds.push(k);
    points.set(key, pt); return true;
  };
  for (const co of cohorts) {
    const inst = co.program.institution;
    let placed = false;
    for (const m of co.meetings) {
      if (m.kind === "CLINICAL") { if (m.employer && add(`site:${m.employer.id}`, "site", m.employer.name, inst, m.employer, co, "clinical")) placed = true; continue; }
      const campus = m.facility?.buildingRef?.campus;
      if (campus && add(`campus:${campus.id}`, "campus", campus.name, inst, campus, co, m.kind.toLowerCase())) placed = true;
    }
    if (!placed) {
      // Not calendarized (or no room yet): it runs at the college's main campus.
      const main = inst.campuses.find((c) => c.isMain) ?? inst.campuses[0] ?? null;
      const place = main ?? { lat: null, lng: null, city: inst.city, state: inst.state };
      if (!add(main ? `campus:${main.id}` : `inst:${inst.id}`, "campus", main?.name ?? inst.name, inst, place, co, "campus")) unlocated.push({ cohort: co.name, program: co.program.name, institution: inst.name });
    }
  }
  const out = [...points.values()].sort((a, b) => a.institution.localeCompare(b.institution) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  return { points: out, unlocated };
}

// ── Clinical hours, two ways: the session table vs the hours coded by setting ──────────────────
// A program's clinical hours per student come from its clinical session rows. The requirement
// roll-up and the by-setting grid read a second figure: the hours each course codes against a
// setting (CourseClinicalRequirement — Sandhills' workbook "course allocation" table). When the
// two disagree the difference is hours no setting claims; it must be shown, never hidden.
export async function getFamilyClinicalHoursBridge(familyId: string): Promise<{ programs: import("./hoursbridge").BridgeProgram[] }> {
  const { programHoursBridge } = await import("./hoursbridge");
  const programs = await prisma.program.findMany({ where: { familyId }, orderBy: { name: "asc" }, select: { id: true, name: true, terms: { select: { courses: { select: { code: true, name: true, sessions: { where: { kind: "CLINICAL" }, select: { lengthHours: true } }, clinicalRequirements: { select: { hoursPerStudent: true } } } } } } } });
  return {
    programs: programs
      .map((p) => programHoursBridge(p.id, p.name, p.terms.flatMap((t) => t.courses).map((c) => ({ course: c.code ?? c.name, sessionHours: c.sessions.reduce((n, s) => n + s.lengthHours, 0), codedHours: c.clinicalRequirements.reduce((n, r) => n + r.hoursPerStudent, 0) }))))
      .filter((p) => p.sessionHours > 0 || p.codedHours > 0),
  };
}

/** Where an institution's dates come from (Phase 3): whether a college calendar was imported, and how
 *  many term dates of its planned and running offerings come from it versus being set by hand or from
 *  the program pattern. `institutionId` omitted or "all" → every institution. */
export async function getCalendarProvenance(institutionId?: string | null) {
  const where = institutionId && institutionId !== ALL_INSTITUTIONS ? { id: institutionId } : {};
  const insts = await prisma.institution.findMany({ where, orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { academicEvents: { where: { kind: "term_start" } } } }, programs: { select: { calendarMode: true, cohorts: { where: NOT_ARCHIVED, select: { cohortTerms: { select: { source: true } } } } } } } });
  const per = insts.map((i) => {
    // A continuing-education class (calendarMode continuous) is dated by its own first day, not by a semester the
    // calendar could have supplied: its chosen dates count as taken from the calendar, not as hand-set stand-ins.
    const terms = i.programs.flatMap((p) => p.cohorts.flatMap((c) => c.cohortTerms.map((t) => ({ source: p.calendarMode === "continuous" && (t.source === "chosen" || t.source === "manual") ? "calendar" : t.source }))));
    const n = (src: string[]) => terms.filter((t) => src.includes(t.source ?? "")).length;
    return { id: i.id, name: i.name, calendarImported: i._count.academicEvents > 0, termsTotal: terms.length, termsFromCalendar: n(["calendar"]), termsHandSet: n(["chosen", "manual"]), termsPattern: n(["pattern", "template", ""]) };
  });
  return { institutions: per, all: per.reduce((a, p) => ({ calendarImported: a.calendarImported && p.calendarImported, termsTotal: a.termsTotal + p.termsTotal, termsFromCalendar: a.termsFromCalendar + p.termsFromCalendar, termsHandSet: a.termsHandSet + p.termsHandSet, termsPattern: a.termsPattern + p.termsPattern }), { calendarImported: per.length > 0, termsTotal: 0, termsFromCalendar: 0, termsHandSet: 0, termsPattern: 0 }) };
}

/** The three capacity views' headline totals for ONE scope (institution × window), side by side, with the scope
 *  difference that explains any gap (Phase 4): the scheduler's demand and site capacity's demand are the same
 *  learner-shifts by definition (lib/clinicaldemand); site load counts the roster's assigned student-shifts. */
export async function getCapacityBridge(institutionId: string, from: string, to: string) {
  const { schedulerModel, filterDemand } = await import("./schedulerplan");
  const { clinicalDemandRows, learnerShifts, inWindow } = await import("./clinicaldemand");
  const { buildInstances } = await import("./capacitymodel");
  const data = await getCapacityModel({ institutionId });
  if (!data) return null;
  const rows = data.cohorts.flatMap((c) => buildInstances({
    cohortId: c.cohortId, cohort: c.cohort, programId: c.programId, program: c.program, enrollmentByTerm: c.enrollmentByTerm,
    termStartByIndex: Object.fromEntries(Object.entries(c.termStartByIndex).map(([k, v]) => [k, v ? new Date(v) : null])),
    termEndByIndex: c.termEndByIndex, termWeeksByIndex: c.termWeeksByIndex, holidays: c.holidays, holidayRule: c.holidayRule, courses: c.courses,
  } as import("./capacitymodel").CohortCalendarInput, c.assumptions).filter((i) => i.dateIso != null));
  const rotations = await prisma.rotationSetting.findMany({ where: institutionId === ALL_INSTITUTIONS ? {} : { institutionId: data.institution.id }, select: { rotationType: true, settingCode: true, rule: true, sourceText: true, interpretationStatus: true } });
  const { ruleFromLegacy } = await import("./settingrule");
  const rotationRows = rotations.map((r) => ({ rotationType: r.rotationType, settingCode: r.settingCode, unitCategory: "", rule: ruleFromLegacy(r), sourceText: r.sourceText, interpretationStatus: r.interpretationStatus }));
  const courseRules = await (await import("./requirementstore")).coursePoolRules(data.cohorts.map((c) => c.programId));
  const capacityDemand = learnerShifts(inWindow(clinicalDemandRows(rows, rotationRows, courseRules), from, to));
  const { demand } = schedulerModel(data.cohorts, rotationRows, courseRules);
  const schedulerDemand = filterDemand(demand, { from, to, cohortIds: [] }).reduce((n, u) => n + u.seats, 0);
  const load = await getSiteLoad(institutionId === ALL_INSTITUTIONS ? ALL_INSTITUTIONS : data.institution.id);
  const loadRows = (load?.rows ?? []).filter((r) => r.date != null && r.date >= from && r.date <= to);
  const loadShifts = loadRows.length;
  const loadSeated = loadRows.filter((r) => r.assetId).length;
  return {
    from, to,
    scheduler: { label: "Clinical scheduler", href: "/scheduler", value: schedulerDemand, unit: "learner-shifts", why: "enrollment targets of planned and running offerings, split into sections; per-date moves applied" },
    capacity: { label: "Clinical site capacity", href: "/insights/clinical-sites", value: capacityDemand, unit: "learner-shifts", why: "the same targets on the same dates, before any move — identical to the scheduler by definition" },
    load: { label: "Clinical site load", href: "/insights/site-load", value: loadShifts, unit: "student-shifts", sub: `${loadSeated.toLocaleString("en-US")} on a booked seat`, why: `the roster's student-shifts in the window (named students, including completed cohorts; ${load?.withdrawn.excluded ?? 0} future shifts of withdrawn students left out); ${loadSeated.toLocaleString("en-US")} of them sit on an asset the scheduler booked` },
  };
}

// ── What is on the calendar now: the roster's clinical shifts and how many sit on a seat the scheduler booked ──
export interface RosterPlacement { shifts: number; seated: number; sites: number; bookings: number; /** ISO date of the latest plan booking written, or null. */ writtenAt: string | null }
/** The roster as the scheduler wrote it (lib/planwrite): every clinical student-shift of the college's planned, running and
 *  completed offerings, how many are pinned to a booked asset, the sites those seats are at, and the plan's bookings. */
export async function getRosterPlacement(institutionId: string): Promise<RosterPlacement> {
  // The very rows the site-load page shows (same withdrawn rule, same seats), so the two pages quote one number.
  const load = await getSiteLoad(institutionId);
  const rows = load?.rows ?? [];
  const [bookings, latest] = await Promise.all([
    prisma.assetBooking.count({ where: { cohort: { program: { institutionId } }, note: AUTO_PLAN_NOTE_Q } }),
    prisma.assetBooking.findFirst({ where: { cohort: { program: { institutionId } }, note: AUTO_PLAN_NOTE_Q }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return { shifts: rows.length, seated: rows.filter((r) => r.assetId).length, sites: new Set(rows.filter((r) => r.assetId).map((r) => r.employerId)).size, bookings, writtenAt: latest?.createdAt.toISOString().slice(0, 10) ?? null };
}
const AUTO_PLAN_NOTE_Q = "auto-plan";

// ── THE SHARED SITE REGISTRY ─────────────────────────────────────────────────────────────────────
/** Every clinical site in the world the platform knows, with each college's relationship to it. */
export async function getSiteRegistry() {
  const [sites, institutions] = await Promise.all([
    prisma.clinicalSite.findMany({ orderBy: [{ name: "asc" }], select: {
      id: true, name: true, organization: true, facilityType: true, address: true, city: true, county: true, zip: true, lat: true, licensedBeds: true, operatingRooms: true,
      partners: { select: { id: true, institutionId: true, agreementStatus: true, status: true, driveMinutes: true, ring: true, institution: { select: { id: true, name: true } }, assets: { where: { status: { not: "archived" } }, select: { learnersPerShift: true } }, _count: { select: { people: true, familySites: true } } } },
    } }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { sites, institutions };
}

/** Registry sites a college has not yet made a partner record for — what its Setup page offers to add. */
export async function getRegistryCandidates(institutionId: string) {
  return prisma.clinicalSite.findMany({ where: { partners: { none: { institutionId } } }, orderBy: [{ name: "asc" }], select: { id: true, name: true, city: true, facilityType: true, partners: { select: { institution: { select: { name: true } }, agreementStatus: true } } } });
}
