import { getCapacityModel } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";

export const dynamic = "force-dynamic";

export default async function CoveragePage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Daily coverage</h1>
        <p className="text-sm text-slate-500">Every shift on every date, by semester, month, week or day; drag a chip to move it, open a day to edit time, place and staff.</p>
      </div>
      <CapacityBoard cohorts={data.cohorts} view="coverage" sites={data.clinicalSites} rooms={data.rooms} people={data.people} />
    </div>
  );
}
