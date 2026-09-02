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
  // Any institution — pick an existing one or create a new one on the spot.
  let institutionId = str(formData.get("institutionId"));
  const newInstitutionName = str(formData.get("newInstitutionName"));
  if (newInstitutionName) {
    const inst = await prisma.institution.create({ data: { name: newInstitutionName } });
    institutionId = inst.id;
  }
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

/** The institution's academic calendar pattern — each semester starts on the
 *  Monday on/after its MM-DD anchor; every derived term date follows it. */
export async function updateInstitutionCalendar(institutionId: string, familyId: string, formData: FormData): Promise<void> {
  const mmdd = (v: FormDataEntryValue | null, d: string) => { const x = str(v); return /^\d{2}-\d{2}$/.test(x) ? x : d; };
  await prisma.institution.update({
    where: { id: institutionId },
    data: {
      springStart: mmdd(formData.get("springStart"), "01-08"),
      summerStart: mmdd(formData.get("summerStart"), "05-28"),
      fallStart: mmdd(formData.get("fallStart"), "08-15"),
    },
  });
  revalidatePath(`/families/${familyId}`);
}

/** The semester pattern + every imported exact semester start — what the
 *  term-date engine follows for this institution. */
async function institutionAnchors(institutionId: string): Promise<import("./term").SemesterAnchors> {
  const inst = await prisma.institution.findUnique({
    where: { id: institutionId },
    select: { springStart: true, summerStart: true, fallStart: true, academicEvents: { where: { kind: "term_start" }, select: { date: true } } },
  });
  const { DEFAULT_ANCHORS } = await import("./term");
  if (!inst) return DEFAULT_ANCHORS;
  return { springStart: inst.springStart, summerStart: inst.summerStart, fallStart: inst.fallStart, knownStarts: inst.academicEvents.map((e) => e.date.toISOString().slice(0, 10)).sort() };
}

export interface AcademicEventInput { iso: string; endIso: string | null; label: string; kind: string; season: string | null; source?: string | null }

/** Import a pasted academic calendar: the coded events replace whatever was
 *  coded for the same years, and the semester pattern follows the coded starts. */
export async function importAcademicCalendar(institutionId: string, familyId: string, payload: {
  anchors: { springStart: string; summerStart: string; fallStart: string };
  events: AcademicEventInput[];
}): Promise<{ saved: number }> {
  const KINDS = new Set(["term_start", "term_end", "session_start", "holiday", "other"]);
  const events = payload.events.filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.iso) && KINDS.has(e.kind) && e.kind !== "other" && e.label.trim());
  const years = [...new Set(events.map((e) => Number(e.iso.slice(0, 4))))];
  const mmdd = (x: string, d: string) => (/^\d{2}-\d{2}$/.test(x) ? x : d);
  await prisma.$transaction(async (tx) => {
    for (const y of years) {
      await tx.academicEvent.deleteMany({ where: { institutionId, date: { gte: new Date(`${y}-01-01T00:00:00Z`), lt: new Date(`${y + 1}-01-01T00:00:00Z`) } } });
    }
    if (events.length) {
      await tx.academicEvent.createMany({
        data: events.map((e) => ({
          institutionId, date: new Date(e.iso + "T00:00:00Z"), endDate: e.endIso ? new Date(e.endIso + "T00:00:00Z") : null,
          label: e.label.trim().slice(0, 200), kind: e.kind, season: e.season, source: e.source?.slice(0, 500) ?? null,
        })),
      });
    }
    await tx.institution.update({
      where: { id: institutionId },
      data: { springStart: mmdd(payload.anchors.springStart, "01-08"), summerStart: mmdd(payload.anchors.summerStart, "05-28"), fallStart: mmdd(payload.anchors.fallStart, "08-15") },
    });
  });
  revalidatePath(`/families/${familyId}`);
  revalidatePath("/", "layout");
  return { saved: events.length };
}

export async function deleteAcademicEvent(id: string, familyId: string): Promise<void> {
  await prisma.academicEvent.delete({ where: { id } }).catch(() => undefined);
  revalidatePath(`/families/${familyId}`);
  revalidatePath("/", "layout");
}

export async function clearAcademicCalendar(institutionId: string, familyId: string): Promise<void> {
  await prisma.academicEvent.deleteMany({ where: { institutionId } });
  revalidatePath(`/families/${familyId}`);
  revalidatePath("/", "layout");
}

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

