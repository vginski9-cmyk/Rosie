import { getCapacityModel } from "@/lib/queries";
import { CapacityBoard } from "@/components/CapacityBoard";

export const dynamic = "force-dynamic";

export default async function ClinicalSitesPage() {
  const data = await getCapacityModel();
  if (!data) return <p className="text-sm text-slate-400">No institution seeded yet.</p>;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">What does each clinical site need to host, and when?</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          For hospitals, offices and employer partners: how many students arrive in each setting, on which days, for how
          many weeks, and how many preceptors that takes — one request block per setting, ready to hand to a site.
        </p>
      </div>
      <CapacityBoard cohorts={data.cohorts} view="sites" />
    </div>
  );
}
