import { getSupplyExplorer } from "@/lib/queries";
import { presetWindow } from "@/lib/supplyexplorer";
import { SupplyExplorer } from "@/components/SupplyExplorer";

export const dynamic = "force-dynamic";

export default async function SupplyPage({ searchParams }: { searchParams: { inst?: string; preset?: string; from?: string; to?: string } }) {
  const today = new Date().toISOString().slice(0, 10);
  const preset = searchParams.preset || "week";
  // The coded semesters come from the institution; resolve the window in two steps for "semester".
  const probe = await getSupplyExplorer(searchParams.inst, today, today);
  if (!probe) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const win = preset === "custom" && searchParams.from && searchParams.to ? { from: searchParams.from, to: searchParams.to, label: `${searchParams.from} → ${searchParams.to}` } : presetWindow(preset, today, probe.semesters);
  const data = await getSupplyExplorer(probe.institution.id, win.from, win.to);
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Asset supply explorer — {data.institution.name}</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Every partner site&apos;s physical assets, shift by shift, for any window: how many day, evening and night shifts run, how many
          hours each offers, how many learner seats they carry, how many are booked and how many are open — by asset, site, setting,
          day, week, month, semester or year. Filter by site, setting, asset, agreement status, weekday and shift; click any row to drill in.
        </p>
      </div>
      <SupplyExplorer institution={data.institution} institutions={data.institutions} assets={data.assets} overrides={data.overrides} bookings={data.bookings} from={win.from} to={win.to} preset={preset} windowLabel={win.label} />
    </div>
  );
}
