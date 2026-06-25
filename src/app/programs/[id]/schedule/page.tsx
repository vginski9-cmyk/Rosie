import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramSchedule } from "@/lib/queries";
import { ScheduleBoard, type TermTemplate, type RosterPerson } from "@/components/ScheduleBoard";
import type { ScheduleSession, SectionStudent } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function SchedulePage({ params }: { params: { id: string } }) {
  const data = await getProgramSchedule(params.id);
  if (!data) notFound();
  const { program, roster, students, defaultEnrollment } = data;

  const terms: TermTemplate[] = program.terms.map((t) => ({
    id: t.id,
    index: t.index,
    name: t.name,
    startDateISO: t.startDate ? t.startDate.toISOString().slice(0, 10) : null,
    weeks: t.startWeek != null && t.endWeek != null ? t.endWeek - t.startWeek + 1 : 16,
    sessions: t.courses.flatMap((c) =>
      c.sessions.map(
        (s): ScheduleSession => ({
          id: s.id,
          courseId: c.id,
          courseCode: c.code ?? c.name,
          courseName: c.name,
          kind: s.kind as "CLASS" | "LAB" | "CLINICAL",
          title: s.title,
          lengthHours: s.lengthHours,
          maxStudents: s.maxStudents,
          facultyNeeded: s.facultyNeeded,
          preceptorsNeeded: s.preceptorsNeeded,
          week: s.week,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          location: s.location,
          rotationType: s.rotationType,
          clinicalMode: s.clinicalMode,
          homework: s.homework,
          staff: s.instructors.map((si) => ({ personId: si.personId, name: si.person.name, role: si.role, contactHours: si.contactHours, segment: si.segment })),
        }),
      ),
    ),
  }));

  const rosterPeople: RosterPerson[] = roster.map((p) => ({ id: p.id, name: p.name, role: p.role, employerName: p.employer?.name ?? null }));
  const sectionStudents: SectionStudent[] = students.map((s) => ({ id: s.id, name: s.name, sectionIndex: s.sectionIndex, stageKey: s.stageKey, status: s.status, clinicalSite: s.clinicalSite }));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Calendar &amp; staffing</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The template, calendared out. Each session becomes the number of <strong>sections/shifts</strong> the cohort
          needs (sections = ROUNDUP(enrollment ÷ capacity)), laid out week-by-week and day-by-day with seeded staffing.
          <strong> Click any day or session</strong> to see what&apos;s covered, the homework, the instructors, and the named
          students in that section. Assign staff and <strong>set each instructor&apos;s contact hours per session</strong>
          (co-teaching splits — e.g. 2h + 1h on a 3h class); workload recomputes live. Use the <strong>Sections</strong> tab
          to merge under-filled sections. Edits are saved in this browser.
        </p>
      </div>
      <ScheduleBoard programId={program.id} terms={terms} roster={rosterPeople} students={sectionStudents} defaultEnrollment={defaultEnrollment} />
    </div>
  );
}
