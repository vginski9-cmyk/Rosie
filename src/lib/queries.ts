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
            include: { sessions: true, courseSkills: { include: { skill: true } } },
          },
        },
      },
    },
  });
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