// ── Functional units (the asset map's master grain) ──
function unitDataFrom(formData: FormData) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].filter((d) => str(formData.get(`day_${d}`)) === "on" || str(formData.get(`day_${d}`)) === "1");
  const blocks = ["Day", "Evening", "Night"].filter((b) => str(formData.get(`block_${b}`)) === "on" || str(formData.get(`block_${b}`)) === "1");
  return {
    unitType: str(formData.get("unitType")) || "Unit",
    unitCategory: str(formData.get("unitCategory")) || "Inpatient beds",
    unitName: str(formData.get("unitName")) || null,
    capacityCount: optNum(formData.get("capacityCount")),
    uom: str(formData.get("uom")) || null,
    dataSource: str(formData.get("dataSource")) || "ESTIMATE",
    shiftsPerDay: Math.max(1, Math.round(numOr(formData.get("shiftsPerDay"), blocks.length || 1))),
    shiftLengthHrs: numOr(formData.get("shiftLengthHrs"), 8),
    shiftBlocks: (blocks.length ? blocks : ["Day"]).join(","),
    days: (days.length ? days : ["Mon", "Tue", "Wed", "Thu", "Fri"]).join(","),
    studentsPerShift: Math.max(0, Math.round(numOr(formData.get("studentsPerShift"), 0))),
    studentsPerPreceptor: Math.max(1, Math.round(numOr(formData.get("studentsPerPreceptor"), 1))),
    preceptorsPerShift: Math.max(0, Math.round(numOr(formData.get("preceptorsPerShift"), 0))),
    natcepEligible: str(formData.get("natcepEligible")) === "yes" ? true : str(formData.get("natcepEligible")) === "no" ? false : null,
    status: str(formData.get("status")) || "active",
    notes: str(formData.get("notes")) || null,
  };
}
export async function createClinicalUnit(employerId: string, formData: FormData): Promise<void> {
  await prisma.clinicalUnit.create({ data: { employerId, ...unitDataFrom(formData) } });
  revalidatePath(`/employers/${employerId}`); revalidatePath("/insights/clinical-sites");
}
export async function updateClinicalUnit(unitId: string, employerId: string, formData: FormData): Promise<void> {
  await prisma.clinicalUnit.update({ where: { id: unitId }, data: unitDataFrom(formData) });
  revalidatePath(`/employers/${employerId}`); revalidatePath("/insights/clinical-sites");
}
export async function deleteClinicalUnit(unitId: string, employerId: string): Promise<void> {
  await prisma.clinicalUnit.delete({ where: { id: unitId } });
  revalidatePath(`/employers/${employerId}`); revalidatePath("/insights/clinical-sites");
}
/** Agreement lifecycle with a site: none | prospect | asked | secured | declined. */
export async function updateEmployerAgreement(employerId: string, status: string): Promise<void> {
  await prisma.employer.update({ where: { id: employerId }, data: { agreementStatus: status || "none" } });
  revalidatePath("/insights/clinical-sites"); revalidatePath("/employers"); revalidatePath(`/employers/${employerId}`);
}
/** Rotation type → unit category (the demand ↔ supply join), per institution. */
export async function upsertRotationSetting(institutionId: string, formData: FormData): Promise<void> {
  const rotationType = str(formData.get("rotationType"));
  if (!rotationType) return;
  await prisma.rotationSetting.upsert({
    where: { institutionId_rotationType: { institutionId, rotationType } },
    update: { unitCategory: str(formData.get("unitCategory")) || "Inpatient beds", unitType: str(formData.get("unitType")) || null, patientsPerStudent: optNum(formData.get("patientsPerStudent")) },
    create: { institutionId, rotationType, unitCategory: str(formData.get("unitCategory")) || "Inpatient beds", unitType: str(formData.get("unitType")) || null, patientsPerStudent: optNum(formData.get("patientsPerStudent")) },
  });
  revalidatePath("/insights/clinical-sites");
}
/** Host a clinical section at a site + functional unit (weekly booking). */
export async function assignSectionSite(meetingId: string, employerId: string | null, unitId: string | null): Promise<void> {
  const m = await prisma.meetingPattern.update({ where: { id: meetingId }, data: { employerId, unitId }, include: { cohort: { select: { programId: true } } } });
  revalidatePath("/insights/clinical-sites"); revalidatePath("/calendar");
  revalidatePath(`/programs/${m.cohort.programId}/offerings/${m.cohortId}`);
  if (employerId) revalidatePath(`/employers/${employerId}`);
}

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
  const intOr = (name: string) => { const v = optNum(formData.get(name)); return v == null ? null : Math.round(v); };
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
      // clinical asset map (facility level)
      organization: str(formData.get("organization")) || null,
      facilityType: str(formData.get("facilityType")) || null,
      county: str(formData.get("county")) || null,
      ring: str(formData.get("ring")) || null,
      licensedBeds: intOr("licensedBeds"), nursingHomeBeds: intOr("nursingHomeBeds"), adultCareBeds: intOr("adultCareBeds"),
      operatingRooms: intOr("operatingRooms"), annualSurgicalCases: intOr("annualSurgicalCases"),
      agreementStatus: str(formData.get("agreementStatus")) || "none",
      agreementNotes: str(formData.get("agreementNotes")) || null,
    },
  });
  revalidatePath("/insights/clinical-sites");
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

  // Real semesterly term dates: term 1 starts on the chosen date; every later
  // term starts at the NEXT legit semester boundary (2nd Mon of Jan / 1st Mon
  // of Jun / 3rd Mon of Aug) after the previous term ends — no "Spring" that
  // starts in December. The class year is when the last term actually ends.
  const { deriveTermStarts } = await import("./term");
  const termWeeks = program.terms.map((term) => (term.endWeek ?? 16) - (term.startWeek ?? 1) + 1);
  const termStarts = deriveTermStarts(input.startDate, termWeeks, await institutionAnchors(program.institutionId));
  const lastStart = termStarts[termStarts.length - 1];
  const endYear = new Date(lastStart.getTime() + termWeeks[termWeeks.length - 1] * 7 * 86400000).getUTCFullYear();

  // Name it by the year it lands its graduates; disambiguate within the program.
  let name = `Class of ${endYear}`;
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

  // Real per-term dates — the semester-snapped starts computed above.
  for (let i = 0; i < program.terms.length; i++) {
    await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: program.terms[i].id, startDate: termStarts[i] } });
  }

  // Calendarize immediately so the data shows up everywhere at once: meetings
  // (with days/times) land on the master calendar and drive the capacity
  // insights. Rooms/sites stay unassigned until someone places them.
  await calendarizeCohort(cohort.id, programId);

  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/programs/${programId}`);
  return { cohortId: cohort.id, name };
}

/** Set one course's real window for THIS offering — courses inside a term run
 *  different lengths (8-, 12-, 16-week), so each gets its own start and end.
 *  The start anchors the course's session weeks; clearing both removes the
 *  override (back to the term's window). */
export async function saveCourseDates(cohortId: string, courseId: string, programId: string, formData: FormData) {
  const startStr = str(formData.get("startDate"));
  const endStr = str(formData.get("endDate"));
  if (!startStr && !endStr) {
    await prisma.cohortCourseDates.deleteMany({ where: { cohortId, courseId } });
  } else {
    await prisma.cohortCourseDates.upsert({
      where: { cohortId_courseId: { cohortId, courseId } },
      update: { startDate: startStr ? new Date(startStr) : null, endDate: endStr ? new Date(endStr) : null },
      create: { cohortId, courseId, startDate: startStr ? new Date(startStr) : null, endDate: endStr ? new Date(endStr) : null },
    });
  }
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
  revalidatePath(`/programs/${programId}/offerings/${cohortId}/design`);
  revalidatePath(`/insights/staffing-need`);
  revalidatePath(`/insights/coverage`);
  revalidatePath(`/insights/clinical-sites`);
}

/** Save a per-INSTANTIATION session override — EVERY input column of the
 *  session table can be adjusted for THIS offering (same configurability as
 *  the template's design & sequence sheet) without touching the template.
 *  Only fields that DIFFER from the template are stored, so anything left
 *  matching keeps inheriting future template edits. */
export async function saveSessionOverride(cohortId: string, sessionId: string, programId: string, formData: FormData) {
  const tpl = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!tpl) return;
  // Day, time and location are effectively supplied by the weekly booking
  // (meeting pattern) when one exists — diff those fields against what the row
  // actually shows (meeting ?? template), or an untouched row would store
  // spurious overrides and an equal-to-template edit would silently revert to
  // the meeting value.
  const meeting = await prisma.meetingPattern.findFirst({
    where: { cohortId, courseId: tpl.courseId, kind: tpl.kind },
    orderBy: { sectionIndex: "asc" },
  });
  const numDiff = (name: string, tplVal: number | null) => {
    const v = optNum(formData.get(name));
    return v != null && v !== tplVal ? v : null;
  };
  const strDiff = (name: string, tplVal: string | null) => {
    const v = str(formData.get(name)) || null;
    return v != null && v !== tplVal ? v : null;
  };
  const data = {
    week: numDiff("week", tpl.week),
    dayOfWeek: strDiff("dayOfWeek", meeting?.dayOfWeek ?? tpl.dayOfWeek),
    startTime: strDiff("startTime", meeting?.startTime ?? tpl.startTime),
    notes: strDiff("notes", tpl.notes),
    title: strDiff("title", tpl.title),
    deliveryMode: strDiff("deliveryMode", tpl.deliveryMode),
    location: strDiff("location", tpl.location),
    lengthHours: numDiff("lengthHours", tpl.lengthHours),
    maxStudents: (() => { const v = optNum(formData.get("maxStudents")); return v != null && v !== tpl.maxStudents ? Math.round(v) : null; })(),
    facultyNeeded: numDiff("facultyNeeded", tpl.facultyNeeded),
    facultyContactPolicy: numDiff("facultyContactPolicy", tpl.facultyContactPolicy),
    supportStaffNeeded: numDiff("supportStaffNeeded", tpl.supportStaffNeeded),
    supportContactPolicy: numDiff("supportContactPolicy", tpl.supportContactPolicy),
    preceptorsNeeded: numDiff("preceptorsNeeded", tpl.preceptorsNeeded),
    preceptorContactPolicy: numDiff("preceptorContactPolicy", tpl.preceptorContactPolicy),
    rotationType: strDiff("rotationType", tpl.rotationType),
    clinicalMode: strDiff("clinicalMode", tpl.clinicalMode),
  };
  const empty = Object.values(data).every((v) => v == null);
  if (empty) {
    await prisma.sessionOverride.deleteMany({ where: { cohortId, sessionId } });
  } else {
    await prisma.sessionOverride.upsert({
      where: { cohortId_sessionId: { cohortId, sessionId } },
      update: data,
      create: { cohortId, sessionId, ...data },
    });
  }
  revalidatePath(`/programs/${programId}/offerings/${cohortId}/design`);
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
  revalidatePath(`/insights/staffing-need`);
  revalidatePath(`/insights/clinical-sites`);
  revalidatePath(`/insights/coverage`);
}

/** Clear a per-instantiation session override entirely (back to the template). */
export async function clearSessionOverride(cohortId: string, sessionId: string, programId: string) {
  await prisma.sessionOverride.deleteMany({ where: { cohortId, sessionId } });
  revalidatePath(`/programs/${programId}/offerings/${cohortId}/design`);
}

/** Adjust a locked-in offering's real dates/** Adjust a locked-in offering's real dates: the start date and each term's
 *  first day. Calendars, capacity insights, and timing all derive from these
 *  live, so a shift here moves everything at once. */
export async function updateOfferingDates(cohortId: string, programId: string, formData: FormData) {
  const startStr = str(formData.get("startDate"));
  await prisma.cohort.update({
    where: { id: cohortId },
    data: startStr ? { startDate: new Date(startStr), entryYear: new Date(startStr).getFullYear() } : {},
  });
  const cts = await prisma.cohortTerm.findMany({ where: { cohortId }, select: { id: true, termId: true, term: { select: { index: true, startWeek: true, endWeek: true } } } });
  if (str(formData.get("rederive")) === "1" && startStr) {
    // Re-derive every term from the offering start along the institution's academic calendar.
    const { deriveTermStarts } = await import("./term");
    const inst = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { program: { select: { institutionId: true } } } });
    const ordered = [...cts].sort((a, b) => a.term.index - b.term.index);
    const starts = deriveTermStarts(startStr, ordered.map((ct) => (ct.term.endWeek ?? 16) - (ct.term.startWeek ?? 1) + 1), inst ? await institutionAnchors(inst.program.institutionId) : undefined);
    for (let i = 0; i < ordered.length; i++) await prisma.cohortTerm.update({ where: { id: ordered[i].id }, data: { startDate: starts[i] } });
  } else {
    for (const ct of cts) {
      const v = str(formData.get(`term_${ct.termId}`));
      if (v) await prisma.cohortTerm.update({ where: { id: ct.id }, data: { startDate: new Date(v) } });
    }
  }

  // The class name tracks when the program actually ends: recompute the real
  // finish (last term's start + its weeks) and rename "Class of YYYY" to match.
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: { cohortTerms: { include: { term: { select: { index: true, startWeek: true, endWeek: true } } } }, program: { select: { cohorts: { select: { id: true, name: true } } } } },
  });
  if (cohort) {
    let endMs = 0;
    for (const ct of cohort.cohortTerms) {
      if (!ct.startDate) continue;
      const weeks = (ct.term.endWeek ?? 16) - (ct.term.startWeek ?? 1) + 1;
      endMs = Math.max(endMs, ct.startDate.getTime() + weeks * 7 * 86400000);
    }
    const m = cohort.name.match(/^Class of (\d{4})(.*)$/);
    if (endMs && m) {
      const endYear = new Date(endMs).getFullYear();
      if (String(endYear) !== m[1]) {
        let newName = `Class of ${endYear}${m[2]}`;
        if (cohort.program.cohorts.some((c) => c.id !== cohortId && c.name === newName)) {
          let n = 2;
          while (cohort.program.cohorts.some((c) => c.id !== cohortId && c.name === `Class of ${endYear} (${n})`)) n++;
          newName = `Class of ${endYear} (${n})`;
        }
        await prisma.cohort.update({ where: { id: cohortId }, data: { name: newName } });
      }
    }
  }
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
  revalidatePath(`/programs/${programId}`);
  revalidatePath(`/calendar`);
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

// ---------------------------------------------------------------------------
// SPREADSHEET IMPORT — a schedule someone already has → the template / an offering
// ---------------------------------------------------------------------------

type ImportedSession = import("./sheetimport").ImportedSession;

const sessionDataFrom = (r: ImportedSession) => ({
  title: r.title, lengthHours: r.lengthHours ?? 0, maxStudents: Math.max(1, Math.round(r.maxStudents ?? 1)),
  facultyNeeded: r.facultyNeeded ?? (r.kind === "CLINICAL" ? 0 : 1), supportStaffNeeded: r.supportStaffNeeded ?? 0,
  preceptorsNeeded: r.preceptorsNeeded ?? (r.kind === "CLINICAL" ? 1 : 0),
  week: r.week != null ? Math.round(r.week) : null, dayOfWeek: r.dayOfWeek, startTime: r.startTime, location: r.location,
  rotationType: r.rotationType, clinicalMode: r.clinicalMode, deliveryMode: r.deliveryMode, notes: r.notes,
  facultyContactPolicy: r.facultyContactPolicy, supportContactPolicy: r.supportContactPolicy, preceptorContactPolicy: r.preceptorContactPolicy,
});

/** Import session rows into the TEMPLATE: terms are matched by term number
 *  (created if missing), courses by code (else title) within the term, and —
 *  when `replace` is on — the imported course × type's existing sessions are
 *  replaced by the sheet's rows; otherwise the rows are appended. */
export async function importProgramSheet(programId: string, sessions: ImportedSession[], opts: { replace: boolean }): Promise<{ terms: number; courses: number; sessions: number }> {
  const program = await prisma.program.findUnique({ where: { id: programId }, include: { terms: { orderBy: { index: "asc" }, include: { courses: true } } } });
  if (!program) throw new Error("Program not found");
  let termsCreated = 0, coursesCreated = 0, sessionsCreated = 0;
  const termByIndex = new Map(program.terms.map((t) => [t.index, t]));
  const groups = new Map<string, { termNumber: number; semester: string | null; code: string | null; title: string | null; rows: ImportedSession[] }>();
  for (const s of sessions) {
    const tn = Math.max(1, Math.round(s.termNumber ?? 1));
    const key = `${tn}|${(s.courseCode ?? s.courseTitle ?? "").toLowerCase()}`;
    const g = groups.get(key) ?? { termNumber: tn, semester: s.semester, code: s.courseCode, title: s.courseTitle, rows: [] };
    g.rows.push(s); groups.set(key, g);
  }
  const cleared = new Set<string>();
  for (const g of groups.values()) {
    let term = termByIndex.get(g.termNumber);
    if (!term) {
      const prevEnd = Math.max(0, ...[...termByIndex.values()].map((t) => t.endWeek ?? 0));
      term = await prisma.term.create({
        data: { programId, index: g.termNumber, name: g.semester ? `Term ${g.termNumber} · ${g.semester}` : `Term ${g.termNumber}`, startWeek: prevEnd + 1, endWeek: prevEnd + 16 },
        include: { courses: true },
      });
      termByIndex.set(g.termNumber, term); termsCreated++;
    }
    let course = term.courses.find((c) => (g.code && (c.code ?? "").toLowerCase() === g.code.toLowerCase()) || (!g.code && g.title && c.name.toLowerCase() === g.title.toLowerCase()));
    if (!course) {
      const last = await prisma.course.findFirst({ where: { termId: term.id }, orderBy: { sequenceOrder: "desc" } });
      course = await prisma.course.create({ data: { termId: term.id, code: g.code, name: g.title ?? g.code ?? "Course", sequenceOrder: (last?.sequenceOrder ?? -1) + 1 } });
      term.courses.push(course); coursesCreated++;
    }
    const kinds = [...new Set(g.rows.map((r) => r.kind))];
    if (opts.replace) {
      for (const k of kinds) { const ck = `${course.id}|${k}`; if (!cleared.has(ck)) { await prisma.session.deleteMany({ where: { courseId: course.id, kind: k } }); cleared.add(ck); } }
    }
    for (const r of g.rows) {
      const last = await prisma.session.findFirst({ where: { courseId: course.id, kind: r.kind }, orderBy: { number: "desc" } });
      const number = opts.replace && r.number != null ? Math.round(r.number) : (last?.number ?? 0) + 1;
      await prisma.session.create({ data: { courseId: course.id, kind: r.kind, number, ...sessionDataFrom(r) } });
      sessionsCreated++;
    }
  }
  revalidatePath(`/programs/${programId}`);
  revalidatePath(`/programs/${programId}/structure`);
  return { terms: termsCreated, courses: coursesCreated, sessions: sessionsCreated };
}

/** Import session rows into ONE OFFERING as overrides: each row is matched to the
 *  template session (course code / title → session type → session number) and
 *  only the cells the sheet fills in — and that differ from the template — are
 *  stored for this offering. Unmatched rows are reported back, never invented. */
export async function importOfferingSheet(cohortId: string, programId: string, sessions: ImportedSession[]): Promise<{ matched: number; unmatched: string[] }> {
  const program = await prisma.program.findUnique({ where: { id: programId }, include: { terms: { include: { courses: { include: { sessions: true } } } } } });
  if (!program) throw new Error("Program not found");
  const courses = program.terms.flatMap((t) => t.courses);
  const unmatched: string[] = [];
  let matched = 0;
  const seen = new Map<string, number>();
  for (const r of sessions) {
    const course = courses.find((c) => (r.courseCode && (c.code ?? "").toLowerCase() === r.courseCode.toLowerCase()) || (r.courseTitle && c.name.toLowerCase() === r.courseTitle.toLowerCase()));
    if (!course) { unmatched.push(`Row ${r.sourceRow}: no course "${r.courseCode ?? r.courseTitle}" in this program`); continue; }
    const key = `${course.id}|${r.kind}`;
    const nth = (seen.get(key) ?? 0) + 1; seen.set(key, nth);
    const number = r.number != null ? Math.round(r.number) : nth;
    const tpl = course.sessions.find((s) => s.kind === r.kind && s.number === number);
    if (!tpl) { unmatched.push(`Row ${r.sourceRow}: ${course.code ?? course.name} has no ${r.kind.toLowerCase()} session #${number}`); continue; }
    const diffN = (v: number | null, t: number | null) => (v != null && v !== t ? v : null);
    const diffS = (v: string | null, t: string | null) => (v != null && v !== t ? v : null);
    const data = {
      week: r.week != null ? diffN(Math.round(r.week), tpl.week) : null, dayOfWeek: diffS(r.dayOfWeek, tpl.dayOfWeek), startTime: diffS(r.startTime, tpl.startTime),
      notes: diffS(r.notes, tpl.notes), title: diffS(r.title, tpl.title), deliveryMode: diffS(r.deliveryMode, tpl.deliveryMode), location: diffS(r.location, tpl.location),
      lengthHours: diffN(r.lengthHours, tpl.lengthHours), maxStudents: r.maxStudents != null ? diffN(Math.round(r.maxStudents), tpl.maxStudents) : null,
      facultyNeeded: diffN(r.facultyNeeded, tpl.facultyNeeded), facultyContactPolicy: diffN(r.facultyContactPolicy, tpl.facultyContactPolicy),
      supportStaffNeeded: diffN(r.supportStaffNeeded, tpl.supportStaffNeeded), supportContactPolicy: diffN(r.supportContactPolicy, tpl.supportContactPolicy),
      preceptorsNeeded: diffN(r.preceptorsNeeded, tpl.preceptorsNeeded), preceptorContactPolicy: diffN(r.preceptorContactPolicy, tpl.preceptorContactPolicy),
      rotationType: diffS(r.rotationType, tpl.rotationType), clinicalMode: diffS(r.clinicalMode, tpl.clinicalMode),
    };
    matched++;
    if (Object.values(data).every((v) => v == null)) continue;
    await prisma.sessionOverride.upsert({ where: { cohortId_sessionId: { cohortId, sessionId: tpl.id } }, update: data, create: { cohortId, sessionId: tpl.id, ...data } });
  }
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
  revalidatePath(`/programs/${programId}/offerings/${cohortId}/design`);
  return { matched, unmatched };
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
/** Cohort-SPECIFIC talent-pipeline targets: this offering's own health rates
 *  and goal share, derived backward into its funnel stage targets (and term
 *  enrollment). Stored on the cohort so every surface (funnel, capacity math,
 *  insights) reads the same plan. */
