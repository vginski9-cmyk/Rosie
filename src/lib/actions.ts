"use server";

import { prisma } from "./db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { STAGES } from "./funnel";

const str = (v: FormDataEntryValue | null) => (v == null ? "" : String(v).trim());
const numOr = (v: FormDataEntryValue | null, d = 0) => {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : d;
};
const optNum = (v: FormDataEntryValue | null): number | null => {
  const s = str(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---------------------------------------------------------------------------
// PROGRAMS
// ---------------------------------------------------------------------------

export async function createProgram(formData: FormData) {
  const institutionId = str(formData.get("institutionId"));
  const name = str(formData.get("name")) || "Untitled Program";
  const program = await prisma.program.create({
    data: {
      institutionId,
      name,
      programType: str(formData.get("programType")) || "Traditional Full Time",
      credential: str(formData.get("credential")) || null,
      occupationId: str(formData.get("occupationId")) || null,
      monthsToFullProductivity: optNum(formData.get("monthsToFullProductivity")),
    },
  });

  // Seed a first term and a default cohort with the canonical funnel stages so
  // the program is immediately usable.
  await prisma.term.create({ data: { programId: program.id, index: 1, name: "Term 1", startWeek: 1, endWeek: 16 } });
  const cohort = await prisma.cohort.create({ data: { programId: program.id, name: "First Cohort" } });
  await prisma.funnelStage.createMany({
    data: STAGES.map((s, i) => ({ cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label })),
  });

  revalidatePath("/");
  redirect(`/programs/${program.id}`);
}

export async function updateProgram(programId: string, formData: FormData) {
  await prisma.program.update({
    where: { id: programId },
    data: {
      name: str(formData.get("name")),
      programType: str(formData.get("programType")),
      credential: str(formData.get("credential")) || null,
      monthsToFullProductivity: optNum(formData.get("monthsToFullProductivity")),
    },
  });
  revalidatePath(`/programs/${programId}`);
}

export async function duplicateProgram(programId: string) {
  const src = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      yearTargets: true,
      programSkills: true,
      cohorts: { include: { stages: true } },
      terms: { include: { courses: { include: { sessions: true, courseSkills: true } } } },
    },
  });
  if (!src) return;

  const copy = await prisma.program.create({
    data: {
      institutionId: src.institutionId,
      occupationId: src.occupationId,
      name: `${src.name} (Copy)`,
      programType: src.programType,
      credential: src.credential,
      serviceArea: src.serviceArea,
      status: "draft",
      monthsToFullProductivity: src.monthsToFullProductivity,
      yearTargets: { create: src.yearTargets.map((t) => ({ year: t.year, credentialTarget: t.credentialTarget, cohortCapacity: t.cohortCapacity })) },
      programSkills: { create: src.programSkills.map((p) => ({ skillId: p.skillId, targetLevel: p.targetLevel, priority: p.priority, notes: p.notes })) },
    },
  });

  for (const t of src.terms) {
    const term = await prisma.term.create({ data: { programId: copy.id, index: t.index, name: t.name, startWeek: t.startWeek, endWeek: t.endWeek } });
    for (const c of t.courses) {
      await prisma.course.create({
        data: {
          termId: term.id,
          code: c.code,
          name: c.name,
          sequenceOrder: c.sequenceOrder,
          weeklyClassHours: c.weeklyClassHours,
          weeklyLabHours: c.weeklyLabHours,
          weeklyClinicalHours: c.weeklyClinicalHours,
          sessions: {
            create: c.sessions.map((s) => ({
              kind: s.kind, number: s.number, title: s.title, lengthHours: s.lengthHours, deliveryMode: s.deliveryMode,
              location: s.location, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, supportStaffNeeded: s.supportStaffNeeded,
              preceptorsNeeded: s.preceptorsNeeded, week: s.week, dayOfWeek: s.dayOfWeek, rotationType: s.rotationType, clinicalMode: s.clinicalMode, notes: s.notes,
            })),
          },
          courseSkills: { create: c.courseSkills.map((cs) => ({ skillId: cs.skillId, targetLevel: cs.targetLevel, role: cs.role })) },
        },
      });
    }
  }
  for (const ch of src.cohorts) {
    const cohort = await prisma.cohort.create({ data: { programId: copy.id, name: ch.name, entryYear: ch.entryYear } });
    await prisma.funnelStage.createMany({ data: ch.stages.map((s) => ({ cohortId: cohort.id, stageKey: s.stageKey, sortOrder: s.sortOrder, label: s.label, targetNumber: s.targetNumber, actualNumber: s.actualNumber })) });
  }

  revalidatePath("/");
  redirect(`/programs/${copy.id}`);
}

