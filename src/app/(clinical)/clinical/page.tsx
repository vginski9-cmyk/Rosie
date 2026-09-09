import Link from "next/link";
import { getFamiliesClinical } from "@/lib/queries";

export const dynamic = "force-dynamic";

const MODEL: Record<string, string> = { hours: "Hours-based", competency: "Competency / case-based", mixed: "Hours + competencies" };

// Clinical sites organized by JOB — each program family administers clinicals
// its own way (set hours in set settings vs. cases and competencies), so each
// gets its own site list, agreements, service areas and supply-vs-demand.
export default async function ClinicalByProgramPage() {
  const fams = await getFamiliesClinical();
  const live = fams.filter((f) => f.sites > 0), empty = fams.filter((f) => f.sites === 0);
  const Card = ({ f }: { f: (typeof fams)[number] }) => {
    const pct = f.score && f.score.required ? f.score.requiredCovered / f.score.required : null;
    return (
      <Link href={`/families/${f.id}/clinical`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-rose-300 hover:bg-rose-50/30">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-slate-900">{f.name}</div>
            <div className="text-xs text-slate-500">{f.occupation ?? ""}{f.soc ? ` · SOC ${f.soc}` : ""} · {f.institution}</div>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${f.clinicalModel === "competency" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>{MODEL[f.clinicalModel] ?? f.clinicalModel}</span>
        </div>
        {f.requirements ? <p className="mt-2 text-xs text-slate-700"><span className="font-semibold">Completion requires</span> ({f.requirements.authority.split(" · ")[0]}): {f.requirements.kind === "cases" ? "a case log by specialty and scrub role" : f.requirements.kind === "hours" ? "set hours in set settings" : `${f.requirements.mandatory} mandatory + ${f.requirements.elective} elective competencies`} across {f.requirements.categories} categories · availability counted by {f.capacityBasis}{f.requirements.verified ? "" : " · starter content, unverified"}</p> : <p className="mt-2 text-xs text-amber-700">No requirement set loaded — add the credentialing body&apos;s list.</p>}
        {pct != null && f.score && (
          <div className="mt-2">
            <div className="flex items-baseline justify-between text-[11px]"><span className="text-slate-600">Required experiences a secured site provides</span><span className={`font-semibold tabular-nums ${pct >= 1 ? "text-emerald-700" : "text-rose-700"}`}>{f.score.requiredCovered} of {f.score.required}</span></div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-slate-100"><div className={`h-full ${pct >= 1 ? "bg-emerald-500" : pct >= 0.8 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${Math.round(pct * 100)}%` }} /></div>
            {(f.score.gaps.length > 0 || f.score.unverified > 0) && <div className="mt-0.5 text-[10px] text-slate-500">{f.score.gaps.length ? <span className="text-rose-600">missing: {f.score.gaps.slice(0, 3).join(", ")}{f.score.gaps.length > 3 ? ` +${f.score.gaps.length - 3}` : ""}</span> : null}{f.score.gaps.length && f.score.unverified ? " · " : ""}{f.score.unverified ? `${f.score.unverified} rest on unconfirmed inference` : ""}</div>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1">{f.areas.map((a) => <span key={a.code} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"><span className="font-mono text-slate-400">{a.code}</span> {a.name}</span>)}</div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
          <span><strong>{f.sites}</strong> sites</span><span className="text-emerald-700"><strong>{f.secured}</strong> secured</span><span className="text-amber-700"><strong>{f.asked}</strong> asked</span><span><strong>{f.programs}</strong> template{f.programs === 1 ? "" : "s"}</span>
          <span className="ml-auto rounded-lg bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white">Open clinical setup →</span>
        </div>
      </Link>
    );
  };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clinical setup by program</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          One clinical setup per job — never one list of sites for everybody. Surgical technology counts cases in operating rooms and a case log by specialty and scrub role; radiography counts seats in rooms, ED, portables, C-arms and fluoro under JRCERT-approved capacity and an ARRT competency list; nurse aides need supervised hours in long-term care. Each program keeps its own sites, and every site is set up for that program: agreement, recognition, assets and shift structures, qualified staff, availability, and — item by item — which required experiences it provides.
        </p>
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
