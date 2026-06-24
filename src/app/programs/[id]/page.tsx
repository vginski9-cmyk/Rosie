import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgramFull, getProgramArchetype } from "@/lib/queries";
import { FunnelChart } from "@/components/FunnelChart";
import { CapacityWorkbench } from "@/components/CapacityWorkbench";
import { fmt } from "@/lib/format";
import type { StageKey } from "@/lib/funnel";

export const dynamic = "force-dynamic";

export default async function ProgramPage({ params }: { params: { id: string } }) {
  const program = await getProgramFull(params.id);
  if (!program) notFound();
  const archetype = await getProgramArchetype(params.id);

  const cohort = program.cohorts[0];
  const northStar = program.yearTargets.find((t) => t.credentialTarget != null);
  const defaultEnrollment = Math.round(northStar?.cohortCapacity ?? 40);
  const totalSessions = archetype.reduce(
    (n, t) => n + t.courses.reduce((m, c) => m + c.sessions.length, 0),
    0,
  );

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">
          ← {program.institution.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{program.name}</h1>
            <p className="text-sm text-slate-500">
              {program.occupation?.title} · SOC {program.occupation?.socCode} · {program.programType} · {program.credential}
            </p>
          </div>
          <Link href={`/programs/${program.id}/sequencer`} className="btn-primary">
            Sequence courses ↦
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="North Star" value={fmt.num(northStar?.credentialTarget)} sub="grads / yr (regional need)" />
        <Kpi label="Cohort capacity needed" value={fmt.num(northStar?.cohortCapacity)} sub="seats to hit goal" />
        <Kpi label="Terms in sequence" value={fmt.num(program.terms.length)} />
        <Kpi label="Required sessions" value={fmt.num(totalSessions)} sub="per student, full program" />
      </div>

      {/* Talent-pipeline funnel */}
      {cohort && (
        <section className="card card-pad space-y-1">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Talent pipeline — {cohort.name}</h2>
            <span className="text-xs text-slate-400">target vs. actual</span>
          </div>
          <p className="mb-3 text-sm text-slate-500">
            From regional demand (North Star) back up to the interest required to hit it. Pale bar = plan target, solid =
            actual.
          </p>
          <FunnelChart
            stages={cohort.stages.map((s) => ({
              key: s.stageKey as StageKey,
              label: s.label,
              target: s.targetNumber,
              actual: s.actualNumber,
            }))}
          />
        </section>
      )}

      {/* Capacity engine */}
      <section className="card card-pad space-y-3">
        <h2 className="text-lg font-semibold">Capacity engine</h2>
        <CapacityWorkbench terms={archetype} defaultEnrollment={defaultEnrollment} />
      </section>

      {/* Program structure */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Program structure</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {program.terms.map((term) => (
            <div key={term.id} className="card card-pad">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{term.name}</h3>
                <span className="text-xs text-slate-400">
                  weeks {term.startWeek}–{term.endWeek}
                </span>
              </div>
              <div className="mt-3 space-y-3">
                {term.courses.map((course) => {
                  const counts = { CLASS: 0, LAB: 0, CLINICAL: 0 } as Record<string, number>;
                  course.sessions.forEach((s) => (counts[s.kind] += 1));
                  return (
                    <div key={course.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium">
                          {course.code ? <span className="text-slate-400">{course.code} · </span> : null}
                          {course.name}
                        </div>
                        <div className="flex gap-1">
                          {counts.CLASS > 0 && <Tag color="bg-sky-100 text-sky-700">{counts.CLASS} class</Tag>}
                          {counts.LAB > 0 && <Tag color="bg-violet-100 text-violet-700">{counts.LAB} lab</Tag>}
                          {counts.CLINICAL > 0 && <Tag color="bg-rose-100 text-rose-700">{counts.CLINICAL} clinical</Tag>}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {course.weeklyClassHours}h class · {course.weeklyLabHours}h lab · {course.weeklyClinicalHours}h
                        clinical per week
                      </div>
                    </div>
                  );
                })}
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

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return <span className={`badge ${color}`}>{children}</span>;
}