export async function deleteProgram(programId: string) {
  await prisma.program.delete({ where: { id: programId } });
  revalidatePath("/");
  redirect("/");
}

const csvFromCheckboxes = (fd: FormData, name: string, fallback: string) => {
  const vals = fd.getAll(name).map(String).filter(Boolean);
  return vals.length ? vals.join(",") : fallback;
};

/** Edit a program's delivery calendar and launch cadence. */
export async function updateLaunchConfig(programId: string, formData: FormData) {
  await prisma.program.update({
    where: { id: programId },
    data: {
      termSlots: csvFromCheckboxes(formData, "termSlots", "FALL,SPRING,SUMMER"),
      launchCadence: str(formData.get("launchCadence")) || "ANNUAL",
      launchTerms: csvFromCheckboxes(formData, "launchTerms", "FALL"),
      launchIntervalYears: Math.max(1, numOr(formData.get("launchIntervalYears"), 1)),
      defaultCohortSeats: optNum(formData.get("defaultCohortSeats")),
    },
  });
  revalidatePath(`/programs/${programId}/plan`);
  revalidatePath(`/programs/${programId}`);
}

/** Add an explicit on-demand cohort (entry term + year + seats). */
export async function addExplicitCohort(programId: string, formData: FormData) {
  await prisma.cohort.create({
    data: {
      programId,
      name: str(formData.get("name")) || "Ad-hoc cohort",
      entryYear: numOr(formData.get("entryYear"), 2026),
      entryTermCode: str(formData.get("entryTermCode")) || "FALL",
      plannedSeats: optNum(formData.get("plannedSeats")),
      isExplicit: true,
    },
  });
  revalidatePath(`/programs/${programId}/plan`);
}

// ---------------------------------------------------------------------------
// TERMS / COURSES / SESSIONS
// ---------------------------------------------------------------------------

export async function addTerm(programId: string) {
  const last = await prisma.term.findFirst({ where: { programId }, orderBy: { index: "desc" } });
  const index = (last?.index ?? 0) + 1;
  await prisma.term.create({ data: { programId, index, name: `Term ${index}`, startWeek: 1, endWeek: 16 } });
  revalidatePath(`/programs/${programId}`);
}

export async function deleteTerm(termId: string, programId: string) {
  await prisma.term.delete({ where: { id: termId } });
  revalidatePath(`/programs/${programId}`);
}

export async function addCourse(termId: string, programId: string, formData: FormData) {
  const last = await prisma.course.findFirst({ where: { termId }, orderBy: { sequenceOrder: "desc" } });
  await prisma.course.create({
    data: {
      termId,
      code: str(formData.get("code")) || null,
      name: str(formData.get("name")) || "New Course",
      sequenceOrder: (last?.sequenceOrder ?? -1) + 1,
      weeklyClassHours: numOr(formData.get("weeklyClassHours")),
      weeklyLabHours: numOr(formData.get("weeklyLabHours")),
      weeklyClinicalHours: numOr(formData.get("weeklyClinicalHours")),
    },
  });
  revalidatePath(`/programs/${programId}`);
}

