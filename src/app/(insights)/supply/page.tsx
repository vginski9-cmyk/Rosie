import { getSupplyExplorer } from "@/lib/queries";
import { presetWindow } from "@/lib/supplyexplorer";
import { SupplyExplorer } from "@/components/SupplyExplorer";
import { ScopeStrip } from "@/components/ScopeStrip";
import { getCalendarProvenance } from "@/lib/queries";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SupplyPage({ searchParams }: { searchParams: { inst?: string; preset?: string; from?: string; to?: string } }) {
  const today = new Date().toISOString().slice(0, 10);
  const preset = searchParams.preset || "week";
  // The coded semesters come from the institution; resolve the window in two steps for "semester".
  const probe = await getSupplyExplorer(searchParams.inst, today, today);
  if (!probe) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const isoOk = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + "T00:00:00Z").getTime());
  const win = preset === "custom" && isoOk(searchParams.from) && isoOk(searchParams.to) && searchParams.from <= searchParams.to ? { from: searchParams.from, to: searchParams.to, label: `${searchParams.from} → ${searchParams.to}` } : presetWindow(preset, today, probe.semesters);
  const data = await getSupplyExplorer(probe.institution.id, win.from, win.to);
  if (!data) return null;
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  return (
    <div className="space-y-6">
      <PageHeader title={<>Asset supply</>} lede={<>Seats offered, booked and open at every site asset, shift by shift.</>} />
      <ScopeStrip
        provisional={provenance}
        shows="A physical ceiling with the applied plan on it — every asset-shift in the window (seats offered), the asset bookings on them (booked), and what is left (open)."
        population={`Asset bookings of every offering at ${data.institution.name}; seats offered are learners per shift × asset-shifts, a theoretical ceiling, not usable capacity`}
        window={win.label}
        constraints={["asset operating days and shift blocks", "date exceptions"]}
        differs={[["Clinical scheduler", "/scheduler", "places demand under levers (agreements, preceptors, travel); its placed seats are always at or below what is open here"], ["Clinical site capacity", "/insights/clinical-sites", "matches the same ceiling against demand date by date"]]}
      />
      <SupplyExplorer institution={data.institution} institutions={data.institutions} assets={data.assets} overrides={data.overrides} bookings={data.bookings} from={win.from} to={win.to} preset={preset} windowLabel={win.label} />
    </div>
  );
}
