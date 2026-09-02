import { getCapacityModel } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";

export const dynamic = "force-dynamic";

export default async function StaffingNeedPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How many instructors and preceptors do we need, and when?</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Every bar is a real week. Session-table hours are converted to people with each program&apos;s workload
          assumptions (a full-time faculty week = the contact hours on the design page), across every scheduled offering
          at {data.institution.name}. Add or re-date offerings and this restacks itself.
        </p>
      </div>
      <CapacityBoard cohorts={data.cohorts} view="staffing" />
    </div>
  );
}