export async function updateCourse(courseId: string, programId: string, formData: FormData) {
  await prisma.course.update({
    where: { id: courseId },
    data: {
      code: str(formData.get("code")) || null,
      name: str(formData.get("name")),
      weeklyClassHours: numOr(formData.get("weeklyClassHours")),
      weeklyLabHours: numOr(formData.get("weeklyLabHours")),
      weeklyClinicalHours: numOr(formData.get("weeklyClinicalHours")),
    },
  });
  revalidatePath(`/programs/${programId}`);
}

export async function deleteCourse(courseId: string, programId: string) {
  await prisma.course.delete({ where: { id: courseId } });
  revalidatePath(`/programs/${programId}`);
}

export async function addSession(courseId: string, programId: string, formData: FormData) {
  const kind = str(formData.get("kind")) || "CLASS";
  const last = await prisma.session.findFirst({ where: { courseId, kind }, orderBy: { number: "desc" } });
  await prisma.session.create({
    data: {
      courseId,
      kind,
      number: (last?.number ?? 0) + 1,
      title: str(formData.get("title")) || null,
      lengthHours: numOr(formData.get("lengthHours")),
      maxStudents: numOr(formData.get("maxStudents"), 1),
      facultyNeeded: numOr(formData.get("facultyNeeded"), 1),
      supportStaffNeeded: numOr(formData.get("supportStaffNeeded")),
      preceptorsNeeded: numOr(formData.get("preceptorsNeeded")),
      week: optNum(formData.get("week")),
      location: str(formData.get("location")) || null,
      rotationType: str(formData.get("rotationType")) || null,
      clinicalMode: str(formData.get("clinicalMode")) || null,
    },
  });
  revalidatePath(`/programs/${programId}`);
}

export async function updateSession(sessionId: string, programId: string, formData: FormData) {
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      title: str(formData.get("title")) || null,
      lengthHours: numOr(formData.get("lengthHours")),
      maxStudents: numOr(formData.get("maxStudents"), 1),
      facultyNeeded: numOr(formData.get("facultyNeeded"), 1),
      supportStaffNeeded: numOr(formData.get("supportStaffNeeded")),
      preceptorsNeeded: numOr(formData.get("preceptorsNeeded")),
      week: optNum(formData.get("week")),
      location: str(formData.get("location")) || null,
      rotationType: str(formData.get("rotationType")) || null,
      clinicalMode: str(formData.get("clinicalMode")) || null,
    },
  });
  revalidatePath(`/programs/${programId}`);
}

export async function deleteSession(sessionId: string, programId: string) {
  await prisma.session.delete({ where: { id: sessionId } });
  revalidatePath(`/programs/${programId}`);
}

// ---------------------------------------------------------------------------
// FUNNEL
// ---------------------------------------------------------------------------

export async function updateFunnelStage(stageId: string, programId: string, formData: FormData) {
  await prisma.funnelStage.update({
    where: { id: stageId },
    data: { targetNumber: optNum(formData.get("target")), actualNumber: optNum(formData.get("actual")) },
  });
  revalidatePath(`/programs/${programId}`);
}

// ---------------------------------------------------------------------------
// SKILLS (KSA library)
// ---------------------------------------------------------------------------

export async function createSkill(institutionId: string, formData: FormData) {
  const skill = await prisma.skill.create({
    data: {
      institutionId,
      name: str(formData.get("name")) || "New Skill",
      type: str(formData.get("type")) || "SKILL",
      category: str(formData.get("category")) || null,
      definition: str(formData.get("definition")) || null,
      howUsed: str(formData.get("howUsed")) || null,
    },
  });
  revalidatePath("/skills");
  redirect(`/skills/${skill.id}`);
}

export async function updateSkill(skillId: string, formData: FormData) {
  await prisma.skill.update({
    where: { id: skillId },
    data: {
      name: str(formData.get("name")),
      type: str(formData.get("type")),
      category: str(formData.get("category")) || null,
      definition: str(formData.get("definition")) || null,
      howUsed: str(formData.get("howUsed")) || null,
    },
  });
  revalidatePath(`/skills/${skillId}`);
  revalidatePath("/skills");
}

