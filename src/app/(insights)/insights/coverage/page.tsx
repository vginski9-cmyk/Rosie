import { getCapacityModel, getCalendarProvenance } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";
import { ScopeStrip } from "@/components/ScopeStrip";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function CoveragePage({ searchParams }: { searchParams: { inst?: string } }) {
  const data = await getCapacityModel({ institutionId: searchParams.inst });
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  return (
    <div className="space-y-6">
      <PageHeader title={<>Daily coverage</>} lede={<>Every shift on every date. Drag a chip to move it; open a day for its time, place and staff.</>} />
      <ScopeStrip
        provisional={provenance}
        shows="The applied plan on the calendar — every dated session of every offering, on the day its weekly booking or a per-date move puts it, with the site, room and staff booked."
        population={`Each term's enrollment target for every planned and running offering at ${data.institution.name} (seats, dealt across sections — not named students)`}
        window="Every dated term of those offerings"
        constraints={["weekly bookings", "per-date moves", "college holidays"]}
        differs={[["Master calendar", "/calendar", "reads the same bookings and moves, week by week, with named students on applied shifts"], ["Clinical site load", "/insights/site-load", "counts named students on the roster, including completed cohorts"]]}
      />
      <CapacityBoard cohorts={data.cohorts} view="coverage" sites={data.clinicalSites} rooms={data.rooms} people={data.people} />
    </div>
  );
}
