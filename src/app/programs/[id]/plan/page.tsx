import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramPlanData, getStaffOptions } from "@/lib/queries";
import { buildAcademicPlan } from "@/lib/plan";
import { PlanChart } from "@/components/PlanChart";
import { addAssignment, removeAssignment, createStaff, updateLaunchConfig } from "@/lib/actions";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const TERMS = ["FALL", "SPRING", "SUMMER"] as const;

export default async function PlanPage({ params }: { params: { id: string } }) {
  const data = await getProgramPlanData(params.id);
  if (!data) notFound();
  const { program, archetype, supply, cohorts, activeCodes, placement, competency, launchConfig, assignments } = data;
  const staff = await getStaffOptions(program.institutionId);

  const plan = buildAcademicPlan(archetype, cohorts, supply, { activeCodes });
  const peakConcurrent = Math.max(0, ...plan.terms.map((t) => t.active.length));

  const chartData = plan.terms.map((t) => ({
    term: t.term.label,
    clinicalDemand: Math.round(t.demand.clinicalSections),
    wblSupply: supply.wblSlots,
    facultyDemand: +t.demand.facultyFTE.toFixed(1),
    facultySupply: supply.facultyFte,
    bottleneck: t.gaps.clinicalSlots.gap < 0,
  }));

  const selected = (csv: string, code: string) => csv.split(",").includes(code);

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Operations plan</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Cohorts launch on the program&apos;s cadence and are overlaid on the academic calendar, so many run at once.
          Rosie sums the <strong>concurrent</strong> capacity demand per term and reconciles it against supply — staff
          FTE, preceptors, and <em>alignment-feasible</em> employer WBL slots — to find bottlenecks.
        </p>
      </div>

      {/* Launch cadence editor */}
      <details className="card card-pad">
        <summary className="cursor-pointer font-semibold">
          Launch cadence —{" "}
          <span className="font-normal text-slate-500">
            {launchConfig.cadence.replace("_", " ").toLowerCase()}, launches {launchConfig.launchTerms.map((t) => t.toLowerCase()).join(" + ")}
            {launchConfig.cadence === "BIENNIAL" ? ` every ${launchConfig.intervalYears} yrs` : ""} · delivers in {activeCodes.map((t) => t.toLowerCase()).join(" + ")}
          </span>
        </summary>
        <form action={updateLaunchConfig.bind(null, program.id)} className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Cadence</span>
            <select name="launchCadence" defaultValue={program.launchCadence} className="input">
              <option value="ANNUAL">Annual</option>
              <option value="BIENNIAL">Biennial (every N years)</option>
              <option value="MULTI_PER_YEAR">Multiple per year</option>
              <option value="ON_DEMAND">On demand (explicit cohorts)</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Interval (years, for biennial)</span>
            <input name="launchIntervalYears" type="number" min={1} defaultValue={program.launchIntervalYears} className="input" />
          </label>
          <div>
            <span className="mb-1 block text-sm font-medium">Launches in terms</span>
            <div className="flex gap-3">
              {TERMS.map((t) => (
                <label key={t} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="launchTerms" value={t} defaultChecked={selected(program.launchTerms, t)} className="accent-rose-600" /> {t.toLowerCase()}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium">Delivers in terms (skip e.g. summer)</span>
            <div className="flex gap-3">
              {TERMS.map((t) => (
                <label key={t} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="termSlots" value={t} defaultChecked={selected(program.termSlots, t)} className="accent-rose-600" /> {t.toLowerCase()}
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Default seats / cohort</span>
            <input name="defaultCohortSeats" type="number" min={1} defaultValue={program.defaultCohortSeats ?? ""} placeholder="used when a year has no target" className="input" />
          </label>
          <div className="flex items-end"><button className="btn-primary">Save cadence</button></div>
        </form>
      </details>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Cohorts in plan" value={fmt.num(cohorts.length)} sub={`${peakConcurrent} concurrent at peak`} />
        <Kpi label="Faculty FTE" value={fmt.fte(supply.facultyFte)} sub={`peak need ${fmt.fte(plan.peak.facultyFte)}`} danger={plan.peak.facultyFte > supply.facultyFte} />
        <Kpi label="Preceptors" value={fmt.num(supply.preceptors)} sub={`peak need ${fmt.num(plan.peak.preceptors)}`} danger={plan.peak.preceptors > supply.preceptors} />
        <Kpi label="WBL slots (feasible)" value={fmt.num(placement.effective)} sub={`of ${fmt.num(placement.raw)} raw · peak need ${fmt.num(plan.peak.clinicalSlots)}`} danger={plan.peak.clinicalSlots > placement.effective} />
        <Kpi label="Competency readiness" value={fmt.pct(competency.competencyReadiness)} sub={`${competency.coreAssessedToTarget}/${competency.coreCount} core assessed`} danger={competency.competencyReadiness < 1} />
        <Kpi label="Bottlenecks" value={fmt.num(plan.bottleneckCount)} sub={plan.hasBottleneck ? "needs attention" : "all clear"} danger={plan.hasBottleneck} />
      </div>

      {/* Chart */}
      <section className="card card-pad">
        <h2 className="mb-3 text-lg font-semibold">Concurrent clinical/WBL demand vs. alignment-feasible slots</h2>
        <PlanChart data={chartData} />
      </section>

      {/* Loop 2: placement feasibility */}
      <section className="card card-pad space-y-3">
        <h2 className="text-lg font-semibold">Placement feasibility (WBL alignment → capacity)</h2>
        <p className="text-sm text-slate-500">
          Only employers whose profile is alignment-feasible for this cohort count toward placement capacity:{" "}
          <strong>{fmt.num(placement.effective)}</strong> of {fmt.num(placement.raw)} raw slots.
        </p>
        <div className="flex flex-wrap gap-2">
          {placement.employers.map((e) => (
            <div key={e.employerId} className={`rounded-lg border px-3 py-2 text-xs ${e.feasible ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
              <div className="font-medium">{e.name}</div>
              <div className="text-slate-500">{fmt.num(e.slots)} slots · {e.score != null ? `${fmt.pct(e.score)} aligned` : "no profile"}</div>
              {!e.feasible && <div className="text-rose-700">blocked: {e.reason}</div>}
            </div>
          ))}
          {placement.employers.length === 0 && <span className="text-sm text-slate-400">No employers yet.</span>}
        </div>
        <Link href="/wbl" className="text-xs text-rose-700 hover:underline">manage WBL profiles →</Link>
      </section>

      {/* Term-by-term reconciliation */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Term-by-term supply &amp; demand</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Academic term</th>
                <th className="th text-right">Cohorts</th>
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
                  <td className="td text-right">{t.active.length}</td>
                  <DCell value={t.gaps.clinicalSlots.demand} bad={t.gaps.clinicalSlots.gap < 0} />
                  <td className="td text-right text-slate-400">{fmt.num(t.gaps.clinicalSlots.supply)}</td>
                  <DCell value={t.gaps.facultyFte.demand} bad={t.gaps.facultyFte.gap < 0} digits={1} />
                  <td className="td text-right text-slate-400">{fmt.fte(t.gaps.facultyFte.supply)}</td>
                  <DCell value={t.gaps.preceptors.demand} bad={t.gaps.preceptors.gap < 0} />
                  <td className="td text-xs">{t.bottlenecks.length ? <span className="text-rose-700">{t.bottlenecks.join("; ")}</span> : <span className="text-emerald-600">clear</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Staff assignments */}
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

function DCell({ value, bad, digits = 0 }: { value: number; bad?: boolean; digits?: number }) {
  return <td className={`td text-right font-medium ${bad ? "text-rose-700" : ""}`}>{value.toLocaleString(undefined, { maximumFractionDigits: digits })}</td>;
}
