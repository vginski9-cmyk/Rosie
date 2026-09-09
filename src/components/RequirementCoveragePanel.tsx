import Link from "next/link";
import type { getProgramRequirementCoverage } from "@/lib/queries";
import { dec } from "@/lib/format";

// On the program design page: what the credentialing body requires of every
// graduate, and whether THIS template's clinical courses touch each category —
// by the rotation settings its sessions are coded with. A category no course
// reaches is a design gap before it is ever a scheduling one.

type Cov = NonNullable<Awaited<ReturnType<typeof getProgramRequirementCoverage>>>;

export function RequirementCoveragePanel({ cov }: { cov: Cov }) {
  return (
    <div className="space-y-4">
      {cov.sets.map((set) => {
        const gapsAll = set.courseCoverage.filter((c) => c.uncovered);
        const gaps = gapsAll.filter((g) => (set.coverage.find((c) => c.category === g.category)?.mandatory ?? 0) > 0);
        const electiveGaps = gapsAll.filter((g) => !gaps.includes(g));
        const supplyGaps = set.uncovered;
        return (
          <div key={set.id} className="space-y-2">
            <div>
              <div className="text-sm font-semibold text-slate-900">{set.name} <span className="font-normal text-slate-500">— {set.authority}</span></div>
              <p className="mt-0.5 max-w-4xl text-xs text-slate-600">{set.summary}</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {set.rules.filter((r) => r.min != null).map((r) => <span key={r.key} className="rounded border border-slate-200 bg-white px-2 py-0.5 text-slate-700" title={r.notes ?? ""}>{r.label}: <strong className="tabular-nums">{r.min}</strong>{r.of != null ? ` of ${r.of}` : ""}</span>)}
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {gaps.length ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-medium text-rose-700">⚠ required, but no clinical course reaches: {gaps.map((g) => g.category).join(", ")}</span> : <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">✓ every required category is reached by a course</span>}
              {electiveGaps.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">elective only, not reached: {electiveGaps.map((g) => g.category).join(", ")}</span>}
              {supplyGaps.length ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">no secured / asked site for: {supplyGaps.join(", ")}</span> : null}
              {!set.verified && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">starter content from the public standard — verify in the directory</span>}
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-1.5 text-left">Category</th><th className="px-2 py-1.5 text-right">Items</th><th className="px-2 py-1.5 text-left">Settings</th><th className="px-2 py-1.5 text-left">Reached by (this template&apos;s clinical courses · hours or cases per student in the category&apos;s settings)</th><th className="px-2 py-1.5 text-left">Sites that can supply it</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {set.coverage.map((c) => { const cc = set.courseCoverage.find((x) => x.category === c.category)!; return (
                    <tr key={c.category} className={cc.uncovered ? (c.mandatory ? "bg-rose-50/40" : "bg-amber-50/40") : ""}>
                      <td className="px-3 py-1 font-medium text-slate-800">{c.category}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.mandatory ? <span className="font-semibold">{c.mandatory} req</span> : null}{c.mandatory && c.elective ? " · " : ""}{c.elective ? <span className="text-slate-500">{c.elective} elec</span> : null}</td>
                      <td className="px-2 py-1">{c.settings.map((s) => <span key={s} className="mr-1 rounded bg-slate-100 px-1 font-mono text-[10px]">{s}</span>)}{!c.settings.length && <span className="text-slate-300">—</span>}</td>
                      <td className="px-2 py-1">{c.settings.length === 0 ? <span className="text-slate-400">not a clinical setting</span> : cc.courses.length ? <>{cc.detail.map((d, i) => <span key={d.course}>{i ? ", " : ""}{d.course}{d.hours > 0 ? <span className="text-slate-400"> {dec(d.hours, 0)} h</span> : d.cases > 0 ? <span className="text-slate-400"> {dec(d.cases, 0)} cases</span> : null}</span>)}{cc.hours > 0 && <span className="ml-1 font-medium text-slate-700">= {dec(cc.hours, 0)} h</span>}{cc.hours <= 0 && cc.cases > 0 && <span className="ml-1 font-medium text-slate-700">= {dec(cc.cases, 0)} cases</span>}</> : <span className={`font-medium ${c.mandatory ? "text-rose-600" : "text-amber-700"}`}>{c.mandatory ? "⚠ " : ""}none — no course codes hours, cases or a rotation in these settings{c.mandatory ? "" : " (elective)"}</span>}</td>
                      <td className="px-2 py-1 text-slate-600">{c.settings.length === 0 ? "—" : c.verdict === "covered" ? `${c.sites.secured.length} secured · ${c.seatsSecured} seats/day` : c.verdict === "asked-only" ? <span className="text-amber-700">asked only ({c.sites.asked.length})</span> : <span className="text-rose-600">none</span>}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400">A course reaches a category when it codes hours or cases per student for a service area in one of the category&apos;s settings, or when one of its clinical sessions carries a rotation type mapped to such a setting — those are the numbers the rotation planner then places students against. Hours are shared evenly when a service area spans several settings. Edit the requirement set, the settings and the sites under <Link href={`/families/${cov.family.id}/clinical`} className="text-rose-600 hover:underline">Directory → Clinical → {cov.family.name}</Link>.</p>
          </div>
        );
      })}
    </div>
  );
}
