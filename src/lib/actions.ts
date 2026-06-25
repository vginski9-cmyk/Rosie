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

// ---------------------------------------------------------------------------
// PROGRAM FAMILY — North-Star goal plan
// ---------------------------------------------------------------------------

/** Persist the family's North-Star goal plan (a JSON blob from the goal planner). */
export async function saveFamilyGoalPlan(familyId: string, planJson: string): Promise<void> {
  await prisma.programFamily.update({ where: { id: familyId }, data: { goalPlan: planJson } });
  revalidatePath(`/families/${familyId}`);
}

// ---------------------------------------------------------------------------
// STUDENTS — intake / enroll / assign (the operational system of record)
// ---------------------------------------------------------------------------

/** Lifecycle status → the funnel stage it corresponds to (drives pipeline drill-down). */
const STATUS_TO_STAGE: Record<string, string | null> = {
  prospect: "interested", applicant: "qualified", admitted: "offered",
  enrolled: "enrolled", completed: "completing", licensed: "licensed",
  placed: "placed", productive: "productive", withdrawn: null,
};

/** Intake: create a real student record and place them in a program (and optionally a cohort). */
export async function enrollStudent(formData: FormData): Promise<void> {
  const programId = str(formData.get("programId"));
  if (!programId) return;
  const status = str(formData.get("status")) || "enrolled";
  await prisma.student.create({
    data: {
      programId,
      cohortId: str(formData.get("cohortId")) || null,
      name: str(formData.get("name")) || "New Student",
      email: str(formData.get("email")) || null,
      status,
      stageKey: STATUS_TO_STAGE[status] ?? null,
      entryYear: optNum(formData.get("entryYear")),
      sectionIndex: Math.max(1, numOr(formData.get("sectionIndex"), 1)),
    },
  });
  revalidatePath("/students");
  revalidatePath(`/programs/${programId}/students`);
}

