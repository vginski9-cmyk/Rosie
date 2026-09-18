import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/queries";
import { CourseServicePanel, type PanelSession } from "@/components/CourseServicePanel";
import { dec } from "@/lib/format";

export const dynamic = "force-dynamic";


const HOUR_TILES = [
  { key: "creditHours", label: "Credit hours" },
  { key: "weeklyClassHours", label: "Class hrs / week" },
  { key: "weeklyLabHours", label: "Lab hrs / week" },
  { key: "weeklyClinicalHours", label: "Clinical hrs / week" },
] as const;

export default async function CoursePage({ params }: { params: { id: string } }) {
  const course = await getCourse(params.id);
  if (!course) notFound();
  const program = course.term.program;

  const plannedEnrollment =
    program.defaultCohortSeats ??
    Math.max(0, ...program.yearTargets.map((t) => t.cohortCapacity ?? 0)) ??
    40;

  const sessions: PanelSession[] = course.sessions.map((s) => ({
    id: s.id,
    number: s.number,
    kind: s.kind as "CLASS" | "LAB" | "CLINICAL",
    title: s.title,
    lengthHours: s.lengthHours,
    maxStudents: s.maxStudents,
    facultyNeeded: s.facultyNeeded,
    preceptorsNeeded: s.preceptorsNeeded,
    supportStaffNeeded: s.supportStaffNeeded,
    week: s.week,
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    location: s.location,
    rotationType: s.rotationType,
    clinicalMode: s.clinicalMode,
  }));

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* Header */}
      <div>
        <Link href={`/programs/${program.id}/structure`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {program.name} design &amp; sequence
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-sm font-semibold text-slate-400">{course.code}</div>
            <h1 className="mt-0.5 text-3xl font-semibold tracking-tight">{course.name}</h1>
            <p className="mt-1 text-sm text-slate-500">{program.institution.name} · {program.name} · {course.term.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {course.semesterOffered && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Offered: {course.semesterOffered}</span>}
            {course.courseType && <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700">{course.courseType.toLowerCase()}</span>}
            <Link href={`/programs/${program.id}/structure`} className="rounded-full bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700">Edit in designer →</Link>
          </div>
        </div>
      </div>

      {/* Hours / credits */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {HOUR_TILES.map((h) => (
          <div key={h.key} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{h.label}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
              {dec(course[h.key] ?? 0)}
            </div>
          </div>
        ))}
      </div>

      {/* Catalog narrative */}
      <div className="grid gap-6 lg:grid-cols-3">
        {course.description && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-2">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Course description</h2>
            <p className="text-[15px] leading-relaxed text-slate-700">{course.description}</p>
          </section>
        )}
        <section className="space-y-6">
          {course.requisites && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Requisites</h2>
              <p className="text-sm leading-relaxed text-slate-700">{course.requisites}</p>
            </div>
          )}
        </section>
      </div>

      {/* Session schedule + service requirements (interactive) */}
      <div>
        <h2 className="mb-1 text-xl font-semibold tracking-tight">Session-by-session schedule &amp; service requirements</h2>
        <p className="mb-4 text-sm text-slate-500">Every session one student attends, and the footprint it creates at cohort size.</p>
        {sessions.length > 0 ? (
          <CourseServicePanel sessions={sessions} defaultEnrollment={plannedEnrollment} />
        ) : (
          <p className="text-sm text-slate-400">No sessions defined for this course yet.</p>
        )}
      </div>
    </div>
  );
}
