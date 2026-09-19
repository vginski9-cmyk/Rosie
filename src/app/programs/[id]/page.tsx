import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull, getProgramOfferings } from "@/lib/queries";
import { duplicateProgram, deleteProgram, createOffering } from "@/lib/actions";
import { fmt } from "@/lib/format";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import { getCalendarProvenance } from "@/lib/queries";

export const dynamic = "force-dynamic";

// OVERVIEW — the offerings that run this program, and the design at a glance.
export default async function ProgramPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const offerings = await getProgramOfferings(params.id);
  const provenance = (await getCalendarProvenance(program.institutionId)).all;
  const northStar = program.yearTargets.find((t) => t.credentialTarget != null);
  const defaultEnrollment = Math.round(program.defaultCohortSeats ?? northStar?.cohortCapacity ?? 40);
  const STATUS: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400" };

  return (
    <div className="space-y-6">
      <ProvisionalDatesBanner provenance={provenance} />
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
                      <div className="mt-0.5 text-xs text-slate-500">{o.startDate ? `starts ${o.startDate.toISOString().slice(0, 10)}` : "no start date"} · {o.cohortTerms.length} of {program.terms.length} terms dated · {o._count.students} students · {o._count.sessionStaff} staffing rows (one person on one shift)</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[o.status] ?? "bg-slate-100 text-slate-600"}`}>{o.status}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200">enrolled <strong>{fmt.num(enrolled?.actualNumber ?? o._count.students)}</strong><span className="text-slate-400" title={fmt.calcTitle(enrolled?.targetNumber, fmt.atLeastPhrase(enrolled?.targetNumber))}> / {fmt.atLeastPhrase(enrolled?.targetNumber)} target</span></span>
                    <span className="rounded-full bg-slate-50 px-2 py-0.5 ring-1 ring-slate-200">productive <strong>{fmt.num(productive?.actualNumber)}</strong><span className="text-slate-400" title={fmt.calcTitle(productive?.targetNumber, fmt.atLeastPhrase(productive?.targetNumber))}> / {fmt.atLeastPhrase(productive?.targetNumber)} target</span></span>
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

      {/* Staffing and clinical placement for these offerings are read on Insights (the capacity model
          and the scheduler), not from the old launch-cadence plan — see docs/metrics-audit.md §1.4. */}
      <p className="text-xs text-slate-500">Instructors, preceptors and clinical placement for these offerings: <Link href="/insights/staffing-need" className="text-rose-700 hover:underline">Instructors &amp; preceptors needed</Link> · <Link href="/scheduler" className="text-rose-700 hover:underline">Clinical scheduler</Link> · <Link href="/insights/clinical-sites" className="text-rose-700 hover:underline">Clinical site capacity</Link>.</p>

      <p className="text-sm text-slate-500">The design — {program.terms.length} term{program.terms.length === 1 ? "" : "s"} · {program.terms.reduce((n, t) => n + t.courses.length, 0)} course{program.terms.reduce((n, t) => n + t.courses.length, 0) === 1 ? "" : "s"} — is under <Link href={`/programs/${program.id}/structure`} className="text-rose-700 hover:underline">Design &amp; sequence →</Link></p>
    </div>
  );
}
