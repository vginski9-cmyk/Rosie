import Link from "next/link";
import { getFamiliesClinical, getFamilyProgramId } from "@/lib/queries";
import { CoverageHeadline } from "@/components/Evidence";

export const dynamic = "force-dynamic";

// CLINICAL SITES BY PROGRAM — one card per program; each opens that program's own network.
export default async function ClinicalByProgramPage() {
  const fams = await getFamiliesClinical();
  const hrefs = new Map(await Promise.all(fams.map(async (f) => [f.id, await getFamilyProgramId(f.id)] as const)));
  const live = fams.filter((f) => f.sites > 0), empty = fams.filter((f) => f.sites === 0);
  const Card = ({ f }: { f: (typeof fams)[number] }) => {
    const pct = f.score && f.score.required ? f.score.requiredCovered / f.score.required : null;
    const pid = hrefs.get(f.id);
    return (
      <Link href={pid ? `/programs/${pid}/clinical` : `/families/${f.id}/clinical`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-rose-300 hover:bg-rose-50/30">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{f.name}</div>
            <div className="text-xs text-slate-500">{f.occupation ?? ""}{f.soc ? ` · SOC ${f.soc}` : ""} · {f.institution}</div>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">counted by {f.capacityBasis}</span>
        </div>
        {f.requirements ? <p className="mt-2 text-xs text-slate-600">{f.requirements.authority.split(" · ")[0]}: {f.requirements.kind === "cases" ? "case log by specialty and scrub role" : f.requirements.kind === "hours" ? "set hours in set settings" : `${f.requirements.mandatory} required + ${f.requirements.elective} elective competencies`}{f.requirements.verified ? "" : " · unverified"}</p> : <p className="mt-2 text-xs text-amber-700">No requirement set loaded.</p>}
        {pct != null && f.score && (
          <div className="mt-2">
            <div className="text-[11px] text-slate-600">Required experiences, from the weakest input</div>
            <div className="mt-0.5"><CoverageHeadline score={f.score} unverifiedStandard={!!f.requirements && !f.requirements.verified} /></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><div className="flex h-full"><div className="h-full bg-emerald-500" style={{ width: `${Math.round((f.score.requiredConfirmed / f.score.required) * 100)}%` }} /><div className="h-full bg-amber-400" style={{ width: `${Math.round(Math.max(0, pct - f.score.requiredConfirmed / f.score.required) * 100)}%` }} /></div></div>
            {f.score.gaps.length > 0 && <div className="mt-0.5 text-[10px] text-rose-600">missing: {f.score.gaps.slice(0, 3).join(", ")}{f.score.gaps.length > 3 ? ` +${f.score.gaps.length - 3}` : ""}</div>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
          <span><strong>{f.sites}</strong> sites</span><span className="text-emerald-700"><strong>{f.secured}</strong> secured</span><span className="text-amber-700"><strong>{f.asked}</strong> asked</span>
          <span className="ml-auto rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white">Open →</span>
        </div>
      </Link>
    );
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical sites by program</h1>
        <p className="text-sm text-slate-500">Each program keeps its own sites, set up the way that program counts them.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">{live.map((f) => <Card key={f.id} f={f} />)}</div>
      {empty.length > 0 && (
        <details className="rounded-xl border border-dashed border-slate-300 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">{empty.length} program{empty.length === 1 ? "" : "s"} with no clinical site yet ▸</summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">{empty.map((f) => <Card key={f.id} f={f} />)}</div>
        </details>
      )}
    </div>
  );
}
