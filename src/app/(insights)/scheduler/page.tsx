import { getCapacityModel, getSchedulerData, getRosterPlacement } from "@/lib/queries";
import { schedulerWindow } from "@/lib/schedulerplan";
import { SchedulerBoard } from "@/components/SchedulerBoard";
import { listChangeSets } from "@/lib/changesets";
import { OPERATIONAL } from "@/lib/mode";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

// The clinical scheduler: every offering's dated clinical sections (demand)
// against every partner's physical assets, day by day (supply) — placed by
// the recommendation engine under levers the room can turn together.
export default async function SchedulerPage({ searchParams }: { searchParams: { inst?: string } }) {
  // The scheduler places one college's demand on that college's sites — "all" reads as the working college.
  const data = await getCapacityModel({ institutionId: searchParams.inst === "all" ? undefined : searchParams.inst });
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  // The same window the apply action rebuilds the plan in — see lib/schedulerplan.
  const { from, to } = schedulerWindow(data.cohorts);
  const sched = await getSchedulerData(data.institution.id, from, to);
  const changes = await listChangeSets(data.institution.id);
  const roster = await getRosterPlacement(data.institution.id);
  return (
    <div className="space-y-6">
      <PageHeader title={<>Clinical scheduler</>} meta={`${data.institution.name}${OPERATIONAL ? "" : " · diagnostic — nothing is written to the calendar"}`} />
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
        siteCaps={sched.siteCaps}
        confirmedSettings={sched.confirmedSettings}
        changes={changes}
        from={from}
        to={to}
        canApply={OPERATIONAL}
        roster={roster}
      />
    </div>
  );
}
