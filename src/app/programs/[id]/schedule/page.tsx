import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramSchedule } from "@/lib/queries";
import { ScheduleBoard, type TermTemplate, type RosterPerson } from "@/components/ScheduleBoard";
import type { ScheduleSession } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function SchedulePage({ params }: { params: { id: string } }) {
  const data = await getProgramSchedule(params.id);
  if (!data) notFound();
  const { program, roster, defaultEnrollment } = data;

  const terms: TermTemplate[] = program.terms.map((t) => ({
    id: t.id,
    index: t.index,
    name: t.name,
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
          location: s.location,
          rotationType: s.rotationType,
          clinicalMode: s.clinicalMode,
        }),
      ),
    ),
  }));

  const rosterPeople: RosterPerson[] = roster.map((p) => ({ id: p.id, name: p.name, role: p.role, employerName: p.employer?.name ?? null }));

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Calendar &amp; staffing</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The template, calendared out. Each session becomes the number of <strong>sections/shifts</strong> the cohort
          needs (sections = ROUNDUP(enrollment ÷ capacity)), laid out week-by-week and day-by-day. Assign an instructor to
          each class/lab shift and a preceptor to each clinical shift — it&apos;s live, right here in the browser.
        </p>
      </div>
      <ScheduleBoard terms={terms} roster={rosterPeople} defaultEnrollment={defaultEnrollment} />
    </div>
  );
}
