import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramSchedule } from "@/lib/queries";
import { ScheduleBoard, type TermTemplate, type RosterPerson } from "@/components/ScheduleBoard";
import type { ScheduleSession, SectionStudent } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export default async function SchedulePage({ params, searchParams }: { params: { id: string }; searchParams: { offering?: string } }) {
  const data = await getProgramSchedule(params.id, searchParams.offering);
  if (!data) notFound();
  const { program, offering, offerings, roster, students, termDates, sectionOverrides, defaultEnrollment } = data;

  const terms: TermTemplate[] = program.terms.map((t) => ({
    id: t.id,
    index: t.index,
    name: t.name,
    startDateISO: termDates[t.id] ?? null,
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar &amp; staffing</h1>
          {offerings.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">Offering:</span>
              {offerings.length === 1 ? (
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">{offering?.name}{offering?.startDate ? ` · starts ${offering.startDate.toISOString().slice(0, 10)}` : ""}</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {offerings.map((o) => (
                    <Link key={o.id} href={`/programs/${program.id}/schedule?offering=${o.id}`} className={`rounded-full px-3 py-1 font-medium ${o.id === offering?.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{o.name}</Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <p className="max-w-3xl text-sm text-slate-500">
          A <strong>scheduled offering</strong> of the timeless program template{offering?.startDate ? <>, anchored on this run&apos;s real term dates (starts {offering.startDate.toISOString().slice(0, 10)})</> : null}.
          Each session becomes the <strong>sections/shifts</strong> the cohort needs (= ROUNDUP(enrollment ÷ capacity)), laid out day-by-day with this offering&apos;s assigned instructors.
          <strong> Click any day or session</strong> for what&apos;s covered, homework, instructors, and the named students in that section. Assign staff and
          <strong> set each instructor&apos;s contact hours per session</strong> (co-teaching splits); workload recomputes live. Edits are saved in this browser.
        </p>
      </div>
      <ScheduleBoard programId={offering ? `${program.id}:${offering.id}` : program.id} terms={terms} roster={rosterPeople} students={sectionStudents} sectionOverrides={sectionOverrides} defaultEnrollment={defaultEnrollment} />
    </div>
  );
}
