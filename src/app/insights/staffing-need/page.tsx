import { getCapacityModel } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";
import { StaffRoster } from "@/components/StaffRoster";
import { rosterFromCohorts } from "@/lib/roster";

export const dynamic = "force-dynamic";

export default async function StaffingNeedPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instructors and preceptors — who we have, how many we need, and when</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          First the roster: every instructor and preceptor at {data.institution.name}, what each one carries across every
          scheduled offering, and the sections still unstaffed. Then the need: every bar is a real week, session-table hours
          converted to people with each program&apos;s workload assumptions. Add or re-date offerings and this restacks itself.
        </p>
      </div>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">The roster — across every offering</h2>
        <StaffRoster institutionId={data.institution.id} people={data.people} meetings={rosterFromCohorts(data.cohorts)} showCohort />
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">The need — semester, week, day</h2>
        <CapacityBoard cohorts={data.cohorts} view="staffing" />
      </section>
    </div>
  );
}
