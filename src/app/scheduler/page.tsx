import { getCapacityModel, getSchedulerData } from "@/lib/queries";
import { SchedulerBoard } from "@/components/SchedulerBoard";

export const dynamic = "force-dynamic";

// The clinical scheduler: every offering's dated clinical sections (demand)
// against every partner's physical assets, day by day (supply) — placed by
// the recommendation engine under levers the room can turn together.
export default async function SchedulerPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const starts = data.cohorts.flatMap((c) => Object.values(c.termStartByIndex).filter((v): v is string => !!v)).sort();
  const todayIso = new Date().toISOString().slice(0, 10);
  const from = starts[0]?.slice(0, 10) ?? todayIso;
  const last = starts[starts.length - 1]?.slice(0, 10) ?? todayIso;
  const to = new Date(new Date(last + "T00:00:00Z").getTime() + 20 * 7 * 86400000).toISOString().slice(0, 10);
  const sched = await getSchedulerData(data.institution.id, from, to);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical scheduler — supply vs demand, and the plan that balances them</h1>
        <p className="max-w-4xl text-sm text-slate-500">
          <strong>Demand</strong> is every dated clinical section of every offering: which setting, which date, which shift, how many students, how many preceptors.
          <strong> Supply</strong> is every physical asset every partner reports, on every calendar day and shift, with the learners it can take.
          The engine places demand onto supply under the levers below, names every placement&apos;s reason, and for everything it cannot place says exactly why and what would fix it.
          Turn a lever and the whole plan, every analytic and every bottleneck recomputes instantly. Nothing is written until you apply the plan.
        </p>
      </div>
      <SchedulerBoard
        institutionId={data.institution.id}
        cohorts={data.cohorts}
        assets={sched.assets}
        overrides={sched.overrides}
        bookings={sched.bookings}
        rotations={sched.rotations}
        preceptors={sched.preceptors}
        instructors={sched.instructors}
        students={sched.students}
        familyAgreements={sched.familyAgreements}
        from={from}
        to={to}
      />
    </div>
  );
}