export async function duplicateSkill(skillId: string) {
  const src = await prisma.skill.findUnique({ where: { id: skillId }, include: { descriptors: true } });
  if (!src) return;
  const copy = await prisma.skill.create({
    data: {
      institutionId: src.institutionId,
      name: `${src.name} (Copy)`,
      type: src.type,
      category: src.category,
      definition: src.definition,
      howUsed: src.howUsed,
      descriptors: { create: src.descriptors.map((d) => ({ level: d.level, descriptor: d.descriptor })) },
    },
  });
  revalidatePath("/skills");
  redirect(`/skills/${copy.id}`);
}

export async function deleteSkill(skillId: string) {
  await prisma.skill.delete({ where: { id: skillId } });
  revalidatePath("/skills");
  redirect("/skills");
}

export async function upsertDescriptor(skillId: string, formData: FormData) {
  const level = numOr(formData.get("level"));
  const descriptor = str(formData.get("descriptor"));
  if (descriptor === "") {
    await prisma.skillLevelDescriptor.deleteMany({ where: { skillId, level } });
  } else {
    await prisma.skillLevelDescriptor.upsert({
      where: { skillId_level: { skillId, level } },
      update: { descriptor },
      create: { skillId, level, descriptor },
    });
  }
  revalidatePath(`/skills/${skillId}`);
}

// ---------------------------------------------------------------------------
// PROGRAM / COURSE SKILL MAPPING
// ---------------------------------------------------------------------------

export async function addProgramSkill(programId: string, formData: FormData) {
  const skillId = str(formData.get("skillId"));
  if (!skillId) return;
  await prisma.programSkill.upsert({
    where: { programId_skillId: { programId, skillId } },
    update: { targetLevel: numOr(formData.get("targetLevel"), 1), priority: str(formData.get("priority")) || null },
    create: { programId, skillId, targetLevel: numOr(formData.get("targetLevel"), 1), priority: str(formData.get("priority")) || null },
  });
  revalidatePath(`/programs/${programId}`);
}

export async function removeProgramSkill(id: string, programId: string) {
  await prisma.programSkill.delete({ where: { id } });
  revalidatePath(`/programs/${programId}`);
}

export async function addCourseSkill(courseId: string, programId: string, formData: FormData) {
  const skillId = str(formData.get("skillId"));
  if (!skillId) return;
  await prisma.courseSkill.upsert({
    where: { courseId_skillId: { courseId, skillId } },
    update: { targetLevel: numOr(formData.get("targetLevel"), 1), role: str(formData.get("role")) || null },
    create: { courseId, skillId, targetLevel: numOr(formData.get("targetLevel"), 1), role: str(formData.get("role")) || null },
  });
  revalidatePath(`/programs/${programId}`);
}

export async function removeCourseSkill(id: string, programId: string) {
  await prisma.courseSkill.delete({ where: { id } });
  revalidatePath(`/programs/${programId}`);
}

// ---------------------------------------------------------------------------
// WBL PROFILES
// ---------------------------------------------------------------------------

export async function createWblProfile(institutionId: string, formData: FormData) {
  const p = await prisma.wblProfile.create({
    data: {
      institutionId,
      subjectType: str(formData.get("subjectType")) || "LEARNER",
      name: str(formData.get("name")) || "New Profile",
      tier: str(formData.get("tier")) || null,
      summary: str(formData.get("summary")) || null,
    },
  });
  revalidatePath("/wbl");
  redirect(`/wbl/${p.id}`);
}

