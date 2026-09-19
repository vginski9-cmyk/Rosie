import Link from "next/link";
import { getInstitutionsHome, getInstitutionsLite } from "@/lib/queries";
import { deleteNorthStarGoal } from "@/lib/actions";
import { NewGoalForm } from "@/components/NewGoalForm";
import { PageHeader } from "@/components/PageHeader";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

// HOME — the colleges and their workforce targets: each college, the jobs it is working toward with
// the goal for each year, and the programs that deliver them. Nothing else.

const CRED_BADGE: Record<string, string> = {
  AAS: "bg-rose-100 text-rose-700", BSN: "bg-fuchsia-100 text-fuchsia-700", Diploma: "bg-violet-100 text-violet-700",
  Certificate: "bg-sky-100 text-sky-700", Cert: "bg-sky-100 text-sky-700", Other: "bg-slate-100 text-slate-600",
};

export default async function HomePage() {
  const [institutions, lite] = await Promise.all([getInstitutionsHome(), getInstitutionsLite()]);
  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear + 1, thisYear + 2, thisYear + 3, thisYear + 4];
  const totals = { jobs: institutions.reduce((n, i) => n + i.families.length, 0), programs: institutions.reduce((n, i) => n + i.programs, 0), goal: institutions.reduce((n, i) => n + i.thisYearGoal, 0) };

  return (
    <div className="space-y-6">
      <PageHeader title="Workforce targets" lede="Each college, the jobs it is working toward, the goal for each year, and the programs that deliver them." meta={<>{institutions.length} colleges · {totals.jobs} target job{totals.jobs === 1 ? "" : "s"} · {totals.programs} programs · {fmt.num(totals.goal)} fully productive workers as the {thisYear} goal</>} actions={<NewGoalForm institutions={lite} />} />

      <div className="grid gap-4 lg:grid-cols-2">
        {institutions.map((inst) => (
          <section key={inst.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900"><Link href={`/programs?inst=${inst.id}`} className="hover:text-rose-700 hover:underline">{inst.name}</Link></h2>
                <div className="text-xs text-slate-500">{[inst.kind, [inst.city, inst.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="text-xs text-slate-500">{inst.programs} program{inst.programs === 1 ? "" : "s"} · {inst.running} offering{inst.running === 1 ? "" : "s"} running · <Link href={`/orgs/${inst.id}`} className="text-rose-600 hover:underline">setup</Link></div>
            </div>
            {inst.families.length === 0 && <p className="px-5 py-4 text-sm text-slate-400">No target jobs yet. Add a North Star goal.</p>}
            <div className="divide-y divide-slate-100">
              {inst.families.map((f) => (
                <div key={f.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link href={f.programs[0] ? `/programs/${f.programs[0].id}/goal` : `/programs?inst=${inst.id}&family=${f.id}`} className="text-base font-semibold text-slate-800 hover:text-rose-700 hover:underline">{f.job}</Link>
                      <div className="text-xs text-slate-500">{f.name}{f.socCode ? ` · SOC ${f.socCode}` : ""}</div>
                    </div>
                    <form action={deleteNorthStarGoal.bind(null, f.id)}><button className="rounded p-1 text-xs text-slate-300 hover:text-rose-600" title="clear this North Star goal (the job family, its sites and records stay)">✕</button></form>
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-1.5">
                    {years.map((y) => (
                      <div key={y} className={`rounded-lg px-2 py-1 text-center ${y === thisYear ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-700"}`}>
                        <div className="text-lg font-bold tabular-nums leading-tight">{fmt.num(f.goalsByYear[y] ?? 0)}</div>
                        <div className={`text-[10px] ${y === thisYear ? "text-slate-300" : "text-slate-400"}`}>{y}</div>
                      </div>
                    ))}
                    <span className="pb-1 pl-1 text-[10px] uppercase tracking-wide text-slate-400">fully productive workers a year</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {f.programs.map((p) => (
                      <Link key={p.id} href={`/programs/${p.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs ring-1 ring-slate-200 hover:ring-rose-300">
                        <span className="font-medium text-slate-700">{p.name}</span>
                        <span className={`rounded px-1 text-[9px] ${CRED_BADGE[p.credential ?? "Other"] ?? CRED_BADGE.Other}`}>{p.credential ?? "—"}</span>
                        <span className="text-slate-400">{p.running} running</span>
                      </Link>
                    ))}
                    {f.programs.length === 0 && <span className="text-xs text-slate-400">No programs yet.</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
