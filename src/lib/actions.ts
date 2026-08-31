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
// NORTH-STAR GOALS — a program family anchored to a target job (create/delete)
// ---------------------------------------------------------------------------

export async function createNorthStarGoal(formData: FormData): Promise<void> {
  const institutionId = str(formData.get("institutionId"));
  if (!institutionId) return;
  const name = str(formData.get("name")) || "New goal";
  const socCode = str(formData.get("socCode"));
  let occupationId: string | null = null;
  if (socCode) {
    const occ = await prisma.occupation.upsert({
      where: { institutionId_socCode: { institutionId, socCode } },
      create: { institutionId, socCode, title: name },
      update: {},
    });
    occupationId = occ.id;
  }
  const fam = await prisma.programFamily.create({ data: { institutionId, occupationId, name } });
  revalidatePath("/");
  redirect(`/families/${fam.id}`);
}

export async function deleteNorthStarGoal(familyId: string): Promise<void> {
  await prisma.program.updateMany({ where: { familyId }, data: { familyId: null } });
  await prisma.programFamily.delete({ where: { id: familyId } });
  revalidatePath("/");
}

/** Create a new delivery-model template under a family (a credential + N-term structure). */
export async function createFamilyProgram(familyId: string, formData: FormData): Promise<void> {
  const fam = await prisma.programFamily.findUnique({ where: { id: familyId }, select: { institutionId: true, occupationId: true } });
  if (!fam) return;
  const program = await prisma.program.create({
    data: {
      institutionId: fam.institutionId, familyId, occupationId: fam.occupationId,
      name: str(formData.get("name")) || "New delivery model",
      programType: str(formData.get("programType")) || "Traditional Full Time",
      credential: str(formData.get("credential")) || null,
    },
  });
  const termCount = Math.max(1, Math.min(12, numOr(formData.get("terms"), 4)));
  for (let i = 1; i <= termCount; i++) {
    await prisma.term.create({ data: { programId: program.id, index: i, name: `Term ${i}`, startWeek: 1, endWeek: 16 } });
  }
  const cohort = await prisma.cohort.create({ data: { programId: program.id, name: "First Cohort" } });
  await prisma.funnelStage.createMany({ data: STAGES.map((s, i) => ({ cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label })) });
  revalidatePath(`/families/${familyId}`);
  redirect(`/programs/${program.id}/structure`);
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

// ---------------------------------------------------------------------------
// OFFERING STAFFING — assign people to a cohort's course (all its sessions)
// ---------------------------------------------------------------------------

/** Assign a person to every session of a course FOR THIS COHORT (per-run staffing). */
export async function assignCourseStaff(cohortId: string, courseId: string, programId: string, formData: FormData): Promise<void> {
  const personId = str(formData.get("personId"));
  if (!personId) return;
  const role = str(formData.get("role")) || "instructor";
  const sessions = await prisma.session.findMany({ where: { courseId }, select: { id: true, lengthHours: true } });
  for (const s of sessions) {
    const exists = await prisma.sessionInstructor.findFirst({ where: { cohortId, sessionId: s.id, personId } });
    if (exists) continue;
    await prisma.sessionInstructor.create({ data: { cohortId, sessionId: s.id, personId, role, contactHours: s.lengthHours, segment: role } });
  }
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
}

/** Remove a person from all of a course's sessions for this cohort. */
export async function removeCourseStaff(cohortId: string, courseId: string, personId: string, programId: string): Promise<void> {
  await prisma.sessionInstructor.deleteMany({ where: { cohortId, personId, session: { courseId } } });
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
}

// ---------------------------------------------------------------------------
// SESSION RESOURCES — homework / readings / materials (course planning)
// ---------------------------------------------------------------------------

export async function addSessionResource(sessionId: string, courseId: string, programId: string, formData: FormData): Promise<void> {
  await prisma.sessionResource.create({
    data: {
      sessionId,
      kind: str(formData.get("kind")) || "READING",
      title: str(formData.get("title")) || "Untitled",
      url: str(formData.get("url")) || null,
      detail: str(formData.get("detail")) || null,
      estMinutes: optNum(formData.get("estMinutes")),
    },
  });
  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/programs/${programId}/structure`);
}

/** Save the program's workload-assumption cells (capacity model AI/AJ/AL, faculty & preceptor). */
export async function updateWorkloadAssumptions(programId: string, formData: FormData) {
  await prisma.program.update({
    where: { id: programId },
    data: {
      facContactHours: numOr(formData.get("facContactHours"), 16),
      facWorkWeekHours: numOr(formData.get("facWorkWeekHours"), 40),
      facTermWeeks: numOr(formData.get("facTermWeeks"), 18),
      preContactHours: numOr(formData.get("preContactHours"), 40),
      preWorkWeekHours: numOr(formData.get("preWorkWeekHours"), 40),
      preTermWeeks: numOr(formData.get("preTermWeeks"), 18),
    },
  });
  revalidatePath(`/programs/${programId}/structure`);
  revalidatePath(`/programs/${programId}`);
}

export async function deleteSessionResource(resourceId: string, courseId: string): Promise<void> {
  await prisma.sessionResource.delete({ where: { id: resourceId } });
  revalidatePath(`/courses/${courseId}`);
}

// ---------------------------------------------------------------------------
// FACILITIES — classrooms / labs / clinical spaces
// ---------------------------------------------------------------------------

export async function createFacility(formData: FormData): Promise<void> {
  const institutionId = str(formData.get("institutionId"));
  if (!institutionId) return;
  await prisma.facility.create({
    data: {
      institutionId,
      name: str(formData.get("name")) || "New facility",
      kind: str(formData.get("kind")) || "CLASSROOM",
      building: str(formData.get("building")) || null,
      capacity: optNum(formData.get("capacity")),
      areaSqft: optNum(formData.get("areaSqft")),
      hours: str(formData.get("hours")) || null,
      availability: str(formData.get("availability")) || null,
      equipment: str(formData.get("equipment")) || null,
      status: str(formData.get("status")) || "active",
    },
  });
  revalidatePath("/facilities");
}

export async function updateFacility(facilityId: string, formData: FormData): Promise<void> {
  await prisma.facility.update({
    where: { id: facilityId },
    data: {
      name: str(formData.get("name")) || "Facility",
      kind: str(formData.get("kind")) || "CLASSROOM",
      building: str(formData.get("building")) || null,
      capacity: optNum(formData.get("capacity")),
      areaSqft: optNum(formData.get("areaSqft")),
      hours: str(formData.get("hours")) || null,
      availability: str(formData.get("availability")) || null,
      equipment: str(formData.get("equipment")) || null,
      status: str(formData.get("status")) || "active",
    },
  });
  revalidatePath("/facilities");
}

export async function deleteFacility(facilityId: string): Promise<void> {
  await prisma.facility.delete({ where: { id: facilityId } });
  revalidatePath("/facilities");
}

// ---------------------------------------------------------------------------
// PEOPLE — faculty / preceptors / support staff
// ---------------------------------------------------------------------------

export async function createPerson(formData: FormData): Promise<void> {
  const institutionId = str(formData.get("institutionId"));
  if (!institutionId) return;
  const startRaw = str(formData.get("startDate"));
  const endRaw = str(formData.get("endDate"));
  await prisma.person.create({
    data: {
      institutionId,
      name: str(formData.get("name")) || "New person",
      role: str(formData.get("role")) || "instructor",
      title: str(formData.get("title")) || null,
      employmentType: str(formData.get("employmentType")) || null,
      active: formData.get("active") != null,
      startDate: startRaw ? new Date(startRaw) : null,
      endDate: endRaw ? new Date(endRaw) : null,
      email: str(formData.get("email")) || null,
      employerId: str(formData.get("employerId")) || null,
    },
  });
  revalidatePath("/people");
}

export async function updatePerson(personId: string, formData: FormData): Promise<void> {
  const startRaw = str(formData.get("startDate"));
  const endRaw = str(formData.get("endDate"));
  await prisma.person.update({
    where: { id: personId },
    data: {
      name: str(formData.get("name")) || "Person",
      role: str(formData.get("role")) || "instructor",
      title: str(formData.get("title")) || null,
      employmentType: str(formData.get("employmentType")) || null,
      active: formData.get("active") != null,
      startDate: startRaw ? new Date(startRaw) : null,
      endDate: endRaw ? new Date(endRaw) : null,
      email: str(formData.get("email")) || null,
      employerId: str(formData.get("employerId")) || null,
    },
  });
  revalidatePath("/people");
}

export async function deletePerson(personId: string): Promise<void> {
  await prisma.person.delete({ where: { id: personId } });
  revalidatePath("/people");
}

// ---------------------------------------------------------------------------
// EMPLOYERS — partner intake / management
// ---------------------------------------------------------------------------

export async function createEmployer(formData: FormData): Promise<void> {
  const institutionId = str(formData.get("institutionId"));
  if (!institutionId) return;
  await prisma.employer.create({
    data: {
      institutionId,
      name: str(formData.get("name")) || "New partner",
      setting: str(formData.get("setting")) || null,
      city: str(formData.get("city")) || null,
      wblSlots: optNum(formData.get("wblSlots")) ?? null,
      status: str(formData.get("status")) || "prospect",
      contactName: str(formData.get("contactName")) || null,
      contactEmail: str(formData.get("contactEmail")) || null,
      contactPhone: str(formData.get("contactPhone")) || null,
      notes: str(formData.get("notes")) || null,
    },
  });
  revalidatePath("/employers");
}

export async function updateEmployer(employerId: string, formData: FormData): Promise<void> {
  await prisma.employer.update({
    where: { id: employerId },
    data: {
      name: str(formData.get("name")) || "Partner",
      setting: str(formData.get("setting")) || null,
      city: str(formData.get("city")) || null,
      wblSlots: optNum(formData.get("wblSlots")) ?? null,
      status: str(formData.get("status")) || "active",
      contactName: str(formData.get("contactName")) || null,
      contactEmail: str(formData.get("contactEmail")) || null,
      contactPhone: str(formData.get("contactPhone")) || null,
      notes: str(formData.get("notes")) || null,
    },
  });
  revalidatePath("/employers");
  revalidatePath(`/employers/${employerId}`);
}

// ---------------------------------------------------------------------------
// WBL PLACEMENTS — assign a student to a partner for a rotation
// ---------------------------------------------------------------------------

const dateOrNull = (v: FormDataEntryValue | null): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

export async function createPlacement(formData: FormData): Promise<void> {
  const studentId = str(formData.get("studentId"));
  const employerId = str(formData.get("employerId"));
  if (!studentId || !employerId) return;
  await prisma.wblPlacement.create({
    data: {
      studentId, employerId,
      cohortId: str(formData.get("cohortId")) || null,
      termId: str(formData.get("termId")) || null,
      startDate: dateOrNull(formData.get("startDate")),
      endDate: dateOrNull(formData.get("endDate")),
      hoursPerWeek: optNum(formData.get("hoursPerWeek")),
      modality: str(formData.get("modality")) || null,
      status: str(formData.get("status")) || "planned",
      notes: str(formData.get("notes")) || null,
    },
  });
  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/employers/${employerId}`);
}

