import { getCapacityModel, getSchedulerData, getCalendarProvenance, getCapacityBridge } from "@/lib/queries";
import { schedulerWindow } from "@/lib/schedulerplan";
import { SchedulerBoard } from "@/components/SchedulerBoard";
import { ScopeStrip } from "@/components/ScopeStrip";

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
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  const bridge = await getCapacityBridge(data.institution.id, from, to);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical scheduler</h1>
        <p className="text-sm text-slate-500">Every dated clinical shift (demand) placed onto every site&apos;s assets (supply), with the reason for each clinical placement and what would fix each gap. Nothing is written until you apply the plan.</p>
      </div>
      <ScopeStrip
        provisional={provenance}
        bridge={bridge} self="scheduler"
        shows="A proposed scenario — the plan the engine builds under the levers on the page. Nothing is written until you apply it; an applied plan shows on the calendar, in daily coverage and in site load."
        population={`Enrollment targets of every planned and running offering at ${data.institution.name} (the goal ladder, not the roster)`}
        window={`${from} → ${to} (adjustable in the levers)`}
        constraints={["agreement tier", "asset seats per shift", "holidays", "site continuity", "travel ring", "preceptors only when the Preceptors lever requires one"]}
        differs={[["Clinical site capacity", "/insights/clinical-sites", "is the per-date ceiling these shifts are placed within — no levers, so it is always at or above “placed”"], ["Clinical site load", "/insights/site-load", "counts the roster's actual student-shifts, including completed cohorts"]]}
      />
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
