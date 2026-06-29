import { prisma } from "./db";
import type { TermArchetype } from "./capacity";

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
      family: { select: { id: true, name: true } },
      yearTargets: { orderBy: { year: "asc" } },
      cohorts: { include: { stages: { orderBy: { sortOrder: "asc" } } } },
      programSkills: { include: { skill: true }, orderBy: { skill: { name: "asc" } } },
      terms: {
        orderBy: { index: "asc" },
        include: {
          courses: {
            orderBy: { sequenceOrder: "asc" },
            include: {
              sessions: { include: { skillLinks: { include: { skill: true } } } },
              courseSkills: { include: { skill: true } },
            },
          },
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
    competencyReadiness: data.competency.competencyReadiness,
    placementRaw: data.placement.raw,
    placementEffective: data.placement.effective,
  };
}

/** The institution-wide proficiency scale (levels) for an institution. */
export async function getProficiencyScale(institutionId: string) {
  return prisma.proficiencyScale.findFirst({
    where: { institutionId, isDefault: true },
    include: { levels: { orderBy: { level: "asc" } } },
  });
}

/** All skills in an institution's library with usage counts. */
export async function getSkillLibrary(institutionId: string) {
  return prisma.skill.findMany({
    where: { institutionId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    include: {
      descriptors: { orderBy: { level: "asc" } },
      _count: { select: { programSkills: true, courseSkills: true } },
    },
  });
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

  const gradYearOf = (name: string): number | null => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : null; };
  const seasonOf = (name: string, month?: number | null): string => {
    const n = name.toLowerCase();
    if (n.includes("fall")) return "Fall";
    if (n.includes("spring")) return "Spring";
    if (n.includes("summer")) return "Summer";
    if (month != null) return month >= 8 ? "Fall" : month <= 5 ? "Spring" : "Summer";
    return "Fall";
  };

  type Fact = { institution: string; family: string; program: string; programType: string; cohort: string; metricGroup: string; metric: string; year: number | null; term: string | null; semester: string | null; value: number; target: number | null; actual: number | null };
  const facts: Fact[] = [];

  for (const inst of insts) {
    for (const p of inst.programs) {
      const family = p.family?.name ?? p.name;
      const base = { institution: inst.name, family, program: p.name, programType: p.programType };
      for (const co of p.cohorts) {
        const gradYear = gradYearOf(co.name) ?? co.entryYear ?? null;
        const entryYear = co.startDate ? co.startDate.getUTCFullYear() : (gradYear ? gradYear - 2 : null);
        const entrySemester = co.startDate ? seasonOf("", co.startDate.getUTCMonth() + 1) : "Fall";
        // --- Pipeline facts (target / actual per stage) ---
        for (const s of co.stages) {
          facts.push({ ...base, cohort: co.name, metricGroup: "Pipeline", metric: s.label, year: gradYear, term: null, semester: entrySemester, value: s.actualNumber ?? s.targetNumber ?? 0, target: s.targetNumber, actual: s.actualNumber });
        }
        // --- Delivery / FTE facts (per term, scaled to cohort enrollment) ---
        const enrollment = Math.round(co.plannedSeats ?? p.defaultCohortSeats ?? 40);
        const ctYear = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate ? ct.startDate.getUTCFullYear() : null]));
        for (const t of p.terms) {
          const sessions = t.courses.flatMap((c) => c.sessions.map((s) => ({ id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded })));
          if (sessions.length === 0) continue;
          const r = courseService(sessions, enrollment, DEFAULT_SERVICE).totals;
          const termYear = ctYear.get(t.id) ?? (entryYear != null ? entryYear + Math.floor((t.index - 1) / 2) : gradYear);
          const sem = seasonOf(t.name);
          const dbase = { ...base, cohort: co.name, metricGroup: "Delivery", year: termYear, term: t.name, semester: sem };
          const add = (metric: string, value: number) => facts.push({ ...dbase, metric, value, target: null, actual: value });
          add("Faculty FTE", Math.round(r.facultyFte * 1000) / 1000);
          add("Faculty contact hours", Math.round(r.facultyContactHours * 10) / 10);
          add("Preceptor FTE", Math.round(r.preceptorFte * 1000) / 1000);
          add("Preceptor contact hours", Math.round(r.preceptorContactHours * 10) / 10);
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
  const gradYearOf = (name: string): number | null => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : null; };

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
      institution: true,
      occupation: true,
      programs: {
        orderBy: { name: "asc" },
        include: {
          yearTargets: { orderBy: { year: "asc" } },
          _count: { select: { terms: true } },
          terms: { include: { courses: { include: { sessions: true } } } },
          cohorts: {
            orderBy: { name: "asc" },
            include: { stages: { orderBy: { sortOrder: "asc" } }, _count: { select: { students: true } }, students: { select: { status: true } }, cohortTerms: { select: { termId: true, startDate: true } } },
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
 * supply, ALIGNMENT-CONSTRAINED WBL supply (loop 2), and the competency
 * readiness derived from what's actually assessed (loop 1).
 */
export async function getProgramPlanData(programId: string) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      institution: true,
      yearTargets: { orderBy: { year: "asc" } },
      programSkills: { include: { skill: true } },
      assignments: { include: { person: true } },
      cohorts: true,
      terms: { include: { courses: { include: { sessions: { include: { skillLinks: true } } } } } },
    },
  });
  if (!program) return null;

  const { parseTermCodes } = await import("./calendar");
  const { generateCohortSeries } = await import("./plan");
  const { effectivePlacementCapacity } = await import("./wbl");
  const { analyzeAssessment } = await import("./ksa");

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
  const explicitCohorts = program.cohorts.filter((c) => c.isExplicit && c.entryTermCode && c.entryYear).map((c) => ({
    id: c.id, label: c.name, entryCode: c.entryTermCode as "FALL" | "SPRING" | "SUMMER", entryCalendarYear: c.entryYear!, seats: Math.round(c.plannedSeats ?? program.defaultCohortSeats ?? 30),
  }));
  const cohorts = generateCohortSeries(launchConfig, explicitCohorts);
  const activeCodes = parseTermCodes(program.termSlots);

  // --- Loop 1: assessment → competency readiness ---
  const assessedLevels: Record<string, number> = {};
  for (const term of program.terms) for (const c of term.courses) for (const s of c.sessions) for (const l of s.skillLinks) {
    if (l.mode === "ASSESS" || l.mode === "BOTH") assessedLevels[l.skillId] = Math.max(assessedLevels[l.skillId] ?? 0, l.targetLevel ?? 0);
  }
  const benchmarks = program.programSkills.map((ps) => ({ skillId: ps.skillId, skillName: ps.skill.name, skillType: ps.skill.type, targetLevel: ps.targetLevel, priority: ps.priority }));
  const competency = analyzeAssessment(benchmarks, assessedLevels);

  return { program, archetype, supply, placement, cohorts, activeCodes, launchConfig, competency, assignments: program.assignments };
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
    where: offering ? { cohortId: offering.id, status: { in: ["enrolled", "completed", "placed"] } } : { programId, status: { in: ["enrolled", "completed", "placed"] } },
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
    },
  });
}

