import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull, getProgramBottleneck, getProgramOfferings } from "@/lib/queries";
import { fmt } from "@/lib/format";
import { duplicateProgram, deleteProgram, createOffering } from "@/lib/actions";

export const dynamic = "force-dynamic";

// OVERVIEW — the offerings that run this program, and the design at a glance.
export default async function ProgramPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const [offerings, bottleneck] = await Promise.all([getProgramOfferings(params.id), getProgramBottleneck(params.id)]);
  const northStar = program.yearTargets.find((t) => t.credentialTarget != null);
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? northStar?.cohortCapacity ?? 40);
  const STATUS: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400" };

  return (
    <div className="space-y-6">
      {/* Offerings */}
      <section className="card card-pad space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Offerings <span className="text-sm font-normal text-slate-400">— each run of this program for a real cohort, with dates, rooms, staff and students</span></h2>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/programs/${program.id}/export?enrollment=${defaultEnrollment}`} className="btn-ghost text-xs">Export Excel ↓</a>
            <form action={duplicateProgram.bind(null, program.id)}><button className="btn-ghost text-xs">Duplicate program</button></form>
            <form action={deleteProgram.bind(null, program.id)}><button className="btn-ghost text-xs text-rose-600">Delete program</button></form>
          </div>
        </div>
        {offerings.length === 0 ? (
          <p className="text-sm text-slate-400">No offerings yet — create one below.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {offerings.map((o) => {
              const enrolled = o.stages.find((s) => s.stageKey === "enrolled");
              const productive = o.stages.find((s) => s.stageKey === "productive");
              return (
                <div key={o.id} className="rounded-xl border border-slate-200 p-4 hover:border-rose-300">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/programs/${program.id}/offerings/${o.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{o.name} →</Link>
                      <div className="mt-0.5 text-xs text-slate-500">{o.startDate ? `starts ${o.startDate.toISOString().slice(0, 10)}` : "no start date"} · {o.cohortTerms.length} of {program.terms.length} terms dated · {o._count.students} students · {o._count.sessionStaff} staff assignments</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[o.status] ?? "bg-slate-100 text-slate-600"}`}>{o.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200">enrolled <strong>{Math.round(enrolled?.actualNumber ?? o._count.students)}</strong><span className="text-slate-400"> / {enrolled?.targetNumber != null ? Math.round(enrolled.targetNumber) : "—"} target</span></span>
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200">productive <strong>{productive?.actualNumber != null ? Math.round(productive.actualNumber) : "—"}</strong><span className="text-slate-400"> / {productive?.targetNumber != null ? Math.round(productive.targetNumber) : "—"} target</span></span>
                    <a href={`/api/offerings/${o.id}/rotations`} className="ml-auto rounded-full border border-slate-200 px-2 py-0.5 text-slate-600 hover:bg-slate-50" title="every clinical course's rotation schedule as a workbook">clinical rotations ↓</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <form action={createOffering.bind(null, program.id)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">New offering</span><input name="name" required placeholder="e.g. Class of 2029" className="input-sm w-56" /></label>
          <label className="block"><span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">Start date</span><input name="startDate" type="date" className="input-sm w-40" /></label>
          <button className="btn-primary text-sm">+ Create offering</button>
        </form>
      </section>

      {bottleneck?.hasBottleneck && (
        <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200">
          ⚠ <strong>{bottleneck.bottleneckCount}</strong> capacity bottleneck{bottleneck.bottleneckCount === 1 ? "" : "s"} across the offerings — peak need {fmt.fte(bottleneck.peak.facultyFte)} faculty FTE and {fmt.num(bottleneck.peak.clinicalSlots)} clinical rotations against {fmt.fte(bottleneck.supply.facultyFte)} FTE and {fmt.num(bottleneck.supply.wblSlots)} hosted. Work it on each offering.
        </div>
      )}

      {/* Design at a glance */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Design at a glance <span className="text-sm font-normal text-slate-400">— {program.terms.length} terms · {program.terms.reduce((n, t) => n + t.courses.length, 0)} courses</span></h2>
          <Link href={`/programs/${program.id}/structure`} className="text-sm text-rose-700 hover:underline">Edit design &amp; sequence →</Link>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {program.terms.map((term) => (
            <div key={term.id} className="card p-4">
              <div className="flex items-center justify-between"><h3 className="font-semibold">{term.name}</h3><span className="text-xs text-slate-400">weeks {term.startWeek}–{term.endWeek}</span></div>
              <div className="mt-2 divide-y divide-slate-100">
                {term.courses.map((course) => {
                  const counts = { CLASS: 0, LAB: 0, CLINICAL: 0 } as Record<string, number>;
                  course.sessions.forEach((s) => (counts[s.kind] += 1));
                  return (
                    <Link key={course.id} href={`/courses/${course.id}`} className="flex items-center justify-between gap-2 py-1.5 text-sm hover:text-rose-700">
                      <span className="min-w-0 truncate"><span className="text-slate-400">{course.code ?? ""}</span> {course.name}</span>
                      <span className="flex shrink-0 gap-1 text-[10px]">
                        {counts.CLASS > 0 && <span className="rounded bg-sky-100 px-1 text-sky-700">{counts.CLASS} class</span>}
                        {counts.LAB > 0 && <span className="rounded bg-violet-100 px-1 text-violet-700">{counts.LAB} lab</span>}
                        {counts.CLINICAL > 0 && <span className="rounded bg-rose-100 px-1 text-rose-700">{counts.CLINICAL} clinical</span>}
                      </span>
                    </Link>
                  );
                })}
                {term.courses.length === 0 && <p className="py-1.5 text-xs text-slate-400">No courses yet.</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
