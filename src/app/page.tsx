import Link from "next/link";
import { getDashboard } from "@/lib/queries";
import { analyzeFunnel, pipelineHealth, type StageKey } from "@/lib/funnel";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const institutions = await getDashboard();

  const totalPrograms = institutions.reduce((n, i) => n + i.programs.length, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Program portfolio</h1>
        <p className="mt-1 text-sm text-slate-500">
          {institutions.length} institutions · {totalPrograms} programs · one shared model from labor-market demand to
          delivery capacity.
        </p>
      </div>

      {institutions.map((inst) => (
        <section key={inst.id} className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold">{inst.name}</h2>
              <p className="text-sm text-slate-500">{inst.serviceArea}</p>
            </div>
            <div className="flex gap-4 text-xs text-slate-500">
              <span>{inst._count.calendarBlocks} calendar blocks</span>
              <span>{inst._count.employers} employers</span>
              <span>{inst._count.people} staff</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {inst.programs.map((p) => {
              const cohort = p.cohorts[0];
              const analysis = cohort
                ? analyzeFunnel(
                    cohort.stages.map((s) => ({
                      key: s.stageKey as StageKey,
                      label: s.label,
                      target: s.targetNumber,
                      actual: s.actualNumber,
                    })),
                  )
                : [];
              const health = analysis.length ? pipelineHealth(analysis) : null;
              const northStar = p.yearTargets.find((t) => t.credentialTarget != null);

              return (
                <Link key={p.id} href={`/programs/${p.id}`} className="card card-pad block transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{p.name}</h3>
                      <p className="text-xs text-slate-500">
                        {p.occupation?.title} · SOC {p.occupation?.socCode}
                      </p>
                    </div>
                    <span className="badge bg-rose-50 text-rose-700">{p.credential}</span>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    <div>
                      <div className="stat-label">North Star</div>
                      <div className="stat-value">{fmt.num(northStar?.credentialTarget)}</div>
                      <div className="text-[11px] text-slate-400">grads / yr</div>
                    </div>
                    <div>
                      <div className="stat-label">Terms</div>
                      <div className="stat-value">{p._count.terms}</div>
                      <div className="text-[11px] text-slate-400">in sequence</div>
                    </div>
                    <div>
                      <div className="stat-label">Goal attainment</div>
                      <div className="stat-value">{fmt.pct(health?.northStarAttainment)}</div>
                      <div className="text-[11px] text-slate-400">actual / target</div>
                    </div>
                  </div>

                  {health?.biggestLeak && (
                    <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Biggest pipeline leak: <strong>{health.biggestLeak.label}</strong> — converting{" "}
                      {fmt.pct(health.biggestLeak.dropVsTarget)} below plan.
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
