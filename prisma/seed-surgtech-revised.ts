// The second Sandhills Surgical Technology template: a full copy of the workbook's program with the
// meeting pattern the program stated (src/lib/surgtechrevision.ts). No offerings — it is the template
// to design against; the original keeps every class that ran or is planned.
import type { PrismaClient } from "@prisma/client";
import { copyProgram } from "../src/lib/programcopy";
import { reviseSurgTech, SURG_TECH_REVISED_NAME, type RevTerm } from "../src/lib/surgtechrevision";

export async function seedSurgTechRevised(prisma: PrismaClient, sourceProgramId: string): Promise<{ id: string; notes: string[] }> {
  const { id } = await copyProgram(prisma, sourceProgramId, { name: SURG_TECH_REVISED_NAME });
  const terms = await prisma.term.findMany({ where: { programId: id }, orderBy: { index: "asc" }, select: { id: true, index: true, startWeek: true, endWeek: true, courses: { orderBy: { sequenceOrder: "asc" }, select: { id: true, code: true, weeklyClassHours: true, weeklyLabHours: true, weeklyClinicalHours: true, sessions: { select: { id: true, kind: true, number: true, title: true, lengthHours: true, deliveryMode: true, location: true, maxStudents: true, facultyNeeded: true, supportStaffNeeded: true, preceptorsNeeded: true, week: true, dayOfWeek: true, startTime: true, endTime: true, sectionTimes: true, rotationType: true, experiences: true, progression: true, clinicalMode: true, notes: true, homework: true, facultyContactPolicy: true, supportContactPolicy: true, preceptorContactPolicy: true } } } } } });
  const termIdOf = new Map(terms.map((t) => [t.index, t.id]));
  const courseIdOf = new Map(terms.flatMap((t) => t.courses.map((c) => [c.code ?? "", c.id] as const)));
  const input: RevTerm[] = terms.map((t) => ({ index: t.index, startWeek: t.startWeek, endWeek: t.endWeek, courses: t.courses.map((c) => ({ code: c.code, weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours, sessions: c.sessions.map(({ id: _id, ...s }) => s) })) }));
  const rev = reviseSurgTech(input);
  for (const t of rev.terms) for (const [order, c] of t.courses.entries()) {
    const courseId = courseIdOf.get(c.code ?? ""); if (!courseId) continue;
    await prisma.session.deleteMany({ where: { courseId } });
    await prisma.session.createMany({ data: c.sessions.map((s) => ({ ...s, courseId })) });
    await prisma.course.update({ where: { id: courseId }, data: { termId: termIdOf.get(t.index)!, sequenceOrder: order, weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours } });
  }
  return { id, notes: rev.notes };
}
