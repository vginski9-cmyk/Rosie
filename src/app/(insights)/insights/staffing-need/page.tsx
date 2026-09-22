import { getCapacityModel, datedStaffAssignments, getCalendarProvenance } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";
import { ScopeStrip } from "@/components/ScopeStrip";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function StaffingNeedPage({ searchParams }: { searchParams: { inst?: string } }) {
  const data = await getCapacityModel({ institutionId: searchParams.inst });
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const assignments = await datedStaffAssignments({ institutionId: data.institution.id });
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  return (
    <div className="space-y-6">
      <PageHeader title={<>Instructors &amp; preceptors needed</>} lede={<>How many instructors and preceptors every week needs, who fills them, and what is still unfilled. Click a bar.</>} />
      <ScopeStrip
        provisional={provenance}
        shows="Requirements — the instructors and preceptors the sessions need, week by week, from session hours through each program's workload assumptions; then who is assigned by name."
        population={`Each term's enrollment target for every offering at ${data.institution.name} — planned, running or graduated (not the roster); the headline peak counts this week on, the weeks before it are history`}
        window="Every dated term of those offerings"
        constraints={["college holidays", "per-date moves"]}
        differs={[["Design & sequence", "/programs", "sums the same FTE across a whole program (cumulative term-FTE); this page shows the concurrent need per week"], ["Clinical scheduler", "/scheduler", "names preceptors only for the shifts it places"]]}
      />
      <CapacityBoard cohorts={data.cohorts} view="staffing" assignments={assignments} />
    </div>
  );
}
