"use server";

import { prisma } from "./db";
import { SCRUB_ROLES, joinScrubRoles } from "./surgvolume";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { STAGES } from "./funnel";
import { seasonOfDate, seasonOfName } from "./term";

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
  redirect("/goals");
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
  await alignInstitutionOfferings(institutionId);
  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/orgs/${institutionId}`);
  revalidatePath("/", "layout");
}

export interface AcademicEventInput { iso: string; endIso: string | null; label: string; kind: string; season: string | null; source?: string | null }

/** Import a pasted academic calendar: the coded events replace whatever was
 *  coded for the same years, and the semester pattern follows the coded starts. */
export async function importAcademicCalendar(institutionId: string, familyId: string, payload: {
  anchors: { springStart: string; summerStart: string; fallStart: string };
  events: AcademicEventInput[];
}): Promise<{ saved: number; aligned: AlignSummary }> {
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
  // Every offering at this institution now follows the coded dates — no retyping.
  const aligned = await alignInstitutionOfferings(institutionId);
  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/orgs/${institutionId}`);
  revalidatePath("/", "layout");
  return { saved: events.length, aligned };
}

export async function deleteAcademicEvent(id: string, familyId: string): Promise<void> {
  const ev = await prisma.academicEvent.delete({ where: { id } }).catch(() => null);
  if (ev) { await alignInstitutionOfferings(ev.institutionId); revalidatePath(`/orgs/${ev.institutionId}`); }
  revalidatePath(`/families/${familyId}`);
  revalidatePath("/", "layout");
}

