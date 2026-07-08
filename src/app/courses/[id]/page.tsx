import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/queries";
import { addSessionResource, deleteSessionResource } from "@/lib/actions";
import { CourseServicePanel, type PanelSession } from "@/components/CourseServicePanel";

export const dynamic = "force-dynamic";

const RES_KINDS = ["HOMEWORK", "ASSIGNMENT", "READING", "VIDEO", "PRACTICE", "MATERIAL"];
const RES_META: Record<string, { label: string; badge: string }> = {
  HOMEWORK: { label: "Homework", badge: "bg-rose-100 text-rose-700" },
  ASSIGNMENT: { label: "Outside assignment", badge: "bg-orange-100 text-orange-700" },
  READING: { label: "Reading", badge: "bg-sky-100 text-sky-700" },
  VIDEO: { label: "Watch", badge: "bg-violet-100 text-violet-700" },
  PRACTICE: { label: "Practice", badge: "bg-emerald-100 text-emerald-700" },
  MATERIAL: { label: "Material", badge: "bg-slate-100 text-slate-600" },
};
const KIND_DOT: Record<string, string> = { CLASS: "bg-sky-500", LAB: "bg-violet-500", CLINICAL: "bg-rose-500" };

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
    <div className="mx-auto max-w-6xl space-y-10">
      {/* Header */}
      <div>
        <Link href={`/programs/${program.id}/structure`} className="text-sm text-slate-500 hover:text-slate-700">
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
              {(course[h.key] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}
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

      {/* Course planning — learning resources per session */}
      <div>
        <h2 className="mb-1 text-xl font-semibold tracking-tight">Course planning — learning resources</h2>
        <p className="mb-6 text-sm text-slate-500">
          For each session, what students should <strong>read, watch, practice</strong> or hand in — homework, outside
          assignments, readings, and materials. These show up on the student&apos;s schedule.
        </p>
        <div className="space-y-4">
          {course.sessions.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${KIND_DOT[s.kind] ?? "bg-slate-400"}`} />
                <span className="text-sm font-semibold text-slate-800">{s.kind} {s.number}{s.title ? ` · ${s.title}` : ""}</span>
                <span className="text-[11px] text-slate-400">{s.resources.length} resource{s.resources.length === 1 ? "" : "s"}</span>
              </div>

              {s.homework && <p className="mt-1 text-[12px] text-slate-500"><span className="font-medium text-slate-600">Quick note:</span> {s.homework}</p>}

              {s.resources.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {s.resources.map((r) => (
                    <li key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-1.5 text-[13px]">
                      <div>
                        <span className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${RES_META[r.kind]?.badge ?? "bg-slate-100 text-slate-600"}`}>{RES_META[r.kind]?.label ?? r.kind}</span>
                        {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium text-rose-700 hover:underline">{r.title}</a> : <span className="font-medium text-slate-800">{r.title}</span>}
                        {r.estMinutes != null && <span className="ml-2 text-[11px] text-slate-400">~{r.estMinutes} min</span>}
                        {r.detail && <span className="block text-[11px] text-slate-400">{r.detail}</span>}
                      </div>
                      <form action={deleteSessionResource.bind(null, r.id, course.id)}>
                        <button className="px-1 text-[11px] text-slate-300 hover:text-rose-600" title="remove">✕</button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}

              <form action={addSessionResource.bind(null, s.id, course.id, program.id)} className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
                <select name="kind" defaultValue="READING" className="rounded-lg border border-slate-300 px-2 py-1 text-sm">
                  {RES_KINDS.map((k) => <option key={k} value={k}>{RES_META[k].label}</option>)}
                </select>
                <input name="title" required placeholder="title (e.g. Bontrager ch. 4)" className="w-56 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <input name="url" placeholder="link (optional)" className="w-44 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <input name="estMinutes" type="number" min={0} placeholder="min" className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums" />
                <input name="detail" placeholder="note (optional)" className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900">+ Add</button>
              </form>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