export async function saveCohortPipeline(
  cohortId: string,
  input: { goal: number; rates: Record<string, number>; termOverrides?: (number | null)[] },
): Promise<void> {
  const { deriveCohortTargets } = await import("./pipeline");
  const { BENCHMARK_RATES } = await import("./northstar");
  const co = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: { programId: true, program: { select: { familyId: true, terms: { select: { id: true } } } } },
  });
  if (!co) return;
  const rates = { ...BENCHMARK_RATES, ...input.rates } as typeof BENCHMARK_RATES;
  const t = deriveCohortTargets(Math.max(0, input.goal), rates, Math.max(1, co.program.terms.length));
  const targets: Record<string, number> = {
    interested: t.interested, qualified: t.qualified, offered: t.offered,
    enrolled: input.termOverrides?.[0] ?? t.capacity, completing: t.completing, licensed: t.licensed,
    placed: t.placed, productive: t.productive,
  };
  for (const s of STAGES) {
    await prisma.funnelStage.upsert({
      where: { cohortId_stageKey: { cohortId, stageKey: s.key } },
      update: { targetNumber: Math.round(targets[s.key] ?? 0) },
      create: { cohortId, stageKey: s.key, sortOrder: STAGES.indexOf(s), label: s.label, targetNumber: Math.round(targets[s.key] ?? 0) },
    });
  }
  await prisma.cohort.update({
    where: { id: cohortId },
    data: { pipelineRates: JSON.stringify({ goal: input.goal, rates, termOverrides: input.termOverrides ?? [] }), plannedSeats: Math.round(input.termOverrides?.[0] ?? t.capacity) },
  });
  if (co.program.familyId) revalidatePath(`/families/${co.program.familyId}`);
  revalidatePath(`/programs/${co.programId}/offerings/${cohortId}`);
  revalidatePath(`/programs/${co.programId}/offerings/${cohortId}/design`);
  revalidatePath("/insights/staffing-need");
  revalidatePath("/insights/clinical-sites");
  revalidatePath("/insights/coverage");
}

