import { getCapacityModel } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";

export const dynamic = "force-dynamic";

export default async function CoveragePage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How many shifts must be covered on each date?</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The coverage board on real dates: each row is a calendar week, each cell a specific day and the number of
          shifts (sections) that day. Hover a cell for the courses, settings and cohorts behind it.
        </p>
      </div>
      <CapacityBoard cohorts={data.cohorts} view="coverage" />
    </div>
  );
}
