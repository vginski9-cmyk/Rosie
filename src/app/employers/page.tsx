import Link from "next/link";
import { getEmployersDirectory } from "@/lib/queries";
import { locateInstitutionSites } from "@/lib/actions";
import { EmployerDirectory } from "@/components/EmployerDirectory";
import { dec } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function EmployersPage() {
  const { employers, institutions } = await getEmployersDirectory();
  const active = employers.filter((e) => e.status === "active").length;
  const hosting = employers.filter((e) => e.hosting.sections > 0).length;
  const secured = employers.filter((e) => e.agreementStatus === "secured" || e.hosting.agreements.some((a) => a.status === "secured")).length;
  const students = employers.reduce((n, e) => n + e.hosting.students, 0);
  const located = employers.filter((e) => e.geo.lat != null).length;
  const unlocated = employers.filter((e) => e.geo.lat == null);
  const byRing = new Map<string, number>(); for (const e of employers) byRing.set(e.ring ?? "unknown", (byRing.get(e.ring ?? "unknown") ?? 0) + 1);
  const sources = new Map<string, number>(); for (const e of employers) if (e.geo.source) sources.set(e.geo.source, (sources.get(e.geo.source) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical sites &amp; employer partners</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The physical supply of clinical placement: every hospital, surgery center, nursing home and office in the region
          — with its beds, operating rooms and <strong>functional units</strong> (the shift structure, days open, students
          and preceptors per shift) — and where each one stands on an agreement with you. Open a site to configure its
          units and see the sections it hosts.
          {" "}{employers.length} sites · {active} open · {secured} with a secured agreement · {hosting} hosting {students} student placements on the calendar.
        </p>
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-700">Where every site is — auto-coded from its address</h2>
            <p className="mt-0.5 max-w-3xl text-xs text-slate-500">Nobody types a ring. Each site is located from its street address, the drive from the institution&apos;s main campus is estimated, and the ring (Core / Ring 1 / Ring 2 / Ring 3) falls out of that drive under the institution&apos;s own bands — set the bands and the main campus address on the <Link href="/orgs" className="text-rose-600 hover:underline">organization page</Link>. A site page can pin a coordinate or override a ring by hand when the estimate is wrong.</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{located} of {employers.length} sites located</span>
              {[...sources.entries()].map(([k, n]) => <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{n} by {k === "census" ? "Census geocoder (street-level)" : k === "gazetteer" ? "built-in gazetteer (town centre — ±1–2 mi)" : "hand-pinned coordinate"}</span>)}
              {["Core", "Ring 1", "Ring 2", "Ring 3"].filter((r) => byRing.get(r)).map((r) => <span key={r} className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800 ring-1 ring-emerald-200">{byRing.get(r)} {r}</span>)}
              {unlocated.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">⚠ {unlocated.length} without a usable address: {unlocated.slice(0, 4).map((e) => e.name).join(", ")}{unlocated.length > 4 ? "…" : ""}</span>}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">Drive time = straight-line distance × {dec(1.25, 2)} road factor at rural / regional speeds, plus 4 minutes to park — an estimate for banding, not a route.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            {institutions.filter((i) => employers.some((e) => e.institution.id === i.id)).map((i) => (
              <form key={i.id} action={locateInstitutionSites.bind(null, i.id)}>
                <button className="w-full rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700">Locate sites &amp; compute drive times — {i.name}</button>
              </form>
            ))}
          </div>
        </div>
      </section>
      <EmployerDirectory employers={employers} institutions={institutions} />
    </div>
  );
}
