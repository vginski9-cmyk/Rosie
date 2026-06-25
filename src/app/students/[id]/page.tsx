import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudent, getProgramSessionPlan, getEmployerWblSlots, getProgramCohortsLite } from "@/lib/queries";
import { updateStudentEnrollment } from "@/lib/actions";
import { STAGES, STAGE_INDEX, type StageKey } from "@/lib/funnel";
import { recommendPlacement, toProfileInput, employerSlotsFrom } from "@/lib/wbl";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

const STUDENT_STATUSES = ["prospect", "applicant", "admitted", "enrolled", "completed", "licensed", "placed", "productive", "withdrawn"];

const LAYER_META: Record<string, { label: string; color: string }> = {
  MOTIVATION: { label: "Motivations", color: "bg-sky-100 text-sky-700" },
  CONSTRAINT: { label: "Constraints", color: "bg-rose-100 text-rose-700" },
  CAPACITY: { label: "Capacities", color: "bg-emerald-100 text-emerald-700" },
};

const dateFmt = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

const GRADE_COLOR = (status: string) =>
  status === "completed" ? "text-slate-800"
  : status === "in_progress" ? "text-sky-600"
  : status === "withdrawn" ? "text-slate-400"
  : "text-rose-600";

const TYPE_BADGE: Record<string, string> = {
  KNOWLEDGE: "bg-sky-100 text-sky-700",
  SKILL: "bg-violet-100 text-violet-700",
  ABILITY: "bg-emerald-100 text-emerald-700",
};

