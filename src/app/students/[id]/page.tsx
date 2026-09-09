import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudent, getProgramSessionPlan, getProgramCohortsLite, getInstitutionEmployersLite, getProgramTermsLite, getStudentAssignments, getStudentRequirementProgress } from "@/lib/queries";
import { updateStudentEnrollment, createPlacement, updatePlacementStatus, deletePlacement, updateStudentProfile } from "@/lib/actions";
import { StudentAssignments } from "@/components/StudentAssignments";
import { RequirementLog } from "@/components/RequirementLog";
import { SEX, RACE_ETHNICITY, RESIDENCY, PRIOR_EDUCATION, EMPLOYMENT_STATUS, WITHDRAWAL_REASON, NC_COUNTIES, ageOn } from "@/lib/learners";
import { STAGES, STAGE_INDEX, type StageKey } from "@/lib/funnel";
import { fmt, dec } from "@/lib/format";

export const dynamic = "force-dynamic";

const STUDENT_STATUSES = ["prospect", "applicant", "admitted", "enrolled", "completed", "licensed", "placed", "productive", "withdrawn"];
const PLACEMENT_NEXT: Record<string, string[]> = { planned: ["active", "cancelled"], active: ["completed", "cancelled"], completed: [], cancelled: ["planned"] };
const PSTATUS_BADGE: Record<string, string> = { planned: "bg-sky-100 text-sky-700", active: "bg-emerald-100 text-emerald-700", completed: "bg-slate-200 text-slate-600", cancelled: "bg-slate-100 text-slate-400" };

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

export default async function StudentPage({ params }: { params: { id: string } }) {
  const student = await getStudent(params.id);
  if (!student) notFound();
  const [cohorts, programTerms, employers, assignments, requirements] = await Promise.all([
    getProgramCohortsLite(student.programId),
    getProgramTermsLite(student.programId),
    getInstitutionEmployersLite(student.program.institutionId),
    getStudentAssignments(student.id),
    getStudentRequirementProgress(student.id),
  ]);
  const todayIso = new Date().toISOString().slice(0, 10);
  const iso = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const inp = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm";
  const lbl = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500";
  const yn = (v: boolean | null) => (v == null ? "" : v ? "yes" : "no");

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

  const stage = STAGES.find((s) => s.key === student.stageKey);
  const reachedIdx = student.stageKey && student.stageKey in STAGE_INDEX ? STAGE_INDEX[student.stageKey as StageKey] : -1;

  const totalSessions = student.attendedCount + student.missedCount;
  const attendanceRate = totalSessions > 0 ? student.attendedCount / totalSessions : null;

  // Group grades by term.
  const terms = Array.from(new Set(student.grades.map((g) => g.termIndex))).sort((a, b) => a - b);

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

      {/* Completion requirements — the credentialing body's list, logged and scored */}
      {requirements && requirements.sets.length > 0 && (
        <section id="requirements" className="scroll-mt-16 rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">Completion requirements — {requirements.sets.map((s) => s.authority.split(" · ")[0]).join(" · ")} <span className="font-normal text-slate-400">— what {requirements.family.name} graduates must have logged, where this student stands, and where the rest can be had</span></h2>
          <p className="mb-3 text-[11px] text-slate-400">Hours are the ledger below; this is the list. Every entry names the experience, the shift and site it happened on, the preceptor, the role or outcome, and whether it was simulated — and the rules are scored exactly as the credentialing body counts them.</p>
          <RequirementLog data={requirements} />
        </section>
      )}

      {/* Demographic profile — every field coded so the analytics aggregate cleanly */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Profile &amp; demographics</h2>
        <p className="text-[11px] text-slate-400">Coded fields (dropdowns and dates) so learners can be aggregated and disaggregated in <Link href="/students/analytics" className="text-rose-600 hover:underline">Learner analytics</Link>.{student.dob ? ` Age ${ageOn(iso(student.dob), todayIso)}.` : ""}</p>
        <form action={updateStudentProfile.bind(null, student.id)} className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      </section>

      {/* Sections & clinical shifts inside the offering */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Sections, instructors, preceptors &amp; the clinical log</h2>
        <p className="mb-2 text-[11px] text-slate-400">Which section of each class, lab and clinical this learner sits in and who staffs it; the clinical hours ledger against the program's requirement grid; and every clinical shift with its site, preceptor, hours and status — logged here as each shift happens.</p>
        <StudentAssignments studentId={student.id} cohort={assignments.cohort} courses={assignments.courses} sections={assignments.sections} staff={assignments.staff} shifts={assignments.shifts} assets={assignments.assets} seat={student.sectionIndex} today={assignments.today} />
      </section>

      {/* Alignment intake — structured motivations / constraints / capacities */}
      <Link href={`/students/${student.id}/alignment`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 hover:border-rose-200 hover:bg-rose-50/40">
        <div>
          <div className="text-sm font-semibold text-slate-800">Alignment intake ↦</div>
          <div className="text-xs text-slate-500">motivations (tiered) · constraints · capacities → computed quadrant, recommended WBL modes, configuration</div>
        </div>
        <span className="text-rose-600">→</span>
      </Link>

      {/* WBL placements — assign this student to an employer partner for a rotation */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Work-based learning placements</h2>
          <span className="text-[11px] text-slate-400">{student.placements.length} placement{student.placements.length === 1 ? "" : "s"}</span>
        </div>
        {student.placements.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {student.placements.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-[13px]">
                <div>
                  <Link href={`/employers/${p.employer.id}`} className="font-medium text-slate-800 hover:text-rose-700 hover:underline">{p.employer.name}</Link>
                  <span className="ml-2 text-slate-400">{[p.cohort?.name, p.term?.name, p.modality].filter(Boolean).join(" · ") || "—"}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PSTATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-600"}`}>{p.status}</span>
                  {(PLACEMENT_NEXT[p.status] ?? []).map((s) => (
                    <form key={s} action={updatePlacementStatus.bind(null, p.id, s)}>
                      <button className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-white">→ {s}</button>
                    </form>
                  ))}
                  <form action={deletePlacement.bind(null, p.id)}><button className="px-1 text-[11px] text-slate-300 hover:text-rose-600" title="remove">✕</button></form>
                </div>
              </div>
            ))}
          </div>
        )}
        {employers.length === 0 ? (
          <p className="mt-2 text-[12px] text-slate-400">No employer partners for this institution yet. Add one in the Employers workspace first.</p>
        ) : (
          <form action={createPlacement} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <input type="hidden" name="studentId" value={student.id} />
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Partner</span>
              <select name="employerId" required className="w-48 rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {employers.map((em) => <option key={em.id} value={em.id}>{em.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cohort</span>
              <select name="cohortId" defaultValue={student.cohortId ?? ""} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">—</option>
                {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Term</span>
              <select name="termId" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                <option value="">—</option>
                {programTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Start</span>
              <input name="startDate" type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">End</span>
              <input name="endDate" type="date" className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Modality</span>
              <input name="modality" placeholder="CT" className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700">Assign placement</button>
          </form>
        )}
      </section>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="GPA" value={student.gpa != null ? dec(student.gpa) : "—"} sub="cumulative" />
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