/** Undo a lock-in: delete the instantiation (cohort) a goal-breakdown slot
 *  created — its stages, term dates, bookings and overrides cascade away;
 *  enrolled students are detached, never deleted. The slot goes back to a
 *  plannable start date. */
export async function unlockInstantiation(cohortId: string): Promise<void> {
  const co = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { programId: true, program: { select: { familyId: true } } } });
  if (!co) return;
  await prisma.cohort.delete({ where: { id: cohortId } });
  revalidatePath("/calendar");
  revalidatePath(`/programs/${co.programId}`);
  if (co.program.familyId) revalidatePath(`/families/${co.program.familyId}`);
  revalidatePath("/insights/staffing-need");
  revalidatePath("/insights/clinical-sites");
  revalidatePath("/insights/coverage");
}

/** Move ONE occurrence of a booked section — the shift that would land on
 *  `fromDateIso` under the weekly pattern happens on `toDate` instead
 *  (optionally at another time / place / with other staff). The weekly booking
 *  is untouched, so no other week moves. */
export async function moveShiftOccurrence(
  meetingId: string,
  fromDateIso: string,
  patch: { toDate?: string; startTime?: string | null; facilityId?: string | null; employerId?: string | null; staffPersonId?: string | null },
): Promise<void> {
  const fromDate = new Date(fromDateIso + "T00:00:00Z");
  const existing = await prisma.shiftMove.findUnique({ where: { meetingId_fromDate: { meetingId, fromDate } } });
  const toDate = patch.toDate ? new Date(patch.toDate + "T00:00:00Z") : existing?.toDate ?? fromDate;
  const data = {
    toDate,
    startTime: patch.startTime === undefined ? existing?.startTime ?? null : patch.startTime,
    facilityId: patch.facilityId === undefined ? existing?.facilityId ?? null : patch.facilityId,
    employerId: patch.employerId === undefined ? existing?.employerId ?? null : patch.employerId,
    staffPersonId: patch.staffPersonId === undefined ? existing?.staffPersonId ?? null : patch.staffPersonId,
  };
  const m = await prisma.shiftMove.upsert({
    where: { meetingId_fromDate: { meetingId, fromDate } },
    update: data,
    create: { meetingId, fromDate, ...data },
    include: { meeting: { select: { cohortId: true, cohort: { select: { programId: true } } } } },
  });
  revalidatePath("/calendar");
  revalidatePath(`/programs/${m.meeting.cohort.programId}/offerings/${m.meeting.cohortId}`);
  revalidatePath("/insights/coverage");
}

