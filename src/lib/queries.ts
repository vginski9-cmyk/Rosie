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
            include: { stages: { orderBy: { sortOrder: "asc" } }, _count: { select: { students: true } } },
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
  const [people, institutions, employers, studentCount] = await Promise.all([
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
  ]);
  return { people, institutions, employers, studentCount };
}

// ---------------------------------------------------------------------------
// EMPLOYERS WORKSPACE — partner directory, detail, and placement context
// ---------------------------------------------------------------------------

/** Every employer partner across institutions + the institution list for intake. */
export async function getEmployersDirectory() {
  const [employers, institutions] = await Promise.all([
    prisma.employer.findMany({
      orderBy: { name: "asc" },
      include: {
        institution: { select: { id: true, name: true } },
        _count: { select: { people: true } },
        placements: { select: { status: true } },
      },
    }),
    prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { employers, institutions };
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
export async function getOfferingScheduler(cohortId: string) {
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: {
        include: {
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
  const overrides: Record<string, { dayOfWeek: string | null; startTime: string | null; location: string | null }> = {};
  for (const o of cohort.sectionSchedules) overrides[`${o.sessionId}#${o.sectionIndex}`] = { dayOfWeek: o.dayOfWeek, startTime: o.startTime, location: o.location };
  return { cohort, program: cohort.program, enrollment, overrides };
}

/** A single course with its full catalog detail + session-by-session schedule. */
export async function getCourse(courseId: string) {
  // The course is part of the TEMPLATE — no instructors/students here (those are
  // offering concerns). Just catalog detail, the session archetype, and KSAs.
  return prisma.course.findUnique({
    where: { id: courseId },
    include: {
      sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }] },
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
  courses: { id: string; name: string; sessions: number }[];
}

export interface SemesterView {
  options: { sem: string; year: number; count: number }[];
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
    rows.push({
      sem: season, year: yr,
      cohortId: co.id, cohortName: co.name, programId: p.id, programName: p.name,
      family: p.family?.name ?? null, familyId: p.family?.id ?? null, institution: p.institution.name,
      termName: ct.term.name, termIndex: ct.term.index, enrollment,
      facultyFte: t ? Math.round(t.facultyFte * 100) / 100 : 0,
      preceptorFte: t ? Math.round(t.preceptorFte * 100) / 100 : 0,
      spaceHours: t ? Math.round(t.spaceHours) : 0,
      sections: t ? t.sections : 0,
      courses: ct.term.courses.map((c) => ({ id: c.id, name: c.name, sessions: c.sessions.length })),
    });
  }

  // Distinct semester options, chronological.
  const optMap = new Map<string, { sem: string; year: number; count: number }>();
  const SEASON_ORDER: Record<string, number> = { Spring: 0, Summer: 1, Fall: 2 };
  for (const r of rows) {
    const k = `${r.year}-${r.sem}`;
    const e = optMap.get(k) ?? { sem: r.sem, year: r.year, count: 0 };
    e.count += 1;
    optMap.set(k, e);
  }
  const options = [...optMap.values()].sort((a, b) => a.year - b.year || SEASON_ORDER[a.sem] - SEASON_ORDER[b.sem]);

  const selected = sem && year != null && optMap.has(`${year}-${sem}`)
    ? { sem, year }
    : options[0] ? { sem: options[0].sem, year: options[0].year } : null;

  const offerings = selected
    ? rows.filter((r) => r.sem === selected.sem && r.year === selected.year)
        .sort((a, b) => a.institution.localeCompare(b.institution) || (a.family ?? "").localeCompare(b.family ?? "") || a.programName.localeCompare(b.programName) || a.termIndex - b.termIndex)
        .map(({ sem: _s, year: _y, ...rest }) => rest)
    : [];

  return { options, selected, offerings };
}
