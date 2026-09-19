import Link from "next/link";
import { getScenarioHub } from "@/lib/executive";
import { fmt } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// SCENARIOS — expansion planning as a primary workflow (Phase 13). Every program, the target it is
// measured against, and its saved scenarios: feasible or not, what binds, what it adds, what it costs.
// The studio for one program (design, evaluate, trace) is /programs/[id]/expand.

const money = (v: number | null | undefined) => (v == null ? "—" : `$${fmt.num(v)}`);
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const STATUS_CHIP: Record<string, string> = { recommended: "bg-emerald-100 text-emerald-800", draft: "bg-slate-100 text-slate-600", archived: "bg-slate-100 text-slate-400" };

export default async function ScenariosPage() {
  const hub = await getScenarioHub();
  return (
    <div className="space-y-6">
      <PageHeader title={<>Scenarios — expansion planning</>} lede={<>For each program: can it meet the target, what binds first, and which investment would expand it at what cost.</>} meta={<>{fmt.num(hub.totals.programs)} programs · {fmt.num(hub.totals.scenarios)} scenarios saved · {fmt.num(hub.totals.evaluated)} evaluated · {fmt.num(hub.totals.recommended)} recommended</>} />

      {hub.institutions.map((inst) => (
        <section key={inst.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-gradient-to-br from-rose-50/60 to-white px-5 py-3"><h2 className="text-lg font-semibold text-slate-900">{inst.name}</h2></div>
          <div className="divide-y divide-slate-100">
            {inst.programs.map((p) => {
              const t = p.target;
              const live = p.scenarios.filter((s) => s.status !== "archived");
              return (
                <div key={p.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <Link href={`/programs/${p.id}/expand`} className="text-base font-semibold text-slate-800 hover:text-rose-700 hover:underline">{p.name} →</Link>
                      <span className="ml-2 text-xs text-slate-500">{p.job}</span>
                    </div>
                    <div className="text-xs text-slate-600">
                      {t.target != null ? <>target <strong className="tabular-nums">{fmt.num(t.target)}</strong> productive workers a year by {t.targetYear}</> : <span className="text-slate-400">no target for {t.targetYear}</span>}
                      {t.baseline != null && <> · baseline <strong className="tabular-nums">{fmt.num(t.baseline)}</strong></>}
                      {t.expectedShortfall != null && <> · shortfall <strong className={`tabular-nums ${t.expectedShortfall > 0 ? "text-rose-700" : "text-emerald-700"}`}>{fmt.num(t.expectedShortfall)}</strong></>}
                      {t.expectedShortfall == null && t.target != null && <> · shortfall <span className="text-slate-400" title="unknown until a scenario is evaluated">unknown</span></>}
                    </div>
                  </div>
                  {live.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-500">No scenario yet. <Link href={`/programs/${p.id}/expand`} className="text-rose-700 hover:underline">Open the studio to design and evaluate one →</Link></p>
                  ) : (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-1 pr-2">Scenario</th><th className="py-1 pr-2">Design</th><th className="py-1 pr-2">Answer</th><th className="py-1 pr-2">Binds on</th><th className="py-1 pr-2 text-right">+ workers / yr</th><th className="py-1 pr-2 text-right">$ / placed</th><th className="py-1 pr-2 text-right">Confidence</th><th className="py-1 text-right">Evaluated</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {live.map((s) => (
                            <tr key={s.id} className="align-top">
                              <td className="py-1.5 pr-2"><Link href={`/programs/${p.id}/expand`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link> <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CHIP[s.status] ?? STATUS_CHIP.draft}`}>{s.status}</span></td>
                              <td className="py-1.5 pr-2 text-slate-600">{s.kindLabel}{s.targetWorkers ? <span className="text-slate-400"> · {fmt.num(s.targetWorkers)} by {s.targetYear}</span> : null}</td>
                              <td className="py-1.5 pr-2">{!s.evaluated ? <span className="text-slate-400">not evaluated</span> : s.feasibleInTime ? <span className="font-medium text-emerald-700">feasible in time</span> : s.feasible ? <span className="font-medium text-amber-700">feasible, not by {s.targetYear}</span> : <span className="font-medium text-rose-700">not feasible as designed</span>}</td>
                              <td className="py-1.5 pr-2 text-slate-600">{s.binding ? <>{s.binding.label}{s.binding.shortfall != null ? <span className="text-slate-400"> · {fmt.dec(s.binding.shortfall)} {s.binding.unit} short</span> : null}</> : s.evaluated ? <span className="text-slate-400">nothing</span> : "—"}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{s.evaluated ? fmt.num(s.additionalAnnualProductive) : "—"}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{money(s.perAdditionalPlaced)}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">{s.evaluated ? <span className={s.unverified.length ? "text-amber-700" : "text-emerald-700"} title={s.unverified.length ? `unverified: ${s.unverified.join(", ")}` : "every assumption verified"}>{fmt.pct(s.confidenceShare)}</span> : "—"}</td>
                              <td className="py-1.5 text-right tabular-nums text-slate-500">{dateOf(s.evaluatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {inst.programs.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No programs yet.</p>}
          </div>
        </section>
      ))}
    </div>
  );
}