/** Put one moved occurrence back on its weekly pattern. */
export async function clearShiftMove(meetingId: string, fromDateIso: string): Promise<void> {
  const fromDate = new Date(fromDateIso + "T00:00:00Z");
  const m = await prisma.shiftMove.findUnique({ where: { meetingId_fromDate: { meetingId, fromDate } }, include: { meeting: { select: { cohortId: true, cohort: { select: { programId: true } } } } } });
  if (!m) return;
  await prisma.shiftMove.delete({ where: { id: m.id } });
  revalidatePath("/calendar");
  revalidatePath(`/programs/${m.meeting.cohort.programId}/offerings/${m.meeting.cohortId}`);
  revalidatePath("/insights/coverage");
}

export async function moveMeeting(
  meetingId: string,
  patch: { dayOfWeek?: string; startTime?: string; lengthHours?: number; facilityId?: string | null; staffPersonId?: string | null; employerId?: string | null },
): Promise<void> {
  const data: Record<string, unknown> = {};
  if (patch.dayOfWeek) data.dayOfWeek = patch.dayOfWeek;
  if (patch.startTime) data.startTime = patch.startTime;
  if (patch.lengthHours != null) data.lengthHours = patch.lengthHours;
  if (patch.facilityId !== undefined) data.facilityId = patch.facilityId || null;
  if (patch.staffPersonId !== undefined) data.staffPersonId = patch.staffPersonId || null;
  if (patch.employerId !== undefined) data.employerId = patch.employerId || null;
  const m = await prisma.meetingPattern.update({ where: { id: meetingId }, data, include: { cohort: { select: { id: true, programId: true } } } });
  revalidatePath("/calendar");
  revalidatePath(`/programs/${m.cohort.programId}/offerings/${m.cohortId}`);
  revalidatePath(`/programs/${m.cohort.programId}/offerings/${m.cohortId}/design`);
  revalidatePath("/insights/coverage");
  revalidatePath("/insights/staffing-need");
  revalidatePath("/insights/clinical-sites");
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
