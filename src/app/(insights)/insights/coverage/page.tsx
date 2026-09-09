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
          The coverage calendar at three altitudes: <strong>Semester</strong> shows every week of every term at a glance,
          <strong> Month</strong> and <strong>Week</strong> put one draggable chip on the grid per shift, and{" "}
          <strong>Day</strong> lists every shift individually — with its weekday, time, room or clinical site and staff
          editable in place, and the day&apos;s numbers explained.
        </p>
      </div>
      <CapacityBoard cohorts={data.cohorts} view="coverage" sites={data.clinicalSites} rooms={data.rooms} people={data.people} />
    </div>
  );
}
