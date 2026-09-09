import Link from "next/link";
import { getOrganizations, getInstitutionsHome, getFamiliesClinical } from "@/lib/queries";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

// HOME — where things stand, in the order the work happens:
//   1. the institution's own setup (calendar, rooms, people, policies)
//   2. each program: designed, running, and its clinical network
//   3. the clinical partners: sites set up per program
//   4. the analyses that fall out of all of it
// Every card is a door into one place; nothing here is a menu.

const STEPS: { key: "basics" | "calendar" | "rooms" | "sites" | "assets" | "people" | "policies" | "programs"; label: string; anchor: string }[] = [
  { key: "basics", label: "Basics", anchor: "#basics" }, { key: "calendar", label: "Academic calendar", anchor: "#calendar" }, { key: "rooms", label: "Rooms & labs", anchor: "#rooms" },
  { key: "people", label: "People", anchor: "#people" }, { key: "policies", label: "Workload policies", anchor: "#people" }, { key: "sites", label: "Clinical sites", anchor: "#sites" },
];

export default async function HomePage() {
  const [orgs, institutions, clinical] = await Promise.all([getOrganizations(), getInstitutionsHome(), getFamiliesClinical()]);
  const thisYear = new Date().getUTCFullYear();
  return (
    <div className="space-y-8">
      {institutions.map((inst) => {
        const org = orgs.find((o) => o.id === inst.id);
        const done = org ? STEPS.filter((s) => org.setup[s.key]).length : 0;
        return (
          <div key={inst.id} className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{inst.name}</h1>
                <p className="text-sm text-slate-500">{[inst.kind, [inst.city, inst.state].filter(Boolean).join(", "), inst.serviceArea].filter(Boolean).join(" · ")}</p>
              </div>
              <Link href="/goals" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">North Star goals — {fmt.num(inst.thisYearGoal)} placements in {thisYear} →</Link>
            </div>

            {/* 1 · Institution setup */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">1 · Institution setup <span className="text-sm font-normal text-slate-400">— set once, inherited by every program</span></h2>
                  <p className="max-w-3xl text-sm text-slate-500">The academic calendar the offerings follow, the rooms and labs classes sit in, the people who teach and precept, and the workload policies that turn their hours into load.</p>
                </div>
                <Link href={`/orgs/${inst.id}`} className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Open setup →</Link>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {STEPS.map((s) => <Link key={s.key} href={`/orgs/${inst.id}${s.anchor}`} className={`rounded-full px-2.5 py-1 text-xs font-medium ${org?.setup[s.key] ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-1 ring-amber-200"}`}>{org?.setup[s.key] ? "✓" : "○"} {s.label}</Link>)}
                <span className="self-center text-xs text-slate-400">{done} of {STEPS.length} done{org ? ` · ${org.counts.facilities} rooms · ${org.counts.people} people · ${org.counts.employers} clinical sites` : ""}</span>
              </div>
            </section>

            {/* 2 · Programs */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">2 · Programs <span className="text-sm font-normal text-slate-400">— design it, run it, calendar it</span></h2>
                  <p className="max-w-3xl text-sm text-slate-500">Each program template is the timeless design: terms, courses, and every class, lab and clinical session with its capacity and staffing. An offering runs it for a cohort with real dates, rooms, instructors, preceptors and students.</p>
                </div>
                <Link href="/programs" className="text-sm text-rose-600 hover:underline">All programs →</Link>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {inst.families.map((f) => {
                  const cl = clinical.find((c) => c.id === f.id);
                  return (
                    <div key={f.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div><div className="text-base font-semibold text-slate-900">{f.name}</div><div className="text-xs text-slate-500">{f.job}{f.socCode ? ` · SOC ${f.socCode}` : ""}</div></div>
                        <div className="text-right text-xs text-slate-500"><span className="text-lg font-bold tabular-nums text-slate-900">{f.running}</span> running{f.students ? ` · ${fmt.num(f.students)} students` : ""}</div>
                      </div>
                      <div className="mt-2 space-y-1">
                        {f.programs.map((p) => (
                          <div key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-100 px-3 py-1.5 text-sm">
                            <Link href={`/programs/${p.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                            <span className="text-xs text-slate-500">{p.credential ?? "—"} · {p.terms} terms{p.seats ? ` · ${fmt.num(p.seats)} seats` : ""}</span>
                            <span className="ml-auto flex gap-1 text-[11px]">
                              <Link href={`/programs/${p.id}/structure`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-rose-100 hover:text-rose-700">design</Link>
                              <Link href={`/programs/${p.id}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-rose-100 hover:text-rose-700">offerings</Link>
                              <Link href={`/programs/${p.id}/students`} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700 hover:bg-rose-100 hover:text-rose-700">students</Link>
                            </span>
                          </div>
                        ))}
                      </div>
                      {cl && (
                        <Link href={`/families/${f.id}/clinical`} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs hover:bg-rose-50">
                          <span className="font-medium text-slate-800">Clinical sites &amp; requirements →</span>
                          <span className="text-slate-600">{cl.sites} sites · <span className="text-emerald-700">{cl.secured} secured</span></span>
                          {cl.score && <span className={`rounded-full px-2 py-0.5 font-medium ${cl.score.requiredCovered === cl.score.required ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{cl.score.requiredCovered} of {cl.score.required} required experiences covered</span>}
                          {cl.score && cl.score.unverified > 0 && <span className="text-slate-500">{cl.score.unverified} unconfirmed</span>}
                        </Link>
                      )}
                    </div>
                  );
                })}
                {inst.families.length === 0 && <p className="text-sm text-slate-400">No programs yet — add a North Star goal for a job first.</p>}
              </div>
            </section>

            {/* 3 · Clinical partners */}
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">3 · Clinical partners <span className="text-sm font-normal text-slate-400">— every site set up per program</span></h2>
                  <p className="max-w-3xl text-sm text-slate-500">A hospital is one organization but many things to many programs. Each program keeps its own site list; on each site you set the agreement, the rooms and shift structures students are placed on, the qualified staff, the availability, and — item by item — which required experiences the site provides.</p>
                </div>
                <div className="flex gap-2"><Link href="/clinical" className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Sites by program →</Link><Link href="/employers" className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">All organizations</Link></div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {clinical.filter((c) => c.institutionId === inst.id && c.sites > 0).map((c) => (
                  <Link key={c.id} href={`/families/${c.id}/clinical`} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-rose-200 hover:bg-rose-50/40">
                    <span className="font-medium text-slate-800">{c.name}</span>
                    <span className="text-xs text-slate-500">{c.sites} sites · {c.secured} secured · {c.asked} asked</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* 4 · Insights */}
            <section>
              <h2 className="text-lg font-semibold">4 · What it adds up to</h2>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                {[
                  ["/insights/staffing-need", "Instructors & preceptors needed", "FTE and contact hours by term, from every offering's sessions"],
                  ["/insights/coverage", "Daily coverage", "who is where, every day, and the gaps"],
                  ["/scheduler", "Clinical scheduler", "clinical supply vs demand week by week"],
                  ["/insights/clinical-sites", "Clinical site capacity", "can the region's sites absorb the cohorts"],
                  ["/utilization", "Room utilization", "campus rooms and labs by hour"],
                  ["/semester", "Semester", "every offering running in one term"],
                  ["/calendar", "Calendar", "the master calendar"],
                  ["/insights", "Explore", "pivot across every metric"],
                ].map(([href, label, hint]) => <Link key={href} href={href} className="rounded-xl border border-slate-200 bg-white px-3 py-2 hover:border-rose-200 hover:bg-rose-50/40"><div className="font-medium text-slate-800">{label}</div><div className="text-xs text-slate-500">{hint}</div></Link>)}
              </div>
            </section>
          </div>
        );
      })}
    </div>
  );
}