export async function clearAcademicCalendar(institutionId: string, familyId: string): Promise<void> {
  await prisma.academicEvent.deleteMany({ where: { institutionId } });
  await alignInstitutionOfferings(institutionId);
  revalidatePath(`/families/${familyId}`);
  revalidatePath(`/orgs/${institutionId}`);
  revalidatePath(`/orgs/${institutionId}`);
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// ALIGN OFFERINGS TO THE ACADEMIC CALENDAR — one engine, called everywhere
// ---------------------------------------------------------------------------

export interface AlignedTermChange { term: string; fromStart: string | null; toStart: string; fromEnd: string | null; toEnd: string; startSource: string; endSource: string }
export interface AlignReport { cohortId: string; name: string; program: string; changed: AlignedTermChange[]; terms: number; courseWindows: number; warnings: string[]; renamed: string | null }
export interface AlignSummary { offerings: number; termsMoved: number; courseWindows: number; reports: AlignReport[] }

/** Put ONE offering's term dates (start and end) and course windows on the
 *  institution's coded academic calendar from its chosen first day. Terms typed
 *  by hand stay put unless `resetManual`; course windows typed by hand stay put. */
export async function alignOfferingToCalendar(cohortId: string, opts: { resetManual?: boolean } = {}): Promise<AlignReport | null> {
  const { alignOffering, endYearOf } = await import("./termalign");
  const cohort = await prisma.cohort.findUnique({
    where: { id: cohortId },
    include: {
      program: { select: { id: true, name: true, institutionId: true, terms: { orderBy: { index: "asc" }, include: { courses: { select: { id: true, code: true, name: true, termId: true, sessions: { select: { week: true } } } } } }, cohorts: { select: { id: true, name: true } } } },
      cohortTerms: true, courseDates: true,
    },
  });
  if (!cohort || !cohort.startDate) return null;
  const inst = await prisma.institution.findUnique({
    where: { id: cohort.program.institutionId },
    select: { springStart: true, summerStart: true, fallStart: true, academicEvents: { select: { date: true, endDate: true, label: true, kind: true, season: true } } },
  });
  const isoOf = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  const manual: Record<string, { startIso: string; endIso: string | null }> = {};
  if (!opts.resetManual) for (const ct of cohort.cohortTerms) if (ct.source === "manual" && ct.startDate) manual[ct.termId] = { startIso: isoOf(ct.startDate)!, endIso: isoOf(ct.endDate) };
  const a = alignOffering({
    startIso: isoOf(cohort.startDate)!,
    terms: cohort.program.terms.map((t) => ({ id: t.id, index: t.index, name: t.name, semester: t.semester, startWeek: t.startWeek, endWeek: t.endWeek })),
    courses: cohort.program.terms.flatMap((t) => t.courses),
    anchors: { springStart: inst?.springStart ?? "01-08", summerStart: inst?.summerStart ?? "05-28", fallStart: inst?.fallStart ?? "08-15" },
    events: (inst?.academicEvents ?? []).map((e) => ({ iso: isoOf(e.date)!, endIso: isoOf(e.endDate), label: e.label, kind: e.kind, season: e.season })),
    manual,
  });
  const changed: AlignedTermChange[] = [];
  for (const t of a.terms) {
    const cur = cohort.cohortTerms.find((ct) => ct.termId === t.termId);
    const fromStart = isoOf(cur?.startDate), fromEnd = isoOf(cur?.endDate);
    if (fromStart !== t.startIso || fromEnd !== t.endIso) changed.push({ term: t.name, fromStart, toStart: t.startIso, fromEnd, toEnd: t.endIso, startSource: t.startSource, endSource: t.endSource });
    await prisma.cohortTerm.upsert({
      where: { cohortId_termId: { cohortId, termId: t.termId } },
      update: { startDate: new Date(t.startIso + "T00:00:00Z"), endDate: new Date(t.endIso + "T00:00:00Z"), source: t.startSource, semester: t.semester.split(" ")[0] },
      create: { cohortId, termId: t.termId, startDate: new Date(t.startIso + "T00:00:00Z"), endDate: new Date(t.endIso + "T00:00:00Z"), source: t.startSource, semester: t.semester.split(" ")[0] },
    });
  }
  // Course windows: rewrite the auto ones, leave typed ones alone.
  await prisma.cohortCourseDates.deleteMany({ where: { cohortId, auto: true, courseId: { notIn: a.courses.map((c) => c.courseId) } } });
  let courseWindows = 0;
  for (const c of a.courses) {
    const cur = cohort.courseDates.find((cd) => cd.courseId === c.courseId);
    if (cur && !cur.auto) continue;
    await prisma.cohortCourseDates.upsert({
      where: { cohortId_courseId: { cohortId, courseId: c.courseId } },
      update: { startDate: new Date(c.startIso + "T00:00:00Z"), endDate: new Date(c.endIso + "T00:00:00Z"), auto: true },
      create: { cohortId, courseId: c.courseId, startDate: new Date(c.startIso + "T00:00:00Z"), endDate: new Date(c.endIso + "T00:00:00Z"), auto: true },
    });
    courseWindows++;
  }
  // The offering's own first day follows term 1 when it snapped onto the coded semester start.
  const first = a.terms[0];
  if (first?.movedFrom) await prisma.cohort.update({ where: { id: cohortId }, data: { startDate: new Date(first.startIso + "T00:00:00Z"), entryYear: Number(first.startIso.slice(0, 4)) } });
  // "Class of YYYY" tracks the year the last term actually ends.
  let renamed: string | null = null;
  const endYear = endYearOf(a.terms);
  const m = cohort.name.match(/^Class of (\d{4})(.*)$/);
  if (Number.isFinite(endYear) && m && String(endYear) !== m[1]) {
    let newName = `Class of ${endYear}${m[2]}`;
    const others = cohort.program.cohorts.filter((c) => c.id !== cohortId);
    if (others.some((c) => c.name === newName)) { let n = 2; while (others.some((c) => c.name === `Class of ${endYear} (${n})`)) n++; newName = `Class of ${endYear} (${n})`; }
    await prisma.cohort.update({ where: { id: cohortId }, data: { name: newName } });
    renamed = newName;
  }
  revalidatePath(`/programs/${cohort.program.id}/offerings/${cohortId}`);
  revalidatePath(`/programs/${cohort.program.id}/offerings/${cohortId}/design`);
  revalidatePath(`/programs/${cohort.program.id}`);
  revalidatePath("/calendar"); revalidatePath("/scheduler");
  revalidatePath("/insights/staffing-need"); revalidatePath("/insights/coverage"); revalidatePath("/insights/clinical-sites");
  return { cohortId, name: renamed ?? cohort.name, program: cohort.program.name, changed, terms: a.terms.length, courseWindows, warnings: a.warnings, renamed };
}

/** Re-align EVERY planned / active offering at an institution (after a calendar
 *  import, a pattern change, or on demand). */
export async function alignInstitutionOfferings(institutionId: string, opts: { resetManual?: boolean } = {}): Promise<AlignSummary> {
  const cohorts = await prisma.cohort.findMany({ where: { program: { institutionId }, status: { in: ["planned", "active"] }, startDate: { not: null } }, select: { id: true }, orderBy: { startDate: "asc" } });
  const reports: AlignReport[] = [];
  for (const c of cohorts) { const r = await alignOfferingToCalendar(c.id, opts); if (r) reports.push(r); }
  return { offerings: reports.length, termsMoved: reports.reduce((n, r) => n + r.changed.length, 0), courseWindows: reports.reduce((n, r) => n + r.courseWindows, 0), reports };
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
      applicationCohortId: str(formData.get("cohortId")) || null,
      name: str(formData.get("name")) || "New Student",
      email: str(formData.get("email")) || null,
      status,
      stageKey: STATUS_TO_STAGE[status] ?? null,
      entryYear: optNum(formData.get("entryYear")),
      sectionIndex: Math.max(1, numOr(formData.get("sectionIndex"), 1)),
      dob: str(formData.get("dob")) ? new Date(str(formData.get("dob")) + "T00:00:00Z") : null,
      sex: str(formData.get("sex")) || null, raceEthnicity: str(formData.get("raceEthnicity")) || null,
      county: str(formData.get("county")) || null, city: str(formData.get("city")) || null, zip: str(formData.get("zip")) || null, state: str(formData.get("state")) || null,
      residency: str(formData.get("residency")) || null, priorEducation: str(formData.get("priorEducation")) || null, employmentStatus: str(formData.get("employmentStatus")) || null,
    },
  });
  { const cid = str(formData.get("cohortId")); if (cid) { const { syncCohortActuals } = await import("./pipelineactuals"); await syncCohortActuals(cid); } }
  revalidatePath("/students");
  revalidatePath("/students/analytics");
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
  const before = await prisma.student.findUnique({ where: { id: studentId }, select: { cohortId: true, applicationCohortId: true } });
  const student = await prisma.student.update({ where: { id: studentId }, data: { ...data, ...(data.cohortId && !before?.applicationCohortId ? { applicationCohortId: data.cohortId } : {}) }, select: { programId: true, cohortId: true, applicationCohortId: true } });
  // Stage actuals follow the records: every offering this learner touched (before and after) resyncs.
  const { syncCohortActuals } = await import("./pipelineactuals");
  for (const id of new Set([before?.cohortId, before?.applicationCohortId, student.cohortId, student.applicationCohortId].filter((x): x is string => !!x))) { await syncCohortActuals(id); const co = await prisma.cohort.findUnique({ where: { id }, select: { programId: true } }); if (co) revalidatePath(`/programs/${co.programId}/offerings/${id}`); }
  revalidatePath("/students");
  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/programs/${student.programId}/students`);
}

// ---------------------------------------------------------------------------
// OFFERING STAFFING — assign people to a cohort's course (all its sessions)
// ---------------------------------------------------------------------------

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
      assetId: str(formData.get("assetId")) || null,
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
      assetId: str(formData.get("assetId")) || null,
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
    update: { unitCategory: str(formData.get("unitCategory")) || "Inpatient beds", unitType: str(formData.get("unitType")) || null, patientsPerStudent: optNum(formData.get("patientsPerStudent")), ...(formData.has("settingCode") ? { settingCode: str(formData.get("settingCode")) || null } : {}) },
    create: { institutionId, rotationType, unitCategory: str(formData.get("unitCategory")) || "Inpatient beds", unitType: str(formData.get("unitType")) || null, patientsPerStudent: optNum(formData.get("patientsPerStudent")), settingCode: str(formData.get("settingCode")) || null },
  });
  revalidatePath("/insights/clinical-sites");
}

// ---------------------------------------------------------------------------
// CLINICAL MODEL BY PROGRAM FAMILY — service areas, requirement grid, sites, allocations
// ---------------------------------------------------------------------------

const revalidateFamilyClinical = (familyId: string) => { revalidatePath(`/families/${familyId}/clinical`); revalidatePath(`/families/${familyId}/clinical/sites/[employerId]`, "page"); revalidatePath("/clinical"); revalidatePath("/insights/clinical-sites"); revalidatePath("/programs/[id]/structure", "page"); };
const revalidateFamilySite = (familyId: string, employerId: string) => { revalidateFamilyClinical(familyId); revalidatePath(`/families/${familyId}/clinical/sites/${employerId}`); revalidatePath(`/employers/${employerId}`); };

export async function updateFamilyClinicalModel(familyId: string, formData: FormData): Promise<void> {
  await prisma.programFamily.update({ where: { id: familyId }, data: { clinicalModel: str(formData.get("clinicalModel")) || "hours", clinicalNotes: str(formData.get("clinicalNotes")) || null } });
  revalidateFamilyClinical(familyId);
}

export async function upsertServiceArea(familyId: string, formData: FormData): Promise<void> {
  const code = str(formData.get("code")).toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12);
  if (!code) return;
  const data = { name: str(formData.get("name")) || code, settingCodes: str(formData.get("settingCodes")).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean).join(","), unitCategories: str(formData.get("unitCategories")).split(",").map((s) => s.trim()).filter(Boolean).join(","), notes: str(formData.get("notes")) || null };
  const count = await prisma.serviceArea.count({ where: { familyId } });
  await prisma.serviceArea.upsert({ where: { familyId_code: { familyId, code } }, update: data, create: { familyId, code, sortOrder: count, ...data } });
  revalidateFamilyClinical(familyId);
}
export async function deleteServiceArea(areaId: string, familyId: string): Promise<void> {
  await prisma.serviceArea.delete({ where: { id: areaId } }).catch(() => undefined);
  revalidateFamilyClinical(familyId);
}

/** Save one course's row of the requirement grid: `req_<serviceAreaId>` hours per student (and optional `cases_<id>`). */
export async function saveCourseRequirements(courseId: string, familyId: string, formData: FormData): Promise<void> {
  for (const [k, v] of formData.entries()) {
    if (!k.startsWith("req_")) continue;
    const serviceAreaId = k.slice(4);
    const hours = optNum(v) ?? 0;
    const cases = optNum(formData.get(`cases_${serviceAreaId}`));
    if (hours <= 0 && cases == null) { await prisma.courseClinicalRequirement.deleteMany({ where: { courseId, serviceAreaId } }); continue; }
    await prisma.courseClinicalRequirement.upsert({ where: { courseId_serviceAreaId: { courseId, serviceAreaId } }, update: { hoursPerStudent: hours, casesPerStudent: cases }, create: { courseId, serviceAreaId, hoursPerStudent: hours, casesPerStudent: cases } });
  }
  revalidateFamilyClinical(familyId);
}

export async function upsertFamilySite(familyId: string, employerId: string, formData: FormData): Promise<void> {
  const data = { agreementStatus: str(formData.get("agreementStatus")) || "none", contactName: str(formData.get("contactName")) || null, contactEmail: str(formData.get("contactEmail")) || null, notes: str(formData.get("notes")) || null };
  await prisma.familySite.upsert({ where: { familyId_employerId: { familyId, employerId } }, update: data, create: { familyId, employerId, ...data } });
  revalidateFamilySite(familyId, employerId);
}

/** Add a site to ONE program's clinical setup — an organization already in the directory, or a new one
 *  (located from its address at once) — then open its setup page. */
export async function addSiteToProgram(familyId: string, formData: FormData): Promise<void> {
  const { employerId } = await addFamilySite(familyId, formData);
  redirect(`/families/${familyId}/clinical/sites/${employerId}`);
}

/** What a site provides toward a program's requirement set, item by item. Form fields per item id:
 *  `st_<id>` = assets (no record: inferred from the asset map) | provides | limited | none; `vol_<id>` procedures
 *  or cases a year; `role_<id>` the most a student may do (case-based sets); `src_<id>` VERIFIED | ESTIMATE;
 *  `note_<id>`. */
export async function saveSiteProvisions(familyId: string, employerId: string, formData: FormData): Promise<void> {
  const ids = [...formData.keys()].filter((k) => k.startsWith("st_")).map((k) => k.slice(3));
  for (const itemId of ids) {
    const st = str(formData.get(`st_${itemId}`));
    if (st === "assets" || st === "") { await prisma.siteRequirementProvision.deleteMany({ where: { employerId, itemId } }); continue; }
    if (!["provides", "limited", "none"].includes(st)) continue;
    const vol = str(formData.get(`vol_${itemId}`));
    const data = { status: st, annualVolume: vol === "" ? null : Math.max(0, Math.round(numOr(vol, 0))), studentRole: joinScrubRoles(SCRUB_ROLES.filter((r) => !!formData.get(`role_${itemId}_${r.replace(/ /g, "_")}`))), source: str(formData.get(`src_${itemId}`)) === "ESTIMATE" ? "ESTIMATE" : "VERIFIED", notes: str(formData.get(`note_${itemId}`)) || null };
    await prisma.siteRequirementProvision.upsert({ where: { employerId_itemId: { employerId, itemId } }, update: data, create: { employerId, itemId, ...data } });
  }
  revalidateFamilySite(familyId, employerId);
}
/** Confirm every experience the asset map only infers at this site as verified-provided (the site said yes to the list). */
export async function confirmInferredProvisions(familyId: string, employerId: string, setId: string): Promise<void> {
  const { siteFit } = await import("./requirements");
  const { getFamilyRequirements } = await import("./queries");
  const req = await getFamilyRequirements(familyId);
  const set = req?.sets.find((x) => x.id === setId); const site = req?.sites.find((x) => x.employerId === employerId);
  if (!set || !site) return;
  for (const f of siteFit(site, set.items, set.provisions)) if (f.basis === "inferred") await prisma.siteRequirementProvision.upsert({ where: { employerId_itemId: { employerId, itemId: f.item.id } }, update: { status: "provides", source: "VERIFIED" }, create: { employerId, itemId: f.item.id, status: "provides", source: "VERIFIED" } });
  revalidateFamilySite(familyId, employerId);
}
export async function removeFamilySite(familyId: string, employerId: string): Promise<void> {
  await prisma.familySite.deleteMany({ where: { familyId, employerId } });
  await prisma.settingAllocation.deleteMany({ where: { familyId, employerId } });
  revalidateFamilySite(familyId, employerId);
}

/** The shifts a site allocates to this family in one setting: Day / Evening / Night shifts per week (0 removes the block). */
export async function saveSettingAllocation(familyId: string, employerId: string, formData: FormData): Promise<void> {
  const settingCode = str(formData.get("settingCode")).toUpperCase();
  if (!settingCode) return;
  const hoursPerShift = numOr(formData.get("hoursPerShift"), 8);
  const learnersPerShift = Math.max(0, Math.round(numOr(formData.get("learnersPerShift"), 1)));
  const fromRaw = str(formData.get("from")), toRaw = str(formData.get("to"));
  const from = fromRaw ? new Date(fromRaw + "T00:00:00Z") : null, to = toRaw ? new Date(toRaw + "T00:00:00Z") : null;
  for (const block of ["Day", "Evening", "Night"]) {
    const shifts = numOr(formData.get(`shifts_${block}`), 0);
    if (shifts <= 0) { await prisma.settingAllocation.deleteMany({ where: { familyId, employerId, settingCode, block } }); continue; }
    await prisma.settingAllocation.upsert({ where: { familyId_employerId_settingCode_block: { familyId, employerId, settingCode, block } }, update: { shiftsPerWeek: shifts, hoursPerShift, learnersPerShift, from, to }, create: { familyId, employerId, settingCode, block, shiftsPerWeek: shifts, hoursPerShift, learnersPerShift, from, to } });
  }
  // Allocating shifts implies a relationship for this family.
  await prisma.familySite.upsert({ where: { familyId_employerId: { familyId, employerId } }, update: {}, create: { familyId, employerId, agreementStatus: "asked" } });
  revalidateFamilyClinical(familyId);
}

/** Import a course-allocation sheet (Course · Course weeks · Rotation/service area · Total hours per student) into the family's grid. */
export async function importCourseAllocation(familyId: string, rows: { courseCode: string; areaName: string; hoursPerStudent: number }[]): Promise<{ saved: number; unmatched: string[] }> {
  const fam = await prisma.programFamily.findUnique({ where: { id: familyId }, include: { serviceAreas: true, programs: { include: { terms: { include: { courses: true } } } } } });
  if (!fam) return { saved: 0, unmatched: ["family not found"] };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const courses = new Map(fam.programs.flatMap((p) => p.terms.flatMap((t) => t.courses)).filter((c) => c.code).map((c) => [norm(c.code!), c.id]));
  const areas = new Map(fam.serviceAreas.flatMap((a) => [[norm(a.name), a.id], [norm(a.code), a.id]] as [string, string][]));
  const unmatched: string[] = []; let saved = 0;
  for (const r of rows) {
    const courseId = courses.get(norm(r.courseCode)); const areaId = areas.get(norm(r.areaName));
    if (!courseId) { unmatched.push(`course ${r.courseCode}`); continue; }
    if (!areaId) { unmatched.push(`service area "${r.areaName}"`); continue; }
    if (r.hoursPerStudent <= 0) { await prisma.courseClinicalRequirement.deleteMany({ where: { courseId, serviceAreaId: areaId } }); continue; }
    await prisma.courseClinicalRequirement.upsert({ where: { courseId_serviceAreaId: { courseId, serviceAreaId: areaId } }, update: { hoursPerStudent: r.hoursPerStudent }, create: { courseId, serviceAreaId: areaId, hoursPerStudent: r.hoursPerStudent } });
    saved++;
  }
  revalidateFamilyClinical(familyId);
  return { saved, unmatched: [...new Set(unmatched)] };
}

// ---------------------------------------------------------------------------
// 365-DAY CLINICAL ASSET MAP — physical assets, per-date exceptions, learner bookings
// ---------------------------------------------------------------------------

const assetDataFrom = (fd: FormData) => {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].filter((d) => fd.get(`day_${d}`) != null);
  const blocks = ["Day", "Evening", "Night"].filter((b) => fd.get(`block_${b}`) != null);
  return {
    externalId: str(fd.get("externalId")) || null,
    settingCode: (str(fd.get("settingCode")) || "GEN").toUpperCase().slice(0, 12),
    setting: str(fd.get("setting")) || "General diagnostic radiography",
    assetType: str(fd.get("assetType")) || "Fixed radiographic room",
    assetNumber: Math.max(1, Math.round(numOr(fd.get("assetNumber"), 1))),
    operatingRule: str(fd.get("operatingRule")) || "Custom",
    days: (days.length ? days : ["Mon", "Tue", "Wed", "Thu", "Fri"]).join(","),
    shiftBlocks: (blocks.length ? blocks : ["Day"]).join(","),
    hoursPerShift: numOr(fd.get("hoursPerShift"), 8),
    serves: str(fd.get("serves")) || null,
    learnersPerShift: Math.max(0, Math.round(numOr(fd.get("learnersPerShift"), 1))),
    preceptorsPerShift: Math.max(0, Math.round(numOr(fd.get("preceptorsPerShift"), 1))),
    dataSource: str(fd.get("dataSource")) || "ESTIMATE",
    status: str(fd.get("status")) || "active",
    notes: str(fd.get("notes")) || null,
  };
};
const revalidateAssets = (employerId?: string) => { revalidatePath("/insights/clinical-sites"); revalidatePath("/clinical"); revalidatePath("/families", "layout"); if (employerId) revalidatePath(`/employers/${employerId}`); };

export interface AssetInput {
  externalId?: string | null; settingCode: string; setting: string; assetType: string; assetNumber?: number; operatingRule?: string;
  days: string[]; blocks: { block: "Day" | "Evening" | "Night"; start: string; hours: number }[];
  serves?: string | null; learnersPerShift?: number; preceptorsPerShift?: number; dataSource?: string; notes?: string | null;
  accreditorClass?: string | null;
}
const assetRowFrom = (d: AssetInput) => {
  const b = (name: "Day" | "Evening" | "Night") => d.blocks.find((x) => x.block === name);
  const days = d.days.filter((x) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].includes(x));
  const blocks = (["Day", "Evening", "Night"] as const).filter((x) => b(x));
  const rule = days.length === 7 && blocks.length === 3 ? "24x7" : days.length === 5 && !days.includes("Sat") && blocks.join() === "Day" ? "Weekday Day" : (d.operatingRule && d.operatingRule !== "24x7" && d.operatingRule !== "Weekday Day" ? d.operatingRule : "Custom");
  return {
    externalId: d.externalId?.trim() || null, settingCode: d.settingCode.trim().toUpperCase().slice(0, 12) || "GEN", setting: d.setting.trim() || d.settingCode,
    assetType: d.assetType.trim() || "Asset", assetNumber: Math.max(1, Math.round(d.assetNumber ?? 1)), operatingRule: rule,
    days: (days.length ? days : ["Mon", "Tue", "Wed", "Thu", "Fri"]).join(","), shiftBlocks: (blocks.length ? blocks : ["Day"]).join(","),
    dayStart: b("Day")?.start || "07:00", dayHours: b("Day")?.hours || 8, eveningStart: b("Evening")?.start || "15:00", eveningHours: b("Evening")?.hours || 8, nightStart: b("Night")?.start || "23:00", nightHours: b("Night")?.hours || 8,
    hoursPerShift: b("Day")?.hours || b("Evening")?.hours || b("Night")?.hours || 8,
    serves: d.serves?.trim() || null, learnersPerShift: Math.max(0, Math.round(d.learnersPerShift ?? 1)), preceptorsPerShift: Math.max(0, Math.round(d.preceptorsPerShift ?? 1)),
    dataSource: d.dataSource || "ESTIMATE", notes: d.notes?.trim() || null,
    accreditorClass: d.accreditorClass || null,
  };
};

/** Create or update ONE physical asset with its full shift structure (days × blocks × start × length). */
export async function saveClinicalAsset(employerId: string, assetId: string | null, input: AssetInput): Promise<{ id: string }> {
  const data = assetRowFrom(input);
  const row = assetId ? await prisma.clinicalAsset.update({ where: { id: assetId }, data }) : await prisma.clinicalAsset.create({ data: { employerId, ...data } });
  revalidateAssets(employerId);
  return { id: row.id };
}
/** Create N assets of one kind in one go (the roster's "add rooms" bar), numbered on from the highest in that setting. */
export async function createClinicalAssets(employerId: string, input: AssetInput, count: number, prefix?: string | null): Promise<void> {
  const data = assetRowFrom(input);
  const max = await prisma.clinicalAsset.aggregate({ where: { employerId, settingCode: data.settingCode }, _max: { assetNumber: true } });
  let n = max._max.assetNumber ?? 0;
  for (let i = 0; i < Math.min(60, Math.max(1, Math.round(count))); i++) {
    n++;
    await prisma.clinicalAsset.create({ data: { employerId, ...data, assetNumber: n, externalId: prefix ? `${prefix}-${data.settingCode}-${String(n).padStart(2, "0")}` : null } });
  }
  revalidateAssets(employerId);
}
/** "Add N more like this" — copies of an asset, numbered on from the highest in that setting. */
export async function duplicateClinicalAsset(assetId: string, count: number): Promise<void> {
  const a = await prisma.clinicalAsset.findUnique({ where: { id: assetId } });
  if (!a) return;
  const max = await prisma.clinicalAsset.aggregate({ where: { employerId: a.employerId, settingCode: a.settingCode }, _max: { assetNumber: true } });
  let n = (max._max.assetNumber ?? 0);
  const { id: _id, createdAt: _c, externalId, ...rest } = a; void _id; void _c;
  const base = externalId?.replace(/-\d+$/, "") ?? null;
  for (let i = 0; i < Math.min(50, Math.max(1, Math.round(count))); i++) {
    n++;
    await prisma.clinicalAsset.create({ data: { ...rest, assetNumber: n, externalId: base ? `${base}-${String(n).padStart(2, "0")}` : null } });
  }
  revalidateAssets(a.employerId);
}
/** Close (or set the blocks of) a set of assets across a date range — holidays, maintenance, surges. */
export async function setAssetDays(assetIds: string[], fromIso: string, toIso: string, shiftBlocks: string | null, note?: string | null): Promise<void> {
  const from = new Date(fromIso + "T00:00:00Z"), to = new Date(toIso + "T00:00:00Z");
  if (!(from <= to) || (to.getTime() - from.getTime()) / 86400000 > 400) return;
  let employerId: string | undefined;
  for (const assetId of assetIds.slice(0, 200)) {
    const a = await prisma.clinicalAsset.findUnique({ where: { id: assetId }, select: { employerId: true } }); if (!a) continue; employerId = a.employerId;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
      if (shiftBlocks == null) await prisma.assetDay.deleteMany({ where: { assetId, date: d } });
      else await prisma.assetDay.upsert({ where: { assetId_date: { assetId, date: d } }, update: { shiftBlocks, note: note ?? null }, create: { assetId, date: d, shiftBlocks, note: note ?? null } });
    }
  }
  revalidateAssets(employerId);
}

/** Add a site to a family's clinical supply map: an existing organization from the directory, or a new one. */
export async function addFamilySite(familyId: string, formData: FormData): Promise<{ employerId: string }> {
  const fam = await prisma.programFamily.findUnique({ where: { id: familyId }, select: { institutionId: true } });
  if (!fam) throw new Error("family not found");
  let employerId = str(formData.get("employerId"));
  if (!employerId) {
    const name = str(formData.get("name")); if (!name) throw new Error("site name required");
    const e = await prisma.employer.create({ data: { institutionId: fam.institutionId, name, externalId: str(formData.get("externalId")) || null, facilityType: str(formData.get("facilityType")) || null, setting: str(formData.get("facilityType")) || null, county: str(formData.get("county")) || null, address: str(formData.get("address")) || null, city: str(formData.get("city")) || null, state: str(formData.get("state")) || "NC", zip: str(formData.get("zip")) || null, organization: str(formData.get("organization")) || null, contactName: str(formData.get("contactName")) || null, contactEmail: str(formData.get("contactEmail")) || null, status: "active", agreementStatus: "none" } });
    employerId = e.id;
    await geocodeInstitutionSites(fam.institutionId, e.id); // ring, distance and drive time come from the address
  }
  await prisma.familySite.upsert({ where: { familyId_employerId: { familyId, employerId } }, update: {}, create: { familyId, employerId, agreementStatus: str(formData.get("agreementStatus")) || "none" } });
  revalidateFamilyClinical(familyId); revalidatePath("/employers");
  return { employerId };
}

export async function createClinicalAsset(employerId: string, formData: FormData): Promise<void> {
  await prisma.clinicalAsset.create({ data: { employerId, ...assetDataFrom(formData) } });
  revalidateAssets(employerId);
}
export async function updateClinicalAsset(assetId: string, employerId: string, formData: FormData): Promise<void> {
  await prisma.clinicalAsset.update({ where: { id: assetId }, data: assetDataFrom(formData) });
  revalidateAssets(employerId);
}
export async function deleteClinicalAsset(assetId: string, employerId: string): Promise<void> {
  await prisma.clinicalAsset.delete({ where: { id: assetId } });
  revalidateAssets(employerId);
}

// ── Geography: locate sites, code drive times and rings ───────────────────────
/** Locate the main campus and every site of an institution (Census geocoder when reachable, the built-in
 *  NC gazetteer otherwise) and code each site's distance, drive time and ring under the institution's bands.
 *  A manual ring override is kept. */
export async function geocodeInstitutionSites(institutionId: string, onlyEmployerId?: string): Promise<void> {
  const { locate, distanceFrom } = await import("./geo");
  const inst = await prisma.institution.findUnique({ where: { id: institutionId }, select: { ringCoreMinutes: true, ringOneMinutes: true, ringTwoMinutes: true } });
  if (!inst) return;
  const bands = { coreMinutes: inst.ringCoreMinutes, oneMinutes: inst.ringOneMinutes, twoMinutes: inst.ringTwoMinutes };
  const campus = (await prisma.campus.findFirst({ where: { institutionId, isMain: true } })) ?? (await prisma.campus.findFirst({ where: { institutionId }, orderBy: { createdAt: "asc" } }));
  if (!campus) return;
  const cLoc = campus.geoSource === "manual" && campus.lat != null && campus.lng != null ? { lat: campus.lat, lng: campus.lng, source: "manual" as const } : await locate({ address: campus.address, city: campus.city, state: campus.state ?? "NC", zip: campus.zip });
  if (!cLoc) return;
  if (campus.geoSource !== "manual") await prisma.campus.update({ where: { id: campus.id }, data: { lat: cLoc.lat, lng: cLoc.lng, geoSource: cLoc.source, isMain: true } });
  const sites = await prisma.employer.findMany({ where: { institutionId, ...(onlyEmployerId ? { id: onlyEmployerId } : {}) }, select: { id: true, address: true, city: true, state: true, zip: true, ringSource: true, geoSource: true, lat: true, lng: true } });
  for (const s of sites) {
    const loc = s.geoSource === "manual" && s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng, source: "manual" as const } : await locate({ address: s.address, city: s.city, state: s.state ?? "NC", zip: s.zip });
    if (!loc) continue;
    const d = distanceFrom(cLoc, loc, bands);
    await prisma.employer.update({ where: { id: s.id }, data: { lat: loc.lat, lng: loc.lng, geoSource: loc.source, distanceMiles: d.miles, driveMinutes: d.minutes, ...(s.ringSource === "manual" ? {} : { ring: d.ring }) } });
  }
  revalidatePath("/employers"); revalidatePath(`/orgs/${institutionId}`); revalidatePath("/clinical");
}
/** Form-friendly wrapper: locate every site of an institution (button on the directory). */
export async function locateInstitutionSites(institutionId: string, _formData?: FormData): Promise<void> {
  await geocodeInstitutionSites(institutionId);
}
/** Re-locate one site from its address (drops a hand-pinned coordinate) and recode its drive time and ring. */
export async function relocateSite(employerId: string): Promise<void> {
  const e = await prisma.employer.update({ where: { id: employerId }, data: { geoSource: null }, select: { institutionId: true } });
  await geocodeInstitutionSites(e.institutionId, employerId);
  revalidatePath(`/employers/${employerId}`);
}
/** Override (or release) one site's ring, or pin its coordinates by hand. */
export async function setSiteGeography(employerId: string, formData: FormData): Promise<void> {
  const ring = str(formData.get("ring"));
  const lat = str(formData.get("lat")), lng = str(formData.get("lng"));
  const data: Record<string, unknown> = {};
  if (ring === "auto") data.ringSource = "auto"; else if (["Core", "Ring 1", "Ring 2", "Ring 3"].includes(ring)) { data.ring = ring; data.ringSource = "manual"; }
  if (lat && lng) { data.lat = numOr(lat, 0); data.lng = numOr(lng, 0); data.geoSource = "manual"; }
  const e = await prisma.employer.update({ where: { id: employerId }, data, select: { institutionId: true } });
  await geocodeInstitutionSites(e.institutionId, employerId);
  revalidatePath(`/employers/${employerId}`);
}
/** The institution's drive-time bands and its main campus address. */
export async function updateInstitutionGeography(institutionId: string, formData: FormData): Promise<void> {
  await prisma.institution.update({ where: { id: institutionId }, data: { ringCoreMinutes: Math.max(1, Math.round(numOr(formData.get("ringCoreMinutes"), 30))), ringOneMinutes: Math.max(1, Math.round(numOr(formData.get("ringOneMinutes"), 60))), ringTwoMinutes: Math.max(1, Math.round(numOr(formData.get("ringTwoMinutes"), 90))) } });
  const campus = (await prisma.campus.findFirst({ where: { institutionId, isMain: true } })) ?? (await prisma.campus.findFirst({ where: { institutionId }, orderBy: { createdAt: "asc" } }));
  const address = str(formData.get("campusAddress")), city = str(formData.get("campusCity")), zip = str(formData.get("campusZip"));
  if (campus && (address || city)) await prisma.campus.update({ where: { id: campus.id }, data: { address: address || campus.address, city: city || campus.city, zip: zip || campus.zip, state: campus.state ?? "NC", isMain: true, geoSource: null } });
  await geocodeInstitutionSites(institutionId);
}

// ── Student requirement log: competencies and cases as the credentialing body counts them ──
/** Log one experience against a requirement item. If a shift is chosen, its date, site and preceptor fill any blank field. */
export async function logRequirement(studentId: string, formData: FormData): Promise<void> {
  const itemId = str(formData.get("itemId")); if (!itemId) return;
  const shiftId = str(formData.get("shiftId")) || null;
  const shift = shiftId ? await prisma.studentShift.findUnique({ where: { id: shiftId }, select: { cohortId: true, sessionId: true, sectionIndex: true, loggedAt: true, preceptorId: true, asset: { select: { employerId: true } }, session: { select: { courseId: true } } } }) : null;
  let date = str(formData.get("date"));
  if (!date && shift) { const { dates } = await (await import("./queries")).sessionDatesForCohort(shift.cohortId); date = shift.loggedAt?.toISOString().slice(0, 10) ?? dates.get(shift.sessionId) ?? ""; }
  if (!date) date = new Date().toISOString().slice(0, 10);
  // The site: the shift's asset, else the site its section is booked at (the meeting pattern).
  const meetingSite = shift && !shift.asset ? (await prisma.meetingPattern.findFirst({ where: { cohortId: shift.cohortId, courseId: shift.session.courseId, kind: "CLINICAL", sectionIndex: shift.sectionIndex }, select: { employerId: true } }))?.employerId ?? null : null;
  const employerId = str(formData.get("employerId")) || shift?.asset?.employerId || meetingSite || null;
  const preceptorId = str(formData.get("preceptorId")) || shift?.preceptorId || null;
  const role = str(formData.get("role")) || null;
  const flags = ["pediatric", "geriatric", "trauma"].filter((f) => formData.get(`flag_${f}`) != null).join(",");
  const count = Math.max(1, Math.round(numOr(formData.get("count"), 1)));
  const n = Math.max(1, Math.min(200, count));
  await prisma.studentRequirementLog.create({ data: { studentId, itemId, shiftId, employerId, preceptorId, date: new Date(date + "T00:00:00Z"), outcome: str(formData.get("outcome")) === "attempted" ? "attempted" : "competent", role, simulated: formData.get("simulated") != null, count: n, procedure: str(formData.get("procedure")) || null, flags, notes: str(formData.get("notes")) || null } });
  revalidatePath(`/students/${studentId}`); revalidatePath("/programs/[id]/offerings/[cohortId]", "page"); revalidatePath("/families", "layout");
}
export async function deleteRequirementLog(logId: string, studentId: string): Promise<void> {
  await prisma.studentRequirementLog.deleteMany({ where: { id: logId, studentId } });
  revalidatePath(`/students/${studentId}`); revalidatePath("/programs/[id]/offerings/[cohortId]", "page"); revalidatePath("/families", "layout");
}
/** The preceptor (or clinical instructor) signs the entry off. */
export async function verifyRequirementLog(logId: string, studentId: string, formData: FormData): Promise<void> {
  const by = str(formData.get("verifiedById")) || null;
  await prisma.studentRequirementLog.update({ where: { id: logId }, data: { verifiedById: by, verifiedAt: by ? new Date() : null } });
  revalidatePath(`/students/${studentId}`);
}
/** Per-course design targets against the requirement set by the END of the course, by rule key (blank = auto-paced). */
export async function saveCourseRequirementPlan(courseId: string, programId: string, formData: FormData): Promise<void> {
  const plan: Record<string, number> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("target_")) { const n = str(v); if (n !== "") plan[k.slice(7)] = Math.max(0, Math.round(numOr(n, 0))); }
  await prisma.course.update({ where: { id: courseId }, data: { requirementPlan: JSON.stringify(plan) } });
  revalidatePath(`/programs/${programId}/structure`); revalidatePath("/programs/[id]/offerings/[cohortId]", "page");
}

// ── Requirement sets (what completion requires) ───────────────────────────────
export async function updateRequirementSet(setId: string, formData: FormData): Promise<void> {
  const set = await prisma.clinicalRequirementSet.update({ where: { id: setId }, data: { verified: formData.get("verified") != null, edition: str(formData.get("edition")) || null, summary: str(formData.get("summary")) || null, notes: str(formData.get("notes")) || null, sourceUrl: str(formData.get("sourceUrl")) || null }, select: { familyId: true } });
  revalidatePath(`/families/${set.familyId}/clinical`);
}
export async function updateRequirementItem(itemId: string, formData: FormData): Promise<void> {
  const item = await prisma.clinicalRequirementItem.update({ where: { id: itemId }, data: { settingCodes: str(formData.get("settingCodes")).toUpperCase().replace(/\s+/g, ""), mandatory: formData.get("mandatory") != null, minCount: str(formData.get("minCount")) === "" ? null : Math.max(0, Math.round(numOr(formData.get("minCount"), 0))), role: str(formData.get("role")) || null, notes: str(formData.get("notes")) || null }, select: { set: { select: { familyId: true } } } });
  revalidatePath(`/families/${item.set.familyId}/clinical`);
}

// ── Accreditor recognition of clinical settings (JRCERT Form 1010R) ──────────
/** The family's programmatic accreditation: accreditor, program number, accredited total capacity. */
export async function updateFamilyAccreditation(familyId: string, formData: FormData): Promise<void> {
  const cap = str(formData.get("accreditedCapacity"));
  await prisma.programFamily.update({ where: { id: familyId }, data: {
    accreditor: str(formData.get("accreditor")) || null, accreditorProgramNumber: str(formData.get("accreditorProgramNumber")) || null,
    accreditedCapacity: cap === "" ? null : Math.max(0, Math.round(numOr(cap, 0))), accreditationNotes: str(formData.get("accreditationNotes")) || null,
  } });
  revalidatePath(`/families/${familyId}/clinical`); revalidatePath(`/families/${familyId}`);
}
/** How a family schedules its clinicals — the basis its availability is counted on and the placement rules. */
export async function updateFamilyRotationPolicy(familyId: string, formData: FormData): Promise<void> {
  const num = (k: string) => { const v = str(formData.get(k)); return v === "" ? null : numOr(v, 0); };
  const basis = str(formData.get("capacityBasis"));
  const agreements = str(formData.get("rotationAgreements"));
  await prisma.programFamily.update({ where: { id: familyId }, data: {
    capacityBasis: ["seats", "cases", "staff"].includes(basis) ? basis : "seats",
    casesPerStudentDay: num("casesPerStudentDay"), caseDaysPerYear: num("caseDaysPerYear") == null ? null : Math.round(num("caseDaysPerYear")!), studentsPerStaff: num("studentsPerStaff"),
    rotationPrimarySetting: str(formData.get("rotationPrimarySetting")) || null,
    rotationAgreements: ["secured", "secured+asked", "any"].includes(agreements) ? agreements : "secured+asked",
    rotationKeepHome: formData.get("rotationKeepHome") != null, rotationSkipHolidays: formData.get("rotationSkipHolidays") != null,
    rotationNotes: str(formData.get("rotationNotes")) || null,
    clinicalModel: ["hours", "competency", "mixed"].includes(str(formData.get("clinicalModel"))) ? str(formData.get("clinicalModel")) : undefined,
  } });
  revalidatePath(`/families/${familyId}/clinical`);
}
/** What one site makes available to one family: students at once, daily cases, days and blocks. */
export async function updateSiteAvailability(familyId: string, employerId: string, formData: FormData): Promise<void> {
  const num = (k: string) => { const v = str(formData.get(k)); return v === "" ? null : numOr(v, 0); };
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].filter((d) => formData.get(`day_${d}`) != null);
  const blocks = ["Day", "Evening", "Night"].filter((b) => formData.get(`block_${b}`) != null);
  const data = { studentsAtOnce: num("studentsAtOnce") == null ? null : Math.round(num("studentsAtOnce")!), casesPerDay: num("casesPerDay"), daysAllowed: days.length ? days.join(",") : null, blocksAllowed: blocks.length ? blocks.join(",") : null, availabilityNotes: str(formData.get("availabilityNotes")) || null, ...(formData.has("qualifiedStaffOnShift") ? { qualifiedStaffOnShift: num("qualifiedStaffOnShift") == null ? null : Math.max(0, Math.round(num("qualifiedStaffOnShift")!)), staffCountSource: str(formData.get("staffCountSource")) === "VERIFIED" ? "VERIFIED" : "ESTIMATE" } : {}) };
  await prisma.familySite.upsert({ where: { familyId_employerId: { familyId, employerId } }, update: data, create: { familyId, employerId, ...data } });
  revalidateFamilySite(familyId, employerId);
}

/** One site's recognition for one family: status, approved / requested capacity, the human-resource count and the student hours it was counted for. */
export async function updateSiteAccreditation(familyId: string, employerId: string, formData: FormData): Promise<void> {
  const opt = (k: string) => { const v = str(formData.get(k)); return v === "" ? null : Math.max(0, Math.round(numOr(v, 0))); };
  const status = str(formData.get("accreditorStatus")) || "none";
  const data = {
    accreditorStatus: ["none", "requested", "recognized"].includes(status) ? status : "none",
    approvedCapacity: opt("approvedCapacity"), requestedCapacity: opt("requestedCapacity"), qualifiedStaffOnShift: opt("qualifiedStaffOnShift"),
    staffCountSource: ["VERIFIED", "ESTIMATE", "GAP"].includes(str(formData.get("staffCountSource"))) ? str(formData.get("staffCountSource")) : "ESTIMATE",
    studentHoursWindow: str(formData.get("studentHoursWindow")) || null, accreditorNotes: str(formData.get("accreditorNotes")) || null, capacityUpdatedAt: new Date(),
  };
  await prisma.familySite.upsert({ where: { familyId_employerId: { familyId, employerId } }, update: data, create: { familyId, employerId, ...data } });
  revalidateFamilySite(familyId, employerId);
}
/** How the accreditor counts one asset (override the derived class). */
export async function setAssetAccreditorClass(assetId: string, employerId: string, formData: FormData): Promise<void> {
  const v = str(formData.get("accreditorClass"));
  await prisma.clinicalAsset.update({ where: { id: assetId }, data: { accreditorClass: v || null } });
  revalidateAssets(employerId);
}

/** Mark one date as an exception for an asset: `shiftBlocks` = the blocks it
 *  runs that day ("" = closed); null removes the exception (back to its rule). */
export async function setAssetDay(assetId: string, dateIso: string, shiftBlocks: string | null, note?: string | null): Promise<void> {
  const date = new Date(dateIso + "T00:00:00Z");
  const a = await prisma.clinicalAsset.findUnique({ where: { id: assetId }, select: { employerId: true } });
  if (shiftBlocks == null) await prisma.assetDay.deleteMany({ where: { assetId, date } });
  else await prisma.assetDay.upsert({ where: { assetId_date: { assetId, date } }, update: { shiftBlocks, note: note ?? null }, create: { assetId, date, shiftBlocks, note: note ?? null } });
  revalidateAssets(a?.employerId);
}

/** Book learners onto a physical asset for one date × shift block. */
export async function bookAsset(input: { assetId: string; cohortId: string; sessionId?: string | null; sectionIndex?: number; meetingId?: string | null; date: string; block: string; students?: number; note?: string | null }): Promise<{ ok: boolean; reason?: string }> {
  const asset = await prisma.clinicalAsset.findUnique({ where: { id: input.assetId }, include: { bookings: { where: { date: new Date(input.date + "T00:00:00Z"), block: input.block } } } });
  if (!asset) return { ok: false, reason: "asset not found" };
  const students = Math.max(1, Math.round(input.students ?? 1));
  const used = asset.bookings.reduce((n, b) => n + b.students, 0);
  if (used + students > asset.learnersPerShift) return { ok: false, reason: `only ${Math.max(0, asset.learnersPerShift - used)} learner seat(s) left on this asset for that shift` };
  await prisma.assetBooking.create({ data: { assetId: input.assetId, cohortId: input.cohortId, sessionId: input.sessionId ?? null, sectionIndex: Math.max(1, Math.round(input.sectionIndex ?? 1)), meetingId: input.meetingId ?? null, date: new Date(input.date + "T00:00:00Z"), block: input.block, students, note: input.note ?? null } });
  revalidateAssets(asset.employerId);
  return { ok: true };
}
export async function unbookAsset(bookingId: string): Promise<void> {
  const b = await prisma.assetBooking.delete({ where: { id: bookingId }, include: { asset: { select: { employerId: true } } } }).catch(() => null);
  revalidateAssets(b?.asset.employerId);
}

/** Import a parsed partner workbook: sites matched by facility_id (externalId)
 *  then name (created if new), the file's assets REPLACE those sites' assets,
 *  and 365-map exceptions are stored per date. */
export async function importAssetMap(institutionId: string, parsed: import("./assetmap").ParsedAssetMap): Promise<{ sites: number; newSites: number; assets: number; exceptions: number }> {
  const employers = await prisma.employer.findMany({ where: { institutionId }, select: { id: true, externalId: true, name: true } });
  const byExt = new Map(employers.filter((e) => e.externalId).map((e) => [e.externalId!, e.id]));
  const byName = new Map(employers.map((e) => [e.name.toLowerCase(), e.id]));
  const siteOf = new Map<string, string>(); let newSites = 0;
  for (const a of parsed.assets) {
    const key = a.facilityExternalId || a.facilityName.toLowerCase();
    if (siteOf.has(key)) continue;
    let id = byExt.get(a.facilityExternalId) ?? byName.get(a.facilityName.toLowerCase());
    if (!id) {
      const e = await prisma.employer.create({ data: { institutionId, name: a.facilityName || a.facilityExternalId, externalId: a.facilityExternalId || null, county: a.county, ring: a.ring, facilityType: a.facilityType, setting: a.facilityType, status: "active", agreementStatus: "none" } });
      id = e.id; newSites++;
    }
    siteOf.set(key, id);
  }
  const touched = [...new Set(siteOf.values())];
  await prisma.clinicalAsset.deleteMany({ where: { employerId: { in: touched } } });
  const ids = new Map<string, string>();
  for (const a of parsed.assets) {
    const employerId = siteOf.get(a.facilityExternalId || a.facilityName.toLowerCase())!;
    const row = await prisma.clinicalAsset.create({ data: { employerId, externalId: a.externalId, settingCode: a.settingCode, setting: a.setting, assetType: a.assetType, assetNumber: a.assetNumber, operatingRule: a.operatingRule, days: a.days, shiftBlocks: a.shiftBlocks, hoursPerShift: a.hoursPerShift, serves: a.serves, learnersPerShift: 1, preceptorsPerShift: 1, dataSource: "VERIFIED",
      dayStart: a.dayStart || "07:00", dayHours: a.dayHours ?? a.hoursPerShift, eveningStart: a.eveningStart || "15:00", eveningHours: a.eveningHours ?? a.hoursPerShift, nightStart: a.nightStart || "23:00", nightHours: a.nightHours ?? a.hoursPerShift } });
    ids.set(a.externalId, row.id);
  }
  let exceptions = 0;
  for (const x of parsed.exceptions) { const assetId = ids.get(x.assetId); if (!assetId) continue; await prisma.assetDay.create({ data: { assetId, date: new Date(x.date + "T00:00:00Z"), shiftBlocks: x.shiftBlocks } }); exceptions++; }
  revalidatePath("/insights/clinical-sites"); revalidatePath("/employers");
  for (const id of touched) revalidatePath(`/employers/${id}`);
  return { sites: touched.length, newSites, assets: parsed.assets.length, exceptions };
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
  const created = await prisma.employer.create({
    data: {
      institutionId,
      name: str(formData.get("name")) || "New partner",
      setting: str(formData.get("setting")) || null,
      address: str(formData.get("address")) || null,
      city: str(formData.get("city")) || null,
      state: str(formData.get("state")) || null,
      zip: str(formData.get("zip")) || null,
      wblSlots: optNum(formData.get("wblSlots")) ?? null,
      status: str(formData.get("status")) || "prospect",
      contactName: str(formData.get("contactName")) || null,
      contactEmail: str(formData.get("contactEmail")) || null,
      contactPhone: str(formData.get("contactPhone")) || null,
      notes: str(formData.get("notes")) || null,
    },
  });
  await geocodeInstitutionSites(institutionId, created.id);
  revalidatePath("/employers");
}

export async function updateEmployer(employerId: string, formData: FormData): Promise<void> {
  const intOr = (name: string) => { const v = optNum(formData.get(name)); return v == null ? null : Math.round(v); };
  const before = await prisma.employer.findUnique({ where: { id: employerId }, select: { address: true, city: true, state: true, zip: true, institutionId: true } });
  const after = await prisma.employer.update({
    where: { id: employerId },
    data: {
      name: str(formData.get("name")) || "Partner",
      setting: str(formData.get("setting")) || null,
      address: str(formData.get("address")) || null,
      city: str(formData.get("city")) || null,
      state: str(formData.get("state")) || null,
      zip: str(formData.get("zip")) || null,
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
      licensedBeds: intOr("licensedBeds"), nursingHomeBeds: intOr("nursingHomeBeds"), adultCareBeds: intOr("adultCareBeds"),
      operatingRooms: intOr("operatingRooms"), annualSurgicalCases: intOr("annualSurgicalCases"),
      inpatientSurgicalCases: intOr("inpatientSurgicalCases"), ambulatorySurgicalCases: intOr("ambulatorySurgicalCases"), operatingDaysPerYear: intOr("operatingDaysPerYear"),
      surgicalCaseSource: str(formData.get("surgicalCaseSource")) || null,
      agreementStatus: str(formData.get("agreementStatus")) || "none",
      agreementNotes: str(formData.get("agreementNotes")) || null,
    },
    select: { address: true, city: true, state: true, zip: true, institutionId: true },
  });
  // The address moved → the location, drive time and ring are recoded (a hand-pinned coordinate is released).
  if (before && (before.address !== after.address || before.city !== after.city || before.state !== after.state || before.zip !== after.zip)) {
    await prisma.employer.update({ where: { id: employerId }, data: { geoSource: null } });
    await geocodeInstitutionSites(after.institutionId, employerId);
  }
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
  for (const t of terms) await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: t.id, startDate: null } });
  // Real term dates and course windows straight from the institution's academic calendar.
  if (startD) await alignOfferingToCalendar(cohort.id);
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
  input: { gradYear: number; goal: number; startDate: string; termOverrides?: (number | null)[]; rates?: Record<string, number> },
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
  // …unless this offering set its own rates on its slot.
  if (input.rates) rates = { ...rates, ...(input.rates as Partial<typeof BENCHMARK_RATES>) };
  const t = deriveCohortTargets(Math.max(0, input.goal), rates, Math.max(1, program.terms.length));
  const termOverrides = (input.termOverrides ?? []).map((v) => (v == null ? null : Math.max(0, Math.round(v))));
  const term1 = termOverrides[0] ?? t.capacity;

  // Real term dates come from the institution's coded academic calendar: term 1
  // on the chosen day (snapped to the coded semester start), every later term
  // on the next coded semester start after the previous term ends, each term
  // ending on its coded "semester ends". The class year is when the last term
  // actually ends.
  const { alignOffering, endYearOf } = await import("./termalign");
  const inst = await prisma.institution.findUnique({ where: { id: program.institutionId }, select: { springStart: true, summerStart: true, fallStart: true, academicEvents: { select: { date: true, endDate: true, label: true, kind: true, season: true } } } });
  const preview = alignOffering({
    startIso: input.startDate,
    terms: program.terms.map((term) => ({ id: term.id, index: term.index, name: term.name, semester: term.semester, startWeek: term.startWeek, endWeek: term.endWeek })),
    courses: [],
    anchors: { springStart: inst?.springStart ?? "01-08", summerStart: inst?.summerStart ?? "05-28", fallStart: inst?.fallStart ?? "08-15" },
    events: (inst?.academicEvents ?? []).map((e) => ({ iso: e.date.toISOString().slice(0, 10), endIso: e.endDate?.toISOString().slice(0, 10) ?? null, label: e.label, kind: e.kind, season: e.season })),
  });
  const endYear = endYearOf(preview.terms);

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
      plannedSeats: Math.round(term1),
      // The slot's own plan travels with the offering: goal, per-term enrollment, rates.
      pipelineRates: JSON.stringify({ goal: input.goal, rates, termOverrides }),
    },
  });

  // Funnel targets — the whole derived ladder, stage by stage.
  const stageTargets: Record<string, number> = {
    interested: t.interested, qualified: t.qualified, offered: t.offered,
    enrolled: term1, completing: t.completing, licensed: t.licensed,
    placed: t.placed, productive: t.productive,
  };
  await prisma.funnelStage.createMany({
    data: STAGES.map((s, i) => ({
      cohortId: cohort.id, stageKey: s.key, sortOrder: i, label: s.label,
      targetNumber: Math.round(stageTargets[s.key] ?? 0),
    })),
  });

  // Real per-term dates (start AND end) and course windows, on the calendar.
  for (const term of program.terms) await prisma.cohortTerm.create({ data: { cohortId: cohort.id, termId: term.id, startDate: null } });
  await alignOfferingToCalendar(cohort.id);

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
    // Back to the calendar: the aligned window (if the course is shorter than its term) returns.
    await prisma.cohortCourseDates.deleteMany({ where: { cohortId, courseId } });
    await alignOfferingToCalendar(cohortId);
  } else {
    await prisma.cohortCourseDates.upsert({
      where: { cohortId_courseId: { cohortId, courseId } },
      update: { startDate: startStr ? new Date(startStr) : null, endDate: endStr ? new Date(endStr) : null, auto: false },
      create: { cohortId, courseId, startDate: startStr ? new Date(startStr) : null, endDate: endStr ? new Date(endStr) : null, auto: false },
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
  const cts = await prisma.cohortTerm.findMany({ where: { cohortId }, select: { id: true, termId: true } });
  if (str(formData.get("rederive")) === "1") {
    // Back onto the academic calendar: every term (typed ones too) re-derived from the offering start.
    await alignOfferingToCalendar(cohortId, { resetManual: true });
  } else {
    // Typed dates are kept as typed (source "manual"); everything else — later
    // terms, term ends, course windows — follows the calendar around them.
    for (const ct of cts) {
      const v = str(formData.get(`term_${ct.termId}`));
      const e = str(formData.get(`term_end_${ct.termId}`));
      if (v) await prisma.cohortTerm.update({ where: { id: ct.id }, data: { startDate: new Date(v), endDate: e ? new Date(e) : null, source: "manual", semester: seasonOfDate(new Date(v)) } });
    }
    await alignOfferingToCalendar(cohortId);
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
      semester: str(formData.get("semester")) || null,
      startWeek: optNum(formData.get("startWeek")),
      endWeek: optNum(formData.get("endWeek")),
    },
  });
  revalidatePath(`/programs/${programId}`);
  revalidatePath(`/programs/${programId}/structure`);
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
  revalidatePath("/students");
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
/** Move ONE shift occurrence — the session × section of a cohort that its weekly
 *  pattern puts on `fromDateIso` — to another date / time / place. Keyed by the
 *  session, so no other shift moves with it; works whether or not the offering
 *  has weekly bookings yet. */
export async function moveShiftOccurrence(
  key: { cohortId: string; sessionId: string; sectionIndex: number; meetingId?: string | null },
  fromDateIso: string,
  patch: { toDate?: string; startTime?: string | null; facilityId?: string | null; employerId?: string | null; staffPersonId?: string | null },
): Promise<void> {
  const { cohortId, sessionId } = key;
  const sectionIndex = Math.max(1, Math.round(key.sectionIndex || 1));
  const fromDate = new Date(fromDateIso + "T00:00:00Z");
  const where = { cohortId_sessionId_sectionIndex_fromDate: { cohortId, sessionId, sectionIndex, fromDate } };
  const existing = await prisma.shiftMove.findUnique({ where });
  const toDate = patch.toDate ? new Date(patch.toDate + "T00:00:00Z") : existing?.toDate ?? fromDate;
  const data = {
    toDate,
    meetingId: key.meetingId ?? existing?.meetingId ?? null,
    startTime: patch.startTime === undefined ? existing?.startTime ?? null : patch.startTime,
    facilityId: patch.facilityId === undefined ? existing?.facilityId ?? null : patch.facilityId,
    employerId: patch.employerId === undefined ? existing?.employerId ?? null : patch.employerId,
    staffPersonId: patch.staffPersonId === undefined ? existing?.staffPersonId ?? null : patch.staffPersonId,
  };
  const m = await prisma.shiftMove.upsert({
    where, update: data,
    create: { cohortId, sessionId, sectionIndex, fromDate, ...data },
    include: { cohort: { select: { programId: true } } },
  });
  revalidatePath("/calendar");
  revalidatePath(`/programs/${m.cohort.programId}/offerings/${cohortId}`);
  revalidatePath("/insights/coverage");
}

/** Put one moved occurrence back on its weekly pattern. */
export async function clearShiftMove(key: { cohortId: string; sessionId: string; sectionIndex: number }, fromDateIso: string): Promise<void> {
  const fromDate = new Date(fromDateIso + "T00:00:00Z");
  const sectionIndex = Math.max(1, Math.round(key.sectionIndex || 1));
  const m = await prisma.shiftMove.findUnique({ where: { cohortId_sessionId_sectionIndex_fromDate: { cohortId: key.cohortId, sessionId: key.sessionId, sectionIndex, fromDate } }, include: { cohort: { select: { programId: true } } } });
  if (!m) return;
  await prisma.shiftMove.delete({ where: { id: m.id } });
  revalidatePath("/calendar");
  revalidatePath(`/programs/${m.cohort.programId}/offerings/${m.cohortId}`);
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
  const { calendarizeCore } = await import("./autoassign");
  const made = await calendarizeCore(cohortId);
  if (!made) return;
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
  revalidatePath("/calendar");
}

// ---------------------------------------------------------------------------
// CLINICAL SCHEDULER — apply a recommended plan
// ---------------------------------------------------------------------------
const AUTO_PLAN_NOTE = "auto-plan";

export interface PlanAssignmentInput {
  assetId: string; employerId: string; cohortId: string; sessionId: string; sectionIndex: number; courseId: string | null;
  date: string; block: string; seats: number; seatsPerSection: number; preceptorIds: string[]; instructorId: string | null;
  /** Seats per asset when the section spreads across several rooms at the site (defaults to the lead asset with all seats). */
  parts?: { assetId: string; seats: number }[];
  /** When a section is split across sites, this piece covers section seats (seatOffset, seatOffset + seats]. */
  seatOffset?: number;
}

/** Write a recommended plan to the database: learner bookings on assets (one
 *  per placed section), each clinical section's meeting pattern pointed at its
 *  main site and lead preceptor, and a planned placement per student per site.
 *  Earlier auto-plan rows for the same offerings are replaced; anything booked
 *  by hand is left alone. */
export async function applySchedulerPlan(institutionId: string, assignments: PlanAssignmentInput[]): Promise<{ bookings: number; placements: number; meetings: number }> {
  const cohortIds = [...new Set(assignments.map((a) => a.cohortId))];
  if (cohortIds.length === 0) return { bookings: 0, placements: 0, meetings: 0 };
  await prisma.assetBooking.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.wblPlacement.deleteMany({ where: { cohortId: { in: cohortIds }, notes: AUTO_PLAN_NOTE } });
  await prisma.assetBooking.createMany({
    data: assignments.flatMap((a) => (a.parts?.length ? a.parts : [{ assetId: a.assetId, seats: a.seats }]).map((pt) => ({ assetId: pt.assetId, cohortId: a.cohortId, sessionId: a.sessionId, sectionIndex: a.sectionIndex, date: new Date(a.date + "T00:00:00Z"), block: a.block, students: Math.max(1, Math.round(pt.seats)), note: AUTO_PLAN_NOTE }))),
  });

  // Each (cohort, course, section)'s MAIN site + lead preceptor → the meeting pattern the calendar reads.
  const bySection = new Map<string, { employer: Map<string, number>; preceptor: Map<string, number> }>();
  for (const a of assignments) {
    if (!a.courseId) continue;
    const k = `${a.cohortId}|${a.courseId}|${a.sectionIndex}`;
    const s = bySection.get(k) ?? { employer: new Map(), preceptor: new Map() };
    s.employer.set(a.employerId, (s.employer.get(a.employerId) ?? 0) + 1);
    for (const p of a.preceptorIds) s.preceptor.set(p, (s.preceptor.get(p) ?? 0) + 1);
    bySection.set(k, s);
  }
  let meetings = 0;
  const top = (m: Map<string, number>) => [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  for (const [k, s] of bySection) {
    const [cohortId, courseId, sec] = k.split("|");
    const r = await prisma.meetingPattern.updateMany({ where: { cohortId, courseId, kind: "CLINICAL", sectionIndex: Number(sec) }, data: { employerId: top(s.employer), staffPersonId: top(s.preceptor) } });
    meetings += r.count;
  }

  // Students follow their section: one planned placement per student × site, dated by that site's first and last shift.
  const students = await prisma.student.findMany({ where: { cohortId: { in: cohortIds } }, select: { id: true, cohortId: true, sectionIndex: true } });
  const placements: { studentId: string; employerId: string; cohortId: string; startDate: Date; endDate: Date; status: string; notes: string }[] = [];
  for (const st of students) {
    const mine = assignments.filter((a) => { if (a.cohortId !== st.cohortId) return false; const per = Math.max(1, a.seatsPerSection); const sec = Math.max(1, Math.ceil(Math.max(1, st.sectionIndex) / per)); if (sec !== a.sectionIndex) return false; const ord = st.sectionIndex - (sec - 1) * per; const off = a.seatOffset ?? 0; return ord > off && ord <= off + a.seats; });
    const bySite = new Map<string, { from: string; to: string }>();
    for (const a of mine) { const w = bySite.get(a.employerId) ?? { from: a.date, to: a.date }; if (a.date < w.from) w.from = a.date; if (a.date > w.to) w.to = a.date; bySite.set(a.employerId, w); }
    for (const [employerId, w] of bySite) placements.push({ studentId: st.id, employerId, cohortId: st.cohortId!, startDate: new Date(w.from + "T00:00:00Z"), endDate: new Date(w.to + "T00:00:00Z"), status: "planned", notes: AUTO_PLAN_NOTE });
  }
  if (placements.length) await prisma.wblPlacement.createMany({ data: placements });

  revalidatePath("/scheduler"); revalidatePath("/calendar"); revalidatePath("/employers"); revalidatePath("/insights/clinical-sites"); revalidatePath("/insights/coverage");
  for (const c of cohortIds) revalidatePath(`/programs/[id]/offerings/${c}`, "page");
  return { bookings: assignments.reduce((n, a) => n + (a.parts?.length || 1), 0), placements: placements.length, meetings };
}

/** Apply the scheduler's plan from its LEVERS. The browser sends only the policy,
 *  the window and the chosen offerings; the plan itself is rebuilt here from the
 *  same offerings and supply the board loaded, by the same pure steps, so it
 *  matches what was on screen — and a 5,000-section plan never has to travel
 *  as a request body (Next.js caps server-action bodies at 1 MB). */
export async function applySchedulerLevers(institutionId: string, levers: import("./schedulerplan").SchedulerLevers): Promise<{ bookings: number; placements: number; meetings: number; sections: number }> {
  const { getCapacityModel, getSchedulerData } = await import("./queries");
  const { buildSchedulerPlan, planInputs, schedulerWindow } = await import("./schedulerplan");
  const data = await getCapacityModel({ institutionId });
  if (!data) return { bookings: 0, placements: 0, meetings: 0, sections: 0 };
  const base = schedulerWindow(data.cohorts);
  const supply = await getSchedulerData(data.institution.id, base.from, base.to);
  const plan = buildSchedulerPlan(data.cohorts, supply, levers);
  const r = await applySchedulerPlan(data.institution.id, planInputs(plan.assignments));
  return { ...r, sections: plan.assignments.length };
}

/** AUTO-ASSIGN one offering end to end: calendarize, place every clinical
 *  section on partner assets, staff every shift under workload policies, and
 *  put every learner in sections and on their clinical shifts. Fills gaps only. */
export async function autoAssignOffering(cohortId: string, programId: string): Promise<import("./autoassign").AutoAssignSummary | null> {
  const { autoAssignOffering: run } = await import("./autoassign");
  const summary = await run(cohortId);
  revalidateStaffing(programId, cohortId);
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`); revalidatePath(`/programs/${programId}/offerings/${cohortId}/design`);
  revalidatePath("/calendar"); revalidatePath("/scheduler"); revalidatePath("/students"); revalidatePath("/people"); revalidatePath("/supply"); revalidatePath("/utilization");
  return summary;
}

