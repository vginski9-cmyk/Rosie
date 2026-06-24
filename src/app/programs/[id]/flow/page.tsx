import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull } from "@/lib/queries";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const TYPE_STYLE: Record<string, { card: string; chip: string; label: string }> = {
  CORE: { card: "border-rose-200 bg-rose-50/60 hover:bg-rose-50", chip: "bg-rose-600 text-white", label: "Core" },
  GENED: { card: "border-slate-200 bg-white hover:bg-slate-50", chip: "bg-slate-500 text-white", label: "Gen-Ed" },
  SUPPORT: { card: "border-sky-200 bg-sky-50/60 hover:bg-sky-50", chip: "bg-sky-600 text-white", label: "Support" },
  DEFAULT: { card: "border-slate-200 bg-white hover:bg-slate-50", chip: "bg-slate-400 text-white", label: "" },
};

const SEM_CHIP: Record<string, string> = {
  Fall: "bg-amber-100 text-amber-800",
  Spring: "bg-emerald-100 text-emerald-800",
  Summer: "bg-orange-100 text-orange-800",
  All: "bg-slate-100 text-slate-600",
};

function hoursLine(c: { weeklyClassHours: number; weeklyLabHours: number; weeklyClinicalHours: number }) {
  const parts: string[] = [];
  if (c.weeklyClassHours) parts.push(`${c.weeklyClassHours} class`);
  if (c.weeklyLabHours) parts.push(`${c.weeklyLabHours} lab`);
  if (c.weeklyClinicalHours) parts.push(`${c.weeklyClinicalHours} clin`);
  return parts.join(" · ") || "—";
}

export default async function FlowPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();

  const totalCredits = program.terms.reduce(
    (sum, t) => sum + t.courses.reduce((s, c) => s + (c.creditHours ?? 0), 0),
    0,
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/programs/${program.id}`} className="text-sm text-slate-500 hover:text-slate-700">← {program.name}</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Curriculum flow</h1>
            <p className="text-sm text-slate-500">
              {program.name}{program.credential ? ` · ${program.credential}` : ""} — {program.terms.length} terms · {fmt.num(totalCredits)} credit hours. Click any course for its session-by-session schedule.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-rose-500" /> Core</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-sky-500" /> Support</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded bg-slate-400" /> Gen-Ed</span>
          </div>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {program.terms.map((term) => {
          const credits = term.courses.reduce((s, c) => s + (c.creditHours ?? 0), 0);
          return (
            <div key={term.id} className="flex w-72 shrink-0 flex-col">
              <div className="mb-2 flex items-baseline justify-between border-b-2 border-slate-200 pb-1">
                <h2 className="font-semibold">{term.name}</h2>
                <span className="text-xs text-slate-400">{fmt.num(credits)} cr</span>
              </div>
              <div className="space-y-2">
                {term.courses.map((course) => {
                  const st = TYPE_STYLE[course.courseType ?? "DEFAULT"] ?? TYPE_STYLE.DEFAULT;
                  return (
                    <Link key={course.id} href={`/courses/${course.id}`} className={`block rounded-lg border p-3 shadow-sm transition-colors ${st.card}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-500">{course.code}</span>
                        <div className="flex items-center gap-1">
                          {course.semesterOffered && <span className={`badge ${SEM_CHIP[course.semesterOffered] ?? "bg-slate-100 text-slate-500"}`}>{course.semesterOffered}</span>}
                          <span className="badge bg-slate-900 text-white">{fmt.num(course.creditHours)} cr</span>
                        </div>
                      </div>
                      <div className="mt-1 text-sm font-medium leading-tight">{course.name}</div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{hoursLine(course)}</span>
                        <span className="text-slate-400">{course.sessions.length} sessions →</span>
                      </div>
                    </Link>
                  );
                })}
                {term.courses.length === 0 && <p className="text-xs text-slate-400">No courses.</p>}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-400">
        Note: once students start RAD-prefix courses they must remain continuously enrolled in RAD-prefix courses each term.
      </p>
    </div>
  );
}
