import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull, getProgramArchetype, getProgramBottleneck, getProgramOfferings } from "@/lib/queries";
import { fmt } from "@/lib/format";
import { duplicateProgram, deleteProgram, createOffering } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function ProgramPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const [archetype, offerings, bottleneck] = await Promise.all([
    getProgramArchetype(params.id),
    getProgramOfferings(params.id),
    getProgramBottleneck(params.id),
  ]);

  const cohort = program.cohorts[0];
  const northStar = program.yearTargets.find((t) => t.credentialTarget != null);
  const defaultEnrollment = Math.round(northStar?.cohortCapacity ?? 40);
  const totalSessions = archetype.reduce((n, t) => n + t.courses.reduce((m, c) => m + c.sessions.length, 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-xs text-slate-400">
          This is the <strong>program template</strong> — the timeless structure (terms, courses, sessions). A
          <strong> scheduled offering</strong> below instantiates it for a cohort with real dates, instructors, and students.
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/programs/${program.id}/export?enrollment=${defaultEnrollment}`} className="btn-ghost">Export Excel ↓</a>
          <form action={duplicateProgram.bind(null, program.id)}><button className="btn-ghost">Duplicate</button></form>
          <form action={deleteProgram.bind(null, program.id)}><button className="btn-ghost text-rose-600">Delete</button></form>
        </div>
      </div>

      {/* Scheduled offerings (instantiations of the template) — with target vs actual */}
      <section className="card card-pad space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Scheduled offerings <span className="text-sm font-normal text-slate-400">— runs of this template, and how each performs against its targets</span></h2>
          <span className="text-xs text-slate-400">{offerings.length} offering{offerings.length === 1 ? "" : "s"}</span>
        </div>
        {offerings.length === 0 ? (
          <p className="text-sm text-slate-400">No offerings yet. A cohort with a start date becomes a scheduled run of this template.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {offerings.map((o) => {
              const STATUS: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400" };
              const stage = (k: string) => o.stages.find((s) => s.stageKey === k);
              const enrolled = stage("enrolled");
              const productive = stage("productive");
              const chip = (label: string, target: number | null | undefined, actual: number | null | undefined) => {
                const t = target != null ? Math.round(target) : null;
                const a = actual != null ? Math.round(actual) : null;
                const cls = a == null || t == null || t === 0 ? "text-slate-500" : a >= t ? "text-emerald-700" : a >= 0.85 * t ? "text-amber-700" : "text-rose-700";
                return (
                  <span key={label} className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] ring-1 ring-slate-200">
                    {label}: <strong className={cls}>{a ?? "—"}</strong><span className="text-slate-400"> / {t ?? "—"} target</span>
                  </span>
                );
              };
              return (
                <div key={o.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/programs/${program.id}/offerings/${o.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{o.name}</Link>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {o.startDate ? `starts ${o.startDate.toISOString().slice(0, 10)}` : "no start date"} · {o.cohortTerms.length} scheduled term{o.cohortTerms.length === 1 ? "" : "s"} · {o._count.students} students · {o._count.sessionStaff} staff assignments
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[o.status] ?? "bg-slate-100 text-slate-600"}`}>{o.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {chip("Enrolled", enrolled?.targetNumber, enrolled?.actualNumber ?? o._count.students)}
                    {chip("Productive", productive?.targetNumber, productive?.actualNumber)}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/programs/${program.id}/offerings/${o.id}`} className="btn-ghost text-xs">Schedule, staffing &amp; WBL ↦</Link>
                    <Link href={`/programs/${program.id}/students`} className="btn-ghost text-xs">Students ↦</Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {/* Spin up a new offering from this template */}
        <form action={createOffering.bind(null, program.id)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">New offering name</span>
            <input name="name" required placeholder="e.g. Fall 2026 cohort" className="input-sm w-56" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Start date</span>
            <input name="startDate" type="date" className="input-sm w-40" />
          </label>
          <button className="btn-primary text-sm">+ Create offering from template</button>
          <span className="pb-1.5 text-[11px] text-slate-400">generates each term&apos;s real dates from the template&apos;s week spans</span>
        </form>
      </section>

      {bottleneck?.hasBottleneck && (
        <div className="block rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
          ⚠ <strong>{bottleneck.bottleneckCount}</strong> capacity bottleneck{bottleneck.bottleneckCount === 1 ? "" : "s"} across the multi-cohort plan —
          peak need {fmt.fte(bottleneck.peak.facultyFte)} faculty FTE / {fmt.num(bottleneck.peak.clinicalSlots)} clinical rotations vs. supply of {fmt.fte(bottleneck.supply.facultyFte)} FTE / {fmt.num(bottleneck.supply.wblSlots)} hosted. Work it on each offering&apos;s schedule.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="North Star" value={fmt.num(northStar?.credentialTarget)} sub="grads / yr (regional need)" />
        <Kpi label="Cohort capacity needed" value={fmt.num(northStar?.cohortCapacity)} sub="seats to hit goal" />
        <Kpi label="Terms in sequence" value={fmt.num(program.terms.length)} />
        <Kpi label="Sessions / student" value={fmt.num(totalSessions)} sub="across the whole sequence" />
      </div>

      {/* Program structure (read-only overview; edit on the structure page) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Program structure</h2>
          <Link href={`/programs/${program.id}/structure`} className="text-sm text-rose-700 hover:underline">Edit design &amp; sequence →</Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {program.terms.map((term) => (
            <div key={term.id} className="card card-pad">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{term.name}</h3>
                <span className="text-xs text-slate-400">weeks {term.startWeek}–{term.endWeek}</span>
              </div>
              <div className="mt-3 space-y-3">
                {term.courses.map((course) => {
                  const counts = { CLASS: 0, LAB: 0, CLINICAL: 0 } as Record<string, number>;
                  course.sessions.forEach((s) => (counts[s.kind] += 1));
                  return (
                    <Link key={course.id} href={`/courses/${course.id}`} className="block rounded-lg border border-slate-100 bg-slate-50/50 p-3 transition-colors hover:bg-slate-100">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">
                          {course.code ? <span className="text-slate-400">{course.code} · </span> : null}{course.name}
                        </div>
                        <div className="flex gap-1">
                          {counts.CLASS > 0 && <span className="badge bg-sky-100 text-sky-700">{counts.CLASS} class sessions</span>}
                          {counts.LAB > 0 && <span className="badge bg-violet-100 text-violet-700">{counts.LAB} lab sessions</span>}
                          {counts.CLINICAL > 0 && <span className="badge bg-rose-100 text-rose-700">{counts.CLINICAL} clinical sessions</span>}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {course.weeklyClassHours}h class · {course.weeklyLabHours}h lab · {course.weeklyClinicalHours}h clinical / wk
                      </div>
                    </Link>
                  );
                })}
                {term.courses.length === 0 && <p className="text-xs text-slate-400">No courses yet.</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card card-pad">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
