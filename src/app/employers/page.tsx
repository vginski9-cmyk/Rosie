import { getEmployersDirectory } from "@/lib/queries";
import { EmployerDirectory } from "@/components/EmployerDirectory";

export const dynamic = "force-dynamic";

export default async function EmployersPage() {
  const { employers, institutions } = await getEmployersDirectory();
  const active = employers.filter((e) => e.status === "active").length;
  const secured = employers.reduce((n, e) => n + e.wbl.secured, 0);
  const asked = employers.reduce((n, e) => n + e.wbl.asked, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Employer partners</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The supply side of work-based learning — every clinical / employer partner and the rotations they actually host.
          Capacity is read live from placement records (what programs <em>asked</em> for vs what was <em>secured</em>),
          not a static slot count, because real availability shifts week to week. Onboard a new partner, then open one to
          manage its details and placements.
          {" "}{employers.length} partners · {active} active · {secured} of {asked} rotations secured.
        </p>
      </div>
      <EmployerDirectory employers={employers} institutions={institutions} />
    </div>
  );
}
