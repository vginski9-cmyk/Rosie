import Link from "next/link";
import { getInstitutionsHome, getInstitutionsLite } from "@/lib/queries";
import { deleteNorthStarGoal } from "@/lib/actions";
import { NewGoalForm } from "@/components/NewGoalForm";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

// The home page reads by INSTITUTION: each college or university, then the
// jobs it is working toward (each with its North-Star goal), then the
// programs — the delivery models — that deliver toward each job.

const CRED_BADGE: Record<string, string> = {
  AAS: "bg-rose-100 text-rose-700", BSN: "bg-fuchsia-100 text-fuchsia-700", Diploma: "bg-violet-100 text-violet-700",
  Certificate: "bg-sky-100 text-sky-700", Cert: "bg-sky-100 text-sky-700", Other: "bg-slate-100 text-slate-600",
};
const TERM_LABEL: Record<string, string> = { FALL: "Fall", SPRING: "Spring", SUMMER: "Summer" };
const entryOf = (launchTerms: string) => launchTerms.split(",").map((t) => TERM_LABEL[t.trim()] ?? t.trim()).filter(Boolean).join(" · ");

export default async function HomePage() {
  const [institutions, lite] = await Promise.all([getInstitutionsHome(), getInstitutionsLite()]);
  const thisYear = new Date().getUTCFullYear();
  const totals = {
    families: institutions.reduce((n, i) => n + i.families.length, 0),
    programs: institutions.reduce((n, i) => n + i.programs, 0),
    goal: institutions.reduce((n, i) => n + i.thisYearGoal, 0),
    running: institutions.reduce((n, i) => n + i.running, 0),
  };
  const years = [thisYear, thisYear + 1, thisYear + 2, thisYear + 3];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">North Star goals</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            {totals.families} target jobs · {totals.programs} programs · {fmt.num(totals.goal)} fully-productive placements as the {thisYear} goal · {totals.running} offerings running.
          </p>
        </div>
        <NewGoalForm institutions={lite} />
      </div>

      {/* Jump list */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {institutions.map((i) => <a key={i.id} href={`#inst-${i.id}`} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 hover:bg-rose-100 hover:text-rose-700">{i.shortName ?? i.name}</a>)}
      </div>

      {institutions.map((inst) => (
        <section key={inst.id} id={`inst-${inst.id}`} className="scroll-mt-16 rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Institution header */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-br from-rose-50/60 to-white px-5 py-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">{inst.name}</h2>
              <div className="text-xs text-slate-500">{[inst.kind, [inst.city, inst.state].filter(Boolean).join(", "), inst.serviceArea].filter(Boolean).join(" · ")} · <Link href={`/orgs/${inst.id}`} className="text-rose-600 hover:underline">setup →</Link></div>
            </div>
            <div className="flex flex-wrap gap-4 text-right text-xs text-slate-500">
              <div><div className="text-2xl font-bold tabular-nums text-slate-900">{fmt.num(inst.thisYearGoal)}</div>{thisYear} goal · productive</div>
              <div><div className="text-2xl font-bold tabular-nums text-slate-900">{inst.families.length}</div>target job{inst.families.length === 1 ? "" : "s"}</div>
              <div><div className="text-2xl font-bold tabular-nums text-slate-900">{inst.programs}</div>program{inst.programs === 1 ? "" : "s"}</div>
              <div><div className="text-2xl font-bold tabular-nums text-slate-900">{inst.running}</div>offerings running</div>
              {inst.sites > 0 && <div><div className="text-2xl font-bold tabular-nums text-slate-900">{fmt.num(inst.sites)}</div>clinical sites</div>}
            </div>
          </div>

          {inst.families.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No target jobs yet — add a North Star goal for this institution above.</p>}

          {/* Jobs → goals → programs */}
          <div className="divide-y divide-slate-100">
            {inst.families.map((f) => {
              const onTrack = f.progress != null && f.progress >= 0.9;
              return (
                <div key={f.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(260px,1fr)_minmax(0,1.6fr)]">
                  {/* The job and its North-Star goal */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link href={f.programs[0] ? `/programs/${f.programs[0].id}/goal` : "/programs"} className="text-base font-semibold text-slate-800 hover:text-rose-700 hover:underline">{f.job} ↦</Link>
                        <div className="text-xs text-slate-500">{f.name}{f.socCode ? ` · SOC ${f.socCode}` : ""}</div>
                      </div>
                      <form action={deleteNorthStarGoal.bind(null, f.id)}><button className="rounded p-1 text-xs text-slate-300 hover:text-rose-600" title="delete this North Star goal">✕</button></form>
                    </div>
                    <div className="mt-2 flex items-end gap-1.5">
                      {years.map((y) => (
                        <div key={y} className={`rounded-lg px-2 py-1 text-center ${y === thisYear ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-700"}`}>
                          <div className="text-lg font-bold tabular-nums leading-tight">{fmt.num(f.goalsByYear[y] ?? 0)}</div>
                          <div className={`text-[10px] ${y === thisYear ? "text-slate-300" : "text-slate-400"}`}>{y}</div>
                        </div>
                      ))}
                      <div className="pb-1 pl-1 text-[10px] uppercase tracking-wide text-slate-400">fully productive placements</div>
                    </div>
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">{thisYear} placed so far</span>
                        <span className={f.progress == null ? "text-slate-400" : onTrack ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>{f.progress != null ? `${Math.round(f.progress * 100)}% of the ${thisYear} goal` : "no goal set"}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${onTrack ? "bg-emerald-500" : "bg-rose-400"}`} style={{ width: `${f.progress != null ? Math.min(100, f.progress * 100) : 0}%` }} /></div>
                    </div>
                    {f.programs[0] && <Link href={`/programs/${f.programs[0].id}/goal`} className="mt-2 inline-block text-xs text-rose-600 hover:underline">open the goal planner →</Link>}
                  </div>

                  {/* The programs (delivery models) under this job */}
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Programs delivering toward it · {f.running} offering{f.running === 1 ? "" : "s"} running{f.students ? ` · ${fmt.num(f.students)} students` : ""}</div>
                    {f.programs.length === 0 && <p className="text-xs text-slate-400">No program templates yet.</p>}
                    <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {f.programs.map((p) => (
                        <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm">
                          <Link href={`/programs/${p.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${CRED_BADGE[p.credential ?? "Other"] ?? CRED_BADGE.Other}`}>{p.credential ?? "—"}</span>
                          <span className="text-xs text-slate-500">{entryOf(p.launchTerms)} entry · {p.programType} · {p.terms} term{p.terms === 1 ? "" : "s"}{p.seats ? ` · up to ${fmt.num(p.seats)} seats` : ""}</span>
                          <span className="ml-auto text-xs text-slate-500">{p.running} running{p.students ? ` · ${fmt.num(p.students)} students` : ""}</span>
                          {p.inventoryNote && <span className="basis-full rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-800" title="open question from the program inventory">⚠ {p.inventoryNote}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
