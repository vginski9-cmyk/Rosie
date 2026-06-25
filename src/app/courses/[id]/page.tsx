import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/queries";
import { CourseServicePanel, type PanelSession } from "@/components/CourseServicePanel";

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

  // Planned staffing rollup (distinct instructors + co-teaching detection).
  const staffRoll = new Map<string, { name: string; hours: number; role: string }>();
  let coTaughtSessions = 0;
  for (const s of course.sessions) {
    if (s.instructors.length > 1) coTaughtSessions += 1;
    for (const si of s.instructors) {
      const cur = staffRoll.get(si.personId) ?? { name: si.person.name, hours: 0, role: si.role };
      cur.hours += si.contactHours;
      staffRoll.set(si.personId, cur);
    }
  }
  const plannedStaff = [...staffRoll.values()].sort((a, b) => b.hours - a.hours);

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* Header */}
      <div>
        <Link href={`/programs/${program.id}/flow`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {program.name} curriculum flow
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
          </div>
        </div>
      </div>

      {/* Hours / credits */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {HOUR_TILES.map((h) => (
          <div key={h.key} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{h.label}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
              {(course[h.key] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
            </div>
          </div>
        ))}
      </div>

      {/* Planned staffing (with co-teaching split contact hours) */}
      {plannedStaff.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Planned staffing</h2>
            {coTaughtSessions > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{coTaughtSessions} co-taught session{coTaughtSessions === 1 ? "" : "s"} (split contact hours)</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {plannedStaff.map((p) => (
              <span key={p.name} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5 text-sm ring-1 ring-slate-200">
                <span className="font-medium text-slate-800">{p.name}</span>
                <span className="text-[11px] capitalize text-slate-400">{p.role}</span>
                <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">{Math.round(p.hours)}h</span>
              </span>
            ))}
          </div>
        </section>
      )}

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
          {course.courseSkills.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Develops KSAs</h2>
              <div className="flex flex-wrap gap-2">
                {course.courseSkills.map((cs) => (
                  <Link key={cs.id} href={`/skills/${cs.skillId}`} className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100">
                    {cs.skill.name} → L{cs.targetLevel}{cs.role ? ` (${cs.role.toLowerCase()})` : ""}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Session schedule + service requirements (interactive) */}
      <div>
        <h2 className="mb-1 text-xl font-semibold tracking-tight">Session-by-session schedule &amp; service requirements</h2>
        <p className="mb-6 text-sm text-slate-500">
          Every session a single student is required to attend, and the delivery footprint it creates once scaled to the
          cohort. Drag the enrollment to watch the formulas recompute.
        </p>
        {sessions.length > 0 ? (
          <CourseServicePanel sessions={sessions} defaultEnrollment={plannedEnrollment} />
        ) : (
          <p className="text-sm text-slate-400">No sessions defined for this course yet.</p>
        )}
      </div>
    </div>
  );
}