/** Assign / re-assign a student: cohort, section, and lifecycle status (→ stage). */
export async function updateStudentEnrollment(studentId: string, formData: FormData): Promise<void> {
  const status = str(formData.get("status"));
  const data: { cohortId: string | null; sectionIndex: number; status?: string; stageKey?: string | null } = {
    cohortId: str(formData.get("cohortId")) || null,
    sectionIndex: Math.max(1, numOr(formData.get("sectionIndex"), 1)),
  };
  if (status) { data.status = status; data.stageKey = STATUS_TO_STAGE[status] ?? null; }
  const student = await prisma.student.update({ where: { id: studentId }, data, select: { programId: true } });
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/programs/${student.programId}/students`);
}

export interface CohortDrill {
  cohortId: string | null;
  programId: string | null;
  students: { id: string; name: string; status: string; stageKey: string | null; sectionIndex: number; clinicalSite: string | null }[];
  instructors: { personId: string; name: string; role: string; sessions: number; contactHours: number }[];
  wbl: { id: string; studentId: string | null; studentName: string; asOfDate: string; shiftPreference: string | null; desiredModality: string | null; maxTravelMinutes: number | null }[];
}

/** Resolve a pivot cell's cohort to the real students / instructors / WBL placements behind it. */
export async function getCohortDrill(institution: string, program: string, cohort: string): Promise<CohortDrill> {
  const co = await prisma.cohort.findFirst({
    where: { name: cohort, program: { name: program, institution: { name: institution } } },
    include: {
      program: { select: { id: true } },
      students: { orderBy: { name: "asc" }, select: { id: true, name: true, status: true, stageKey: true, sectionIndex: true, clinicalSite: true } },
      sessionStaff: { include: { person: { select: { id: true, name: true } } } },
    },
  });
  if (!co) return { cohortId: null, programId: null, students: [], instructors: [], wbl: [] };

  // Aggregate co-teaching staffing into one row per person (role + session count + hours).
  const byPerson = new Map<string, { personId: string; name: string; role: string; sessions: number; contactHours: number }>();
  for (const si of co.sessionStaff) {
    const cur = byPerson.get(si.personId) ?? { personId: si.personId, name: si.person.name, role: si.role, sessions: 0, contactHours: 0 };
    cur.sessions += 1;
    cur.contactHours += si.contactHours;
    if (si.role === "preceptor") cur.role = "preceptor";
    byPerson.set(si.personId, cur);
  }

  const studentIds = co.students.map((s) => s.id);
  const snaps = studentIds.length
    ? await prisma.wblSnapshot.findMany({
        where: { studentId: { in: studentIds }, subjectType: "LEARNER_STUDENT" },
        orderBy: { asOfDate: "desc" },
        include: { student: { select: { name: true } } },
      })
    : [];

  return {
    cohortId: co.id,
    programId: co.program.id,
    students: co.students,
    instructors: [...byPerson.values()].sort((a, b) => b.contactHours - a.contactHours),
    wbl: snaps.map((w) => ({ id: w.id, studentId: w.studentId, studentName: w.student?.name ?? "—", asOfDate: w.asOfDate.toISOString().slice(0, 10), shiftPreference: w.shiftPreference, desiredModality: w.desiredModality, maxTravelMinutes: w.maxTravelMinutes })),
  };
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

/** Turn the timeless template into a scheduled OFFERING: a cohort with a real
 *  start date, the canonical funnel, and per-term dates cascaded from each
 *  template term's week-span. Then you assign instructors and enroll students. */
export async function createOffering(programId: string, formData: FormData) {
  const name = str(formData.get("name")) || "New Offering";
  const startStr = str(formData.get("startDate"));
  const startD = startStr ? new Date(startStr) : null;
  const cohort = await prisma.cohort.create({
    data: { programId, name, status: "planned", startDate: startD, entryYear: startD ? startD.getFullYear() : null },
  });
  await prisma.funnelStage.createMany({ data: STAGES.map((s, i) => ({ cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label })) });
  const terms = await prisma.term.findMany({ where: { programId }, orderBy: { index: "asc" } });
  const cursor = startD ? new Date(startD) : null;
  for (const t of terms) {
    await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: t.id, startDate: cursor ? new Date(cursor) : null } });
    if (cursor) {
      const weeks = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
      cursor.setDate(cursor.getDate() + (weeks + 2) * 7); // term length + ~2-week break
    }
  }
  revalidatePath(`/programs/${programId}`);
  redirect(`/programs/${programId}/offerings/${cohort.id}`);
}

/** Persist an offering's per-section weekly slots (day/time/room) in bulk. */
export async function saveSectionSchedules(
  cohortId: string,
  programId: string,
  items: { sessionId: string; sectionIndex: number; dayOfWeek: string | null; startTime: string | null; location: string | null }[],
) {
  for (const it of items) {
    await prisma.sectionSchedule.upsert({
      where: { cohortId_sessionId_sectionIndex: { cohortId, sessionId: it.sessionId, sectionIndex: it.sectionIndex } },
      create: { cohortId, sessionId: it.sessionId, sectionIndex: it.sectionIndex, dayOfWeek: it.dayOfWeek || null, startTime: it.startTime || null, location: it.location || null },
      update: { dayOfWeek: it.dayOfWeek || null, startTime: it.startTime || null, location: it.location || null },
    });
  }
  revalidatePath(`/programs/${programId}/offerings/${cohortId}/schedule`);
}

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

export async function updateTerm(termId: string, programId: string, formData: FormData) {
  await prisma.term.update({
    where: { id: termId },
    data: {
      name: str(formData.get("name")) || "Term",
      startWeek: optNum(formData.get("startWeek")),
      endWeek: optNum(formData.get("endWeek")),
    },
  });
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
      creditHours: optNum(formData.get("creditHours")),
      semesterOffered: str(formData.get("semesterOffered")) || null,
      courseType: str(formData.get("courseType")) || null,
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
      creditHours: optNum(formData.get("creditHours")),
      semesterOffered: str(formData.get("semesterOffered")) || null,
      courseType: str(formData.get("courseType")) || null,
      description: str(formData.get("description")) || null,
      requisites: str(formData.get("requisites")) || null,
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
      dayOfWeek: str(formData.get("dayOfWeek")) || null,
      startTime: str(formData.get("startTime")) || null,
      location: str(formData.get("location")) || null,
      homework: str(formData.get("homework")) || null,
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
      dayOfWeek: str(formData.get("dayOfWeek")) || null,
      startTime: str(formData.get("startTime")) || null,
      location: str(formData.get("location")) || null,
      homework: str(formData.get("homework")) || null,
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

/** Bulk-set day / time / location (and optional length) for every session of a
 *  kind in a course — the common case where all lectures share a slot. Only the
 *  fields you fill are applied. */
export async function setSessionTiming(courseId: string, programId: string, formData: FormData) {
  const kind = str(formData.get("kind")) || "CLASS";
  const data: Record<string, unknown> = {};
  const day = str(formData.get("dayOfWeek"));
  const time = str(formData.get("startTime"));
  const loc = str(formData.get("location"));
  const len = str(formData.get("lengthHours"));
  const cap = str(formData.get("maxStudents"));
  if (day) data.dayOfWeek = day;
  if (time) data.startTime = time;
  if (loc) data.location = loc;
  if (len) data.lengthHours = Number(len);
  if (cap) data.maxStudents = Number(cap);
  if (Object.keys(data).length > 0) {
    await prisma.session.updateMany({ where: { courseId, kind }, data });
  }
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
