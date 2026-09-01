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
      terms: {
        orderBy: { index: "asc" },
        include: {
          courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: true } },
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
  const explicitCohorts = program.cohorts.filter((c) => c.isExplicit && c.entryTermCode && c.entryYear).map((c) => ({
    id: c.id, label: c.name, entryCode: c.entryTermCode as "FALL" | "SPRING" | "SUMMER", entryCalendarYear: c.entryYear!, seats: Math.round(c.plannedSeats ?? program.defaultCohortSeats ?? 30),
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
      program: { include: { institution: true, terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { select: { kind: true, week: true } } } } } } } },
      cohortTerms: { include: { term: true } },
      courseDates: true,
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
      _count: { select: { grades: true, absences: true } },
    },
  });
  return { program, students };
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
  employerId: string | null; employerName: string | null;
  staffPersonId: string | null; staffName: string | null;
  termIndex: number; weekStartMs: number; weekEndMs: number;
  startLabel: string; endLabel: string;
  /** Session titles for this meeting's kind, week by week (from the template). */
  sessionTitles: { week: number | null; title: string | null }[];
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
  if (!institutionId) return { institutions, institutionId: null, rooms: [], people: [] as { id: string; name: string; role: string }[], employers: [] as { id: string; name: string; setting: string | null }[], meetings: [] as MasterMeeting[], conflicts: [], weeks: [], currentWeekMs: null, programs: [] as { id: string; name: string }[], summary: { roomed: 0, unroomed: 0, clinical: 0, peakUtil: 0 } };

  const [rooms, calPeople, calEmployers, raw] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true, capacity: true, building: true } }),
    prisma.person.findMany({ where: { institutionId, active: true, role: { in: ["instructor", "preceptor", "coordinator"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    prisma.employer.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, setting: true } }),
    prisma.meetingPattern.findMany({
      where: { cohort: { program: { institutionId } } },
      include: {
        facility: { select: { id: true, name: true, kind: true } },
        employer: { select: { id: true, name: true } },
        staff: { select: { id: true, name: true } },
        course: { select: { id: true, code: true, name: true, term: { select: { index: true, startWeek: true, endWeek: true } }, sessions: { select: { kind: true, week: true, number: true, title: true }, orderBy: [{ week: "asc" }, { number: "asc" }] } } },
        cohort: { select: { id: true, name: true, program: { select: { id: true, name: true, family: { select: { name: true } } } }, cohortTerms: { select: { startDate: true, term: { select: { index: true } } } } } },
      },
    }),
  ]);

  const dlabel = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
      employerId: m.employerId, employerName: m.employer?.name ?? null,
      staffPersonId: m.staffPersonId, staffName: m.staff?.name ?? null,
      termIndex: liveIdx, weekStartMs, weekEndMs,
      startLabel: startMs ? dlabel(weekStartMs) : "—", endLabel: startMs ? dlabel(weekEndMs) : "—",
      // Session titles for this meeting's kind — what actually happens in the room/at the site, week by week.
      sessionTitles: m.course.sessions.filter((x) => x.kind === m.kind).map((x) => ({ week: x.week, title: x.title })),
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

  return { institutions, institutionId, rooms: roomsOut, people: calPeople, employers: calEmployers, meetings, conflicts, weeks, currentWeekMs, programs, summary };
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
  const [rooms, people, mine, instMeetings] = await Promise.all([
    prisma.facility.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, capacity: true } }),
    prisma.person.findMany({ where: { institutionId, active: true, role: { in: ["instructor", "preceptor", "coordinator"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    prisma.meetingPattern.findMany({ where: { cohortId }, include: { facility: { select: { name: true, kind: true } }, employer: { select: { id: true, name: true } }, staff: { select: { id: true, name: true } }, course: { select: { id: true, code: true, name: true, term: { select: { index: true, name: true } } } } } }),
    prisma.meetingPattern.findMany({ where: { cohort: { program: { institutionId } } }, select: { id: true, cohortId: true, sectionIndex: true, kind: true, seats: true, lengthHours: true, dayOfWeek: true, startTime: true, termIndex: true, startWeek: true, endWeek: true, facilityId: true, staffPersonId: true, course: { select: { term: { select: { index: true, startWeek: true, endWeek: true } } } }, cohort: { select: { cohortTerms: { select: { startDate: true, term: { select: { index: true } } } } } } } }),
  ]);

  const winOf = (cohortTerms: { startDate: Date | null; term: { index: number } }[], termIndex: number, startWeek: number, endWeek: number) => {
    const ct = cohortTerms.find((c) => c.term.index === termIndex);
    const s = ct?.startDate ? ct.startDate.getTime() : 0;
    return { weekStartMs: s, weekEndMs: s + Math.max(1, endWeek - startWeek + 1) * WEEK_MS };
  };
  // Institution-wide bookings → conflicts; keep only those touching this cohort.
  const bookings = instMeetings.map((m) => ({ id: m.id, cohortId: m.cohortId, sectionIndex: m.sectionIndex, kind: m.kind, seats: m.seats, lengthHours: m.lengthHours, dayOfWeek: m.dayOfWeek as import("./space").Weekday, startMin: toMin(m.startTime), ...winOf(m.cohort.cohortTerms, m.course.term?.index ?? m.termIndex, m.course.term?.startWeek ?? m.startWeek, m.course.term?.endWeek ?? m.endWeek), facilityId: m.facilityId, staffPersonId: m.staffPersonId }));
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
    // Default to the tenant with the most shared-code courses (the rich one).
    institutionId = institutions[0]?.id;
    const counts = await prisma.course.groupBy({ by: ["termId"], _count: true });
    void counts; // (kept simple — default below handles it)
    const withCohorts = await prisma.institution.findMany({ select: { id: true, _count: { select: { programs: true } } }, orderBy: { name: "asc" } });
    institutionId = withCohorts.sort((a, b) => b._count.programs - a._count.programs)[0]?.id ?? institutionId;
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
  const cg = await prisma.cohort.groupBy({ by: ["programId"], where: { program: { institutionId }, status: "active" }, _count: true });
  for (const g of cg) cohortsByProgram.set(g.programId, g._count);

  // Scheduled CLASS sections per course code (from the master bookings).
  const meetings = await prisma.meetingPattern.findMany({ where: { kind: "CLASS", cohort: { program: { institutionId } } }, select: { seats: true, course: { select: { code: true } } } });
  const schedByCode = new Map<string, { sections: number; seats: number }>();
  for (const m of meetings) { const code = m.course.code; if (!code) continue; const e = schedByCode.get(code) ?? { sections: 0, seats: 0 }; e.sections += 1; e.seats += m.seats; schedByCode.set(code, e); }

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
  const { detectConflicts, toMin } = await import("./space");
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
  const gradYearOf = (name: string): number => { const m = name.match(/(20\d{2})/); return m ? Number(m[1]) : 0; };

  for (const fam of families) {
    // 1) GOAL GAP — this year's goal vs live placed across cohorts graduating now.
    const goalNow = fam.programs.reduce((n, p) => n + (p.yearTargets.find((t) => t.year === nowYear)?.credentialTarget ?? 0), 0);
    if (goalNow > 0) {
      const placedNow = fam.programs.reduce((n, p) => n + p.cohorts.filter((c) => gradYearOf(c.name) === nowYear).reduce((m, c) => m + c.students.filter((s) => (RANK[s.status] ?? -1) >= 6).length, 0), 0);
      if (placedNow < goalNow) {
        items.push({ severity: placedNow < goalNow * 0.5 ? "red" : "amber", kind: "goal-gap", family: fam.name, title: `${nowYear} goal at risk: ${placedNow} placed of ${goalNow}`, detail: `The ${nowYear} North-Star goal is ${goalNow} placed; live student data shows ${placedNow}. Work the graduating cohorts and placement pipeline.`, href: `/families/${fam.id}` });
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
          items.push({ severity: admitted < seats * 0.5 ? "red" : "amber", kind: "recruiting", family: fam.name, title: `${c.name} recruiting behind: ${admitted} admitted of ${seats} seats`, detail: `Starts ${start.toLocaleDateString(undefined, { month: "short", year: "numeric" })}. Interventions targeting qualified/enrolled are the lever.`, href: `/families/${fam.id}/design` });
        }
      }
    }
    // 3) NO NEXT LAUNCH — nothing recruiting or planned after the newest running cohort.
    const anyFuture = fam.programs.some((p) => p.cohorts.some((c) => { const s = c.cohortTerms.find((ct) => ct.term.index === 1)?.startDate; return s && s > today; }));
    const anyActive = fam.programs.some((p) => p.cohorts.length > 0);
    if (anyActive && !anyFuture) {
      items.push({ severity: "amber", kind: "no-next-launch", family: fam.name, title: "No next cohort scheduled", detail: "Every instantiation has already started — there is no future intake on the calendar. Plan the next launch.", href: `/families/${fam.id}/design` });
    }
  }

  // 4) SCHEDULE HEALTH — unstaffed / unroomed / conflicting bookings (live weeks only).
  const meetings = await prisma.meetingPattern.findMany({
    include: { cohort: { select: { name: true, program: { select: { id: true, name: true, family: { select: { name: true } } } }, cohortTerms: { select: { startDate: true, term: { select: { index: true } } } } } } },
  });
  const live = meetings.map((m) => {
    const ct = m.cohort.cohortTerms.find((c) => c.term.index === m.termIndex);
    const s = ct?.startDate ? ct.startDate.getTime() : 0;
    return { m, weekStartMs: s, weekEndMs: s + Math.max(1, m.endWeek - m.startWeek + 1) * WEEK_MS };
  }).filter((x) => x.weekStartMs && x.weekEndMs > today.getTime());
  const unstaffed = live.filter((x) => !x.m.staffPersonId);
  if (unstaffed.length) {
    const fams = [...new Set(unstaffed.map((x) => x.m.cohort.program.family?.name ?? x.m.cohort.program.name))].join(", ");
    items.push({ severity: "red", kind: "unstaffed", family: null, title: `${unstaffed.length} current/upcoming meetings have no instructor`, detail: `Across ${fams}. Assign staff from each offering's schedule panel.`, href: `/programs/${unstaffed[0].m.cohort.program.id}/offerings/${unstaffed[0].m.cohortId}`
    });
  }
  const unroomed = live.filter((x) => !x.m.facilityId && x.m.kind !== "CLINICAL");
  if (unroomed.length) items.push({ severity: "amber", kind: "unroomed", family: null, title: `${unroomed.length} campus meetings have no room`, detail: "Space pressure — resolve on the master calendar (idle rooms are visible in the utilization rail).", href: "/calendar" });
  const conflicts = detectConflicts(live.map((x) => ({ id: x.m.id, cohortId: x.m.cohortId, sectionIndex: x.m.sectionIndex, kind: x.m.kind, seats: x.m.seats, lengthHours: x.m.lengthHours, dayOfWeek: x.m.dayOfWeek as import("./space").Weekday, startMin: toMin(x.m.startTime), weekStartMs: x.weekStartMs, weekEndMs: x.weekEndMs, facilityId: x.m.facilityId, staffPersonId: x.m.staffPersonId })));
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
    items.push({ severity: "info", kind: "intake", family: null, title: `${noIntake} enrolled learners have no alignment intake`, detail: "Placement design runs on intake profiles — motivations, constraints, capacities. Work the intake worklist.", href: firstFam ? `/families/${firstFam.id}/wbl` : "/students" });
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
export async function getCapacityModel(opts?: { institutionId?: string }) {
  const { deriveCohortTargets } = await import("./pipeline");
  const { BENCHMARK_RATES } = await import("./northstar");

  const institutions = await prisma.institution.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const institution = institutions.find((i) => i.id === opts?.institutionId) ?? institutions[0];
  if (!institution) return null;

  const programs = await prisma.program.findMany({
    where: { institutionId: institution.id, cohorts: { some: { status: { in: ["planned", "active"] } } } },
    include: {
      family: { select: { id: true, name: true, goalPlan: true } },
      terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: true } } } },
      cohorts: {
        where: { status: { in: ["planned", "active"] } },
        orderBy: { name: "asc" },
        include: {
          stages: true,
          cohortTerms: { select: { termId: true, startDate: true } },
          sessionOverrides: true,
          courseDates: { select: { courseId: true, startDate: true, endDate: true } },
          meetings: { select: { id: true, courseId: true, kind: true, sectionIndex: true, sectionCount: true, seats: true, dayOfWeek: true, startTime: true, facility: { select: { name: true } }, employer: { select: { name: true } }, staff: { select: { name: true } } }, orderBy: { sectionIndex: "asc" as const } },
          _count: { select: { students: true } },
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
      const derived = productiveGoal > 0
        ? deriveCohortTargets(productiveGoal, rates, Math.max(1, orderedTerms.length)).terms
        : orderedTerms.map(() => Number(fallbackSeats));
      const enrollmentByTerm: Record<number, number> = {};
      orderedTerms.forEach((t, i) => { enrollmentByTerm[t.index] = Math.round(derived[i] ?? derived[derived.length - 1] ?? 0); });
      const ctById = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
      const termStartByIndex: Record<number, string | null> = {};
      orderedTerms.forEach((t) => { const d = ctById.get(t.id) ?? null; termStartByIndex[t.index] = d ? d.toISOString() : null; });
      // Templates are timeless — days attach at instantiation. When this offering
      // has calendarized meetings, their day pattern dates the session rows.
      const meetingDay = new Map<string, string>();
      const meetingTime = new Map<string, string>();
      const meetingLoc = new Map<string, string>();
      const meetingStaff = new Map<string, string>();
      for (const m of co.meetings) {
        const k = `${m.courseId}|${m.kind}`;
        if (!meetingDay.has(k)) meetingDay.set(k, m.dayOfWeek);
        if (!meetingTime.has(k)) meetingTime.set(k, m.startTime);
        const loc = m.kind === "CLINICAL" ? (m.employer?.name ? `@ ${m.employer.name}` : "@ site TBD") : (m.facility?.name ?? null);
        if (loc && !meetingLoc.has(k)) meetingLoc.set(k, loc);
        if (m.staff?.name && !meetingStaff.has(k)) meetingStaff.set(k, m.staff.name);
      }
      // Per-instantiation session overrides beat both the template and the
      // meeting-day fallback — this cohort's reality is what the math uses.
      const ovBySession = new Map(co.sessionOverrides.map((o) => [o.sessionId, o]));
      const cdByCourse = new Map(co.courseDates.map((cd) => [cd.courseId, cd]));
      return {
        cohortId: co.id, cohort: co.name, status: co.status,
        programId: p.id, program: p.name, familyId: p.family?.id ?? null, family: p.family?.name ?? null,
        students: co._count.students,
        enrollmentByTerm, termStartByIndex,
        // One row per booked section — the calendar's draggable shift instances.
        meetings: co.meetings.map((m) => ({
          id: m.id, courseId: m.courseId, kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats,
          dayOfWeek: m.dayOfWeek, startTime: m.startTime,
          loc: m.kind === "CLINICAL" ? (m.employer?.name ? `@ ${m.employer.name}` : "@ site TBD") : (m.facility?.name ?? null),
          staffName: m.staff?.name ?? null,
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
              staffName: meetingStaff.get(`${c.id}|${s.kind}`) ?? null,
              lengthHours: ov?.lengthHours ?? s.lengthHours, maxStudents: ov?.maxStudents ?? s.maxStudents,
              facultyNeeded: ov?.facultyNeeded ?? s.facultyNeeded, facultyContactPolicy: ov?.facultyContactPolicy ?? s.facultyContactPolicy,
              supportStaffNeeded: ov?.supportStaffNeeded ?? s.supportStaffNeeded, supportContactPolicy: ov?.supportContactPolicy ?? s.supportContactPolicy,
              week: ov?.week ?? s.week,
              dayOfWeek: ov?.dayOfWeek ?? s.dayOfWeek ?? meetingDay.get(`${c.id}|${s.kind}`) ?? null,
              startTime: ov?.startTime ?? s.startTime ?? meetingTime.get(`${c.id}|${s.kind}`) ?? null,
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

  return { institution, institutions, cohorts, clinicalSites };
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
          institution: { select: { id: true, name: true } },
          terms: {
            orderBy: { index: "asc" },
            include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { orderBy: [{ kind: "asc" }, { number: "asc" }] } } } },
          },
        },
      },
      cohortTerms: { select: { termId: true, startDate: true } },
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
    prisma.person.findMany({ where: { institutionId, active: true, role: { in: ["instructor", "preceptor", "coordinator"] } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } }),
    prisma.employer.findMany({ where: { institutionId, status: "active" }, orderBy: { name: "asc" }, select: { id: true, name: true, setting: true } }),
  ]);
  return { cohort, rooms, people, employers };
}
