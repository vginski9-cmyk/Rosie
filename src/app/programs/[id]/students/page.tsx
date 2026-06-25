import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramStudents } from "@/lib/queries";
import { STAGES, STAGE_INDEX, type StageKey } from "@/lib/funnel";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  prospect: "bg-slate-100 text-slate-600",
  applicant: "bg-sky-100 text-sky-700",
  admitted: "bg-indigo-100 text-indigo-700",
  enrolled: "bg-emerald-100 text-emerald-700",
  completed: "bg-amber-100 text-amber-700",
  placed: "bg-rose-100 text-rose-700",
  withdrawn: "bg-slate-200 text-slate-500",
};

export default async function ProgramStudentsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { stage?: string };
}) {
  const data = await getProgramStudents(params.id);
  if (!data) notFound();
  const { program, students } = data;

  const reachedIndex = (s: { stageKey: string | null }) =>
    s.stageKey && s.stageKey in STAGE_INDEX ? STAGE_INDEX[s.stageKey as StageKey] : -1;

  // Cumulative "reached this stage or beyond" counts — matches the funnel actuals.
  const reachedCount = (key: StageKey) =>
    students.filter((s) => reachedIndex(s) >= STAGE_INDEX[key]).length;

  const activeStage = searchParams.stage && searchParams.stage in STAGE_INDEX ? (searchParams.stage as StageKey) : null;
  const filtered = activeStage
    ? students.filter((s) => reachedIndex(s) >= STAGE_INDEX[activeStage])
    : students;

  const stageLabel = activeStage ? STAGES.find((s) => s.key === activeStage)?.label : null;

  return (
    <div className="space-y-8">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
            <p className="text-sm text-slate-500">{program.institution.name} · {program.name} · {students.length} people in the pipeline</p>
          </div>
        </div>
      </div>

      {/* Funnel-stage filter rail — click a stage to drill into the people in it */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/programs/${program.id}/students`}
          className={`rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${!activeStage ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
        >
          All <span className="tabular-nums opacity-70">{students.length}</span>
        </Link>
        {STAGES.map((stage) => {
          const n = reachedCount(stage.key);
          const active = activeStage === stage.key;
          return (
            <Link
              key={stage.key}
              href={`/programs/${program.id}/students?stage=${stage.key}`}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors ${active ? "text-white" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
              style={active ? { background: stage.color, borderColor: stage.color } : { borderColor: undefined }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: active ? "#fff" : stage.color }} />
              {stage.label}
              <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </div>

      {activeStage && (
        <div className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
          Showing <strong>{filtered.length}</strong> students who reached <strong>{stageLabel}</strong> or beyond.{" "}
          <Link href={`/programs/${program.id}/students`} className="text-rose-700 hover:underline">clear filter</Link>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-4 py-3 font-semibold">Student</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Furthest stage</th>
              <th className="px-4 py-3 text-right font-semibold">GPA</th>
              <th className="px-4 py-3 text-right font-semibold">Attended</th>
              <th className="px-4 py-3 text-right font-semibold">Missed</th>
              <th className="px-4 py-3 text-right font-semibold">Grades</th>
              <th className="px-4 py-3 text-right font-semibold">Assessments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {filtered.map((s) => {
              const stage = STAGES.find((x) => x.key === s.stageKey);
              return (
                <tr key={s.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/students/${s.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{s.name}</Link>
                    {s.email && <div className="text-[11px] text-slate-400">{s.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLOR[s.status] ?? "bg-slate-100 text-slate-600"}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {stage ? (
                      <span className="inline-flex items-center gap-1.5 text-slate-600">
                        <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />
                        {stage.label}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{s.gpa != null ? s.gpa.toFixed(2) : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{s.attendedCount || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{s.missedCount ? <span className="text-rose-600">{s.missedCount}</span> : <span className="text-slate-300">0</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{s._count.grades || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">{s._count.assessments || "—"}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">No students at this stage.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
