import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

// PROGRAMS — three levels, one at a time: the colleges; a college's job families; a family's
// programs with every offering that runs them. ?inst= opens a college, ?family= opens a family.

const TERM_LABEL: Record<string, string> = { FALL: "Fall", SPRING: "Spring", SUMMER: "Summer" };
const entryOf = (launchTerms: string) => launchTerms.split(",").map((t) => TERM_LABEL[t.trim()] ?? t.trim()).filter(Boolean).join(" · ");
const STATUS: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400" };
const STATUS_LABEL: Record<string, string> = { active: "in program", planned: "planned", completed: "graduated", archived: "archived" };
const dateOf = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const thisYear = new Date().getUTCFullYear();
const goalsOf = (goalPlan: string | null) => { try { const g = JSON.parse(goalPlan ?? "{}").goalsByYear ?? {}; return Object.fromEntries(Object.entries(g).map(([y, v]) => [Number(y), Number(v) || 0])) as Record<number, number>; } catch { return {} as Record<number, number>; } };

export default async function ProgramsPage({ searchParams }: { searchParams: { inst?: string; family?: string } }) {
  const institutions = await prisma.institution.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, shortName: true, kind: true, city: true, state: true,
      programFamilies: { orderBy: { name: "asc" }, select: { id: true, name: true, goalPlan: true, occupation: { select: { title: true, socCode: true } }, _count: { select: { familySites: true } },
        programs: { orderBy: { name: "asc" }, select: { id: true, name: true, credential: true, programType: true, launchTerms: true, defaultCohortSeats: true, _count: { select: { terms: true } },
          cohorts: { orderBy: [{ startDate: "asc" }, { name: "asc" }], select: { id: true, name: true, status: true, startDate: true, _count: { select: { students: true } }, stages: { where: { stageKey: "productive" }, select: { targetNumber: true } } } } } } } },
    },
  });
  const inst = searchParams.inst ? institutions.find((i) => i.id === searchParams.inst) : undefined;
  const family = inst && searchParams.family ? inst.programFamilies.find((f) => f.id === searchParams.family) : undefined;
  const running = (fs: (typeof institutions)[number]["programFamilies"]) => fs.reduce((n, f) => n + f.programs.reduce((m, p) => m + p.cohorts.filter((c) => c.status === "active" || c.status === "planned").length, 0), 0);
  const students = (fs: (typeof institutions)[number]["programFamilies"]) => fs.reduce((n, f) => n + f.programs.reduce((m, p) => m + p.cohorts.reduce((k, c) => k + c._count.students, 0), 0), 0);

  // ── Level 3: one family — its programs and every offering ────────────────────────────────────
  if (inst && family) {
    const goals = goalsOf(family.goalPlan);
    return (
      <div className="space-y-6">
        <PageHeader crumb={{ href: `/programs?inst=${inst.id}`, label: inst.name }} title={family.occupation?.title ?? family.name} lede={<>{family.name}{family.occupation?.socCode ? ` · SOC ${family.occupation.socCode}` : ""} · {inst.name}</>} meta={<>{family.programs.length} program{family.programs.length === 1 ? "" : "s"} · {running([family])} offering{running([family]) === 1 ? "" : "s"} running · {fmt.num(students([family]))} students · {family._count.familySites} clinical sites</>}
          actions={family.programs[0] ? <><Link href={`/programs/${family.programs[0].id}/goal`} className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Goal &amp; pipeline →</Link><Link href={`/programs/${family.programs[0].id}/clinical`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Clinical sites →</Link></> : undefined} />
        <div className="flex flex-wrap items-end gap-1.5">
          {[thisYear, thisYear + 1, thisYear + 2, thisYear + 3, thisYear + 4].map((y) => <div key={y} className={`rounded-lg px-2.5 py-1 text-center ${y === thisYear ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-700"}`}><div className="text-lg font-bold tabular-nums leading-tight">{fmt.num(goals[y] ?? 0)}</div><div className={`text-[10px] ${y === thisYear ? "text-slate-300" : "text-slate-400"}`}>{y}</div></div>)}
          <span className="pb-1 pl-1 text-[10px] uppercase tracking-wide text-slate-400">fully productive workers a year — the North Star goal</span>
        </div>
        <div className="space-y-4">
          {family.programs.map((p) => (
            <section key={p.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-5 py-3">
                <div>
                  <Link href={`/programs/${p.id}`} className="text-lg font-semibold text-slate-900 hover:text-rose-700 hover:underline">{p.name}</Link>
                  <div className="text-xs text-slate-500">{[p.credential, p.programType, `${entryOf(p.launchTerms)} entry`, `${p._count.terms} term${p._count.terms === 1 ? "" : "s"}`, p.defaultCohortSeats ? `up to ${fmt.num(p.defaultCohortSeats)} seats` : null].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {([["Design & sequence", "structure"], ["Clinical sites", "clinical"], ["Goal & pipeline", "goal"], ["Students", "students"]] as [string, string][]).map(([l, seg]) => <Link key={seg} href={`/programs/${p.id}/${seg}`} className="rounded-full bg-slate-50 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-200 hover:text-rose-700 hover:ring-rose-300">{l}</Link>)}
                </div>
              </div>
              {p.cohorts.length === 0 ? <p className="px-5 py-3 text-sm text-slate-400">No offerings yet — lock one in from the goal planner.</p> : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-2">Offering</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Starts</th><th className="px-3 py-2 text-right">Goal</th><th className="px-3 py-2 text-right">Students</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {p.cohorts.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/60">
                        <td className="px-5 py-2"><Link href={`/programs/${p.id}/offerings/${c.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{c.name}</Link></td>
                        <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[c.status] ?? "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[c.status] ?? c.status}</span></td>
                        <td className="px-3 py-2 text-slate-600">{dateOf(c.startDate)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt.num(c.stages[0]?.targetNumber ?? 0)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">{fmt.num(c._count.students)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ))}
          {family.programs.length === 0 && <p className="text-sm text-slate-400">No programs in this family yet.</p>}
        </div>
      </div>
    );
  }

  // ── Level 2: one college — its job families ───────────────────────────────────────────────────
  if (inst) {
    return (
      <div className="space-y-6">
        <PageHeader crumb={{ href: "/programs", label: "Programs" }} title={inst.name} lede="The jobs this college is working toward. Open one for its programs and offerings." meta={[inst.kind, [inst.city, inst.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")} actions={<Link href={`/orgs/${inst.id}`} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Setup →</Link>} />
        <div className="grid gap-3 md:grid-cols-2">
          {inst.programFamilies.map((f) => {
            const goals = goalsOf(f.goalPlan);
            return (
              <Link key={f.id} href={`/programs?inst=${inst.id}&family=${f.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-rose-300">
                <div className="text-lg font-semibold text-slate-900">{f.occupation?.title ?? f.name}</div>
                <div className="text-xs text-slate-500">{f.name}{f.occupation?.socCode ? ` · SOC ${f.occupation.socCode}` : ""}</div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span><strong className="text-slate-900">{fmt.num(goals[thisYear] ?? 0)}</strong> workers a year, {thisYear} goal</span>
                  <span><strong className="text-slate-900">{f.programs.length}</strong> program{f.programs.length === 1 ? "" : "s"}</span>
                  <span><strong className="text-slate-900">{running([f])}</strong> offering{running([f]) === 1 ? "" : "s"} running</span>
                  <span><strong className="text-slate-900">{fmt.num(students([f]))}</strong> students</span>
                  <span><strong className="text-slate-900">{f._count.familySites}</strong> clinical sites</span>
                </div>
              </Link>
            );
          })}
          {inst.programFamilies.length === 0 && <p className="text-sm text-slate-400">No target jobs yet. Add a North Star goal on Home.</p>}
        </div>
      </div>
    );
  }

  // ── Level 1: the colleges ──────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader title="Programs" lede="Open a college for its jobs, a job for its programs and every offering." actions={<Link href="/programs/new" className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">+ New program</Link>} />
      <div className="grid gap-3 md:grid-cols-2">
        {institutions.map((i) => (
          <Link key={i.id} href={`/programs?inst=${i.id}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-rose-300">
            <div className="text-lg font-semibold text-slate-900">{i.name}</div>
            <div className="text-xs text-slate-500">{[i.kind, [i.city, i.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
              <span><strong className="text-slate-900">{i.programFamilies.length}</strong> target job{i.programFamilies.length === 1 ? "" : "s"}</span>
              <span><strong className="text-slate-900">{i.programFamilies.reduce((n, f) => n + f.programs.length, 0)}</strong> programs</span>
              <span><strong className="text-slate-900">{running(i.programFamilies)}</strong> offerings running</span>
              <span><strong className="text-slate-900">{fmt.num(students(i.programFamilies))}</strong> students</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">{i.programFamilies.map((f) => f.occupation?.title ?? f.name).join(" · ") || "no target jobs yet"}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