/** Remove everything a plan wrote for these offerings (hand-made bookings stay). */
export async function clearSchedulerPlan(cohortIds: string[]): Promise<void> {
  if (!cohortIds.length) return;
  await prisma.assetBooking.deleteMany({ where: { cohortId: { in: cohortIds }, note: AUTO_PLAN_NOTE } });
  await prisma.wblPlacement.deleteMany({ where: { cohortId: { in: cohortIds }, notes: AUTO_PLAN_NOTE } });
  revalidatePath("/scheduler"); revalidatePath("/calendar"); revalidatePath("/employers"); revalidatePath("/insights/clinical-sites");
}

// ---------------------------------------------------------------------------
// WORKLOAD POLICIES — assumptions by institution, employer and position
// ---------------------------------------------------------------------------

/** Create or update a workload policy row (the People page's policy table). */
export async function saveWorkloadPolicy(formData: FormData): Promise<void> {
  const id = str(formData.get("id"));
  const institutionId = str(formData.get("institutionId"));
  if (!institutionId) return;
  const data = {
    institutionId,
    employerId: str(formData.get("employerId")) || null,
    assetId: str(formData.get("assetId")) || null,
    role: str(formData.get("role")) || "instructor",
    employmentType: str(formData.get("employmentType")) || null,
    title: str(formData.get("title")) || null,
    label: str(formData.get("label")) || null,
    contactHoursPerWeek: numOr(formData.get("contactHoursPerWeek"), 16),
    workWeekHours: numOr(formData.get("workWeekHours"), 40),
    termWeeks: numOr(formData.get("termWeeks"), 16),
    annualWeeks: numOr(formData.get("annualWeeks"), 32),
    hoursPerContactHour: optNum(formData.get("hoursPerContactHour")),
    maxContactHoursPerWeek: optNum(formData.get("maxContactHoursPerWeek")),
    notes: str(formData.get("notes")) || null,
  };
  if (id) await prisma.workloadPolicy.update({ where: { id }, data });
  else await prisma.workloadPolicy.create({ data });
  revalidatePath("/people");
  revalidatePath("/", "layout");
}

