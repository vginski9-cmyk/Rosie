import { getCapacityModel } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";

export const dynamic = "force-dynamic";

export default async function StaffingNeedPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instructors &amp; preceptors needed</h1>
        <p className="text-sm text-slate-500">Every bar is a real week; session hours become people through each program&apos;s workload assumptions, across every offering at {data.institution.name}.</p>
      </div>
      <CapacityBoard cohorts={data.cohorts} view="staffing" />
    </div>
  );
}
