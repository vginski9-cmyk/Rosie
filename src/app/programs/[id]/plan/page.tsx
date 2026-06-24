import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramPlanData, getStaffOptions } from "@/lib/queries";
import { buildAcademicPlan, cohortSeriesFromYearTargets } from "@/lib/plan";
import { PlanChart } from "@/components/PlanChart";
import { addAssignment, removeAssignment, createStaff } from "@/lib/actions";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: { id: string } }) {
  const data = await getProgramPlanData(params.id);
  if (!data) notFound();
  const { program, archetype, supply, cohortSeeds, assignments } = data;
  const staff = await getStaffOptions(program.institutionId);

  const cohorts = cohortSeriesFromYearTargets(cohortSeeds);
  const plan = buildAcademicPlan(archetype, cohorts, supply);

  const chartData = plan.terms.map((t) => ({
    term: t.term.label,
    clinicalDemand: Math.round(t.demand.clinicalSections),
    wblSupply: supply.wblSlots,
    facultyDemand: +t.demand.facultyFTE.toFixed(1),
    facultySupply: supply.facultyFte,
    bottleneck: t.gaps.clinicalSlots.gap < 0,
  }));

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Operations plan</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The integrated view. A cohort enters each year (sized by the funnel&apos;s required seats), overlaid on the
          academic calendar so several cohorts run at once. Rosie sums the <strong>concurrent</strong> capacity demand in
          every term and reconciles it against <strong>supply</strong> — staff FTE, preceptors, and employer WBL slots —
          to find the bottlenecks.
        </p>
      </div>

      {/* Supply + peak demand KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Cohorts in plan" value={fmt.num(cohorts.length)} sub="one per year" />
        <Kpi label="Faculty FTE supply" value={fmt.fte(supply.facultyFte)} sub={`peak need ${fmt.fte(plan.peak.facultyFte)}`} danger={plan.peak.facultyFte > supply.facultyFte} />
        <Kpi label="Preceptor supply" value={fmt.num(supply.preceptors)} sub={`peak need ${fmt.num(plan.peak.preceptors)}`} danger={plan.peak.preceptors > supply.preceptors} />
        <Kpi label="WBL slots" value={fmt.num(supply.wblSlots)} sub={`peak need ${fmt.num(plan.peak.clinicalSlots)}`} danger={plan.peak.clinicalSlots > supply.wblSlots} />
        <Kpi label="Academic terms" value={fmt.num(plan.terms.length)} sub="in horizon" />
        <Kpi label="Bottlenecks" value={fmt.num(plan.bottleneckCount)} sub={plan.hasBottleneck ? "needs attention" : "all clear"} danger={plan.hasBottleneck} />
      </div>

      {/* Chart */}
      <section className="card card-pad">
        <h2 className="mb-3 text-lg font-semibold">Concurrent clinical/WBL demand vs. available slots</h2>
        <PlanChart data={chartData} />
      </section>

      {/* Term-by-term reconciliation */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Term-by-term supply &amp; demand</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Academic term</th>
                <th className="th">Active cohorts</th>
                <th className="th text-right">Clinical need</th>
                <th className="th text-right">WBL slots</th>
                <th className="th text-right">Faculty FTE need</th>
                <th className="th text-right">FTE supply</th>
                <th className="th text-right">Preceptor need</th>
                <th className="th">Bottleneck</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {plan.terms.map((t) => (
                <tr key={t.term.ordinal} className={t.bottlenecks.length ? "bg-rose-50/40" : ""}>
                  <td className="td font-medium">{t.term.label}</td>
                  <td className="td text-xs text-slate-500">{t.active.map((a) => `${a.cohortLabel} (T${a.programTermIndex}·${a.enrollment})`).join(", ")}</td>
                  <Cell value={t.gaps.clinicalSlots.demand} bad={t.gaps.clinicalSlots.gap < 0} />
                  <td className="td text-right text-slate-400">{fmt.num(t.gaps.clinicalSlots.supply)}</td>
                  <Cell value={t.gaps.facultyFte.demand} bad={t.gaps.facultyFte.gap < 0} digits={1} />
                  <td className="td text-right text-slate-400">{fmt.fte(t.gaps.facultyFte.supply)}</td>
                  <Cell value={t.gaps.preceptors.demand} bad={t.gaps.preceptors.gap < 0} />
                  <td className="td text-xs">{t.bottlenecks.length ? <span className="text-rose-700">{t.bottlenecks.join("; ")}</span> : <span className="text-emerald-600">clear</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Staff assignments (supply authoring) */}
      <section className="card card-pad space-y-4">
        <h2 className="text-lg font-semibold">Staff &amp; supply</h2>
        <div className="flex flex-wrap gap-2">
          {assignments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <span className="font-medium">{a.person.name}</span>
              <span className="text-slate-400">{a.role} · {fmt.fte(a.fteCommitment)} FTE</span>
              <form action={removeAssignment.bind(null, a.id, program.id)}><button className="text-slate-300 hover:text-rose-600">✕</button></form>
            </span>
          ))}
          {assignments.length === 0 && <span className="text-sm text-slate-400">No staff assigned yet.</span>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <form action={addAssignment.bind(null, program.id, program.institutionId)} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
            <div className="w-full text-xs font-semibold uppercase tracking-wide text-slate-400">Assign existing staff</div>
            <select name="personId" required className="input-sm w-44"><option value="">Person…</option>{staff.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}</select>
            <select name="role" className="input-sm w-32"><option value="instructor">instructor</option><option value="preceptor">preceptor</option><option value="coordinator">coordinator</option><option value="support">support</option></select>
            <input name="fteCommitment" type="number" step="0.1" defaultValue="1" className="input-sm w-16" title="FTE" />
            <button className="btn-primary py-1 text-xs">Assign</button>
          </form>
          <form action={createStaff.bind(null, program.institutionId, program.id)} className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
            <div className="w-full text-xs font-semibold uppercase tracking-wide text-slate-400">Add new staff member</div>
            <input name="name" required placeholder="Name" className="input-sm w-44" />
            <select name="role" className="input-sm w-32"><option value="instructor">instructor</option><option value="preceptor">preceptor</option><option value="coordinator">coordinator</option><option value="support">support</option></select>
            <button className="btn-ghost py-1 text-xs">Add to roster</button>
          </form>
        </div>
        <p className="text-xs text-slate-400">Faculty/coordinator FTE and preceptor counts here become the supply line the plan reconciles against. Employer WBL slots come from the institution&apos;s employers.</p>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className={`card card-pad ${danger ? "ring-1 ring-rose-300" : ""}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${danger ? "text-rose-700" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Cell({ value, bad, digits = 0 }: { value: number; bad?: boolean; digits?: number }) {
  return <td className={`td text-right font-medium ${bad ? "text-rose-700" : ""}`}>{value.toLocaleString(undefined, { maximumFractionDigits: digits })}</td>;
}