/** One offering (cohort run) in full: the program template it instantiates, its
 *  per-term real dates, funnel, and staffing/enrollment counts. */
export async function getOffering(cohortId: string) {
  return prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: { include: { institution: true, terms: { orderBy: { index: "asc" }, include: { _count: { select: { courses: true } } } } } },
      cohortTerms: { include: { term: true } },
      stages: { orderBy: { sortOrder: "asc" } },
      _count: { select: { students: true, sessionStaff: true } },
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
      _count: { select: { grades: true, assessments: true, absences: true } },
    },
  });
  return { program, students };
}

/** A single student's complete record: dated grades, dated KSA assessments,
 *  and dated attendance — the bottom of every drill-down. */
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
      assessments: {
        orderBy: [{ assessedDate: "asc" }],
        include: { skill: { select: { id: true, name: true, type: true } } },
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
  const [raw, institutions, employers, studentCount] = await Promise.all([
    prisma.person.findMany({
      orderBy: { name: "asc" },
      include: {
        institution: { select: { id: true, name: true } },
        employer: { select: { id: true, name: true } },
        _count: { select: { sessionStaff: true, assignments: true } },
        // Cohort-level assignments (this run), for the time-bound load view. Pull
        // the cohort start date + the session's term so each assignment can be
        // bucketed to a real calendar year + semester (and flagged "in session now").
        sessionStaff: {
          where: { cohortId: { not: null } },
          select: {
            contactHours: true,
            cohort: { select: { id: true, name: true, startDate: true, program: { select: { name: true } } } },
            session: { select: { course: { select: { term: { select: { name: true, startWeek: true, endWeek: true } } } } } },
          },
        },
      },
    }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.employer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, institutionId: true } }),
    prisma.student.count(),
  ]);

  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const today = new Date();
  const seasonOf = (d: Date) => { const m = d.getUTCMonth(); return m >= 7 ? "Fall" : m >= 5 ? "Summer" : "Spring"; };

  // Roll each person's cohort assignments into a time-bound load summary: total
  // hours, per calendar year, per semester (year+season), per cohort, and whether
  // any assignment falls in a term that is in session today ("currently working").
  const people = raw.map((p) => {
    type Bucket = { cohortId: string; name: string; program: string; hours: number; year: number | null; season: string | null };
    const buckets: Bucket[] = [];
    const byYear: Record<number, number> = {};
    const bySemester: Record<string, { year: number; season: string; hours: number }> = {};
    let totalHours = 0;
    let workingNow = false;
    let currentHours = 0;
    for (const si of p.sessionStaff) {
      if (!si.cohort) continue;
      const start = si.cohort.startDate;
      const term = si.session?.course?.term ?? null;
      let year: number | null = null, season: string | null = null;
      if (start) {
        const td = new Date(start.getTime() + (((term?.startWeek ?? 1) - 1) * WEEK_MS));
        year = td.getUTCFullYear();
        season = seasonOf(td);
        const termEnd = new Date(start.getTime() + (((term?.endWeek ?? 16)) * WEEK_MS));
        if (today >= td && today < termEnd) { workingNow = true; currentHours += si.contactHours; }
      }
      totalHours += si.contactHours;
      if (year != null) byYear[year] = (byYear[year] ?? 0) + si.contactHours;
      if (year != null && season) {
        const key = `${year} ${season}`;
        const b = bySemester[key] ?? { year, season, hours: 0 };
        b.hours += si.contactHours; bySemester[key] = b;
      }
      // Aggregate into per-cohort+season buckets so the same cohort across terms
      // still rolls up sensibly while keeping the period dimension.
      const bk = buckets.find((x) => x.cohortId === si.cohort!.id && x.year === year && x.season === season);
      if (bk) bk.hours += si.contactHours;
      else buckets.push({ cohortId: si.cohort.id, name: si.cohort.name, program: si.cohort.program.name, hours: si.contactHours, year, season });
    }
    buckets.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.hours - a.hours);
    const semesters = Object.values(bySemester).sort((a, b) => b.year - a.year || a.season.localeCompare(b.season));
    const { sessionStaff: _drop, ...rest } = p;
    return { ...rest, workingNow, currentHours, load: { cohorts: buckets, byYear, semesters, totalHours } };
  });

  return { people, institutions, employers, studentCount };
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
        _count: { select: { people: true } },
        placements: { select: { status: true, startDate: true } },
      },
    }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const seasonOf = (d: Date) => { const m = d.getUTCMonth(); return m >= 7 ? "Fall" : m >= 5 ? "Summer" : "Spring"; };
  // Roll each partner's placements into asked (all non-cancelled) vs secured
  // (active + completed) totals, plus a per-period (year + semester) breakdown.
  const withWbl = employers.map((e) => {
    const byPeriod: Record<string, { year: number; season: string; asked: number; secured: number }> = {};
    let asked = 0, secured = 0;
    for (const pl of e.placements) {
      if (pl.status === "cancelled") continue;
      asked += 1;
      const isSecured = pl.status === "active" || pl.status === "completed";
      if (isSecured) secured += 1;
      if (pl.startDate) {
        const y = pl.startDate.getUTCFullYear();
        const s = seasonOf(pl.startDate);
        const key = `${y} ${s}`;
        const b = byPeriod[key] ?? { year: y, season: s, asked: 0, secured: 0 };
        b.asked += 1; if (isSecured) b.secured += 1; byPeriod[key] = b;
      }
    }
    const periods = Object.values(byPeriod).sort((a, b) => b.year - a.year || a.season.localeCompare(b.season));
    const { placements: _drop, ...rest } = e;
    return { ...rest, wbl: { asked, secured, periods } };
  });
  return { employers: withWbl, institutions };
}