export default async function StudentPage({ params }: { params: { id: string } }) {
  const student = await getStudent(params.id);
  if (!student) notFound();
  const cohorts = await getProgramCohortsLite(student.programId);

  // The program's session plan, reduced to per-course instructors + homework so
  // the student's personal schedule shows who teaches them and what's assigned.
  const plan = await getProgramSessionPlan(student.programId);
  const coursePlan = new Map<string, { instructors: Map<string, { name: string; hours: number }>; homework: Set<string>; sessions: number; clinical: boolean }>();
  for (const t of plan) for (const c of t.courses) {
    const entry = { instructors: new Map<string, { name: string; hours: number }>(), homework: new Set<string>(), sessions: c.sessions.length, clinical: c.sessions.some((s) => s.kind === "CLINICAL") };
    for (const s of c.sessions) {
      if (s.homework) entry.homework.add(s.homework);
      for (const si of s.instructors) {
        const cur = entry.instructors.get(si.personId) ?? { name: si.person.name, hours: 0 };
        cur.hours += si.contactHours;
        entry.instructors.set(si.personId, cur);
      }
    }
    coursePlan.set(c.id, entry);
  }

  // WBL fit: build the student's latest learner profile, score employers, and
  // recommend a placement + surface unmet needs.
  const latestSnap = student.wblSnapshots[0] ?? null;
  let wbl: Awaited<ReturnType<typeof getEmployerWblSlots>> = [];
  let rec: ReturnType<typeof recommendPlacement> | null = null;
  if (latestSnap) {
    wbl = await getEmployerWblSlots(student.program.institutionId);
    const learner = toProfileInput(student.id, "LEARNER", student.name, latestSnap.factors);
    rec = recommendPlacement(learner, employerSlotsFrom(wbl));
  }

  const stage = STAGES.find((s) => s.key === student.stageKey);
  const reachedIdx = student.stageKey && student.stageKey in STAGE_INDEX ? STAGE_INDEX[student.stageKey as StageKey] : -1;

  const totalSessions = student.attendedCount + student.missedCount;
  const attendanceRate = totalSessions > 0 ? student.attendedCount / totalSessions : null;

  // Group grades by term.
  const terms = Array.from(new Set(student.grades.map((g) => g.termIndex))).sort((a, b) => a - b);

  // Group KSA assessments by skill, ordered by date — the proficiency ladder.
  const skillIds = Array.from(new Set(student.assessments.map((a) => a.skillId)));
  const bySkill = skillIds.map((id) => {
    const rows = student.assessments.filter((a) => a.skillId === id);
    return { skill: rows[0].skill, rows };
  });
  const maxLevel = 5;

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Link href="/students" className="hover:text-slate-700">← All students</Link>
          <span className="text-slate-300">·</span>
          <Link href={`/programs/${student.programId}/students`} className="hover:text-slate-700">{student.program.name} roster</Link>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{student.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {student.program.institution.name} · {student.program.name}
              {student.cohort ? ` · ${student.cohort.name}` : ""}
              {student.email ? ` · ${student.email}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{student.status}</span>
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">Section {student.sectionIndex}</span>
            {student.clinicalSite && <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">{student.clinicalSite}</span>}
            {stage && (
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: stage.color }}>
                {stage.label}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Manage enrollment — assign cohort / section / lifecycle status */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Manage enrollment</h2>
        <p className="text-[11px] text-slate-400">Assign this student to a cohort and section, and advance their lifecycle status (which sets their pipeline stage).</p>
        <form action={updateStudentEnrollment.bind(null, student.id)} className="mt-2 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cohort</span>
            <select name="cohortId" defaultValue={student.cohortId ?? ""} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="">— unassigned —</option>
              {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Section</span>
            <input name="sectionIndex" type="number" min={1} defaultValue={student.sectionIndex} className="w-20 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Status</span>
            <select name="status" defaultValue={student.status} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save</button>
        </form>
      </section>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="GPA" value={student.gpa != null ? student.gpa.toFixed(2) : "—"} sub="cumulative" />
        <Tile label="Sessions attended" value={fmt.num(student.attendedCount)} sub={`of ${fmt.num(totalSessions)}`} />
        <Tile label="Sessions missed" value={fmt.num(student.missedCount)} sub={`${student.absences.filter((a) => a.excused).length} excused`} accent={student.missedCount > 0} />
        <Tile label="Attendance rate" value={attendanceRate != null ? fmt.pct(attendanceRate, 1) : "—"} sub="attended ÷ total" />
      </div>

      {/* Funnel pathway — how they progressed through the pipeline */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Pipeline pathway</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {STAGES.map((s, i) => {
            const reached = i <= reachedIdx;
            const isCurrent = i === reachedIdx;
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <div
                  className={`rounded-lg px-3 py-2 text-xs font-medium ring-1 ring-inset ${reached ? "text-white" : "bg-white text-slate-400 ring-slate-200"} ${isCurrent ? "ring-2" : ""}`}
                  style={reached ? { background: s.color, borderColor: s.color } : undefined}
                >
                  {s.label}
                  {isCurrent && <span className="ml-1 opacity-80">• current</span>}
                </div>
                {i < STAGES.length - 1 && <span className={reached && i < reachedIdx ? "text-slate-400" : "text-slate-200"}>→</span>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Course progression / grades — dated, grouped by term */}
      <section>
        <h2 className="mb-1 text-xl font-semibold tracking-tight">Course progression &amp; grades</h2>
        <p className="mb-4 text-sm text-slate-500">Every course this student has taken or is taking, with the grade earned and when it completed.</p>
        {student.grades.length === 0 ? (
          <p className="text-sm text-slate-400">No course record yet — this student has not enrolled.</p>
        ) : (
          <div className="space-y-5">
            {terms.map((t) => {
              const rows = student.grades.filter((g) => g.termIndex === t);
              return (
                <div key={t}>
                  <div className="mb-2 text-sm font-semibold text-slate-600">Term {t}</div>
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-3 font-semibold">Course</th>
                          <th className="px-4 py-3 text-center font-semibold">Credits</th>
                          <th className="px-4 py-3 text-center font-semibold">Status</th>
                          <th className="px-4 py-3 text-center font-semibold">Grade</th>
                          <th className="px-4 py-3 text-right font-semibold">Completed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-sm">
                        {rows.map((g) => (
                          <tr key={g.id} className="hover:bg-slate-50/60">
                            <td className="px-4 py-3">
                              <Link href={`/courses/${g.course.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">
                                {g.course.code ? <span className="text-slate-400">{g.course.code} · </span> : null}{g.course.name}
                              </Link>
                            </td>
                            <td className="px-4 py-3 text-center tabular-nums text-slate-500">{g.course.creditHours ?? "—"}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={`text-xs font-medium ${GRADE_COLOR(g.status)}`}>{g.status.replace("_", " ")}</span>
                            </td>
                            <td className={`px-4 py-3 text-center text-lg font-bold tabular-nums ${GRADE_COLOR(g.status)}`}>{g.grade ?? "—"}</td>
                            <td className="px-4 py-3 text-right text-slate-500">{dateFmt(g.completedDate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Class schedule — who teaches this student, and what's assigned */}
      {student.grades.length > 0 && (
        <section>
          <h2 className="mb-1 text-xl font-semibold tracking-tight">Class schedule &amp; instructors</h2>
          <p className="mb-4 text-sm text-slate-500">
            This student is in <strong>Section {student.sectionIndex}</strong>{student.clinicalSite ? <> · clinicals at <strong>{student.clinicalSite}</strong></> : null}.
            Co-taught courses list each instructor with the contact hours they cover. Open a course for the full day-by-day plan.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {student.grades.map((g) => {
              const cp = coursePlan.get(g.course.id);
              const instructors = cp ? [...cp.instructors.values()].sort((a, b) => b.hours - a.hours) : [];
              const homework = cp ? [...cp.homework] : [];
              return (
                <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/courses/${g.course.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">
                      {g.course.code ? <span className="text-slate-400">{g.course.code} · </span> : null}{g.course.name}
                    </Link>
                    <span className="shrink-0 text-[11px] text-slate-400">Term {g.termIndex} · {cp?.sessions ?? 0} sessions</span>
                  </div>
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Instructors</div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {instructors.length === 0 && <span className="text-[12px] text-slate-400">—</span>}
                      {instructors.map((ins) => (
                        <span key={ins.name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                          {ins.name}{instructors.length > 1 && <span className="text-slate-400">{Math.round(ins.hours)}h</span>}
                        </span>
                      ))}
                      {instructors.length > 1 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">co-taught</span>}
                    </div>
                  </div>
                  {homework.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Assignments / homework</div>
                      <ul className="mt-1 space-y-0.5">
                        {homework.slice(0, 3).map((h, i) => <li key={i} className="text-[12px] text-slate-600">• {h}</li>)}
                        {homework.length > 3 && <li className="text-[11px] text-slate-400">+{homework.length - 3} more across the course</li>}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* KSA proficiency over time */}
      <section>
        <h2 className="mb-1 text-xl font-semibold tracking-tight">Skill &amp; knowledge levels (KSAs)</h2>
        <p className="mb-4 text-sm text-slate-500">Dated proficiency assessments — each Knowledge, Skill, and Ability and how the student progressed through the levels over time.</p>
        {bySkill.length === 0 ? (
          <p className="text-sm text-slate-400">No KSA assessments recorded yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {bySkill.map(({ skill, rows }) => {
              const latest = rows[rows.length - 1];
              return (
                <div key={skill.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/skills/${skill.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{skill.name}</Link>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${TYPE_BADGE[skill.type] ?? "bg-slate-100 text-slate-600"}`}>{skill.type.toLowerCase()}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold tabular-nums text-slate-900">L{latest.level}</div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-400">current</div>
                    </div>
                  </div>
                  {/* level meter */}
                  <div className="mt-3 flex gap-1">
                    {Array.from({ length: maxLevel }, (_, i) => (
                      <div key={i} className={`h-2 flex-1 rounded-full ${i < latest.level ? "bg-rose-500" : "bg-slate-100"}`} />
                    ))}
                  </div>
                  {/* dated ladder */}
                  <div className="mt-4 space-y-1.5">
                    {rows.map((a) => (
                      <div key={a.id} className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">{dateFmt(a.assessedDate)}</span>
                        <span className="flex-1 px-2 text-slate-400">{a.courseCode ?? ""}{a.method ? ` · ${a.method}` : ""}</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">L{a.level}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Work-based learning fit & recommendation */}
      {latestSnap && rec && (
        <section>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold tracking-tight">Work-based learning fit &amp; recommendation</h2>
            <span className="text-xs text-slate-400">
              snapshot as of {dateFmt(latestSnap.asOfDate)}
              {student.wblSnapshots.length > 1 ? ` · ${student.wblSnapshots.length} dated captures` : ""}
            </span>
          </div>
          <p className="mb-4 text-sm text-slate-500">{latestSnap.summary}</p>

          {/* Recommendation banner */}
          {rec.best ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="text-sm">
                <span className="font-semibold text-emerald-800">Recommended placement: {rec.best.name}</span>
                {rec.best.score != null && <span className="ml-2 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{fmt.pct(rec.best.score)} fit</span>}
                <span className="ml-2 text-emerald-700">· {rec.feasibleCount} feasible site{rec.feasibleCount === 1 ? "" : "s"}</span>
              </div>
              {rec.metNeeds.length > 0 && (
                <div className="mt-1 text-xs text-emerald-700">Meets binding needs: {rec.metNeeds.map((f) => f.label).join(", ")}.</div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 text-sm font-medium text-rose-800">
              No feasible placement yet — resolve the blocking needs below before assigning a site.
            </div>
          )}

          {/* Unmet needs the coordinator must act on */}
          {rec.unmetNeeds.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Needs requiring support ({rec.unmetNeeds.length})</div>
              <ul className="mt-2 space-y-1.5">
                {rec.unmetNeeds.map((n, i) => (
                  <li key={i} className="text-sm text-amber-900">
                    <span className="font-medium">{n.factor.label}</span> — {n.action}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Snapshot detail: structured fields + factors by layer */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Logistics (this snapshot)</div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                <Field label="Shift preference" value={latestSnap.shiftPreference} />
                <Field label="Max travel" value={latestSnap.maxTravelMinutes != null ? `${latestSnap.maxTravelMinutes} min` : null} />
                <Field label="Transport" value={latestSnap.transport} />
                <Field label="Available" value={latestSnap.availability} />
                <Field label="Target wage" value={latestSnap.targetWage != null ? `$${latestSnap.targetWage}/hr` : null} />
                <Field label="Desired modality" value={latestSnap.desiredModality} />
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Motivations · constraints · capacities</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {latestSnap.factors.map((f) => (
                  <span key={f.id} className={`rounded-full px-2 py-0.5 text-[11px] ${LAYER_META[f.layer]?.color ?? "bg-slate-100 text-slate-600"}`}>
                    {f.binding ? "★ " : ""}{f.label}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-[10px] text-slate-400">★ = binding (non-negotiable)</div>
            </div>
          </div>

          {/* Ranked employer fit */}
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2 font-semibold">Clinical partner</th>
                  <th className="px-4 py-2 text-center font-semibold">Fit</th>
                  <th className="px-4 py-2 text-center font-semibold">Slots</th>
                  <th className="px-4 py-2 font-semibold">Status / blockers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rec.ranked.map((r) => (
                  <tr key={r.employerId} className={r.feasible ? "" : "bg-rose-50/30"}>
                    <td className="px-4 py-2 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-2 text-center tabular-nums">{r.score != null ? fmt.pct(r.score) : "—"}</td>
                    <td className="px-4 py-2 text-center tabular-nums text-slate-500">{r.slots}</td>
                    <td className="px-4 py-2 text-[12px]">
                      {r.feasible
                        ? <span className="text-emerald-600">feasible{r.met.length ? ` · meets ${r.met.map((f) => f.label).join(", ")}` : ""}</span>
                        : <span className="text-rose-600">blocked — {r.unmetBinding.map((u) => u.factor.label).join("; ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Attendance / absences */}
      <section>
        <h2 className="mb-1 text-xl font-semibold tracking-tight">Attendance</h2>
        <p className="mb-4 text-sm text-slate-500">{fmt.num(student.attendedCount)} sessions attended · {fmt.num(student.missedCount)} missed.</p>
        {student.absences.length === 0 ? (
          <p className="text-sm text-emerald-600">Perfect attendance — no sessions missed.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Date missed</th>
                  <th className="px-4 py-3 font-semibold">Course</th>
                  <th className="px-4 py-3 font-semibold">Session</th>
                  <th className="px-4 py-3 text-center font-semibold">Excused</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {student.absences.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-slate-700">{dateFmt(a.date)}</td>
                    <td className="px-4 py-3 text-slate-500">{a.courseCode ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{a.sessionTitle ?? "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {a.excused ? <span className="text-emerald-600">excused</span> : <span className="text-rose-600">unexcused</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-slate-400">{label}: </span>
      <span className="font-medium text-slate-700">{value || "—"}</span>
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-5 ${accent ? "border-rose-200 ring-1 ring-rose-100" : "border-slate-200"}`}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${accent ? "text-rose-700" : "text-slate-900"}`}>{value}</div>
      {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