export async function deleteWorkloadPolicy(id: string): Promise<void> {
  await prisma.workloadPolicy.delete({ where: { id } }).catch(() => undefined);
  revalidatePath("/people");
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// SHIFT ASSIGNMENTS — who covers which part of which shift, for THIS offering
// ---------------------------------------------------------------------------

function revalidateStaffing(programId: string, cohortId: string) {
  revalidatePath(`/programs/${programId}/offerings/${cohortId}`);
  revalidatePath(`/programs/${programId}/offerings/${cohortId}/design`);
  revalidatePath("/people");
  revalidatePath("/calendar");
}

/** Add one person's share of one shift (session × section). `sectionIndex`
 *  "all" puts the same share on every section of the session. Hours default
 *  to the whole session length; an offset (minutes into the session) places
 *  the share in time, so overlapping shares read as co-teaching. */
export async function addShiftAssignment(cohortId: string, programId: string, formData: FormData): Promise<void> {
  const sessionId = str(formData.get("sessionId")); const personId = str(formData.get("personId"));
  if (!sessionId || !personId) return;
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { lengthHours: true } });
  if (!session) return;
  const role = str(formData.get("role")) || "instructor";
  const hoursRaw = str(formData.get("contactHours"));
  const contactHours = hoursRaw ? Math.max(0, numOr(formData.get("contactHours"), session.lengthHours)) : session.lengthHours;
  const startOffsetMin = optNum(formData.get("startOffsetMin"));
  const segment = str(formData.get("segment")) || null;
  const secRaw = str(formData.get("sectionIndex")) || "1";
  const sections = secRaw === "all" ? Array.from({ length: Math.max(1, numOr(formData.get("sectionCount"), 1)) }, (_, i) => i + 1) : [Math.max(1, Math.round(numOr(formData.get("sectionIndex"), 1)))];
  for (const sectionIndex of sections) {
    await prisma.sessionInstructor.create({ data: { cohortId, sessionId, personId, sectionIndex, role, contactHours, startOffsetMin, segment } });
  }
  revalidateStaffing(programId, cohortId);
}

