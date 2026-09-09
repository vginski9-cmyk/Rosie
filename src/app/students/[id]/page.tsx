import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudent, getProgramCohortsLite, getInstitutionEmployersLite, getProgramTermsLite, getStudentAssignments, getStudentRequirementProgress } from "@/lib/queries";
import { updateStudentEnrollment, createPlacement, updatePlacementStatus, deletePlacement, updateStudentProfile } from "@/lib/actions";
import { StudentAssignments } from "@/components/StudentAssignments";
import { RequirementLog } from "@/components/RequirementLog";
import { Collapse } from "@/components/Collapse";
import { SEX, RACE_ETHNICITY, RESIDENCY, PRIOR_EDUCATION, EMPLOYMENT_STATUS, WITHDRAWAL_REASON, NC_COUNTIES, ageOn } from "@/lib/learners";
import { STAGES, STAGE_INDEX, type StageKey } from "@/lib/funnel";
import { fmt, dec } from "@/lib/format";

export const dynamic = "force-dynamic";

// ONE STUDENT — enrollment, completion requirements, then everything else folded away.

const STUDENT_STATUSES = ["prospect", "applicant", "admitted", "enrolled", "completed", "licensed", "placed", "productive", "withdrawn"];
const PLACEMENT_NEXT: Record<string, string[]> = { planned: ["active", "cancelled"], active: ["completed", "cancelled"], completed: [], cancelled: ["planned"] };
const PSTATUS_BADGE: Record<string, string> = { planned: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700", completed: "bg-slate-200 text-slate-600", cancelled: "bg-slate-100 text-slate-400" };
const dateFmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
const GRADE_COLOR = (status: string) => status === "completed" ? "text-slate-800" : status === "in_progress" ? "text-sky-600" : status === "withdrawn" ? "text-slate-400" : "text-rose-600";
const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";

export default async function StudentPage({ params }: { params: { id: string } }) {
  const student = await getStudent(params.id);
  if (!student) notFound();
  const [cohorts, programTerms, employers, assignments, requirements] = await Promise.all([
    getProgramCohortsLite(student.programId), getProgramTermsLite(student.programId), getInstitutionEmployersLite(student.program.institutionId), getStudentAssignments(student.id), getStudentRequirementProgress(student.id),
  ]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const yn = (v: boolean | null) => (v == null ? "" : v ? "yes" : "no");
  const stage = STAGES.find((s) => s.key === student.stageKey);
  const reachedIdx = student.stageKey && student.stageKey in STAGE_INDEX ? STAGE_INDEX[student.stageKey as StageKey] : -1;
  const totalSessions = student.attendedCount + student.missedCount;
  const attendanceRate = totalSessions > 0 ? student.attendedCount / totalSessions : null;
  const terms = Array.from(new Set(student.grades.map((g) => g.termIndex))).sort((a, b) => a - b);
  const clinicalShifts = assignments.shifts.length;
  const completedShifts = assignments.shifts.filter((s) => s.status === "completed").length;
  const reqSummary = requirements?.sets.map((s) => (s.progress.complete ? `${s.authority.split(" · ")[0]} complete` : `${Math.round(s.progress.pct * 100)}% of ${s.authority.split(" · ")[0]}`)).join(" · ");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Link href="/students" className="hover:text-slate-700">← All students</Link>
          <span className="text-slate-300">·</span>
          <Link href={`/programs/${student.programId}/students`} className="hover:text-slate-700">{student.program.name} roster</Link>
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{student.name}</h1>
            <p className="text-sm text-slate-500">{student.program.name}{student.cohort ? ` · ${student.cohort.name}` : ""}{student.email ? ` · ${student.email}` : ""}{reqSummary ? ` · ${reqSummary}` : ""}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stage && <span className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: stage.color }}>{stage.label}</span>}
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700">Section {student.sectionIndex}</span>
            {student.clinicalSite && <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700">{student.clinicalSite}</span>}
          </div>
        </div>
        <form action={updateStudentEnrollment.bind(null, student.id)} className="mt-3 flex flex-wrap items-end gap-2 text-xs">
          <label className="block"><span className={lbl}>Cohort</span><select name="cohortId" defaultValue={student.cohortId ?? ""} className="rounded-lg border border-slate-300 px-2 py-1 text-sm"><option value="">— unassigned —</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="block"><span className={lbl}>Section</span><input name="sectionIndex" type="number" min={1} defaultValue={student.sectionIndex} className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-sm tabular-nums" /></label>
          <label className="block"><span className={lbl}>Status</span><select name="status" defaultValue={student.status} className="rounded-lg border border-slate-300 px-2 py-1 text-sm">{STUDENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <button className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save</button>
        </form>
      </div>

      {requirements && requirements.sets.length > 0 && (
        <section id="requirements" className="scroll-mt-16 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-800">Completion requirements <span className="font-normal text-slate-400">— {requirements.sets.map((s) => s.authority.split(" · ")[0]).join(" · ")}: what is logged, what is missing, and where it can be had</span></h2>
          <RequirementLog data={requirements} />
        </section>
      )}

      <Collapse title="Sections, preceptors & clinical shifts" sub="Which section this student sits in for each course, who staffs it, and every clinical shift with its site, preceptor and hours" summary={<>{completedShifts} of {clinicalShifts} clinical shifts logged</>}>
        <StudentAssignments studentId={student.id} cohort={assignments.cohort} courses={assignments.courses} sections={assignments.sections} staff={assignments.staff} shifts={assignments.shifts} assets={assignments.assets} seat={student.sectionIndex} today={assignments.today} />
      </Collapse>

      <Collapse title="Academic record" sub="Pipeline stage, grades by term, attendance" summary={<>GPA {student.gpa != null ? dec(student.gpa) : "—"} · attendance {attendanceRate != null ? fmt.pct(attendanceRate, 1) : "—"} · {student.grades.length} courses</>}>
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGES.map((s, i) => {
              const reached = i <= reachedIdx;
              return (
                <div key={s.key} className="flex items-center gap-1.5">
                  <div className={`rounded-lg px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${reached ? "text-white" : "bg-white text-slate-400 ring-slate-200"} ${i === reachedIdx ? "ring-2" : ""}`} style={reached ? { background: s.color, borderColor: s.color } : undefined}>{s.label}</div>
                  {i < STAGES.length - 1 && <span className="text-slate-200">→</span>}
                </div>
              );
            })}
          </div>
          {student.grades.length === 0 ? <p className="text-sm text-slate-400">No course record yet.</p> : terms.map((t) => (
            <div key={t}>
              <div className="mb-1 text-xs font-semibold text-slate-600">Term {t}</div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Course</th><th className="px-3 py-2 text-center font-semibold">Credits</th><th className="px-3 py-2 text-center font-semibold">Status</th><th className="px-3 py-2 text-center font-semibold">Grade</th><th className="px-3 py-2 text-right font-semibold">Completed</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {student.grades.filter((g) => g.termIndex === t).map((g) => (
                      <tr key={g.id}>
                        <td className="px-3 py-1.5"><Link href={`/courses/${g.course.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{g.course.code ? <span className="text-slate-400">{g.course.code} · </span> : null}{g.course.name}</Link></td>
                        <td className="px-3 py-1.5 text-center tabular-nums text-slate-500">{g.course.creditHours ?? "—"}</td>
                        <td className={`px-3 py-1.5 text-center text-xs font-medium ${GRADE_COLOR(g.status)}`}>{g.status.replace("_", " ")}</td>
                        <td className={`px-3 py-1.5 text-center font-bold tabular-nums ${GRADE_COLOR(g.status)}`}>{g.grade ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right text-slate-500">{dateFmt(g.completedDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div>
            <div className="mb-1 text-xs font-semibold text-slate-600">Attendance — {fmt.num(student.attendedCount)} attended · {fmt.num(student.missedCount)} missed{student.absences.length ? ` · ${student.absences.filter((a) => a.excused).length} excused` : ""}</div>
            {student.absences.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2 font-semibold">Date missed</th><th className="px-3 py-2 font-semibold">Course</th><th className="px-3 py-2 font-semibold">Session</th><th className="px-3 py-2 text-center font-semibold">Excused</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{student.absences.map((a) => <tr key={a.id}><td className="px-3 py-1.5 text-slate-700">{dateFmt(a.date)}</td><td className="px-3 py-1.5 text-slate-500">{a.courseCode ?? "—"}</td><td className="px-3 py-1.5 text-slate-500">{a.sessionTitle ?? "—"}</td><td className="px-3 py-1.5 text-center">{a.excused ? <span className="text-emerald-600">excused</span> : <span className="text-rose-600">unexcused</span>}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Collapse>

      <Collapse title="Profile & demographics" sub="Coded fields, so learners aggregate cleanly in Learner analytics" summary={<>{[student.sex, student.raceEthnicity, student.county ? `${student.county} County` : null, student.dob ? `age ${ageOn(iso(student.dob), todayIso)}` : null].filter(Boolean).join(" · ") || "not coded yet"}</>}>
        <form action={updateStudentProfile.bind(null, student.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block"><span className={lbl}>Name</span><input name="name" defaultValue={student.name} className={inp} /></label>
          <label className="block"><span className={lbl}>Email</span><input name="email" type="email" defaultValue={student.email ?? ""} className={inp} /></label>
          <label className="block"><span className={lbl}>Phone</span><input name="phone" defaultValue={student.phone ?? ""} className={inp} /></label>
          <label className="block"><span className={lbl}>Date of birth</span><input name="dob" type="date" defaultValue={iso(student.dob)} className={inp} /></label>
          <label className="block"><span className={lbl}>Sex</span><select name="sex" defaultValue={student.sex ?? ""} className={inp}><option value="">—</option>{SEX.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="block"><span className={lbl}>Race / ethnicity</span><select name="raceEthnicity" defaultValue={student.raceEthnicity ?? ""} className={inp}><option value="">—</option>{RACE_ETHNICITY.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="block"><span className={lbl}>Primary language</span><input name="primaryLanguage" defaultValue={student.primaryLanguage ?? ""} className={inp} /></label>
          <label className="block"><span className={lbl}>Dependents</span><input name="dependents" type="number" min="0" step="1" defaultValue={student.dependents ?? ""} className={inp} /></label>
          <label className="block sm:col-span-2"><span className={lbl}>Street address</span><input name="address" defaultValue={student.address ?? ""} className={inp} /></label>
          <label className="block"><span className={lbl}>City</span><input name="city" defaultValue={student.city ?? ""} className={inp} /></label>
          <label className="block"><span className={lbl}>County</span><select name="county" defaultValue={student.county ?? ""} className={inp}><option value="">—</option>{NC_COUNTIES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="block"><span className={lbl}>State</span><input name="state" defaultValue={student.state ?? "NC"} className={inp} /></label>
          <label className="block"><span className={lbl}>ZIP</span><input name="zip" defaultValue={student.zip ?? ""} className={inp} /></label>
          <label className="block"><span className={lbl}>Residency</span><select name="residency" defaultValue={student.residency ?? ""} className={inp}><option value="">—</option>{RESIDENCY.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="block"><span className={lbl}>Prior education</span><select name="priorEducation" defaultValue={student.priorEducation ?? ""} className={inp}><option value="">—</option>{PRIOR_EDUCATION.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label className="block"><span className={lbl}>Employment</span><select name="employmentStatus" defaultValue={student.employmentStatus ?? ""} className={inp}><option value="">—</option>{EMPLOYMENT_STATUS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          {([["firstGeneration", "First generation", student.firstGeneration], ["veteran", "Veteran", student.veteran], ["pellEligible", "Pell eligible", student.pellEligible], ["disability", "Disability", student.disability]] as const).map(([k, label, v]) => (
            <label key={k} className="block"><span className={lbl}>{label}</span><select name={k} defaultValue={yn(v)} className={inp}><option value="">unknown</option><option value="yes">yes</option><option value="no">no</option></select></label>
          ))}
          <label className="block"><span className={lbl}>Started</span><input name="startDate" type="date" defaultValue={iso(student.startDate)} className={inp} /></label>
          <label className="block"><span className={lbl}>Completed</span><input name="completionDate" type="date" defaultValue={iso(student.completionDate)} className={inp} /></label>
          <label className="block"><span className={lbl}>GPA</span><input name="gpa" type="number" step="any" defaultValue={student.gpa ?? ""} className={inp} /></label>
          <label className="block"><span className={lbl}>Withdrawal reason</span><select name="withdrawalReason" defaultValue={student.withdrawalReason ?? ""} className={inp}><option value="">—</option>{WITHDRAWAL_REASON.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <div className="flex items-end lg:col-span-4"><button className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700">Save profile</button></div>
        </form>
      </Collapse>

      <Collapse title="Placements" sub="Work-based learning placements at partner sites" summary={<>{student.placements.length} placement{student.placements.length === 1 ? "" : "s"}</>}>
        <div className="space-y-1.5">
          {student.placements.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[13px]">
              <div><Link href={`/employers/${p.employer.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.employer.name}</Link><span className="ml-2 text-slate-400">{[p.cohort?.name, p.term?.name, p.modality].filter(Boolean).join(" · ") || "—"}</span></div>
              <div className="flex items-center gap-1.5">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PSTATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"}`}>{p.status}</span>
                {(PLACEMENT_NEXT[p.status] ?? []).map((s) => <form key={s} action={updatePlacementStatus.bind(null, p.id, s)}><button className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white">→ {s}</button></form>)}
                <form action={deletePlacement.bind(null, p.id)}><button className="px-1 text-[11px] text-slate-300 hover:text-rose-600" title="remove">✕</button></form>
              </div>
            </div>
          ))}
        </div>
        {employers.length > 0 && (
          <form action={createPlacement} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 text-xs">
            <input type="hidden" name="studentId" value={student.id} />
            <label className="block"><span className={lbl}>Partner</span><select name="employerId" required className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm">{employers.map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}</select></label>
            <label className="block"><span className={lbl}>Cohort</span><select name="cohortId" defaultValue={student.cohortId ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"><option value="">—</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="block"><span className={lbl}>Term</span><select name="termId" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"><option value="">—</option>{programTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="block"><span className={lbl}>Start</span><input name="startDate" type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className={lbl}>End</span><input name="endDate" type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></label>
            <label className="block"><span className={lbl}>Modality</span><input name="modality" placeholder="CT" className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></label>
            <button className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700">Add placement</button>
          </form>
        )}
      </Collapse>
    </div>
  );
}
