import { getCapacityModel, datedStaffAssignments, getCalendarProvenance } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";
import { ScopeStrip } from "@/components/ScopeStrip";

export const dynamic = "force-dynamic";

export default async function StaffingNeedPage({ searchParams }: { searchParams: { inst?: string } }) {
  const data = await getCapacityModel({ institutionId: searchParams.inst });
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const assignments = await datedStaffAssignments({ institutionId: data.institution.id });
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instructors &amp; preceptors needed</h1>
        <p className="text-sm text-slate-500">Every bar is a real week; session hours become people through each program&apos;s workload assumptions, across every offering at {data.institution.name}. Click any bar to see which people fill it and what is still unfilled.</p>
      </div>
      <ScopeStrip
        provisional={provenance}
        shows="Requirements — the instructors and preceptors the sessions need, week by week, from session hours through each program's workload assumptions; then who is assigned by name."
        population={`Each term's enrollment target for every planned and running offering at ${data.institution.name} (not the roster)`}
        window="Every dated term of those offerings"
        constraints={["college holidays", "per-date moves"]}
        differs={[["Design & sequence", "/programs", "sums the same FTE across a whole program (cumulative term-FTE); this page shows the concurrent need per week"], ["Clinical scheduler", "/scheduler", "names preceptors only for the shifts it places"]]}
      />
      <CapacityBoard cohorts={data.cohorts} view="staffing" assignments={assignments} />
    </div>
  );
}