export async function updateShiftAssignment(id: string, cohortId: string, programId: string, formData: FormData): Promise<void> {
  await prisma.sessionInstructor.update({
    where: { id },
    data: {
      personId: str(formData.get("personId")) || undefined,
      role: str(formData.get("role")) || undefined,
      contactHours: Math.max(0, numOr(formData.get("contactHours"), 0)),
      startOffsetMin: optNum(formData.get("startOffsetMin")),
      segment: str(formData.get("segment")) || null,
    },
  }).catch(() => undefined);
  revalidateStaffing(programId, cohortId);
}

export async function removeShiftAssignment(id: string, cohortId: string, programId: string): Promise<void> {
  await prisma.sessionInstructor.delete({ where: { id } }).catch(() => undefined);
  revalidateStaffing(programId, cohortId);
}

/** Copy one section's assignments for a session onto every other section. */
export async function copyShiftAssignments(cohortId: string, sessionId: string, fromSection: number, sectionCount: number, programId: string): Promise<void> {
  const rows = await prisma.sessionInstructor.findMany({ where: { cohortId, sessionId, sectionIndex: fromSection } });
  await prisma.sessionInstructor.deleteMany({ where: { cohortId, sessionId, sectionIndex: { not: fromSection } } });
  for (let s = 1; s <= sectionCount; s++) {
    if (s === fromSection) continue;
    for (const r of rows) await prisma.sessionInstructor.create({ data: { cohortId, sessionId, sectionIndex: s, personId: r.personId, role: r.role, contactHours: r.contactHours, startOffsetMin: r.startOffsetMin, segment: r.segment } });
  }
  revalidateStaffing(programId, cohortId);
}

