import { getOfferingsMap } from "@/lib/queries";
import { OfferingsMap } from "@/components/OfferingsMap";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import { getCalendarProvenance } from "@/lib/queries";

export const dynamic = "force-dynamic";

// MAP — where every offering runs: the campuses its class and lab sessions are booked at, and the
// clinical sites its shifts are booked at, across every college.
export default async function MapPage({ searchParams }: { searchParams: { inst?: string } }) {
  const { points, unlocated } = await getOfferingsMap();
  const inst = searchParams.inst && searchParams.inst !== "all" ? searchParams.inst : null;
  const shown = inst ? points.filter((p) => p.institutionId === inst) : points;
  const provenance = (await getCalendarProvenance(inst)).all;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Where the offerings run</h1>
        <p className="text-sm text-slate-500">Every planned and running offering on the map: the campus its classes and labs meet at, and the clinical sites its shifts are booked at. Click a pin for what runs there.</p>
      </div>
      <ProvisionalDatesBanner provenance={provenance} />
      <OfferingsMap points={shown} />
      {unlocated.length > 0 && <p className="text-xs text-slate-400">Not on the map (no town to place them in): {unlocated.map((u) => `${u.cohort} (${u.program}, ${u.institution})`).join("; ")}.</p>}
    </div>
  );
}