export async function updatePlacementStatus(placementId: string, status: string): Promise<void> {
  const p = await prisma.wblPlacement.update({ where: { id: placementId }, data: { status }, select: { studentId: true, employerId: true } });
  revalidatePath(`/students/${p.studentId}`);
  revalidatePath(`/employers/${p.employerId}`);
}

export async function deletePlacement(placementId: string): Promise<void> {
  const p = await prisma.wblPlacement.delete({ where: { id: placementId }, select: { studentId: true, employerId: true } });
  revalidatePath(`/students/${p.studentId}`);
  revalidatePath(`/employers/${p.employerId}`);
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

/** Lock in an instantiation from the goal-breakdown box: create the cohort
 *  (offering) for a delivery model with real per-term dates AND the full set of
 *  funnel targets derived backward from its share of the goal — so the moment
 *  it's locked, every surface (offering page, calendars, analytics, capacity
 *  insights) has its numbers. */
export async function lockInInstantiation(
  programId: string,
  familyId: string,
  input: { gradYear: number; goal: number; startDate: string },
): Promise<{ cohortId: string; name: string }> {
  const { deriveCohortTargets } = await import("./pipeline");
  const { BENCHMARK_RATES } = await import("./northstar");

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: { terms: { orderBy: { index: "asc" } }, family: { select: { goalPlan: true } }, cohorts: { select: { name: true } } },
  });
  if (!program) throw new Error("Program not found");

  // The SAME rates the goal planner saves — one plan, every surface reads it.
  let rates = { ...BENCHMARK_RATES };
  if (program.family?.goalPlan) {
    try {
      const saved = JSON.parse(program.family.goalPlan) as { goal?: Partial<typeof BENCHMARK_RATES> };
      if (saved.goal) rates = { ...rates, ...saved.goal };
    } catch { /* benchmarks */ }
  }
  const t = deriveCohortTargets(Math.max(0, input.goal), rates, Math.max(1, program.terms.length));

  // Name it by the year it lands its graduates; disambiguate within the program.
  let name = `Class of ${input.gradYear}`;
  if (program.cohorts.some((c) => c.name === name)) {
    let n = 2;
    while (program.cohorts.some((c) => c.name === `${name} (${n})`)) n++;
    name = `${name} (${n})`;
  }

  const startD = new Date(input.startDate);
  const cohort = await prisma.cohort.create({
    data: {
      programId, name, status: "planned", startDate: startD,
      entryYear: startD.getFullYear(), isExplicit: true,
      plannedSeats: Math.round(t.capacity),
    },
  });

  // Funnel targets — the whole derived ladder, stage by stage.
  const stageTargets: Record<string, number> = {
    interested: t.interested, qualified: t.qualified, offered: t.offered,
    enrolled: t.capacity, completing: t.completing, licensed: t.licensed,
    placed: t.placed, productive: t.productive,
  };
  await prisma.funnelStage.createMany({
    data: STAGES.map((s, i) => ({
      cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label,
      targetNumber: Math.round(stageTargets[s.key] ?? 0),
    })),
  });

  // Real per-term dates cascaded from each template term's week span.
  const cursor = new Date(startD);
  for (const term of program.terms) {
    await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: term.id, startDate: new Date(cursor) } });
    const weeks = (term.endWeek ?? 16) - (term.startWeek ?? 1) + 1;
    cursor.setDate(cursor.getDate() + (weeks + 2) * 7); // term length + ~2-week break
  }

  // Calendarize immediately so the data shows up everywhere at once: meetings
  // (with days/times) land on the master calendar and drive the capacity
  // insights. Rooms/sites stay unassigned until someone places them.
  await calendarizeCohort(cohort.id, programId);

  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/programs/${programId}`);
  return { cohortId: cohort.id, name };
}

/** Persist an offering's per-section weekly slots (day/time/room) in bulk. */
export async function saveSectionSchedules(
  cohortId: string,
  programId: string,
  items: { sessionId: string; sectionIndex: number; dayOfWeek: string | null; startTime: string | null; location: string | null; facilityId?: string | null }[],
) {
  for (const it of items) {
    const facilityId = it.facilityId || null;
    await prisma.sectionSchedule.upsert({
      where: { cohortId_sessionId_sectionIndex: { cohortId, sessionId: it.sessionId, sectionIndex: it.sectionIndex } },
      create: { cohortId, sessionId: it.sessionId, sectionIndex: it.sectionIndex, dayOfWeek: it.dayOfWeek || null, startTime: it.startTime || null, location: it.location || null, facilityId },
      update: { dayOfWeek: it.dayOfWeek || null, startTime: it.startTime || null, location: it.location || null, facilityId },
    });
  }
  revalidatePath(`/programs/${programId}/offerings/${cohortId}/schedule`);
  revalidatePath(`/programs/${programId}/schedule`);
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
      deliveryMode: str(formData.get("deliveryMode")) || null,
      notes: str(formData.get("notes")) || null,
      facultyContactPolicy: optNum(formData.get("facultyContactPolicy")),
      supportContactPolicy: optNum(formData.get("supportContactPolicy")),
      preceptorContactPolicy: optNum(formData.get("preceptorContactPolicy")),
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
      deliveryMode: str(formData.get("deliveryMode")) || null,
      notes: str(formData.get("notes")) || null,
      facultyContactPolicy: optNum(formData.get("facultyContactPolicy")),
      supportContactPolicy: optNum(formData.get("supportContactPolicy")),
      preceptorContactPolicy: optNum(formData.get("preceptorContactPolicy")),
    },
  });
  revalidatePath(`/programs/${programId}`);
  revalidatePath(`/programs/${programId}/structure`);
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

/** The studio's "ask": create a PLANNED placement (learner × partner). The partner
 *  confirming it (planned → active) is what makes it secured — asked vs secured on
 *  the employer page reads straight from these statuses. */
export async function requestPlacement(studentId: string, employerId: string, familyId: string): Promise<void> {
  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { cohortId: true } });
  const dup = await prisma.wblPlacement.findFirst({ where: { studentId, employerId, status: { in: ["planned", "active"] } } });
  if (!dup) {
    await prisma.wblPlacement.create({ data: { studentId, employerId, cohortId: student?.cohortId ?? null, status: "planned" } });
  }
  revalidatePath(`/families/${familyId}/wbl`);
  revalidatePath(`/employers/${employerId}`);
}

// ---------------------------------------------------------------------------
// MASTER SCHEDULE — move / reassign a bookable meeting
// ---------------------------------------------------------------------------

/** Move a meeting to a new day / time / room (and optionally staff). Used by the
 *  master space calendar and the offering calendar — both read MeetingPattern, so
 *  a change here shows up in every surface. */
export async function moveMeeting(
  meetingId: string,
  patch: { dayOfWeek?: string; startTime?: string; lengthHours?: number; facilityId?: string | null; staffPersonId?: string | null },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.dayOfWeek) data.dayOfWeek = patch.dayOfWeek;
  if (patch.startTime) data.startTime = patch.startTime;
  if (patch.lengthHours != null) data.lengthHours = patch.lengthHours;
  if (patch.facilityId !== undefined) data.facilityId = patch.facilityId || null;
  if (patch.staffPersonId !== undefined) data.staffPersonId = patch.staffPersonId || null;
  const m = await prisma.meetingPattern.update({ where: { id: meetingId }, data, include: { cohort: { select: { id: true, programId: true } } } });
  revalidatePath("/calendar");
  revalidatePath(`/programs/${m.cohort.programId}/offerings/${m.cohortId}`);
}

// ---------------------------------------------------------------------------
// COURSE DEMAND — drill to the students driving a shared course's demand
// ---------------------------------------------------------------------------

export async function fetchCourseDemandStudents(code: string, institutionId: string) {
  const { getCourseDemandStudents } = await import("./queries");
  return getCourseDemandStudents(code, institutionId);
}

// ---------------------------------------------------------------------------
// ALIGNMENT ENGINE — save intake / checkpoint profiles + interventions
// ---------------------------------------------------------------------------

export interface AlignmentTagInput {
  layer: string; // MOTIVATION | CONSTRAINT | CAPACITY
  code: string;
  tier?: number | null;
  binding?: boolean;
  conditionalOn?: string | null;
  note?: string | null;
}

/** Create (or replace, per subject+checkpoint) an alignment profile with its tags. */
export async function saveAlignmentProfile(input: {
  subjectType: "LEARNER" | "EMPLOYER";
  studentId?: string | null;
  employerId?: string | null;
  checkpoint: string;
  mvdTier: number;
  narrative?: string | null;
  conductedBy?: string | null;
  tags: AlignmentTagInput[];
}): Promise<void> {
  const where = input.subjectType === "LEARNER"
    ? { studentId: input.studentId ?? undefined, checkpoint: input.checkpoint }
    : { employerId: input.employerId ?? undefined, checkpoint: input.checkpoint };
  const existing = await prisma.alignmentProfile.findFirst({ where });
  if (existing) await prisma.alignmentProfile.delete({ where: { id: existing.id } });
  await prisma.alignmentProfile.create({
    data: {
      subjectType: input.subjectType,
      studentId: input.subjectType === "LEARNER" ? input.studentId ?? null : null,
      employerId: input.subjectType === "EMPLOYER" ? input.employerId ?? null : null,
      checkpoint: input.checkpoint,
      mvdTier: input.mvdTier,
      narrative: input.narrative ?? null,
      conductedBy: input.conductedBy ?? null,
      tags: {
        create: input.tags.map((t) => ({
          layer: t.layer, code: t.code, tier: t.tier ?? null,
          binding: t.binding ?? false, conditionalOn: t.conditionalOn ?? null, note: t.note ?? null,
        })),
      },
    },
  });
  if (input.studentId) revalidatePath(`/students/${input.studentId}/alignment`);
  if (input.employerId) revalidatePath(`/employers/${input.employerId}/alignment`);
}

export async function deleteAlignmentProfile(profileId: string): Promise<void> {
  const p = await prisma.alignmentProfile.delete({ where: { id: profileId } });
  if (p.studentId) revalidatePath(`/students/${p.studentId}/alignment`);
  if (p.employerId) revalidatePath(`/employers/${p.employerId}/alignment`);
}

// ---------------------------------------------------------------------------
// CALENDARIZE — bind a cohort's timeless archetype to reality (rooms, sites,
// days, times), creating its bookable meetings. THE assignment surface starts here.
// ---------------------------------------------------------------------------

export async function calendarizeCohort(cohortId: string, programId: string): Promise<void> {
  const { autoSchedule, toHHMM } = await import("./space");
  const WK_MS = 7 * 24 * 3600 * 1000;
  const existing = await prisma.meetingPattern.count({ where: { cohortId } });
  if (existing > 0) return; // already calendarized — edit meetings instead
  const co = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      cohortTerms: { select: { termId: true, startDate: true } },
      program: { select: { institutionId: true, defaultCohortSeats: true, terms: { select: { id: true, index: true, startWeek: true, endWeek: true, courses: { select: { id: true, sessions: { select: { kind: true, maxStudents: true, lengthHours: true } } } } } } } },
    },
  });
  if (!co) return;
  const rooms = await prisma.facility.findMany({ where: { institutionId: co.program.institutionId, status: "active" }, select: { id: true, name: true, kind: true, capacity: true } });
  const hosts = await prisma.employer.findMany({ where: { institutionId: co.program.institutionId, status: "active", OR: [{ setting: { contains: "Hospital" } }, { setting: { contains: "Imaging" } }, { setting: { contains: "Surgical" } }, { setting: { contains: "Clinic" } }] }, select: { id: true } });
  const E = Math.round(co.plannedSeats ?? co.program.defaultCohortSeats ?? 30);
  const ctStart = new Map(co.cohortTerms.map((ct) => [ct.termId, ct.startDate]));
  type Req = import("./space").PlaceReq;
  const reqs: Req[] = [];
  const meta = new Map<string, { courseId: string; kind: string; sectionIndex: number; sectionCount: number; seats: number; lengthHours: number; termIndex: number; startWeek: number; endWeek: number }>();
  for (const t of co.program.terms) {
    const termStart = ctStart.get(t.id);
    // Planned cohorts may lack dated terms — synthesize a window from the cohort start.
    const base = termStart ?? (co.startDate ? new Date(co.startDate.getTime() + (t.index - 1) * 17 * WK_MS) : null);
    if (!base) continue;
    const tw = (t.endWeek ?? 16) - (t.startWeek ?? 1) + 1;
    for (const c of t.courses) {
      const kinds = new Map<string, { maxStudents: number; lengthHours: number }>();
      for (const s of c.sessions) if (!kinds.has(s.kind)) kinds.set(s.kind, { maxStudents: s.maxStudents, lengthHours: s.lengthHours });
      for (const [kind, info] of kinds) {
        const cap = Math.max(1, info.maxStudents || (kind === "CLINICAL" ? 8 : 30));
        const sections = Math.max(1, Math.ceil(E / cap));
        for (let si = 1; si <= sections; si++) {
          const id = `${cohortId}:${c.id}:${kind}:${si}`;
          reqs.push({ id, cohortId, sectionIndex: si, kind, seats: Math.ceil(E / sections), lengthHours: info.lengthHours || 2, weekStartMs: base.getTime(), weekEndMs: base.getTime() + tw * WK_MS });
          meta.set(id, { courseId: c.id, kind, sectionIndex: si, sectionCount: sections, seats: Math.ceil(E / sections), lengthHours: info.lengthHours || 2, termIndex: t.index, startWeek: t.startWeek ?? 1, endWeek: t.endWeek ?? 16 });
        }
      }
    }
  }
  if (!reqs.length) return;
  // Schedule against everything already booked at the institution (no conflicts).
  const { placements } = autoSchedule(reqs, rooms);
  let ci = 0;
  const rows = reqs.map((r) => {
    const m = meta.get(r.id)!;
    const pl = placements.get(r.id)!;
    return { cohortId, courseId: m.courseId, kind: m.kind, sectionIndex: m.sectionIndex, sectionCount: m.sectionCount, seats: m.seats, dayOfWeek: pl.dayOfWeek, startTime: toHHMM(pl.startMin), lengthHours: m.lengthHours, termIndex: m.termIndex, startWeek: m.startWeek, endWeek: m.endWeek, facilityId: pl.facilityId, employerId: m.kind === "CLINICAL" && hosts.length ? hosts[(ci++) % hosts.length].id : null, staffPersonId: null };
  });
  for (let i = 0; i < rows.length; i += 400) await prisma.meetingPattern.createMany({ data: rows.slice(i, i + 400) });
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
  revalidatePath("/calendar");
}
