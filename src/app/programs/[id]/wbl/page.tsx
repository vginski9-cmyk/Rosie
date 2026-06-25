import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramWblBoard } from "@/lib/queries";
import { recommendPlacement, toProfileInput, employerSlotsFrom } from "@/lib/wbl";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProgramWblBoardPage({ params }: { params: { id: string } }) {
  const data = await getProgramWblBoard(params.id);
  if (!data) notFound();
  const { program, students, employers } = data;
  const employerSlots = employerSlotsFrom(employers);

  // Per-student recommendation.
  const rows = students.map((s) => {
    const snap = s.wblSnapshots[0] ?? null;
    if (!snap) return { student: s, snap: null, rec: null };
    const learner = toProfileInput(s.id, "LEARNER", s.name, snap.factors);
    return { student: s, snap, rec: recommendPlacement(learner, employerSlots) };
  });

  const placeable = rows.filter((r) => r.rec?.best).length;
  const needSupport = rows.filter((r) => r.rec && r.rec.unmetNeeds.length > 0).length;
  const noSnapshot = rows.filter((r) => !r.snap).length;

  // Aggregate unmet-need types across the cohort.
  const needTally = new Map<string, number>();
  for (const r of rows) for (const n of r.rec?.unmetNeeds ?? []) needTally.set(n.factor.label, (needTally.get(n.factor.label) ?? 0) + 1);
  const needs = [...needTally.entries()].sort((a, b) => b[1] - a[1]);

  // Demand vs feasible supply (slots from sites that are feasible for ≥1 student).
  const totalSlots = employerSlots.reduce((n, e) => n + e.slots, 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">WBL placement board</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Each enrolled student&apos;s latest work-based-learning snapshot, scored against every clinical partner&apos;s
          capacity. The engine recommends a placement per student and flags the binding needs no feasible site meets —
          the support the coordinator has to arrange before placement.
        </p>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Students" value={fmt.num(students.length)} sub="with a WBL snapshot" />
        <Tile label="Placeable now" value={fmt.num(placeable)} sub="have ≥1 feasible site" tone="ok" />
        <Tile label="Need support first" value={fmt.num(needSupport)} sub="blocking need unmet" tone={needSupport > 0 ? "warn" : "ok"} />
        <Tile label="Partner WBL slots" value={fmt.num(totalSlots)} sub={`${employers.length} clinical partners`} />
      </div>

      {/* Cohort need types */}
      {needs.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-700">Unmet needs across the cohort</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {needs.map(([label, count]) => (
              <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-sm ring-1 ring-amber-200">
                {label} <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Per-student board */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Snapshot</th>
              <th className="px-4 py-3 font-semibold">Recommended placement</th>
              <th className="px-4 py-3 text-center font-semibold">Fit</th>
              <th className="px-4 py-3 text-center font-semibold">Feasible sites</th>
              <th className="px-4 py-3 font-semibold">Unmet needs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ student, snap, rec }) => (
              <tr key={student.id} className={rec && !rec.best ? "bg-rose-50/30" : "hover:bg-slate-50/60"}>
                <td className="px-4 py-3">
                  <Link href={`/students/${student.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{student.name}</Link>
                  <div className="text-[11px] text-slate-400">Section {student.sectionIndex}{student.clinicalSite ? ` · ${student.clinicalSite}` : ""}</div>
                </td>
                <td className="px-4 py-3 text-[12px] text-slate-500">{snap ? snap.summary : <span className="text-slate-300">no snapshot</span>}</td>
                <td className="px-4 py-3">
                  {rec?.best ? <span className="font-medium text-emerald-700">{rec.best.name}</span>
                    : rec ? <span className="text-rose-600">needs support first</span>
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-center tabular-nums">{rec?.best?.score != null ? fmt.pct(rec.best.score) : "—"}</td>
                <td className="px-4 py-3 text-center tabular-nums text-slate-500">{rec ? rec.feasibleCount : "—"}</td>
                <td className="px-4 py-3 text-[12px]">
                  {rec && rec.unmetNeeds.length > 0
                    ? <span className="text-amber-700">{rec.unmetNeeds.map((n) => n.factor.label).join(", ")}</span>
                    : rec ? <span className="text-emerald-600">none</span> : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No enrolled students with WBL snapshots.</td></tr>}
          </tbody>
        </table>
      </div>
      {noSnapshot > 0 && <p className="text-xs text-slate-400">{noSnapshot} student(s) have no WBL snapshot yet.</p>}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <div className={`rounded-xl border bg-white p-5 ${tone === "warn" ? "border-amber-200 ring-1 ring-amber-100" : "border-slate-200"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