/** Bulk: one person covers every session of a course (optionally one kind) in
 *  full, on the chosen section(s) — the fast path; refine any shift on the
 *  design page. */
export async function assignCourseStaffBulk(cohortId: string, courseId: string, programId: string, formData: FormData): Promise<void> {
  const personId = str(formData.get("personId"));
  if (!personId) return;
  const role = str(formData.get("role")) || "instructor";
  const kind = str(formData.get("kind")) || "";
  const secRaw = str(formData.get("sectionIndex")) || "1";
  const sessions = await prisma.session.findMany({ where: { courseId, ...(kind ? { kind } : {}) }, select: { id: true, lengthHours: true, maxStudents: true } });
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { plannedSeats: true, _count: { select: { students: true } } } });
  const enrolled = Math.max(cohort?._count.students ?? 0, cohort?.plannedSeats ?? 0, 1);
  for (const s of sessions) {
    const sectionCount = Math.max(1, Math.ceil(enrolled / Math.max(1, s.maxStudents)));
    const sections = secRaw === "all" ? Array.from({ length: sectionCount }, (_, i) => i + 1) : [Math.max(1, Math.round(Number(secRaw) || 1))];
    for (const sectionIndex of sections) {
      const exists = await prisma.sessionInstructor.findFirst({ where: { cohortId, sessionId: s.id, personId, sectionIndex } });
      if (exists) continue;
      await prisma.sessionInstructor.create({ data: { cohortId, sessionId: s.id, personId, sectionIndex, role, contactHours: s.lengthHours, segment: null } });
    }
  }
  revalidateStaffing(programId, cohortId);
}

// ---------------------------------------------------------------------------
// ORGANIZATIONS — basics
// ---------------------------------------------------------------------------

