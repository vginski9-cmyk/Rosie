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
      programs: {
        include: {
          occupation: true,
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
  if (!data || data.cohortSeeds.length === 0) return null;
  const { buildAcademicPlan, cohortSeriesFromYearTargets } = await import("./plan");
  const plan = buildAcademicPlan(data.archetype, cohortSeriesFromYearTargets(data.cohortSeeds), data.supply);
  return { hasBottleneck: plan.hasBottleneck, bottleneckCount: plan.bottleneckCount, peak: plan.peak, supply: data.supply };
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

export async function getInstitutions() {
  return prisma.institution.findMany({ orderBy: { name: "asc" }, include: { occupations: true } });
}

/**
 * Assemble every input the integrated planning engine needs for one program:
 * the authored archetype, the cohort series (from year targets), staff + WBL
 * supply (reconciled against demand), the assignment roster, and which skills
 * are actually assessed.
 */
export async function getProgramPlanData(programId: string) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      institution: true,
      yearTargets: { orderBy: { year: "asc" } },
      programSkills: { include: { skill: true } },
      assignments: { include: { person: true } },
      terms: { include: { courses: { include: { sessions: { include: { skillLinks: true } } } } } },
    },
  });
  if (!program) return null;

  const archetype = await getProgramArchetype(programId);

  // Supply: faculty/coordinator FTE + preceptor FTE from assignments; WBL slots
  // from the institution's employers.
  const facultyFte = program.assignments.filter((a) => a.role === "instructor" || a.role === "coordinator").reduce((s, a) => s + a.fteCommitment, 0);
  const preceptors = program.assignments.filter((a) => a.role === "preceptor").reduce((s, a) => s + a.fteCommitment, 0);
  const employerSlots = await prisma.employer.aggregate({ where: { institutionId: program.institutionId }, _sum: { wblSlots: true } });
  const supply = { facultyFte, preceptors, wblSlots: employerSlots._sum.wblSlots ?? 0 };

  // Cohort series from per-year planned cohort capacity.
  const cohortSeeds = program.yearTargets
    .filter((t) => (t.cohortCapacity ?? 0) > 0)
    .map((t) => ({ year: t.year, seats: Math.round(t.cohortCapacity!) }));

  // Skills actually assessed (any session marked ASSESS or BOTH).
  const assessedSkillIds = new Set<string>();
  for (const term of program.terms) for (const c of term.courses) for (const s of c.sessions) for (const l of s.skillLinks) {
    if (l.mode === "ASSESS" || l.mode === "BOTH") assessedSkillIds.add(l.skillId);
  }

  return { program, archetype, supply, cohortSeeds, assessedSkillIds, assignments: program.assignments };
}

/** People available to staff a program (for the assignment picker). */
export async function getStaffOptions(institutionId: string) {
  return prisma.person.findMany({ where: { institutionId }, orderBy: { name: "asc" } });
}
