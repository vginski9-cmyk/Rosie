import Link from "next/link";
import type { getCohortRequirementProgress } from "@/lib/queries";

// ONE OFFERING against the credentialing body's list: every student on every rule, and
// what the cohort still needs — each experience with how many students lack it and the
// secured sites that provide it — which is the demand the rotation plan is built to serve.
// Server component.

type Data = NonNullable<Awaited<ReturnType<typeof getCohortRequirementProgress>>>;

export function CohortRequirementProgress({ data, base }: { data: Data; base: string }) {
  const programBase = base.replace(/\/offerings\/.*$/, "");
  return (
    <div className="space-y-6">
      {data.sets.map((set) => {
        const cases = set.kind === "cases";
        return (
          <div key={set.id} className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-sm font-semibold text-slate-900">{set.name}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{set.complete} of {data.students} students complete</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{set.itemDemand.filter((d) => d.item.mandatory).length} required experience{set.itemDemand.filter((d) => d.item.mandatory).length === 1 ? "" : "s"} still open for someone</span>
              {!set.verified && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">starter content — verify the list</span>}
            </div>

            {/* Students × rules */}
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Student</th>{set.ruleKeys.map((r) => <th key={r.key} className="px-2 py-1.5 text-right whitespace-nowrap" title={r.label}>{r.label}{r.min != null ? <span className="block font-normal normal-case text-slate-400">min {r.min}</span> : r.max != null ? <span className="block font-normal normal-case text-slate-400">max {r.max}</span> : null}</th>)}<th className="px-2 py-1.5 text-right">Missing req.</th><th className="px-2 py-1.5 text-right">Logged</th><th className="px-2 py-1.5 text-left">Standing</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {set.students.map((s) => (
                    <tr key={s.id} className={s.complete ? "bg-emerald-50/30" : ""}>
                      <td className="px-3 py-1 whitespace-nowrap"><Link href={`/students/${s.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link><span className="ml-1 text-[10px] text-slate-400">#{s.seat}</span></td>
                      {set.ruleKeys.map((rk) => { const r = s.rules.find((x) => x.key === rk.key); if (!r) return <td key={rk.key} />; return <td key={rk.key} className={`px-2 py-1 text-right tabular-nums ${r.ok ? (r.min != null && r.have >= r.min ? "text-emerald-700" : "text-slate-600") : "font-semibold text-rose-600"}`} title={r.note ?? ""}>{r.have}</td>; })}
                      <td className={`px-2 py-1 text-right tabular-nums ${s.missingRequired ? "text-rose-600" : "text-emerald-700"}`}>{s.missingRequired}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-slate-500">{s.logged}</td>
                      <td className="px-2 py-1"><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${s.complete ? "bg-emerald-100 text-emerald-700" : s.pct >= 0.5 ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>{s.complete ? "complete" : `${Math.round(s.pct * 100)}%`}</span></td>
                    </tr>
                  ))}
                  {set.students.length === 0 && <tr><td colSpan={set.ruleKeys.length + 4} className="px-3 py-3 text-center text-slate-400">No enrolled students.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* What the cohort still needs — and where it can be had */}
            {set.itemDemand.length > 0 && (
              <div className="grid gap-3 lg:grid-cols-[1.7fr_1fr]">
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="min-w-[16rem] px-3 py-1.5 text-left">Experience the cohort still needs</th><th className="px-2 py-1.5 text-right">Students</th><th className="px-2 py-1.5 text-left">Secured sites that provide it</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {set.itemDemand.slice(0, 40).map((d) => (
                        <tr key={d.item.id} className={d.providers.length === 0 ? "bg-rose-50/40" : ""}>
                          <td className="min-w-[16rem] px-3 py-1"><span className={d.item.mandatory ? "font-medium text-slate-800" : "text-slate-600"}>{d.item.name}</span><span className="ml-1 whitespace-nowrap text-[10px] text-slate-400">{d.category} · {d.item.mandatory ? "required" : "elective"}</span></td>
                          <td className="px-2 py-1 text-right tabular-nums">{d.missing}</td>
                          <td className="px-2 py-1 text-slate-600">{d.providers.length ? d.providers.slice(0, 4).map((p) => <span key={p.employerId} className="mr-1.5 whitespace-nowrap"><span className={p.basis === "verified" ? "text-emerald-700" : p.basis === "estimate" ? "text-amber-700" : "text-slate-400"}>{p.basis === "verified" ? "✓" : p.basis === "estimate" ? "≈" : "?"}</span>{p.name.replace(/ — .*$/, "").replace(/ & .*$/, "").slice(0, 22)}{p.annualVolume != null ? <span className="text-slate-400"> {p.annualVolume}/yr</span> : null}</span>).concat(d.providers.length > 4 ? [<span key="more" className="text-slate-400">+{d.providers.length - 4}</span>] : []) : <span className="text-rose-600">{d.asked ? `only ${d.asked} asked site${d.asked === 1 ? "" : "s"}` : "nobody — needs an agreement or a site confirmation"}</span>}</td>
                        </tr>
                      ))}
                      {set.itemDemand.length > 40 && <tr><td colSpan={3} className="px-3 py-1 text-[10px] text-slate-400">+{set.itemDemand.length - 40} more</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Where the outstanding requirements can be met</div>
                  <p className="text-[11px] text-slate-500">Sites by how many outstanding student-experiences they can serve.</p>
                  <ul className="mt-2 space-y-1">
                    {set.sites.slice(0, 8).map((s) => (
                      <li key={s.employerId} className="flex items-baseline justify-between gap-2">
                        <Link href={`${programBase}/clinical/sites/${s.employerId}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link>
                        <span className="whitespace-nowrap tabular-nums text-slate-600"><span className="text-rose-700">{s.required}</span> required · {s.studentItems} student-experiences</span>
                      </li>
                    ))}
                    {set.sites.length === 0 && <li className="text-slate-400">No secured site provides what is outstanding.</li>}
                  </ul>
                  <div className="mt-3 flex flex-wrap gap-2"><a href={`${base}#rotations`} className="rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-700">Build the rotation plan from this ↓</a><Link href={`${programBase}/clinical`} className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50">Clinical sites &amp; requirements →</Link></div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
