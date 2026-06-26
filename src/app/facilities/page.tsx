import { getFacilitiesDirectory } from "@/lib/queries";
import { FacilityDirectory } from "@/components/FacilityDirectory";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage() {
  const { facilities, institutions } = await getFacilitiesDirectory();
  const seats = facilities.reduce((n, f) => n + (f.capacity ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Facilities</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The supply of physical space — classrooms, labs, clinical and simulation facilities — with their size, capacity,
          hours, availability, and equipment. This is what delivery (sections, labs, clinicals) gets mapped onto.
          {" "}{facilities.length} spaces · {seats} total seats/stations.
        </p>
      </div>
      <FacilityDirectory facilities={facilities} institutions={institutions} />
    </div>
  );
}