export async function updateInstitution(id: string, formData: FormData): Promise<void> {
  await prisma.institution.update({
    where: { id },
    data: {
      name: str(formData.get("name")) || undefined,
      shortName: str(formData.get("shortName")) || null,
      kind: str(formData.get("kind")) || null,
      city: str(formData.get("city")) || null,
      state: str(formData.get("state")) || null,
      serviceArea: str(formData.get("serviceArea")) || null,
    },
  });
  revalidatePath(`/orgs/${id}`); revalidatePath("/orgs"); revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// CAMPUSES · BUILDINGS · ROOM HOURS · EQUIPMENT
// ---------------------------------------------------------------------------

function revalidateRooms(institutionId?: string | null) {
  revalidatePath("/facilities"); if (institutionId) revalidatePath(`/orgs/${institutionId}`); revalidatePath("/calendar");
}

export async function saveCampus(formData: FormData): Promise<void> {
  const id = str(formData.get("id")); const institutionId = str(formData.get("institutionId"));
  if (!institutionId) return;
  const data = { institutionId, name: str(formData.get("name")) || "Campus", address: str(formData.get("address")) || null, city: str(formData.get("city")) || null, state: str(formData.get("state")) || null, zip: str(formData.get("zip")) || null, notes: str(formData.get("notes")) || null };
  if (id) await prisma.campus.update({ where: { id }, data }); else await prisma.campus.create({ data });
  revalidateRooms(institutionId);
}
export async function deleteCampus(id: string): Promise<void> {
  const c = await prisma.campus.delete({ where: { id } }).catch(() => null); revalidateRooms(c?.institutionId);
}
export async function saveBuilding(formData: FormData): Promise<void> {
  const id = str(formData.get("id")); const institutionId = str(formData.get("institutionId"));
  if (!institutionId) return;
  const data = { institutionId, campusId: str(formData.get("campusId")) || null, name: str(formData.get("name")) || "Building", code: str(formData.get("code")) || null, address: str(formData.get("address")) || null, floors: optNum(formData.get("floors")), notes: str(formData.get("notes")) || null };
  if (id) await prisma.building.update({ where: { id }, data }); else await prisma.building.create({ data });
  revalidateRooms(institutionId);
}
export async function deleteBuilding(id: string): Promise<void> {
  const b = await prisma.building.delete({ where: { id } }).catch(() => null); revalidateRooms(b?.institutionId);
}

/** Read the structured hours out of a room form: one open/close pair per weekday
 *  (blank = closed), or a preset key that fills them all. */
function hoursFromForm(formData: FormData): { dayOfWeek: string; openTime: string; closeTime: string }[] | null {
  const preset = str(formData.get("hoursPreset"));
  if (preset === "keep") return null;
  const { HOURS_PRESETS, WEEKDAYS } = require("./rooms") as typeof import("./rooms");
  if (preset) { const p = HOURS_PRESETS.find((x) => x.key === preset); if (p) return p.spans; }
  const spans: { dayOfWeek: string; openTime: string; closeTime: string }[] = [];
  for (const d of WEEKDAYS) {
    const o = str(formData.get(`open_${d}`)), c = str(formData.get(`close_${d}`));
    if (/^\d{2}:\d{2}$/.test(o) && /^\d{2}:\d{2}$/.test(c) && c > o) spans.push({ dayOfWeek: d, openTime: o, closeTime: c });
    const o2 = str(formData.get(`open2_${d}`)), c2 = str(formData.get(`close2_${d}`));
    if (/^\d{2}:\d{2}$/.test(o2) && /^\d{2}:\d{2}$/.test(c2) && c2 > o2) spans.push({ dayOfWeek: d, openTime: o2, closeTime: c2 });
  }
  return spans;
}
async function writeHours(facilityId: string, spans: { dayOfWeek: string; openTime: string; closeTime: string }[] | null) {
  if (!spans) return;
  await prisma.facilityHours.deleteMany({ where: { facilityId } });
  if (spans.length) await prisma.facilityHours.createMany({ data: spans.map((s) => ({ facilityId, ...s })) });
}
function roomData(formData: FormData) {
  return {
    name: str(formData.get("name")) || "Room", kind: str(formData.get("kind")) || "CLASSROOM",
    buildingId: str(formData.get("buildingId")) || null, roomNumber: str(formData.get("roomNumber")) || null, floor: str(formData.get("floor")) || null,
    capacity: optNum(formData.get("capacity")), areaSqft: optNum(formData.get("areaSqft")),
    availability: str(formData.get("availability")) || null, notes: str(formData.get("notes")) || null, status: str(formData.get("status")) || "active",
  };
}
export async function createRoom(formData: FormData): Promise<void> {
  const institutionId = str(formData.get("institutionId")); if (!institutionId) return;
  const d = roomData(formData);
  const b = d.buildingId ? await prisma.building.findUnique({ where: { id: d.buildingId }, select: { name: true } }) : null;
  const room = await prisma.facility.create({ data: { institutionId, ...d, building: b?.name ?? null } });
  await writeHours(room.id, hoursFromForm(formData) ?? []);
  revalidateRooms(institutionId);
}
export async function updateRoom(facilityId: string, formData: FormData): Promise<void> {
  const d = roomData(formData);
  const b = d.buildingId ? await prisma.building.findUnique({ where: { id: d.buildingId }, select: { name: true } }) : null;
  const room = await prisma.facility.update({ where: { id: facilityId }, data: { ...d, building: b?.name ?? null } });
  await writeHours(facilityId, hoursFromForm(formData));
  revalidateRooms(room.institutionId);
}
export async function setRoomClosure(facilityId: string, formData: FormData): Promise<void> {
  const date = str(formData.get("date")); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const openTime = str(formData.get("openTime")) || null, closeTime = str(formData.get("closeTime")) || null;
  const room = await prisma.facility.findUnique({ where: { id: facilityId }, select: { institutionId: true } });
  await prisma.facilityClosure.upsert({ where: { facilityId_date: { facilityId, date: new Date(date + "T00:00:00Z") } }, update: { openTime, closeTime, note: str(formData.get("note")) || null }, create: { facilityId, date: new Date(date + "T00:00:00Z"), openTime, closeTime, note: str(formData.get("note")) || null } });
  revalidateRooms(room?.institutionId);
}
export async function deleteRoomClosure(id: string): Promise<void> {
  const c = await prisma.facilityClosure.delete({ where: { id }, include: { facility: { select: { institutionId: true } } } }).catch(() => null); revalidateRooms(c?.facility.institutionId);
}

export async function saveEquipment(formData: FormData): Promise<void> {
  const id = str(formData.get("id")); const institutionId = str(formData.get("institutionId")); if (!institutionId) return;
  const acquired = str(formData.get("acquiredDate"));
  const homeFacilityId = str(formData.get("homeFacilityId")) || null;
  const home = homeFacilityId ? await prisma.facility.findUnique({ where: { id: homeFacilityId }, select: { buildingId: true } }) : null;
  const data = {
    institutionId, name: str(formData.get("name")) || "Equipment", category: str(formData.get("category")) || "Other", mobility: str(formData.get("mobility")) || "fixed",
    quantity: Math.max(1, Math.round(numOr(formData.get("quantity"), 1))), make: str(formData.get("make")) || null, model: str(formData.get("model")) || null, serial: str(formData.get("serial")) || null,
    homeFacilityId, buildingId: str(formData.get("buildingId")) || home?.buildingId || null, status: str(formData.get("status")) || "active",
    acquiredDate: acquired ? new Date(acquired) : null, notes: str(formData.get("notes")) || null,
  };
  if (id) await prisma.equipment.update({ where: { id }, data }); else await prisma.equipment.create({ data });
  revalidateRooms(institutionId);
}
export async function deleteEquipment(id: string): Promise<void> {
  const e = await prisma.equipment.delete({ where: { id } }).catch(() => null); revalidateRooms(e?.institutionId);
}
/** Place mobile / portable equipment in a room for a period (blank dates = open-ended). */
export async function assignEquipment(equipmentId: string, formData: FormData): Promise<void> {
  const facilityId = str(formData.get("facilityId")); if (!facilityId) return;
  const from = str(formData.get("from")), to = str(formData.get("to"));
  const e = await prisma.equipment.findUnique({ where: { id: equipmentId }, select: { institutionId: true } });
  await prisma.equipmentAssignment.create({ data: { equipmentId, facilityId, quantity: Math.max(1, Math.round(numOr(formData.get("quantity"), 1))), from: from ? new Date(from) : null, to: to ? new Date(to) : null, note: str(formData.get("note")) || null } });
  revalidateRooms(e?.institutionId);
}
export async function removeEquipmentAssignment(id: string): Promise<void> {
  const a = await prisma.equipmentAssignment.delete({ where: { id }, include: { equipment: { select: { institutionId: true } } } }).catch(() => null); revalidateRooms(a?.equipment.institutionId);
}

// ---------------------------------------------------------------------------
// STAFF ROLES (custom, per institution) · POLICY SCOPING & BULK APPLY
// ---------------------------------------------------------------------------

export async function saveStaffRole(formData: FormData): Promise<void> {
  const id = str(formData.get("id")); const institutionId = str(formData.get("institutionId")); if (!institutionId) return;
  const label = str(formData.get("label")) || "Role";
  const key = (str(formData.get("key")) || label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "role";
  const data = { institutionId, key, label, family: str(formData.get("family")) || "faculty", notes: str(formData.get("notes")) || null };
  if (id) await prisma.staffRole.update({ where: { id }, data }); else await prisma.staffRole.upsert({ where: { institutionId_key: { institutionId, key } }, update: data, create: data });
  revalidatePath("/people"); revalidatePath(`/orgs/${institutionId}`);
}
export async function deleteStaffRole(id: string): Promise<void> {
  const r = await prisma.staffRole.delete({ where: { id } }).catch(() => null);
  revalidatePath("/people"); if (r) revalidatePath(`/orgs/${r.institutionId}`);
}

/** Copy one policy onto every partner site of its institution (or the chosen
 *  ones) so each site carries the same numbers; existing site rows for the
 *  same position are replaced. */
export async function applyPolicyToEmployers(policyId: string, employerIds: string[] | "all"): Promise<{ applied: number }> {
  const p = await prisma.workloadPolicy.findUnique({ where: { id: policyId } });
  if (!p) return { applied: 0 };
  const targets = employerIds === "all" ? (await prisma.employer.findMany({ where: { institutionId: p.institutionId, status: "active" }, select: { id: true } })).map((e) => e.id) : employerIds;
  let applied = 0;
  for (const employerId of targets) {
    if (employerId === p.employerId) continue;
    await prisma.workloadPolicy.deleteMany({ where: { institutionId: p.institutionId, employerId, assetId: null, role: p.role, employmentType: p.employmentType, title: p.title } });
    await prisma.workloadPolicy.create({ data: { institutionId: p.institutionId, employerId, assetId: null, role: p.role, employmentType: p.employmentType, title: p.title, label: p.label, contactHoursPerWeek: p.contactHoursPerWeek, workWeekHours: p.workWeekHours, termWeeks: p.termWeeks, annualWeeks: p.annualWeeks, hoursPerContactHour: p.hoursPerContactHour, maxContactHoursPerWeek: p.maxContactHoursPerWeek, notes: p.notes } });
    applied++;
  }
  revalidatePath("/people"); revalidatePath(`/orgs/${p.institutionId}`);
  return { applied };
}

// ---------------------------------------------------------------------------
// LEARNERS — demographics · class sections · clinical shifts
// ---------------------------------------------------------------------------

const boolOrNull = (v: FormDataEntryValue | null): boolean | null => { const s = str(v); return s === "yes" ? true : s === "no" ? false : null; };

/** Save the coded demographic profile (every field a dropdown or a date, so it aggregates cleanly). */
export async function updateStudentProfile(studentId: string, formData: FormData): Promise<void> {
  const d = (k: string) => { const v = str(formData.get(k)); return v ? new Date(v + "T00:00:00Z") : null; };
  const s = await prisma.student.update({
    where: { id: studentId },
    data: {
      name: str(formData.get("name")) || undefined, email: str(formData.get("email")) || null, phone: str(formData.get("phone")) || null,
      dob: d("dob"), sex: str(formData.get("sex")) || null, raceEthnicity: str(formData.get("raceEthnicity")) || null,
      address: str(formData.get("address")) || null, city: str(formData.get("city")) || null, county: str(formData.get("county")) || null, state: str(formData.get("state")) || null, zip: str(formData.get("zip")) || null,
      residency: str(formData.get("residency")) || null, priorEducation: str(formData.get("priorEducation")) || null, employmentStatus: str(formData.get("employmentStatus")) || null,
      firstGeneration: boolOrNull(formData.get("firstGeneration")), veteran: boolOrNull(formData.get("veteran")), pellEligible: boolOrNull(formData.get("pellEligible")), disability: boolOrNull(formData.get("disability")),
      dependents: optNum(formData.get("dependents")), primaryLanguage: str(formData.get("primaryLanguage")) || null,
      withdrawalReason: str(formData.get("withdrawalReason")) || null, startDate: d("startDate"), completionDate: d("completionDate"), gpa: optNum(formData.get("gpa")),
    },
    select: { programId: true },
  });
  revalidatePath(`/students/${studentId}`); revalidatePath("/students"); revalidatePath("/students/analytics"); revalidatePath(`/programs/${s.programId}/students`);
}

/** Put a student in a section of one course kind for their offering (0 = remove). */
export async function setStudentSection(studentId: string, formData: FormData): Promise<void> {
  const cohortId = str(formData.get("cohortId")), courseId = str(formData.get("courseId")), kind = str(formData.get("kind"));
  const sectionIndex = Math.round(numOr(formData.get("sectionIndex"), 0));
  if (!cohortId || !courseId || !kind) return;
  if (sectionIndex <= 0) await prisma.studentSection.deleteMany({ where: { studentId, cohortId, courseId, kind } });
  else await prisma.studentSection.upsert({ where: { studentId_cohortId_courseId_kind: { studentId, cohortId, courseId, kind } }, update: { sectionIndex }, create: { studentId, cohortId, courseId, kind, sectionIndex } });
  revalidatePath(`/students/${studentId}`);
}

/** Put a student on a clinical shift (a clinical session × section), optionally on a specific asset. */
export async function addStudentShift(studentId: string, formData: FormData): Promise<void> {
  const cohortId = str(formData.get("cohortId")), sessionId = str(formData.get("sessionId"));
  if (!cohortId || !sessionId) return;
  const sectionIndex = Math.max(1, Math.round(numOr(formData.get("sectionIndex"), 1)));
  const assetId = str(formData.get("assetId")) || null;
  await prisma.studentShift.upsert({ where: { studentId_cohortId_sessionId: { studentId, cohortId, sessionId } }, update: { sectionIndex, assetId, note: str(formData.get("note")) || null }, create: { studentId, cohortId, sessionId, sectionIndex, assetId, note: str(formData.get("note")) || null } });
  revalidatePath(`/students/${studentId}`);
}
export async function removeStudentShift(id: string, studentId: string): Promise<void> {
  await prisma.studentShift.delete({ where: { id } }).catch(() => undefined);
  revalidatePath(`/students/${studentId}`);
}
// ── The clinical log: what happened on each shift ───────────────────────────
const SHIFT_STATUSES = new Set(["scheduled", "completed", "absent", "excused"]);
/** Log one shift: completed (hours credited — the session length unless overridden), absent or excused
 *  (no hours), or back to scheduled. The preceptor recorded defaults to the section's assigned preceptor. */
export async function logStudentShift(shiftId: string, studentId: string, formData: FormData): Promise<void> {
  const status = str(formData.get("status"));
  if (!SHIFT_STATUSES.has(status)) return;
  const sh = await prisma.studentShift.findUnique({ where: { id: shiftId }, select: { cohortId: true, sessionId: true, sectionIndex: true, preceptorId: true, settingCode: true, asset: { select: { settingCode: true } }, session: { select: { lengthHours: true, rotationType: true, course: { select: { term: { select: { program: { select: { institutionId: true } } } } } } } } } });
  if (!sh) return;
  const hoursIn = formData.get("hours");
  const hours = status === "completed" ? (hoursIn == null || String(hoursIn).trim() === "" ? sh.session.lengthHours : Math.max(0, numOr(hoursIn, sh.session.lengthHours))) : status === "scheduled" ? null : 0;
  const preceptorIn = str(formData.get("preceptorId"));
  const preceptorId = preceptorIn || sh.preceptorId || (await prisma.sessionInstructor.findFirst({ where: { cohortId: sh.cohortId, sessionId: sh.sessionId, sectionIndex: sh.sectionIndex, role: "preceptor" }, select: { personId: true } }))?.personId || null;
  const settingCode = sh.settingCode ?? sh.asset?.settingCode ?? (sh.session.rotationType ? (await prisma.rotationSetting.findFirst({ where: { institutionId: sh.session.course.term.program.institutionId, rotationType: sh.session.rotationType }, select: { settingCode: true } }))?.settingCode ?? null : null);
  const dateIn = str(formData.get("date"));
  await prisma.studentShift.update({ where: { id: shiftId }, data: { status, hoursLogged: hours, preceptorId, settingCode, loggedAt: status === "scheduled" ? null : dateIn ? new Date(dateIn + "T00:00:00Z") : new Date(), note: str(formData.get("note")) || undefined } });
  revalidatePath(`/students/${studentId}`);
}

/** Log every still-scheduled shift dated on or before a date as completed (session hours, section preceptor)
 *  — for one learner, or for the whole offering when no studentId is given. */
export async function logShiftsThrough(cohortId: string, studentId: string | null, formData: FormData): Promise<void> {
  const through = str(formData.get("through")) || new Date().toISOString().slice(0, 10);
  const { sessionDatesForCohort } = await import("./queries");
  const { dates } = await sessionDatesForCohort(cohortId);
  const shifts = await prisma.studentShift.findMany({ where: { cohortId, status: "scheduled", ...(studentId ? { studentId } : {}) }, select: { id: true, sessionId: true, sectionIndex: true, preceptorId: true, session: { select: { lengthHours: true } } } });
  const preceptors = await prisma.sessionInstructor.findMany({ where: { cohortId, role: "preceptor" }, select: { sessionId: true, sectionIndex: true, personId: true } });
  const preceptorOf = new Map(preceptors.map((a) => [`${a.sessionId}#${a.sectionIndex}`, a.personId]));
  let n = 0;
  for (const sh of shifts) {
    const iso = dates.get(sh.sessionId);
    if (!iso || iso > through) continue;
    await prisma.studentShift.update({ where: { id: sh.id }, data: { status: "completed", hoursLogged: sh.session.lengthHours, loggedAt: new Date(iso + "T00:00:00Z"), preceptorId: sh.preceptorId ?? preceptorOf.get(`${sh.sessionId}#${sh.sectionIndex}`) ?? null } });
    n++;
  }
  const co = await prisma.cohort.findUnique({ where: { id: cohortId }, select: { programId: true } });
  if (studentId) revalidatePath(`/students/${studentId}`);
  if (co) revalidatePath(`/programs/${co.programId}/offerings/${cohortId}`);
  void n;
}

// ── Clinical rotations: build, save and pin ──────────────────────────────────
/** Build the rotation plan for one clinical course of an offering under the options in the form,
 *  and save it: every student's shift gets its asset (site + setting) and a preceptor at that site,
 *  and the seats are booked on the asset map so other cohorts see them taken. Pinned cells stay. */
export async function buildClinicalRotations(cohortId: string, courseId: string, _formData?: FormData): Promise<void> {
  void _formData;
  const { getRotationInput } = await import("./queries");
  const { buildRotationPlan } = await import("./rotations");
  const { AUTO_PLAN_NOTE } = await import("./scheduler");
  const r = await getRotationInput(cohortId, courseId);
  if (!r || !r.input) return;
  // The plan is built from the family's clinical set-up (directory) — nothing is configured here.
  const plan = buildRotationPlan(r.input);
  const note = `${AUTO_PLAN_NOTE} rotation`;
  const sessionIds = r.input.shifts.map((s) => s.sessionId);
  await prisma.assetBooking.deleteMany({ where: { cohortId, sessionId: { in: sessionIds }, note } });
  const secOf = new Map(r.input.students.map((s) => [s.id, s.sectionIndex]));
  for (let i = 0; i < plan.placements.length; i += 400) await prisma.assetBooking.createMany({ data: plan.placements.slice(i, i + 400).map((p) => ({ assetId: p.assetId, cohortId, sessionId: p.sessionId, sectionIndex: secOf.get(p.studentId) ?? 1, date: new Date(p.date + "T00:00:00Z"), block: p.block, students: 1, note })) });
  // Preceptors at each site, for shifts away from home (or unprecepted): dealt round-robin per site.
  const preceptors = await prisma.person.findMany({ where: { institutionId: r.co.program.institutionId, active: true, role: "preceptor", employerId: { in: [...new Set(plan.placements.map((p) => p.employerId))] } }, select: { id: true, employerId: true, title: true } });
  const disc = /Radiograph/i.test(r.co.program.name) ? /Radiolog|RT\(R\)|Radiograph|MRI/i : /Surgical/i.test(r.co.program.name) ? /Surg|OR |CST|CSFA|Operating/i : /./;
  const bySite = new Map<string, string[]>();
  for (const p of preceptors) if (p.employerId && disc.test(p.title ?? "")) { const l = bySite.get(p.employerId) ?? []; l.push(p.id); bySite.set(p.employerId, l); }
  const rr = new Map<string, number>();
  const current = new Map((await prisma.studentShift.findMany({ where: { cohortId, sessionId: { in: sessionIds } }, select: { id: true, studentId: true, sessionId: true, preceptorId: true, preceptor: { select: { employerId: true } } } })).map((s) => [`${s.studentId}|${s.sessionId}`, s]));
  // Group the writes by (asset, setting, preceptor) so a 1,300-shift plan is a few dozen statements, not 1,300.
  const groups = new Map<string, { assetId: string; settingCode: string; preceptorId: string | null; ids: string[] }>();
  const creates: { studentId: string; cohortId: string; sessionId: string; sectionIndex: number; assetId: string; settingCode: string; preceptorId: string | null }[] = [];
  for (const p of plan.placements) {
    const cur = current.get(`${p.studentId}|${p.sessionId}`);
    let preceptorId = cur?.preceptorId ?? null;
    if (!preceptorId || cur?.preceptor?.employerId !== p.employerId) { const pool = bySite.get(p.employerId) ?? []; if (pool.length) { const n = rr.get(p.employerId) ?? 0; preceptorId = pool[n % pool.length]; rr.set(p.employerId, n + 1); } }
    if (cur) { const k = `${p.assetId}|${p.settingCode}|${preceptorId ?? ""}`; const g = groups.get(k) ?? { assetId: p.assetId, settingCode: p.settingCode, preceptorId, ids: [] }; g.ids.push(cur.id); groups.set(k, g); }
    else creates.push({ studentId: p.studentId, cohortId, sessionId: p.sessionId, sectionIndex: secOf.get(p.studentId) ?? 1, assetId: p.assetId, settingCode: p.settingCode, preceptorId });
  }
  await prisma.$transaction([
    ...[...groups.values()].map((g) => prisma.studentShift.updateMany({ where: { id: { in: g.ids } }, data: { assetId: g.assetId, settingCode: g.settingCode, preceptorId: g.preceptorId } })),
    ...(creates.length ? [prisma.studentShift.createMany({ data: creates })] : []),
  ]);
  // Shifts the plan could not place lose any stale asset so the board shows them as open.
  const placedKeys = new Set(plan.placements.map((p) => `${p.studentId}|${p.sessionId}`));
  const stale = plan.unplaced.map((u) => current.get(`${u.studentId}|${u.sessionId}`)).filter((c): c is NonNullable<typeof c> => !!c && !placedKeys.has(`${c.studentId}|${c.sessionId}`)).map((c) => c.id);
  if (stale.length) await prisma.studentShift.updateMany({ where: { id: { in: stale } }, data: { assetId: null } });
  revalidatePath(`/programs/${r.co.program.id}/offerings/${cohortId}`);
}

/** Pin (or unpin) a student's shifts in one week to a service area, then rebuild the plan around it. */
export async function pinStudentWeek(cohortId: string, courseId: string, studentId: string, weekMonday: string, formData: FormData): Promise<void> {
  const area = str(formData.get("area")) || null;
  const { getRotationInput } = await import("./queries");
  const r = await getRotationInput(cohortId, courseId);
  if (!r || !r.input) return;
  const sessionIds = r.input.shifts.filter((s) => s.weekMonday === weekMonday).map((s) => s.sessionId);
  if (!sessionIds.length) return;
  for (const sessionId of sessionIds) {
    await prisma.studentShift.upsert({ where: { studentId_cohortId_sessionId: { studentId, cohortId, sessionId } }, update: { pinnedArea: area }, create: { studentId, cohortId, sessionId, sectionIndex: r.input.students.find((s) => s.id === studentId)?.sectionIndex ?? 1, pinnedArea: area } });
  }
  await buildClinicalRotations(cohortId, courseId);
}

/** Put the student on every clinical shift of a course, section = their seat's section. */
export async function addStudentShiftsForCourse(studentId: string, formData: FormData): Promise<void> {
  const cohortId = str(formData.get("cohortId")), courseId = str(formData.get("courseId"));
  if (!cohortId || !courseId) return;
  const sectionIndex = Math.max(1, Math.round(numOr(formData.get("sectionIndex"), 1)));
  const sessions = await prisma.session.findMany({ where: { courseId, kind: "CLINICAL" }, select: { id: true } });
  for (const s of sessions) await prisma.studentShift.upsert({ where: { studentId_cohortId_sessionId: { studentId, cohortId, sessionId: s.id } }, update: { sectionIndex }, create: { studentId, cohortId, sessionId: s.id, sectionIndex } });
  revalidatePath(`/students/${studentId}`);
}
