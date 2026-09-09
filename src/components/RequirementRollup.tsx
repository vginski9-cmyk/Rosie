import Link from "next/link";
import type { getProgramRequirementCoverage } from "@/lib/queries";
import { saveCourseRequirementPlan } from "@/lib/actions";
import { dec } from "@/lib/format";

// ON THE PROGRAM DESIGN PAGE: how the clinical sequence rolls up to the credentialing
// body's list. Course by course: the settings its students are in, the hours or cases it
// codes, the experiences it FIRST makes reachable, what is reachable in total by its end,
// and the program's pacing target per rule (explicit, or spread evenly across the courses
// that reach it) — ending in whether the sequence, as designed, can satisfy the list.
// Server component with a small per-course targets form.

type Cov = NonNullable<Awaited<ReturnType<typeof getProgramRequirementCoverage>>>;
const inp = "w-14 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px] tabular-nums";

export function RequirementRollup({ cov }: { cov: Cov }) {
  return (
    <div className="space-y-6">
      {cov.sets.map((set) => {
        const ru = set.rollup;
        const cases = set.kind === "cases";
        const counted = set.rules.filter((r) => r.min != null && r.key !== "simulation");
        return (
          <div key={set.id} className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-900">{set.name} <span className="font-normal text-slate-500">— {set.authority}</span></div>
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
                {counted.map((r) => <span key={r.key} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-700" title={r.notes ?? ""}>{r.label}: <strong className="tabular-nums">{r.min}</strong>{r.of != null ? ` of ${r.of}` : ""}</span>)}
              </div>
            </div>

            {/* Verdict on the sequence as designed */}
            <div className="flex flex-wrap gap-2 text-xs">
              {ru.unreachableRequired.length ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">⚠ required experiences no course can reach: {ru.unreachableRequired.map((i) => i.name).slice(0, 5).join(", ")}{ru.unreachableRequired.length > 5 ? ` +${ru.unreachableRequired.length - 5}` : ""}</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">✓ every required experience is reachable somewhere in the sequence</span>}
              {ru.endGaps.length > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">by the end of the sequence: {ru.endGaps.map((g) => `${g.label} ${g.reachable} of ${g.min}`).join(" · ")}</span>}
              {ru.unreachable.length > ru.unreachableRequired.length && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{ru.unreachable.length - ru.unreachableRequired.length} elective{ru.unreachable.length - ru.unreachableRequired.length === 1 ? "" : "s"} unreachable</span>}
              {ru.caseDesign && <span className={`rounded-full px-2 py-0.5 font-medium ${ru.caseDesign.planned >= ru.caseDesign.required ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>cases coded on the courses: {dec(ru.caseDesign.planned)} of {ru.caseDesign.required} required{ru.caseDesign.planned < ru.caseDesign.required ? ` — ${dec(ru.caseDesign.required - ru.caseDesign.planned)} short in the design` : ""}</span>}
            </div>

            {/* Course by course */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-1.5 text-left">Course (in sequence)</th><th className="min-w-[12rem] px-2 py-1.5 text-left">Settings · {cases ? "cases" : "hours"} per student</th><th className="min-w-[14rem] px-2 py-1.5 text-left">First reachable here</th>{counted.map((r) => <th key={r.key} className="px-2 py-1.5 text-right whitespace-nowrap" title={r.notes ?? ""}>{r.label}<span className="block font-normal normal-case text-slate-400">reachable · target by end</span></th>)}<th className="px-2 py-1.5"></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ru.courses.map((c) => (
                    <tr key={c.course.id} className="align-top">
                      <td className="px-3 py-1.5"><span className="font-medium text-slate-800">{c.course.code ?? c.course.name}</span><span className="block text-[10px] text-slate-400">{c.course.termName} · cumulative {cases ? `${dec(c.cumCases)} cases` : `${dec(c.cumHours, 1)} h`}</span></td>
                      <td className="min-w-[12rem] px-2 py-1.5"><span className="flex flex-wrap gap-1">{c.course.settings.map((s) => <span key={s} className="inline-block whitespace-nowrap rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-700">{s}{cases ? (c.course.cases[s] ? ` ${dec(c.course.cases[s])}` : "") : (c.course.hours[s] ? ` ${dec(c.course.hours[s], 1)}` : "")}</span>)}</span></td>
                      <td className="min-w-[14rem] px-2 py-1.5 text-slate-600">{c.newItems.length ? <>{c.newItems.filter((i) => i.mandatory).length} required · {c.newItems.filter((i) => !i.mandatory).length} elective<span className="block text-[10px] text-slate-400">{c.newItems.slice(0, 4).map((i) => i.name.replace(/ \(.*$/, "")).join(", ")}{c.newItems.length > 4 ? ` +${c.newItems.length - 4}` : ""}</span></> : <span className="text-slate-300">nothing new</span>}</td>
                      {c.rules.map((r) => (
                        <td key={r.key} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                          <span className={r.reachable >= r.min ? "text-emerald-700" : "text-slate-700"}>{r.reachable}</span>
                          <span className="text-slate-300"> · </span>
                          <input form={`plan-${c.course.id}`} name={`target_${r.key}`} defaultValue={r.explicit ? r.target : ""} placeholder={String(r.target)} className={inp + (r.targetOk ? "" : " border-rose-400 text-rose-700")} title={r.explicit ? `design target by the end of ${c.course.code ?? c.course.name}` : `auto-paced: ${r.target} by the end of this course (type a number to set your own)`} />
                          {!r.targetOk && <span className="block text-[10px] text-rose-600">above what is reachable</span>}
                        </td>
                      ))}
                      <td className="px-2 py-1.5"><form id={`plan-${c.course.id}`} action={saveCourseRequirementPlan.bind(null, c.course.id, cov.programId)}><button className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-white">save targets</button></form></td>
                    </tr>
                  ))}
                  {ru.courses.length === 0 && <tr><td colSpan={4 + counted.length} className="px-3 py-3 text-center text-slate-400">No clinical course codes hours or cases yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400">Reachable = experiences whose settings a student has been in by the end of that course. Targets are what a student should have logged by the end of each course; blank cells pace evenly, a target above what is reachable is flagged. The list and the sites that supply it are under <Link href={`/programs/${cov.programId}/clinical`} className="text-rose-600 hover:underline">Clinical sites &amp; requirements</Link>.</p>
          </div>
        );
      })}
    </div>
  );
}
