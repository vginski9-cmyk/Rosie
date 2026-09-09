import { getRoomsWorkspace } from "@/lib/queries";
import { RoomsWorkspace } from "@/components/RoomsWorkspace";

export const dynamic = "force-dynamic";

export default async function FacilitiesPage({ searchParams }: { searchParams: { inst?: string } }) {
  const ws = await getRoomsWorkspace();
  const seats = ws.rooms.reduce((n, f) => n + (f.capacity ?? 0), 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Rooms, buildings &amp; equipment</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The campus supply, structured so it can be mapped, checked and measured: campuses hold buildings, buildings hold rooms, every
          room has coded open hours (by weekday, with dated exceptions) that availability and utilization are computed from, and
          equipment is its own record — fixed in a room, mobile between rooms, or portable — assignable to rooms for periods.
          {" "}{ws.rooms.length} rooms · {seats} seats / stations · {ws.buildings.length} building{ws.buildings.length === 1 ? "" : "s"} on {ws.campuses.length} campus{ws.campuses.length === 1 ? "" : "es"} · {ws.equipment.reduce((n, e) => n + e.quantity, 0)} pieces of equipment.
        </p>
      </div>
      <RoomsWorkspace rooms={ws.rooms} campuses={ws.campuses} buildings={ws.buildings} equipment={ws.equipment} institutions={ws.institutions} defaultInstitutionId={searchParams.inst} />
    </div>
  );
}
