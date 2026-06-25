import { getEmployersDirectory } from "@/lib/queries";
import { EmployerDirectory } from "@/components/EmployerDirectory";

export const dynamic = "force-dynamic";

export default async function EmployersPage() {
  const { employers, institutions } = await getEmployersDirectory();
  const active = employers.filter((e) => e.status === "active").length;
  const slots = employers.reduce((n, e) => n + (e.wblSlots ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Employer partners</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The supply side of work-based learning — every clinical / employer partner, the WBL capacity they host, and the
          students placed with them. Onboard a new partner, then open one to manage its details and placements.
          {" "}{employers.length} partners · {active} active · {slots} WBL slots.
        </p>
      </div>
      <EmployerDirectory employers={employers} institutions={institutions} />
    </div>
  );
}
