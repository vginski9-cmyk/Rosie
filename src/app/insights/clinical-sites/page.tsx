import { getCapacityModel, getClinicalSupply, getAssetMap } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";
import { ClinicalSupplyBoard } from "@/components/ClinicalSupplyBoard";
import { AssetMapBoard } from "@/components/AssetMapBoard";

export const dynamic = "force-dynamic";

export default async function ClinicalSitesPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const supply = await getClinicalSupply(data.institution.id);
  // The window the asset map is matched over: from the earliest dated term to
  // the latest, else the coming 18 months.
  const starts = data.cohorts.flatMap((c) => Object.values(c.termStartByIndex).filter((v): v is string => !!v)).sort();
  const todayIso = new Date().toISOString().slice(0, 10);
  const from = starts[0]?.slice(0, 10) ?? todayIso;
  const last = starts[starts.length - 1]?.slice(0, 10) ?? todayIso;
  const to = new Date(new Date(last + "T00:00:00Z").getTime() + 20 * 7 * 86400000).toISOString().slice(0, 10);
  const year = Number(from.slice(0, 4)) + 1;
  const map = await getAssetMap(data.institution.id, from, to);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Can the region&apos;s clinical sites absorb this — asset by asset, day by day?</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Two grains of supply. The <strong>365-day asset map</strong> is what partners report: every physical asset (radiographic room, ED room, portable, C-arm, fluoro room, OR suite, bed unit …) with its operating rule on every calendar day — the physical ceiling — with learner rules layered on top, and learners booked onto specific assets. Below it, the <strong>functional-unit view</strong> sizes beds and units by weekday and shift block.
        </p>
      </div>
      <AssetMapBoard institutionId={data.institution.id} assets={map.assets} overrides={map.overrides} bookings={map.bookings} rotations={map.rotations} cohorts={data.cohorts} from={from} to={to} year={year} />
      {supply && <ClinicalSupplyBoard institutionId={supply.institution.id} sites={supply.sites} rotations={supply.rotations} cohorts={data.cohorts} />}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">What each setting needs to host, and when</h2>
          <p className="text-sm text-slate-500">The request block per setting — students on the heaviest day, days on site, the window, preceptor hours — ready to hand to a partner.</p>
        </div>
        <CapacityBoard cohorts={data.cohorts} view="sites" sites={data.clinicalSites} />
      </section>
    </div>
  );
}