/** One employer partner with its placements (the hosted students). */
export async function getEmployer(id: string) {
  return prisma.employer.findUnique({
    where: { id },
    include: {
      institution: { select: { id: true, name: true } },
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
  const employers = await prisma.employer.findMany({
    where: { institutionId },
    orderBy: { name: "asc" },
    include: { wblSnapshots: { orderBy: { asOfDate: "desc" }, take: 1, include: { factors: true } } },
  });
  return employers.map((e) => ({ employerId: e.id, name: e.name, slots: e.wblSlots ?? 0, snapshot: e.wblSnapshots[0] ?? null }));
}

/** The cohort-wide WBL placement board: every enrolled-and-beyond student with
 *  their latest learner snapshot, plus employer capacity, so the page can
 *  recommend a placement and surface unmet needs per student. */
export async function getProgramWblBoard(programId: string) {
  const program = await prisma.program.findUnique({ where: { id: programId }, include: { institution: true } });
  if (!program) return null;
  const students = await prisma.student.findMany({
    where: { programId, status: { in: ["enrolled", "completed", "placed"] } },
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
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: {
        include: {
          institution: { select: { id: true, name: true } },
          terms: {
            orderBy: { index: "asc" },
            include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { select: { id: true, lengthHours: true, kind: true } } } } },
          },
        },
      },
      sessionStaff: { include: { person: { select: { id: true, name: true, role: true } }, session: { select: { id: true, courseId: true } } } },
    },
  });
  if (!cohort) return null;
  const people = await prisma.person.findMany({
    where: { institutionId: cohort.program.institution.id },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, role: true },
  });
  return { cohort, program: cohort.program, staff: cohort.sessionStaff, people };
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
  // offering concerns). Just catalog detail, the session archetype, and KSAs.
  return prisma.course.findUnique({
    where: { id: courseId },
    include: {
      sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }], include: { resources: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } },
      courseSkills: { include: { skill: true } },
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
  return { students, institutions };
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
  const seasonOf = (name: string, month?: number | null): string => {
    const n = name.toLowerCase();
    if (n.includes("fall")) return "Fall";
    if (n.includes("spring")) return "Spring";
    if (n.includes("summer")) return "Summer";
    if (month != null) return month >= 8 ? "Fall" : month <= 5 ? "Spring" : "Summer";
    return "Fall";
  };

  const cts = await prisma.cohortTerm.findMany({
    include: {
      term: { include: { courses: { include: { sessions: true } } } },
      cohort: {
        include: {
          program: { include: { institution: { select: { name: true } }, family: { select: { id: true, name: true } } } },
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
    const season = seasonOf(ct.term.name, ct.startDate ? ct.startDate.getUTCMonth() + 1 : null);
    const sessions = ct.term.courses.flatMap((c) => c.sessions.map((s) => ({ id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded })));
    const enrollment = Math.round(co.plannedSeats ?? p.defaultCohortSeats ?? 40);
    const t = sessions.length ? courseService(sessions, enrollment, DEFAULT_SERVICE).totals : null;
    // Term date window: real start (from the CohortTerm) + its instructional span.
    const termWeeks = ct.term.startWeek != null && ct.term.endWeek != null && ct.term.endWeek >= ct.term.startWeek ? ct.term.endWeek - ct.term.startWeek + 1 : 16;
    const endDate = ct.startDate ? new Date(ct.startDate.getTime() + termWeeks * WEEK_MS) : null;
    const inSessionNow = !!(ct.startDate && endDate && today >= ct.startDate && today < endDate);
    rows.push({
      sem: season, year: yr,
      cohortId: co.id, cohortName: co.name, programId: p.id, programName: p.name,
      family: p.family?.name ?? null, familyId: p.family?.id ?? null, institution: p.institution.name,
      termName: ct.term.name, termIndex: ct.term.index, enrollment,
      facultyFte: t ? Math.round(t.facultyFte * 100) / 100 : 0,
      preceptorFte: t ? Math.round(t.preceptorFte * 100) / 100 : 0,
      spaceHours: t ? Math.round(t.spaceHours) : 0,
      sections: t ? t.sections : 0,
      startDate: ct.startDate ?? null, endDate, inSessionNow,
      courses: ct.term.courses.map((c) => ({ id: c.id, name: c.name, sessions: c.sessions.length })),
    });
  }

  // Distinct semester options, chronological. Mark the one in session today.
  const optMap = new Map<string, { sem: string; year: number; count: number; current: boolean }>();
  const SEASON_ORDER: Record<string, number> = { Spring: 0, Summer: 1, Fall: 2 };
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
  staffPersonId: string | null; staffName: string | null;
  termIndex: number; weekStartMs: number; weekEndMs: number;
  startLabel: string; endLabel: string;
}

export async function getMasterCalendar(opts?: { institutionId?: string; weekMs?: number }) {
  const { detectConflicts, roomUtilization, toMin, toHHMM } = await import("./space");
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
  if (!institutionId) return { institutions, institutionId: null, rooms: [], meetings: [] as MasterMeeting[], conflicts: [], weeks: [], currentWeekMs: null, programs: [] as { id: string; name: string }[], summary: { roomed: 0, unroomed: 0, clinical: 0, peakUtil: 0 } };

  const [rooms, raw] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, capacity: true, building: true } }),
    prisma.meetingPattern.findMany({
      where: { cohort: { program: { institutionId } } },
      include: {
        facility: { select: { id: true, name: true, kind: true } },
        staff: { select: { id: true, name: true } },
        course: { select: { id: true, code: true, name: true } },
        cohort: { select: { id: true, name: true, program: { select: { id: true, name: true, family: { select: { name: true } } } }, cohortTerms: { select: { startDate: true, term: { select: { index: true } } } } } },
      },
    }),
  ]);

  const dlabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const meetings: MasterMeeting[] = raw.map((m) => {
    const ct = m.cohort.cohortTerms.find((c) => c.term.index === m.termIndex);
    const startMs = ct?.startDate ? ct.startDate.getTime() : 0;
    const tw = Math.max(1, m.endWeek - m.startWeek + 1);
    const weekStartMs = startMs;
    const weekEndMs = startMs + tw * WEEK_MS;
    const endMin = toMin(m.startTime) + m.lengthHours * 60;
    return {
      id: m.id,
      cohortId: m.cohortId, cohortName: m.cohort.name,
      programId: m.cohort.program.id, programName: m.cohort.program.name, family: m.cohort.program.family?.name ?? null,
      courseId: m.courseId, courseCode: m.course.code, courseName: m.course.name,
      kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
      dayOfWeek: m.dayOfWeek, startTime: m.startTime, endTime: toHHMM(Math.round(endMin)), lengthHours: m.lengthHours,
      facilityId: m.facilityId, facilityName: m.facility?.name ?? null, facilityKind: m.facility?.kind ?? null,
      staffPersonId: m.staffPersonId, staffName: m.staff?.name ?? null,
      termIndex: m.termIndex, weekStartMs, weekEndMs,
      startLabel: startMs ? dlabel(weekStartMs) : "—", endLabel: startMs ? dlabel(weekEndMs) : "—",
    };
  });

  // Engine inputs.
  const bookings = meetings.map((m) => ({
    id: m.id, cohortId: m.cohortId, sectionIndex: m.sectionIndex, kind: m.kind, seats: m.seats,
    lengthHours: m.lengthHours, dayOfWeek: m.dayOfWeek as import("./space").Weekday, startMin: toMin(m.startTime),
    weekStartMs: m.weekStartMs, weekEndMs: m.weekEndMs, facilityId: m.facilityId, staffPersonId: m.staffPersonId,
  }));
  const conflicts = detectConflicts(bookings);
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

  return { institutions, institutionId, rooms: roomsOut, meetings, conflicts, weeks, currentWeekMs, programs, summary };
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
  const { detectConflicts, toMin, toHHMM } = await import("./space");
  const WEEK_MS = 7 * 24 * 3600 * 1000;
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: { id: true, name: true, program: { select: { id: true, name: true, institutionId: true } }, cohortTerms: { select: { startDate: true, term: { select: { index: true, name: true } } } } },
  });
  if (!cohort) return null;
  const institutionId = cohort.program.institutionId;
  const [rooms, mine, instMeetings] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, capacity: true } }),
    prisma.meetingPattern.findMany({ where: { cohortId }, include: { facility: { select: { name: true, kind: true } }, staff: { select: { id: true, name: true } }, course: { select: { id: true, code: true, name: true, term: { select: { index: true, name: true } } } } } }),
    prisma.meetingPattern.findMany({ where: { cohort: { program: { institutionId } } }, select: { id: true, cohortId: true, sectionIndex: true, kind: true, seats: true, lengthHours: true, dayOfWeek: true, startTime: true, termIndex: true, startWeek: true, endWeek: true, facilityId: true, staffPersonId: true, cohort: { select: { cohortTerms: { select: { startDate: true, term: { select: { index: true } } } } } } } }),
  ]);

  const winOf = (cohortTerms: { startDate: Date | null; term: { index: number } }[], termIndex: number, startWeek: number, endWeek: number) => {
    const ct = cohortTerms.find((c) => c.term.index === termIndex);
    const s = ct?.startDate ? ct.startDate.getTime() : 0;
    return { weekStartMs: s, weekEndMs: s + Math.max(1, endWeek - startWeek + 1) * WEEK_MS };
  };
  // Institution-wide bookings → conflicts; keep only those touching this cohort.
  const bookings = instMeetings.map((m) => ({ id: m.id, cohortId: m.cohortId, sectionIndex: m.sectionIndex, kind: m.kind, seats: m.seats, lengthHours: m.lengthHours, dayOfWeek: m.dayOfWeek as import("./space").Weekday, startMin: toMin(m.startTime), ...winOf(m.cohort.cohortTerms, m.termIndex, m.startWeek, m.endWeek), facilityId: m.facilityId, staffPersonId: m.staffPersonId }));
  const conflicts = detectConflicts(bookings).filter((c) => { const a = instMeetings.find((m) => m.id === c.aId), b = instMeetings.find((m) => m.id === c.bId); return a?.cohortId === cohortId || b?.cohortId === cohortId; });
  const conflictIds = new Set<string>();
  for (const c of conflicts) { if (instMeetings.find((m) => m.id === c.aId)?.cohortId === cohortId) conflictIds.add(c.aId); if (instMeetings.find((m) => m.id === c.bId)?.cohortId === cohortId) conflictIds.add(c.bId); }

  const meetings = mine.map((m) => {
    const w = winOf(cohort.cohortTerms, m.termIndex, m.startWeek, m.endWeek);
    return {
      id: m.id, courseId: m.courseId, courseCode: m.course.code, courseName: m.course.name,
      termIndex: m.termIndex, termName: m.course.term.name,
      kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
      dayOfWeek: m.dayOfWeek, startTime: m.startTime, endTime: toHHMM(toMin(m.startTime) + m.lengthHours * 60), lengthHours: m.lengthHours,
      facilityId: m.facilityId, facilityName: m.facility?.name ?? null, facilityKind: m.facility?.kind ?? null,
      staffPersonId: m.staffPersonId, staffName: m.staff?.name ?? null,
      weekStartMs: w.weekStartMs, weekEndMs: w.weekEndMs,
      conflict: conflictIds.has(m.id),
    };
  });
  return { cohort, rooms, meetings, conflictCount: conflicts.length };
}
