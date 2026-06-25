import Link from "next/link";
import { notFound } from "next/navigation";
import { getOffering } from "@/lib/queries";
import { FunnelChart } from "@/components/FunnelChart";
import { fmt } from "@/lib/format";
import type { StageKey } from "@/lib/funnel";

export const dynamic = "force-dynamic";

const dateFmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

const STATUS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700",
  completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400",
};

export default async function OfferingPage({ params }: { params: { id: string; cohortId: string } }) {
  const offering = await getOffering(params.cohortId);
  if (!offering || offering.programId !== params.id) notFound();
  const program = offering.program;

  // Real date per template term for THIS offering.
  const termDate = new Map(offering.cohortTerms.map((ct) => [ct.termId, ct.startDate]));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name} template</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{offering.name}</h1>
            <p className="text-sm text-slate-500">
              A scheduled offering of <Link href={`/programs/${program.id}`} className="text-rose-700 hover:underline">{program.name}</Link> · {program.institution.name}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS[offering.status] ?? "bg-slate-100 text-slate-600"}`}>{offering.status}</span>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-600">
        <strong>Template vs. offering:</strong> the program defines the structure once, timelessly. This offering binds that
        structure to a real calendar, a specific roster of instructors, and the enrolled students below.
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Starts" value={offering.startDate ? dateFmt(offering.startDate) : "—"} />
        <Tile label="Scheduled terms" value={`${offering.cohortTerms.length} / ${program.terms.length}`} sub="dated of template" />
        <Tile label="Students" value={fmt.num(offering._count.students)} />
        <Tile label="Staff assignments" value={fmt.num(offering._count.sessionStaff)} sub="per-session, this run" />
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Link href={`/programs/${program.id}/offerings/${offering.id}/schedule`} className="btn-primary">Section scheduler ↦</Link>
        <Link href={`/programs/${program.id}/schedule?offering=${offering.id}`} className="btn-primary">Calendar &amp; staffing ↦</Link>
        <Link href={`/programs/${program.id}/students`} className="btn-primary">Students ↦</Link>
        <Link href={`/programs/${program.id}/wbl`} className="btn-primary">WBL placement board ↦</Link>
        <Link href={`/programs/${program.id}/plan`} className="btn-ghost">Operations plan</Link>
      </div>

      {/* The run's term calendar */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">Term schedule</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 font-semibold">Template term</th>
                <th className="px-4 py-3 text-center font-semibold">Courses</th>
                <th className="px-4 py-3 font-semibold">This offering starts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {program.terms.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                  <td className="px-4 py-3 text-center tabular-nums text-slate-500">{t._count.courses}</td>
                  <td className="px-4 py-3 text-slate-700">{termDate.has(t.id) ? dateFmt(termDate.get(t.id)) : <span className="text-slate-300">not scheduled</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* This run's funnel */}
      {offering.stages.length > 0 && (
        <section className="card card-pad space-y-1">
          <h2 className="text-lg font-semibold">Talent pipeline — {offering.name}</h2>
          <FunnelChart programId={program.id} stages={offering.stages.map((s) => ({ key: s.stageKey as StageKey, label: s.label, target: s.targetNumber, actual: s.actualNumber }))} />
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
