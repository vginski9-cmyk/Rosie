import Link from "next/link";
import { getOrganizations } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Organizations — every institution in the workspace and how far its set-up
// has come: basics, academic calendar, rooms, clinical sites & assets, people,
// workload policies, programs. Open one to map everything in one place.

const STEPS: { key: keyof Awaited<ReturnType<typeof getOrganizations>>[number]["setup"]; label: string }[] = [
  { key: "basics", label: "Basics" }, { key: "calendar", label: "Calendar" }, { key: "rooms", label: "Rooms" }, { key: "sites", label: "Sites" },
  { key: "assets", label: "Assets" }, { key: "people", label: "People" }, { key: "policies", label: "Policies" }, { key: "programs", label: "Programs" },
];

export default async function OrganizationsPage() {
  const orgs = await getOrganizations();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organizations — set up &amp; map</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Set each institution up once — its basics, academic calendar, rooms and labs, clinical sites and their physical assets, people and
          the workload policies that govern them — and every program, course, session and offering configured afterwards inherits it.
          {" "}{orgs.length} institutions.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {orgs.map((o) => {
          const done = STEPS.filter((s) => o.setup[s.key]).length;
          return (
            <Link key={o.id} href={`/orgs/${o.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-rose-300 hover:bg-rose-50/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">{o.name}</div>
                  <div className="text-xs text-slate-500">{[o.kind, [o.city, o.state].filter(Boolean).join(", "), o.serviceArea].filter(Boolean).join(" · ") || "no basics yet"}</div>
                </div>
                <div className="text-right"><div className="text-xl font-bold tabular-nums text-slate-900">{done}/{STEPS.length}</div><div className="text-[10px] uppercase tracking-wide text-slate-400">set up</div></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {STEPS.map((s) => <span key={s.key} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${o.setup[s.key] ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400"}`}>{o.setup[s.key] ? "✓ " : ""}{s.label}</span>)}
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                {o.counts.codedSemesters} coded semesters · {o.counts.facilities} rooms · {o.counts.employers} sites · {o.counts.assets} assets · {o.counts.people} people · {o.counts.workloadPolicies} policies · {o.counts.programFamilies} jobs · {o.counts.programs} programs
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
