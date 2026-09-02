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
        <h1 className="text-2xl font-semibold tracking-tight">Clinical sites &amp; employer partners</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The physical supply of clinical placement: every hospital, surgery center, nursing home and office in the region
          — with its beds, operating rooms and <strong>functional units</strong> (the shift structure, days open, students
          and preceptors per shift) — and where each one stands on an agreement with you. Open a site to configure its
          units and see the sections it hosts.
          {" "}{employers.length} sites · {active} open · {secured} of {asked} rotations secured.
        </p>
      </div>
      <EmployerDirectory employers={employers} institutions={institutions} />
    </div>
  );
}