export async function addWblFactor(profileId: string, formData: FormData) {
  await prisma.wblFactor.create({
    data: {
      profileId,
      layer: str(formData.get("layer")) || "MOTIVATION",
      label: str(formData.get("label")) || "Factor",
      detail: str(formData.get("detail")) || null,
      weight: numOr(formData.get("weight"), 1),
      binding: str(formData.get("binding")) === "on",
      disclosure: str(formData.get("disclosure")) || "STATED",
      matchKey: str(formData.get("matchKey")) || null,
    },
  });
  revalidatePath(`/wbl/${profileId}`);
}

export async function deleteWblFactor(factorId: string, profileId: string) {
  await prisma.wblFactor.delete({ where: { id: factorId } });
  revalidatePath(`/wbl/${profileId}`);
}

export async function deleteWblProfile(profileId: string) {
  await prisma.wblProfile.delete({ where: { id: profileId } });
  revalidatePath("/wbl");
  redirect("/wbl");
}

// ---------------------------------------------------------------------------
// STAFF ASSIGNMENTS (supply)
// ---------------------------------------------------------------------------

export async function addAssignment(programId: string, institutionId: string, formData: FormData) {
  const personId = str(formData.get("personId"));
  if (!personId) return;
  await prisma.assignment.create({
    data: {
      institutionId,
      programId,
      personId,
      role: str(formData.get("role")) || "instructor",
      fteCommitment: numOr(formData.get("fteCommitment"), 1),
    },
  });
  revalidatePath(`/programs/${programId}/plan`);
}

export async function removeAssignment(id: string, programId: string) {
  await prisma.assignment.delete({ where: { id } });
  revalidatePath(`/programs/${programId}/plan`);
}

export async function createStaff(institutionId: string, programId: string, formData: FormData) {
  await prisma.person.create({
    data: {
      institutionId,
      name: str(formData.get("name")) || "New staff",
      role: str(formData.get("role")) || "instructor",
    },
  });
  revalidatePath(`/programs/${programId}/plan`);
}

// ---------------------------------------------------------------------------
// SESSION SKILLS (delivery / assessment)
// ---------------------------------------------------------------------------

export async function addSessionSkill(sessionId: string, programId: string, formData: FormData) {
  const skillId = str(formData.get("skillId"));
  if (!skillId) return;
  await prisma.sessionSkill.upsert({
    where: { sessionId_skillId: { sessionId, skillId } },
    update: { mode: str(formData.get("mode")) || "DELIVER", targetLevel: optNum(formData.get("targetLevel")) },
    create: { sessionId, skillId, mode: str(formData.get("mode")) || "DELIVER", targetLevel: optNum(formData.get("targetLevel")) },
  });
  revalidatePath(`/programs/${programId}/structure`);
}

export async function removeSessionSkill(id: string, programId: string) {
  await prisma.sessionSkill.delete({ where: { id } });
  revalidatePath(`/programs/${programId}/structure`);
}

/** Tag every session of a given kind in a course with a skill (delivery/assessment). */
export async function tagCourseSessions(courseId: string, programId: string, formData: FormData) {
  const skillId = str(formData.get("skillId"));
  const kind = str(formData.get("kind"));
  if (!skillId || !kind) return;
  const mode = str(formData.get("mode")) || "DELIVER";
  const targetLevel = optNum(formData.get("targetLevel"));
  const sessions = await prisma.session.findMany({ where: { courseId, kind }, select: { id: true } });
  for (const s of sessions) {
    await prisma.sessionSkill.upsert({
      where: { sessionId_skillId: { sessionId: s.id, skillId } },
      update: { mode, targetLevel },
      create: { sessionId: s.id, skillId, mode, targetLevel },
    });
  }
  revalidatePath(`/programs/${programId}/structure`);
}

/** Remove a skill from all sessions of a course. */
export async function untagCourseSessions(courseId: string, programId: string, skillId: string) {
  const sessions = await prisma.session.findMany({ where: { courseId }, select: { id: true } });
  await prisma.sessionSkill.deleteMany({ where: { sessionId: { in: sessions.map((s) => s.id) }, skillId } });
  revalidatePath(`/programs/${programId}/structure`);
}
