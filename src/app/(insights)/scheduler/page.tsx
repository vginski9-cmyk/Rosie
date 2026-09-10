import { getCapacityModel, getSchedulerData } from "@/lib/queries";
import { schedulerWindow } from "@/lib/schedulerplan";
import { SchedulerBoard } from "@/components/SchedulerBoard";

export const dynamic = "force-dynamic";

// The clinical scheduler: every offering's dated clinical sections (demand)
// against every partner's physical assets, day by day (supply) — placed by
// the recommendation engine under levers the room can turn together.
export default async function SchedulerPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  // The same window the apply action rebuilds the plan in — see lib/schedulerplan.
  const { from, to } = schedulerWindow(data.cohorts);
  const sched = await getSchedulerData(data.institution.id, from, to);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical scheduler</h1>
        <p className="text-sm text-slate-500">Every dated clinical section (demand) placed onto every site&apos;s assets (supply), with the reason for each placement and what would fix each gap. Nothing is written until you apply the plan.</p>
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
