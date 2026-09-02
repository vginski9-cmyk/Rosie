import { getCapacityModel, getClinicalSupply } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";
import { ClinicalSupplyBoard } from "@/components/ClinicalSupplyBoard";

export const dynamic = "force-dynamic";

export default async function ClinicalSitesPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  const supply = await getClinicalSupply(data.institution.id);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Can the region&apos;s clinical sites absorb this — and which ones are secured?</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Supply is the clinical asset map — every site&apos;s functional units with their shift structure, days open and
          students per shift. Demand is every dated clinical section across your instantiations, mapped from rotation
          type to unit category. They are matched day by day and shift block by shift block; then assign each section to
          a site and unit, and track which sites are secured.
        </p>
      </div>
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
