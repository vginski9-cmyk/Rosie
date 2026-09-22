import { getCapacityModel, getClinicalSupply, getAssetMap, getCalendarProvenance, getCapacityBridge } from "@/lib/queries";
import { schedulerWindow } from "@/lib/schedulerplan";
import { ScopeStrip } from "@/components/ScopeStrip";
import { CapacityBoard } from "@/components/CapacityBoard";
import { ClinicalSupplyBoard } from "@/components/ClinicalSupplyBoard";
import { AssetMapBoard } from "@/components/AssetMapBoard";
import { Collapse } from "@/components/Collapse";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ClinicalSitesPage({ searchParams }: { searchParams: { inst?: string } }) {
  const data = await getCapacityModel({ institutionId: searchParams.inst });
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const supply = await getClinicalSupply(data.institution.id);
  // The window the asset map is matched over — the same one the scheduler plans in
  // (earliest dated term start → latest term start + 20 weeks), so the two pages read one demand.
  const { from, to } = schedulerWindow(data.cohorts);
  const year = Number(from.slice(0, 4)) + 1;
  const map = await getAssetMap(data.institution.id, from, to);
  const provenance = (await getCalendarProvenance(data.institution.id)).all;
  const bridge = await getCapacityBridge(data.institution.id, from, to);
  return (
    <div className="space-y-6">
      <PageHeader title={<>Clinical site capacity</>} lede={<>Can the sites absorb the cohorts? Every asset on every day against the learners booked on it.</>} />
      <ScopeStrip
        provisional={provenance}
        bridge={bridge} self="capacity"
        shows="Requirements against a physical ceiling — each date × shift × setting: the learner-shifts the offerings need against what the assets could host. No plan, no preceptors, no holidays, no travel: the ceiling the scheduler places within."
        population={`Enrollment targets of every planned and running offering at ${data.institution.name} (the goal ladder, not the roster)`}
        window={`${from} → ${to}`}
        constraints={["agreement tier (secured vs physical)", "asset operating days and shift blocks"]}
        differs={[["Clinical scheduler", "/scheduler", "places these same learner-shifts under levers (holidays, preceptors, continuity, travel) — its “placed” is always at or below this ceiling"], ["Clinical site load", "/insights/site-load", "counts the roster's actual student-shifts, including completed cohorts and undated rows"]]}
      />
      <AssetMapBoard institutionId={data.institution.id} assets={map.assets} overrides={map.overrides} bookings={map.bookings} rotations={map.rotations} courseRules={map.courseRules} cohorts={data.cohorts} from={from} to={to} year={year} />
      {supply && <Collapse title="Functional units by weekday and shift" sub="The older grain: beds and units sized by weekday and shift block" summary={<>{supply.sites.length} sites</>}><ClinicalSupplyBoard institutionId={supply.institution.id} sites={supply.sites} rotations={supply.rotations} cohorts={data.cohorts} /></Collapse>}
      <Collapse title="What each setting needs to host, and when" sub="The request block per setting — students on the heaviest day, days on site, the window, preceptor hours — ready to hand to a partner"><CapacityBoard cohorts={data.cohorts} view="sites" sites={data.clinicalSites} /></Collapse>
    </div>
  );
}
