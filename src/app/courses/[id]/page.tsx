import Link from "next/link";
import { notFound } from "next/navigation";
import { getCourse } from "@/lib/queries";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const KIND_META: Record<string, { label: string; color: string }> = {
  CLASS: { label: "Class sessions", color: "text-sky-700" },
  LAB: { label: "Lab sessions", color: "text-violet-700" },
  CLINICAL: { label: "Clinical sessions", color: "text-rose-700" },
};

export default async function CoursePage({ params }: { params: { id: string } }) {
  const course = await getCourse(params.id);
  if (!course) notFound();
  const program = course.term.program;

  const byKind = (k: string) => course.sessions.filter((s) => s.kind === k);
  const kinds = ["CLASS", "LAB", "CLINICAL"].filter((k) => byKind(k).length > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href={`/programs/${program.id}/flow`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {program.name} curriculum flow
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              <span className="font-mono text-slate-400">{course.code}</span> {course.name}
            </h1>
            <p className="text-sm text-slate-500">{program.institution.name} · {course.term.name}</p>
          </div>
          <div className="flex items-center gap-2">
            {course.semesterOffered && <span className="badge bg-slate-100 text-slate-600">Offered: {course.semesterOffered}</span>}
            {course.courseType && <span className="badge bg-rose-50 text-rose-700">{course.courseType.toLowerCase()}</span>}
          </div>
        </div>
      </div>

      {/* Hours / credits */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Credit hours" value={fmt.num(course.creditHours)} />
        <Stat label="Class hrs/wk" value={fmt.num(course.weeklyClassHours)} />
        <Stat label="Lab hrs/wk" value={fmt.num(course.weeklyLabHours)} />
        <Stat label="Clinical hrs/wk" value={fmt.num(course.weeklyClinicalHours)} />
      </div>

      {course.description && (
        <section className="card card-pad">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Description</h2>
          <p className="text-sm leading-relaxed text-slate-700">{course.description}</p>
        </section>
      )}

      {course.requisites && (
        <section className="card card-pad">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500">Requisites</h2>
          <p className="text-sm leading-relaxed text-slate-700">{course.requisites}</p>
        </section>
      )}

      {course.courseSkills.length > 0 && (
        <section className="card card-pad">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Develops KSAs</h2>
          <div className="flex flex-wrap gap-1">
            {course.courseSkills.map((cs) => (
              <Link key={cs.id} href={`/skills/${cs.skillId}`} className="badge bg-violet-50 text-violet-700 hover:bg-violet-100">
                {cs.skill.name} → L{cs.targetLevel}{cs.role ? ` (${cs.role.toLowerCase()})` : ""}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Session-by-session schedule */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Session-by-session schedule</h2>
        {kinds.map((kind) => {
          const meta = KIND_META[kind];
          const sessions = byKind(kind);
          const isClinical = kind === "CLINICAL";
          return (
            <div key={kind} className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
                <h3 className={`font-semibold ${meta.color}`}>{meta.label}</h3>
                <span className="text-xs text-slate-400">{sessions.length} sessions</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="th">#</th>
                      <th className="th">Title</th>
                      <th className="th text-center">Week</th>
                      <th className="th text-center">Day</th>
                      <th className="th text-right">Hrs</th>
                      <th className="th text-center">Cap</th>
                      <th className="th">Location</th>
                      <th className="th">{isClinical ? "Rotation / mode" : "Staffing"}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="td text-slate-400">{s.number}</td>
                        <td className="td font-medium">{s.title}</td>
                        <td className="td text-center">{s.week ?? "—"}</td>
                        <td className="td text-center">{s.dayOfWeek ?? "—"}</td>
                        <td className="td text-right">{fmt.num(s.lengthHours)}</td>
                        <td className="td text-center">{s.maxStudents}</td>
                        <td className="td text-xs text-slate-500">{s.location ?? "—"}</td>
                        <td className="td text-xs text-slate-500">
                          {isClinical
                            ? `${s.rotationType ?? "—"}${s.clinicalMode ? ` · ${s.clinicalMode}` : ""}${s.preceptorsNeeded ? ` · ${s.preceptorsNeeded} preceptor` : ""}`
                            : `${s.facultyNeeded} faculty${s.supportStaffNeeded ? ` · ${s.supportStaffNeeded} support` : ""}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
        {kinds.length === 0 && <p className="text-sm text-slate-400">No sessions defined for this course yet.</p>}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card card-pad">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
