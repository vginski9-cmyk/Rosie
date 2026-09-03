import Link from "next/link";
import { getFamiliesClinical } from "@/lib/queries";

export const dynamic = "force-dynamic";

const MODEL: Record<string, string> = { hours: "Hours-based", competency: "Competency / case-based", mixed: "Hours + competencies" };

// Clinical sites organized by JOB — each program family administers clinicals
// its own way (set hours in set settings vs. cases and competencies), so each
// gets its own site list, agreements, service areas and supply-vs-demand.
export default async function ClinicalByProgramPage() {
  const fams = await getFamiliesClinical();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical sites by program</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          One clinical picture per job. Surgical technology counts cases in operating rooms; radiography counts hours in fixed rooms, ED, portables, C-arms and fluoro; nurse aides need supervised hours in long-term care; medical assistants need an office externship. Each family keeps its own service areas, requirement grid, site agreements, allocated shifts and supply-vs-demand.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {fams.map((f) => (
          <Link key={f.id} href={`/families/${f.id}/clinical`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-rose-300 hover:bg-rose-50/30">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-900">{f.name}</div>
                <div className="text-xs text-slate-500">{f.occupation ?? ""}{f.soc ? ` · SOC ${f.soc}` : ""} · {f.institution}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${f.clinicalModel === "competency" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>{MODEL[f.clinicalModel] ?? f.clinicalModel}</span>
            </div>
            {f.clinicalNotes && <p className="mt-2 text-xs text-slate-600">{f.clinicalNotes}</p>}
            <div className="mt-3 flex flex-wrap gap-1">{f.areas.map((a) => <span key={a.code} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"><span className="font-mono text-slate-400">{a.code}</span> {a.name}</span>)}</div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
              <span><strong>{f.sites}</strong> sites</span><span className="text-emerald-700"><strong>{f.secured}</strong> secured</span><span className="text-amber-700"><strong>{f.asked}</strong> asked</span><span><strong>{f.allocations}</strong> shift allocations</span><span><strong>{f.programs}</strong> template{f.programs === 1 ? "" : "s"}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
