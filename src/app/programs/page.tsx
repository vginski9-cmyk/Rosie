import Link from "next/link";
import { getInstitutionsHome, getFamiliesClinical } from "@/lib/queries";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

// PROGRAMS — one card per job, with the program that delivers it and the four things you do
// with a program: design it, set up its clinical sites, run offerings, follow the students.

const TERM_LABEL: Record<string, string> = { FALL: "Fall", SPRING: "Spring", SUMMER: "Summer" };
const entryOf = (launchTerms: string) => launchTerms.split(",").map((t) => TERM_LABEL[t.trim()] ?? t.trim()).filter(Boolean).join(" · ");

export default async function ProgramsPage() {
  const [institutions, clinical] = await Promise.all([getInstitutionsHome(), getFamiliesClinical()]);
  const families = institutions.flatMap((i) => i.families.map((f) => ({ ...f, institution: i.name })));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Programs</h1>
          <p className="text-sm text-slate-500">Design the program, set up its clinical sites, run an offering, follow the students.</p>
        </div>
        <Link href="/programs/new" className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">+ New program</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {families.map((f) => {
          const cl = clinical.find((c) => c.id === f.id);
          return (
            <section key={f.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{f.name}</h2>
                  <div className="text-xs text-slate-500">{f.job}{f.socCode ? ` · SOC ${f.socCode}` : ""} · {f.institution}</div>
                </div>
                <div className="text-right text-xs text-slate-500"><div className="text-xl font-bold tabular-nums text-slate-900">{f.running}</div>running{f.students ? ` · ${fmt.num(f.students)} students` : ""}</div>
              </div>
              <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
                {f.programs.map((p) => (
                  <div key={p.id} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <Link href={`/programs/${p.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.name}</Link>
                      <span className="text-xs text-slate-500">{p.credential ?? "—"} · {entryOf(p.launchTerms)} entry · {p.terms} term{p.terms === 1 ? "" : "s"}{p.seats ? ` · up to ${fmt.num(p.seats)} seats` : ""}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                      <Link href={`/programs/${p.id}/structure`} className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 hover:bg-rose-100 hover:text-rose-700">1 · Design &amp; sequence</Link>
                      <Link href={`/programs/${p.id}/clinical`} className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 hover:bg-rose-100 hover:text-rose-700">2 · Clinical sites &amp; requirements</Link>
                      <Link href={`/programs/${p.id}`} className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 hover:bg-rose-100 hover:text-rose-700">3 · Offerings &amp; calendar</Link>
                      <Link href={`/programs/${p.id}/students`} className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 hover:bg-rose-100 hover:text-rose-700">4 · Students</Link>
                    </div>
                  </div>
                ))}
                {f.programs.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">No program template yet.</div>}
              </div>
              {cl && (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{cl.sites} clinical sites · <span className="text-emerald-700">{cl.secured} secured</span></span>
                  {cl.score && <span className={`rounded-full px-2 py-0.5 font-medium ${cl.score.requiredCovered === cl.score.required ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{cl.score.requiredCovered} of {cl.score.required} required experiences covered</span>}
                  {cl.requirements && !cl.requirements.verified && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">requirement list unverified</span>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
