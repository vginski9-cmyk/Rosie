import { getEmployersDirectory } from "@/lib/queries";
import { locateInstitutionSites } from "@/lib/actions";
import { EmployerDirectory } from "@/components/EmployerDirectory";

export const dynamic = "force-dynamic";

// ALL ORGANIZATIONS — the shared record of every partner: address, drive time, assets, people.
export default async function EmployersPage() {
  const { employers, institutions } = await getEmployersDirectory();
  const secured = employers.filter((e) => e.agreementStatus === "secured" || e.hosting.agreements.some((a) => a.status === "secured")).length;
  const located = employers.filter((e) => e.geo.lat != null).length;
  const unlocated = employers.filter((e) => e.geo.lat == null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">All organizations</h1>
          <p className="text-sm text-slate-500">{employers.length} partners · {secured} with a secured agreement · {located} located from their address{unlocated.length ? <span className="text-amber-700"> · {unlocated.length} without a usable address</span> : null}. What a site means to a program is set on that program&apos;s clinical pages.</p>
        </div>
        {institutions.filter((i) => employers.some((e) => e.institution.id === i.id)).map((i) => (
          <form key={i.id} action={locateInstitutionSites.bind(null, i.id)}><button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">Re-locate every site &amp; recompute drive times</button></form>
        ))}
      </div>
      <EmployerDirectory employers={employers} institutions={institutions} />
    </div>
  );
}
