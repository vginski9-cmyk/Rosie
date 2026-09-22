// A FULL COPY OF A PROGRAM TEMPLATE. Everything the template holds comes across: the program's
// identity and calendar (family, occupation, cadence, launch terms, seats, workload assumptions),
// its year targets and skills, every term, every course with its catalog fields and clinical
// requirements, every session with every workbook column (day, start and end time, section
// times, staffing counts and contact policies, rotation type, supervision model, experiences,
// progression, notes, homework), and each session's skills and resources. Offerings are not
// copied: a copy is a template to design against, and an offering is a record of a class that
// ran or will run — it belongs to the program that actually ran it. Used by the Duplicate button
// and by the seed, so both produce the same thing.

import type { PrismaClient } from "@prisma/client";

export async function copyProgram(client: PrismaClient, programId: string, opts: { name: string; status?: string }): Promise<{ id: string }> {
  const src = await client.program.findUnique({
    where: { id: programId },
    include: {
      yearTargets: true,
      programSkills: true,
      terms: { orderBy: { index: "asc" }, include: { courses: { orderBy: { sequenceOrder: "asc" }, include: { sessions: { orderBy: { number: "asc" }, include: { skillLinks: true, resources: { orderBy: { sortOrder: "asc" } } } }, courseSkills: true, clinicalRequirements: true } } } },
    },
  });
  if (!src) throw new Error(`copyProgram: no program ${programId}`);
  const copy = await client.program.create({
    data: {
      institutionId: src.institutionId, occupationId: src.occupationId, familyId: src.familyId,
      name: opts.name, programType: src.programType, credential: src.credential, serviceArea: src.serviceArea, inventoryNote: src.inventoryNote,
      status: opts.status ?? src.status, monthsToFullProductivity: src.monthsToFullProductivity,
      termSlots: src.termSlots, launchCadence: src.launchCadence, launchTerms: src.launchTerms, launchIntervalYears: src.launchIntervalYears, defaultCohortSeats: src.defaultCohortSeats, calendarMode: src.calendarMode,
      facContactHours: src.facContactHours, facWorkWeekHours: src.facWorkWeekHours, facTermWeeks: src.facTermWeeks, preContactHours: src.preContactHours, preWorkWeekHours: src.preWorkWeekHours, preTermWeeks: src.preTermWeeks,
      yearTargets: { create: src.yearTargets.map((t) => ({ year: t.year, credentialTarget: t.credentialTarget, cohortCapacity: t.cohortCapacity })) },
      programSkills: { create: src.programSkills.map((p) => ({ skillId: p.skillId, targetLevel: p.targetLevel, priority: p.priority, notes: p.notes })) },
    },
  });
  for (const t of src.terms) {
    const term = await client.term.create({ data: { programId: copy.id, index: t.index, name: t.name, semester: t.semester, startWeek: t.startWeek, endWeek: t.endWeek, startDate: t.startDate } });
    for (const c of t.courses) {
      await client.course.create({
        data: {
          termId: term.id, code: c.code, name: c.name, sequenceOrder: c.sequenceOrder,
          weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours,
          creditHours: c.creditHours, semesterOffered: c.semesterOffered, description: c.description, requisites: c.requisites, requirementPlan: c.requirementPlan, courseType: c.courseType,
          sessions: {
            create: c.sessions.map((s) => ({
              kind: s.kind, number: s.number, title: s.title, lengthHours: s.lengthHours, deliveryMode: s.deliveryMode, location: s.location,
              maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, supportStaffNeeded: s.supportStaffNeeded, preceptorsNeeded: s.preceptorsNeeded,
              week: s.week, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, sectionTimes: s.sectionTimes,
              rotationType: s.rotationType, experiences: s.experiences, progression: s.progression, clinicalMode: s.clinicalMode, notes: s.notes, homework: s.homework,
              facultyContactPolicy: s.facultyContactPolicy, supportContactPolicy: s.supportContactPolicy, preceptorContactPolicy: s.preceptorContactPolicy,
              skillLinks: { create: s.skillLinks.map((k) => ({ skillId: k.skillId, mode: k.mode, targetLevel: k.targetLevel })) },
              resources: { create: s.resources.map((r) => ({ kind: r.kind, title: r.title, url: r.url, detail: r.detail, estMinutes: r.estMinutes, sortOrder: r.sortOrder })) },
            })),
          },
          courseSkills: { create: c.courseSkills.map((cs) => ({ skillId: cs.skillId, targetLevel: cs.targetLevel, role: cs.role })) },
          clinicalRequirements: { create: c.clinicalRequirements.map((r) => ({ serviceAreaId: r.serviceAreaId, hoursPerStudent: r.hoursPerStudent, casesPerStudent: r.casesPerStudent, notes: r.notes })) },
        },
      });
    }
  }
  return { id: copy.id };
}
