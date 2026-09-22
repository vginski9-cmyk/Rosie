import { notFound } from "next/navigation";
import { getProgramFull } from "@/lib/queries";
import { ProgramDesigner, type DTerm } from "@/components/ProgramDesigner";
import { setProgramCalendarMode } from "@/lib/actions";
import { requirementLedger, supervisionBook, ruleBook } from "@/lib/requirementstore";

export const dynamic = "force-dynamic";

// DESIGN & SEQUENCE — the program template: the design at a glance (sessions, shifts and hours
// by kind), then terms, courses, every class, lab and clinical session with its capacity and
// staffing. What the credentialing body requires of the clinicals lives under Clinical sites &
// requirements.
export default async function StructureEditor({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? Math.max(0, ...program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ?? 40);
  // Structured requirements beside the structure (recommendation 1), the supervision rule each clinical session resolves to (5), and the settings the college knows (2).
  const [ledger, supervision, rules] = await Promise.all([requirementLedger(program.id), supervisionBook([program.id]), ruleBook(program.institutionId)]);
  const revisions = new Map((await (await import("@/lib/db")).prisma.supervisionRule.findMany({ where: { scope: "session", sessionId: { in: program.terms.flatMap((t) => t.courses.flatMap((c) => c.sessions.map((s) => s.id))) } }, select: { sessionId: true, revision: true } })).map((r) => [r.sessionId!, r.revision]));

  const terms: DTerm[] = program.terms.map((t) => ({
    id: t.id, name: t.name, index: t.index, semester: t.semester, startWeek: t.startWeek, endWeek: t.endWeek,
    courses: t.courses.map((c) => ({
      id: c.id, code: c.code, name: c.name, creditHours: c.creditHours,
      weeklyClassHours: c.weeklyClassHours, weeklyLabHours: c.weeklyLabHours, weeklyClinicalHours: c.weeklyClinicalHours,
      semesterOffered: c.semesterOffered, courseType: c.courseType, description: c.description, requisites: c.requisites,
      sessions: c.sessions.map((s) => ({
        id: s.id, kind: s.kind as "CLASS" | "LAB" | "CLINICAL", number: s.number, title: s.title,
        lengthHours: s.lengthHours, maxStudents: s.maxStudents, facultyNeeded: s.facultyNeeded, preceptorsNeeded: s.preceptorsNeeded, supportStaffNeeded: s.supportStaffNeeded,
        week: s.week, dayOfWeek: s.dayOfWeek, startTime: s.startTime, location: s.location,
        homework: s.homework, rotationType: s.rotationType, clinicalMode: s.clinicalMode,
        deliveryMode: s.deliveryMode, notes: s.notes,
        facultyContactPolicy: s.facultyContactPolicy, supportContactPolicy: s.supportContactPolicy, preceptorContactPolicy: s.preceptorContactPolicy,
        supervision: s.kind === "CLINICAL" && supervision.get(s.id) ? { ...supervision.get(s.id)!, revision: revisions.get(s.id) ?? 0, scope: "session" as const } : undefined,
      })),
    })),
  }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">The template every offering runs. Open a course to edit its sessions.</p>
        <form action={setProgramCalendarMode.bind(null, program.id)} className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Terms sit on the calendar</span>
          <select name="calendarMode" defaultValue={program.calendarMode} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" title="semester: each term ends with the college's semester. continuous: a continuing-education class runs its weeks straight from the day it starts, across semester boundaries.">
            <option value="semester">with the semester</option>
            <option value="continuous">straight through (continuing education)</option>
          </select>
          <button className="rounded-lg border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">Apply to planned offerings</button>
        </form>
      </div>
      <ProgramDesigner
        programId={program.id}
        programName={program.name}
        terms={terms}
        defaultEnrollment={defaultEnrollment}
        requirements={ledger.requirements}
        familyId={ledger.familyId}
        settings={[...rules.known].sort()}
        assumptions={{
          facContactHours: program.facContactHours, facWorkWeekHours: program.facWorkWeekHours, facTermWeeks: program.facTermWeeks,
          preContactHours: program.preContactHours, preWorkWeekHours: program.preWorkWeekHours, preTermWeeks: program.preTermWeeks,
        }}
      />

    </div>
  );
}
