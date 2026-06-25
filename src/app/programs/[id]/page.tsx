import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getProgramFull, getProgramArchetype, getProficiencyScale, getProgramBottleneck, getProgramOfferings } from "@/lib/queries";
import { FunnelChart } from "@/components/FunnelChart";
import { CapacityWorkbench } from "@/components/CapacityWorkbench";
import { fmt } from "@/lib/format";
import type { StageKey } from "@/lib/funnel";
import { analyzeCoverage, assessmentCoverage, analyzeAssessment, competencyAdjustedCompletion, type ProgramBenchmark, type CourseDevelopment } from "@/lib/ksa";
import {
  duplicateProgram, deleteProgram, updateFunnelStage, addProgramSkill, removeProgramSkill,
} from "@/lib/actions";

export const dynamic = "force-dynamic";

const STATUS_COLOR: Record<string, string> = {
  MET: "bg-emerald-100 text-emerald-700",
  BELOW: "bg-amber-100 text-amber-700",
  NOT_TAUGHT: "bg-rose-100 text-rose-700",
};

export default async function ProgramPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const archetype = await getProgramArchetype(params.id);
  const [scale, library, offerings] = await Promise.all([
    getProficiencyScale(program.institutionId),
    prisma.skill.findMany({ where: { institutionId: program.institutionId }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    getProgramOfferings(params.id),
  ]);

  const cohort = program.cohorts[0];
  const northStar = program.yearTargets.find((t) => t.credentialTarget != null);
  const defaultEnrollment = Math.round(northStar?.cohortCapacity ?? 40);
  const totalSessions = archetype.reduce((n, t) => n + t.courses.reduce((m, c) => m + c.sessions.length, 0), 0);

  // KSA curriculum coverage.
  const benchmarks: ProgramBenchmark[] = program.programSkills.map((ps) => ({
    skillId: ps.skillId, skillName: ps.skill.name, skillType: ps.skill.type, targetLevel: ps.targetLevel, priority: ps.priority,
  }));
  const development: CourseDevelopment[] = program.terms.flatMap((t) =>
    t.courses.flatMap((c) => c.courseSkills.map((cs) => ({ skillId: cs.skillId, courseId: c.id, courseName: c.code ?? c.name, termIndex: t.index, targetLevel: cs.targetLevel, role: cs.role ?? undefined }))),
  );
  const coverage = analyzeCoverage(benchmarks, development);
  const mappedSkillIds = new Set(program.programSkills.map((p) => p.skillId));

  // Skills → assessment loop (boolean coverage + leveled competency readiness).
  const assessedSkillIds = new Set<string>();
  const assessedLevels: Record<string, number> = {};
  for (const t of program.terms) for (const c of t.courses) for (const s of c.sessions) for (const l of s.skillLinks) {
    if (l.mode === "ASSESS" || l.mode === "BOTH") {
      assessedSkillIds.add(l.skillId);
      assessedLevels[l.skillId] = Math.max(assessedLevels[l.skillId] ?? 0, l.targetLevel ?? 0);
    }
  }
  const assessment = assessmentCoverage(benchmarks, assessedSkillIds);
  const competency = analyzeAssessment(benchmarks, assessedLevels);
  const bottleneck = await getProgramBottleneck(program.id);

  // Loop 1: assessment competency → funnel completion projection.
  const completingTarget = cohort?.stages.find((s) => s.stageKey === "completing")?.targetNumber ?? null;
  const projectedCompetent = completingTarget != null ? competencyAdjustedCompletion(completingTarget, competency.competencyReadiness) : null;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">← {program.institution.name}</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {program.name}
              {program.status === "draft" && <span className="badge ml-2 bg-slate-200 text-slate-600 align-middle">draft</span>}
            </h1>
            <p className="text-sm text-slate-500">
              {program.occupation?.title}{program.occupation ? ` · SOC ${program.occupation.socCode}` : ""} · {program.programType} · {program.credential}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              This is the <strong>program template</strong> — the timeless structure (terms, courses, sessions, KSAs). A
              <strong> scheduled offering</strong> below instantiates it for a cohort with real dates, instructors, and students.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="self-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">Template:</span>
            <Link href={`/programs/${program.id}/flow`} className="btn-primary">Curriculum flow ↦</Link>
            <Link href={`/programs/${program.id}/structure`} className="btn-ghost">Design structure</Link>
            <Link href={`/programs/${program.id}/sequencer`} className="btn-ghost">Sequence</Link>
            <a href={`/api/programs/${program.id}/export?enrollment=${defaultEnrollment}`} className="btn-ghost">Export Excel ↓</a>
            <form action={duplicateProgram.bind(null, program.id)}><button className="btn-ghost">Duplicate</button></form>
            <form action={deleteProgram.bind(null, program.id)}><button className="btn-ghost text-rose-600">Delete</button></form>
          </div>
        </div>
      </div>

      {/* Scheduled offerings (instantiations of the template) */}
      <section className="card card-pad space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Scheduled offerings <span className="text-sm font-normal text-slate-400">— runs of this template</span></h2>
          <span className="text-xs text-slate-400">{offerings.length} offering{offerings.length === 1 ? "" : "s"}</span>
        </div>
        {offerings.length === 0 ? (
          <p className="text-sm text-slate-400">No offerings yet. A cohort with a start date becomes a scheduled run of this template.</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {offerings.map((o) => {
              const STATUS: Record<string, string> = { active: "bg-emerald-100 text-emerald-700", planned: "bg-sky-100 text-sky-700", completed: "bg-slate-200 text-slate-600", archived: "bg-slate-100 text-slate-400" };
              return (
                <div key={o.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Link href={`/programs/${program.id}/offerings/${o.id}`} className="font-semibold text-slate-800 hover:text-rose-700 hover:underline">{o.name}</Link>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {o.startDate ? `starts ${o.startDate.toISOString().slice(0, 10)}` : "no start date"} · {o.cohortTerms.length} scheduled term{o.cohortTerms.length === 1 ? "" : "s"} · {o._count.students} students · {o._count.sessionStaff} staff assignments
                      </div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[o.status] ?? "bg-slate-100 text-slate-600"}`}>{o.status}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/programs/${program.id}/offerings/${o.id}`} className="btn-ghost text-xs">Overview</Link>
                    <Link href={`/programs/${program.id}/schedule?offering=${o.id}`} className="btn-ghost text-xs">Calendar &amp; staffing ↦</Link>
                    <Link href={`/programs/${program.id}/students`} className="btn-ghost text-xs">Students ↦</Link>
                    <Link href={`/programs/${program.id}/wbl`} className="btn-ghost text-xs">WBL board ↦</Link>
                    <Link href={`/programs/${program.id}/plan`} className="btn-ghost text-xs">Operations plan</Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {bottleneck?.hasBottleneck && (
        <Link href={`/programs/${program.id}/plan`} className="block rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100">
          ⚠ <strong>{bottleneck.bottleneckCount}</strong> capacity bottleneck{bottleneck.bottleneckCount === 1 ? "" : "s"} across the multi-cohort plan —
          peak need {fmt.fte(bottleneck.peak.facultyFte)} faculty FTE / {fmt.num(bottleneck.peak.clinicalSlots)} clinical slots vs. supply of {fmt.fte(bottleneck.supply.facultyFte)} FTE / {fmt.num(bottleneck.supply.wblSlots)} slots. See the operations plan →
        </Link>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="North Star" value={fmt.num(northStar?.credentialTarget)} sub="grads / yr (regional need)" />
        <Kpi label="Cohort capacity needed" value={fmt.num(northStar?.cohortCapacity)} sub="seats to hit goal" />
        <Kpi label="Terms in sequence" value={fmt.num(program.terms.length)} />
        <Kpi label="KSA coverage" value={fmt.pct(coverage.coverageRate)} sub={`${coverage.met}/${coverage.total} benchmarks met`} />
      </div>

      {/* Talent-pipeline funnel */}
      {cohort && (
        <section className="card card-pad space-y-1">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Talent pipeline — {cohort.name}</h2>
            <span className="text-xs text-slate-400">target vs. actual · {totalSessions} sessions/student</span>
          </div>
          <FunnelChart programId={program.id} stages={cohort.stages.map((s) => ({ key: s.stageKey as StageKey, label: s.label, target: s.targetNumber, actual: s.actualNumber }))} />
          {projectedCompetent != null && (
            <div className={`mt-3 rounded-lg px-3 py-2 text-xs ${competency.competencyReadiness < 1 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
              <strong>Competency-adjusted completion (loop 1):</strong> with {fmt.pct(competency.competencyReadiness)} of core competencies assessed to target, ~
              <strong>{fmt.num(projectedCompetent)}</strong> of the {fmt.num(completingTarget)} planned completers are <em>verifiably</em> competent. Unassessed core skills can&apos;t be certified — close the gap in the structure editor.
            </div>
          )}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-rose-700">Edit funnel numbers</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {cohort.stages.map((s) => (
                <form key={s.id} action={updateFunnelStage.bind(null, s.id, program.id)} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 text-xs text-slate-600">{s.label}</span>
                  <input name="target" type="number" step="0.1" defaultValue={s.targetNumber ?? ""} placeholder="target" className="input-sm w-20" />
                  <input name="actual" type="number" step="0.1" defaultValue={s.actualNumber ?? ""} placeholder="actual" className="input-sm w-20" />
                  <button className="text-xs text-rose-700">Save</button>
                </form>
              ))}
            </div>
          </details>
        </section>
      )}

      {/* Capacity engine */}
      <section className="card card-pad space-y-3">
        <h2 className="text-lg font-semibold">Capacity engine</h2>
        <CapacityWorkbench terms={archetype} defaultEnrollment={defaultEnrollment} />
      </section>

      {/* KSA / curriculum coverage */}
      <section className="card card-pad space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Graduate proficiency benchmarks (KSAs)</h2>
          <span className="text-xs text-slate-400">core coverage {fmt.pct(coverage.coreCoverageRate)} · assessed {fmt.pct(assessment.assessmentRate)}</span>
        </div>
        {assessment.unassessed.length > 0 && (
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Taught but never <strong>assessed</strong>: {assessment.unassessed.map((u) => u.skillName).join(", ")}. Tag sessions as ASSESS in the structure editor to close the loop.
          </div>
        )}
        {coverage.skills.length === 0 ? (
          <p className="text-sm text-slate-500">No skills benchmarked yet. Add one below from the skill library.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Skill</th>
                  <th className="th text-center">Benchmark</th>
                  <th className="th text-center">Curriculum reaches</th>
                  <th className="th">Status</th>
                  <th className="th">Developed by</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {coverage.skills.map((s) => {
                  const ps = program.programSkills.find((p) => p.skillId === s.skillId)!;
                  return (
                    <tr key={s.skillId}>
                      <td className="td">
                        <Link href={`/skills/${s.skillId}`} className="font-medium text-rose-700 hover:underline">{s.skillName}</Link>
                        {s.priority === "core" && <span className="ml-1 text-[10px] text-slate-400">core</span>}
                      </td>
                      <td className="td text-center font-medium">L{s.targetLevel}</td>
                      <td className="td text-center">{s.reachedLevel ? `L${s.reachedLevel}` : "—"}</td>
                      <td className="td"><span className={`badge ${STATUS_COLOR[s.status]}`}>{s.status.replace("_", " ").toLowerCase()}</span></td>
                      <td className="td text-xs text-slate-500">{s.contributingCourses.map((c) => c.courseName).join(", ") || "—"}</td>
                      <td className="td text-right">
                        <form action={removeProgramSkill.bind(null, ps.id, program.id)}><button className="text-xs text-slate-300 hover:text-rose-600">✕</button></form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <form action={addProgramSkill.bind(null, program.id)} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Add benchmark</span>
            <select name="skillId" required className="input-sm w-56">
              <option value="">Select a skill…</option>
              {library.filter((sk) => !mappedSkillIds.has(sk.id)).map((sk) => (
                <option key={sk.id} value={sk.id}>{sk.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Target level</span>
            <select name="targetLevel" className="input-sm w-32">
              {(scale?.levels ?? []).map((l) => <option key={l.id} value={l.level}>L{l.level} · {l.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Priority</span>
            <select name="priority" className="input-sm w-28">
              <option value="core">core</option>
              <option value="supporting">supporting</option>
            </select>
          </label>
          <button className="btn-primary">Add</button>
          <Link href="/skills" className="text-xs text-slate-400 hover:text-slate-600">manage library →</Link>
        </form>
      </section>

      {/* Program structure (read-only overview; edit on the structure page) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Program structure</h2>
          <Link href={`/programs/${program.id}/structure`} className="text-sm text-rose-700 hover:underline">Edit structure →</Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {program.terms.map((term) => (
            <div key={term.id} className="card card-pad">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{term.name}</h3>
                <span className="text-xs text-slate-400">weeks {term.startWeek}–{term.endWeek}</span>
              </div>
              <div className="mt-3 space-y-3">
                {term.courses.map((course) => {
                  const counts = { CLASS: 0, LAB: 0, CLINICAL: 0 } as Record<string, number>;
                  course.sessions.forEach((s) => (counts[s.kind] += 1));
                  return (
                    <Link key={course.id} href={`/courses/${course.id}`} className="block rounded-lg border border-slate-100 bg-slate-50/50 p-3 transition-colors hover:bg-slate-100">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">
                          {course.code ? <span className="text-slate-400">{course.code} · </span> : null}{course.name}
                        </div>
                        <div className="flex gap-1">
                          {counts.CLASS > 0 && <span className="badge bg-sky-100 text-sky-700">{counts.CLASS} class</span>}
                          {counts.LAB > 0 && <span className="badge bg-violet-100 text-violet-700">{counts.LAB} lab</span>}
                          {counts.CLINICAL > 0 && <span className="badge bg-rose-100 text-rose-700">{counts.CLINICAL} clinical</span>}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {course.weeklyClassHours}h class · {course.weeklyLabHours}h lab · {course.weeklyClinicalHours}h clinical / wk
                        {course.courseSkills.length > 0 && <span className="text-slate-400"> · {course.courseSkills.length} KSAs</span>}
                      </div>
                    </Link>
                  );
                })}
                {term.courses.length === 0 && <p className="text-xs text-slate-400">No courses yet.</p>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card card-pad">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
