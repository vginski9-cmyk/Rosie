import { getCapacityModel, getClinicalSupply, getAssetMap } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";
import { ClinicalSupplyBoard } from "@/components/ClinicalSupplyBoard";
import { AssetMapBoard } from "@/components/AssetMapBoard";
import { Collapse } from "@/components/Collapse";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical site capacity</h1>
        <p className="text-sm text-slate-500">Every asset on every calendar day against the learners booked on it — can the sites absorb the cohorts?</p>
      </div>
      <AssetMapBoard institutionId={data.institution.id} assets={map.assets} overrides={map.overrides} bookings={map.bookings} rotations={map.rotations} cohorts={data.cohorts} from={from} to={to} year={year} />
      {supply && <Collapse title="Functional units by weekday and shift" sub="The older grain: beds and units sized by weekday and shift block" summary={<>{supply.sites.length} sites</>}><ClinicalSupplyBoard institutionId={supply.institution.id} sites={supply.sites} rotations={supply.rotations} cohorts={data.cohorts} /></Collapse>}
      <Collapse title="What each setting needs to host, and when" sub="The request block per setting — students on the heaviest day, days on site, the window, preceptor hours — ready to hand to a partner"><CapacityBoard cohorts={data.cohorts} view="sites" sites={data.clinicalSites} /></Collapse>
    </div>
  );
}
