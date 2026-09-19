import { getOfferingsMap } from "@/lib/queries";
import { OfferingsMap } from "@/components/OfferingsMap";
import { ProvisionalDatesBanner } from "@/components/Evidence";
import { getCalendarProvenance } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";

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
      <PageHeader title={<>Where the offerings run</>} lede={<>Where each offering runs: its campus and the clinical sites its shifts are booked at.</>} />
      <ProvisionalDatesBanner provenance={provenance} />
      <OfferingsMap points={shown} />
      {unlocated.length > 0 && <p className="text-xs text-slate-400">Not on the map (no town to place them in): {unlocated.map((u) => `${u.cohort} (${u.program}, ${u.institution})`).join("; ")}.</p>}
    </div>
  );
}
