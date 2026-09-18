import { notFound } from "next/navigation";
import { getProgramFull } from "@/lib/queries";
import { ProgramDesigner, type DTerm } from "@/components/ProgramDesigner";

export const dynamic = "force-dynamic";

// DESIGN & SEQUENCE — the program template: the design at a glance (sessions, shifts and hours
// by kind), then terms, courses, every class, lab and clinical session with its capacity and
// staffing. What the credentialing body requires of the clinicals lives under Clinical sites &
// requirements.
export default async function StructureEditor({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? Math.max(0, ...program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ?? 40);

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
      })),
    })),
  }));
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">The template every offering runs: terms, courses, and each class, lab and clinical session with its length, capacity and staffing. Open a course to edit its sessions.</p>

      <ProgramDesigner
        programId={program.id}
        programName={program.name}
        terms={terms}
        defaultEnrollment={defaultEnrollment}
        assumptions={{
          facContactHours: program.facContactHours, facWorkWeekHours: program.facWorkWeekHours, facTermWeeks: program.facTermWeeks,
          preContactHours: program.preContactHours, preWorkWeekHours: program.preWorkWeekHours, preTermWeeks: program.preTermWeeks,
        }}
      />

    </div>
  );
}
